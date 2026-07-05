/** Rented-machine virtual worker — makes a rented Fly machine behave EXACTLY like a connected
 * computer. It plays the worker role on the SAME bridge as real machines (poll → run → report),
 * so the roster, direct machine sessions (MachineView), and Nimbus repair dispatch all work
 * unchanged. The only difference from a laptop worker: it executes the agent via Fly `exec` instead
 * of a locally-installed Claude Code. See docs/rented-compute.md + docs/shared-compute-repair.md. */
import { pollTask, pushStep, pushTurn, pushDelta, setResult, pollControl } from './repair.mjs'
import { agentChat, readSummary } from './provisioner.mjs'
import { listRentals } from '../repositories/rentals.mjs'
import { upsertSummary } from '../repositories/summaries.mjs'

const _loops = new Set() // owner:rentalId with a running loop (so we start it only once)

const currentRental = (owner, id) => listRentals(owner).find((r) => r.id === id) || null
const agentOf = (r) => r.agent || r.model || 'claude'

// The agent keeps a running SUMMARY of its work at this path on the machine. We never inject the
// content — we give the agent the FILE PATH: on a fresh session it reads it for context, and after
// every turn it appends what it did. That file IS the cross-session memory ("what was fixed last").
const SUMMARY = '/root/workspace/.nimbus/summary.md'
function withMemory(msg, isFirst) {
  const head = isFirst
    ? `[Context] A running work-summary from earlier sessions on this machine may exist at ${SUMMARY}. If it exists, read that file first for continuity (it may be empty or incomplete).\n\n`
    : ''
  const tail = `\n\n[Housekeeping] When you finish the above, append a short summary of what you did and what you fixed to ${SUMMARY} (create it if missing). Keep it a concise running log for future sessions.`
  return head + msg + tail
}

// Start the in-process worker loop for a running rental (idempotent).
export function ensureRentedWorker(owner, rentalId) {
  const key = owner + ':' + rentalId
  if (_loops.has(key)) return
  _loops.add(key)
  workerLoop(owner, rentalId)
    .catch((e) => console.error('[rented-worker]', rentalId, e?.message || e))
    .finally(() => _loops.delete(key))
}

async function workerLoop(owner, rentalId) {
  while (true) {
    const r = currentRental(owner, rentalId)
    if (!r || r.status !== 'running') return // machine gone → stop being its worker (drops off the roster)
    const info = { host: `Nimbus Cloud · ${r.size}`, os: 'fly', hasClaudeCode: true, rented: true, agent: agentOf(r), model: r.model }
    // Long-poll for a task targeted at this machine. This ALSO keeps it on the online roster.
    const task = await pollTask(owner, rentalId, info, { timeoutMs: 15000 })
    if (task) await runTask(owner, rentalId, task)
  }
}

// Run a task turn-by-turn by driving the machine's agent over Fly exec, honoring the same control
// commands (message / stop / done) that a real worker honors.
async function runTask(owner, rentalId, task) {
  pushStep(owner, task.id, { phase: 'framing', text: 'Running on your rented machine…' })

  const turn = async (msg, cont) => {
    const r = currentRental(owner, rentalId)
    if (!r) { setResult(owner, task.id, { status: 'stopped' }); return false }
    try {
      // isFirst = the first turn of this session (cont is false only then) → give the summary path.
      // onStep streams the agent's internal thinking + tool calls live; onDelta streams the growing
      // reply text — together this is the "professional" live stream, not a 3-dot wait.
      const out = await agentChat(r, withMemory(msg, !cont), cont, task.model || undefined, {
        onStep: (s) => pushStep(owner, task.id, s),
        onDelta: (text) => pushDelta(owner, task.id, text),
      })
      pushTurn(owner, task.id, out.ready ? out.reply : 'The agent is still installing on the machine — give it a few seconds, then message again.')
      // Sync the machine's running summary back to OUR store so it survives teardown / can be resumed.
      try { const content = await readSummary(r); if (content) upsertSummary(owner, { sourceId: r.id, projectId: r.projectId, agent: agentOf(r), size: r.size, content }) } catch { /* best-effort */ }
    } catch {
      // Transient (machine still warming up / brief exec hiccup) — don't kill the session.
      pushTurn(owner, task.id, 'The machine is still warming up — try again in a moment.')
    }
    return true
  }

  const prompt = task.incident?.brief || task.incident?.summary || ''
  if (prompt && !(await turn(prompt, false))) return

  // Control loop — same commands the real worker honors.
  while (true) {
    const cmd = await pollControl(owner, task.id, { timeoutMs: 300000 })
    if (!cmd) continue
    if (cmd.type === 'stop') { setResult(owner, task.id, { status: 'stopped' }); return }
    if (cmd.type === 'done') { setResult(owner, task.id, { status: 'done' }); return }
    if (cmd.type === 'message') { if (!(await turn(cmd.text, true))) return }
    // 'compact' → no-op for a rented machine
  }
}
