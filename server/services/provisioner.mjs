/** Fly Machines provisioner — boots and destroys a rented machine via Fly's REST Machines API.
 *
 * REAL mode: when FLY_APP (+ a Fly token + optionally FLY_MACHINE_IMAGE) is set, we actually create
 * and destroy Fly Machines. SIMULATED mode (default): no app configured → we mint a synthetic
 * machine id and skip the API, so the whole lifecycle (provision → run → expire → destroy → meter)
 * is exercised end-to-end without booting real infra or spending money. See docs/rented-compute.md. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const FLY_API = 'https://api.machines.dev/v1'

// Prefer an explicit env token, else the locally logged-in flyctl token (~/.fly/config.yml).
export function flyToken() {
  const env = process.env.FLY_API_TOKEN || process.env.FLY_ACCESS_TOKEN
  if (env) return env
  try {
    const cfg = readFileSync(join(homedir(), '.fly', 'config.yml'), 'utf8')
    const m = cfg.match(/^access_token:\s*(.+)$/m)
    return m ? m[1].trim() : ''
  } catch { return '' }
}

const flyApp = () => process.env.FLY_APP || 'nimbus-rented'
const flyRegion = () => process.env.FLY_REGION || 'iad'
// A real, public base image with node+npm+git (node:20 full includes git; slim does not).
const image = () => process.env.FLY_MACHINE_IMAGE || 'node:20'

// Install command + credential env var for each supported agent.
const AGENT_INSTALL = {
  claude: 'npm i -g @anthropic-ai/claude-code',
  codex: 'npm i -g @openai/codex',
  opencode: 'npm i -g opencode-ai',
}
const AGENT_KEY_ENV = { claude: 'ANTHROPIC_API_KEY', codex: 'OPENAI_API_KEY', opencode: 'OPENAI_API_KEY' }

// Backward-compat: older rentals stored the CLI in `model`; new ones use `agent` + a real `model`.
const agentOf = (r) => r.agent || r.model || 'claude'
const modelOf = (r) => (r.agent ? (r.model || '') : '')

// A GitHub token for cloning the project's (possibly private) repo onto the machine.
function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try { return execSync('gh auth token', { encoding: 'utf8' }).trim() } catch { return '' }
}
// Absolute paths — $HOME is unreliable/empty in Fly's exec + init environment, so never use it.
const HOME = '/root'
const NIMBUS_DIR = `${HOME}/.nimbus`         // ready marker etc. (accessed by US via exec, not the agent)
const WORKDIR = `${HOME}/workspace`          // the agent runs here (the cloned repo)
// The summary MUST live inside the workspace — agents like OpenCode sandbox file access to the project
// dir and auto-reject anything outside it. Kept out of git via .git/info/exclude at boot.
const SUMMARY_DIR = `${WORKDIR}/.nimbus`
const SUMMARY_FILE = `${SUMMARY_DIR}/summary.md`

// Can we talk to Fly for real? Needs an app + a token. (App defaults to nimbus-rented.)
export function canProvision() { return !!(flyApp() && flyToken()) }

// Ensure the Fly app exists (create it if it was deleted) so boots never 404 with "app not found".
async function ensureApp(app, tok) {
  const g = await fetch(`${FLY_API}/apps/${app}`, { headers: { Authorization: `Bearer ${tok}` } })
  if (g.ok) return
  const c = await fetch(`${FLY_API}/apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_name: app, org_slug: process.env.FLY_ORG || 'personal' }),
  })
  if (!c.ok && c.status !== 409) throw new Error(`Fly app create failed (${c.status}): ${await c.text().catch(() => '')}`)
}

// Boot a REAL Fly machine for a rental → { machineId, region }. The machine installs the chosen
// coding agent (with the user's API key injected as env) and stays up for the rental's lifetime.
export async function bootRental(rental) {
  const app = flyApp(), tok = flyToken()
  if (!tok) throw new Error('no Fly token available to provision a machine')
  await ensureApp(app, tok) // self-heal if the app was deleted

  const guest = {
    cpu_kind: rental.cpuKind === 'dedicated' ? 'performance' : 'shared',
    cpus: rental.cpus || 1,
    // Floor at 1 GB — the agent CLIs are heavy and OOM/hang installing on 256 MB.
    memory_mb: Math.max(rental.memoryMb || 256, 1024),
  }
  const agent = agentOf(rental)
  const ghTok = githubToken()
  const env = { NIMBUS_RENTAL: rental.id, NIMBUS_AGENT: agent, NIMBUS_PROJECT: rental.projectId || '' }
  if (rental.apiKey) {
    if (agent === 'claude') {
      // Claude Code authenticates against a Claude SUBSCRIPTION via an OAuth token (from our
      // "Connect" flow / `claude setup-token`), NOT an Anthropic API key. Keep ANTHROPIC_API_KEY
      // UNSET so the subscription token is used and no per-token API charges are incurred.
      env.CLAUDE_CODE_OAUTH_TOKEN = rental.apiKey
    } else if (agent === 'opencode') {
      // OpenCode uses OpenRouter (the "any provider" gateway — one key, every model).
      env.OPENROUTER_API_KEY = rental.apiKey
    } else if (AGENT_KEY_ENV[agent]) {
      env[AGENT_KEY_ENV[agent]] = rental.apiKey
    }
  }
  if (ghTok) { env.GITHUB_TOKEN = ghTok; env.GH_TOKEN = ghTok } // so the agent can push / open PRs
  env.GIT_TERMINAL_PROMPT = '0' // never let git hang waiting for a credential prompt

  const install = AGENT_INSTALL[agent] || 'true'
  // Clone the project's connected repo (auth with the token for private repos) into the workdir.
  // Prompts off + a hard timeout so a bad clone can NEVER hang the bootstrap.
  const repo = rental.repo || ''
  const cloneUrl = repo ? (ghTok ? `https://x-access-token:${ghTok}@github.com/${repo}.git` : `https://github.com/${repo}.git`) : ''
  const clone = repo ? `GIT_TERMINAL_PROMPT=0 timeout 180 git clone --depth 1 ${cloneUrl} ${WORKDIR} 2>&1 | tail -2 || true;` : ''

  // The FULL bootstrap runs at boot: memory dir → install agent → clone repo → mark READY → idle.
  // The machine only goes "green" once $HOME/.nimbus/ready exists (see isReady), so the user can chat
  // immediately with a fully-provisioned machine.
  const ensureGit = '(command -v git >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq git))'
  // Make the summary dir inside the workspace + keep it out of git, then mark ready.
  const summaryDir = `mkdir -p ${SUMMARY_DIR}; [ -d ${WORKDIR}/.git ] && (grep -q '.nimbus/' ${WORKDIR}/.git/info/exclude 2>/dev/null || echo '.nimbus/' >> ${WORKDIR}/.git/info/exclude) || true;`
  const bootstrap = `mkdir -p ${NIMBUS_DIR}; ${ensureGit}; ${install}; ${clone} ${summaryDir} touch ${NIMBUS_DIR}/ready; echo nimbus-ready; sleep infinity`
  const body = {
    region: flyRegion(),
    config: {
      image: image(),
      guest,
      auto_destroy: false, // WE own teardown (time-based), not Fly's on-exit destroy
      env,
      init: { exec: ['bash', '-lc', bootstrap] },
    },
  }
  const res = await fetch(`${FLY_API}/apps/${app}/machines`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Fly boot failed (${res.status}): ${await res.text().catch(() => '')}`)
  const m = await res.json()
  return { machineId: m.id, region: m.region || null }
}

// Destroy a rental's machine (idempotent — 404 is fine, it's already gone).
export async function destroyRental(rental) {
  if (!rental.machineId || !flyToken()) return { ok: true }
  const app = flyApp(), tok = flyToken()
  const res = await fetch(`${FLY_API}/apps/${app}/machines/${rental.machineId}?force=true`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tok}` },
  })
  if (!res.ok && res.status !== 404) throw new Error(`Fly destroy failed (${res.status})`)
  return { ok: true }
}

// Is the machine fully bootstrapped? (ready marker written AND the agent CLI installed.) The rental
// only goes "green"/running once this is true, so the user can chat the moment they see the light.
export async function isReady(rental) {
  const bin = AGENT_BIN[agentOf(rental)] || 'claude'
  try {
    const out = await runExec(rental, ['bash', '-lc', `test -f ${NIMBUS_DIR}/ready && command -v ${bin} >/dev/null 2>&1 && echo READY || echo NO`], 30)
    return (out.stdout || '').includes('READY')
  } catch { return false }
}

// Current Fly state of a rental's machine ('created' | 'starting' | 'started' | 'stopped' | …).
export async function machineState(rental) {
  const app = flyApp(), tok = flyToken()
  if (!rental.machineId || !tok) return null
  const res = await fetch(`${FLY_API}/apps/${app}/machines/${rental.machineId}`, { headers: { Authorization: `Bearer ${tok}` } })
  if (!res.ok) return null
  return (await res.json()).state || null
}

// Run a command inside the machine via Fly exec → { stdout, stderr, exit_code }.
export async function runExec(rental, command, timeout = 120) {
  const app = flyApp(), tok = flyToken()
  if (!rental.machineId) throw new Error('machine not booted')
  const res = await fetch(`${FLY_API}/apps/${app}/machines/${rental.machineId}/exec`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, timeout }),
  })
  if (!res.ok) throw new Error(`exec failed (${res.status}): ${await res.text().catch(() => '')}`)
  return res.json()
}

// Single-quote a string for safe embedding in a bash -lc command.
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
const AGENT_BIN = { claude: 'claude', codex: 'codex', opencode: 'opencode' }

// Non-interactive one-shot per agent, in STRUCTURED output mode (clean parse, no TUI/ANSI noise) with
// tool permissions auto-approved. No redirects here — the launcher handles output capture.
const agentCmd = (agent, msg, cont, mdl) => {
  if (agent === 'codex') return `codex exec --json ${mdl ? `-m ${shq(mdl)} ` : ''}${shq(msg)}`
  if (agent === 'opencode') return `opencode run --format json --auto ${mdl ? `-m ${shq(mdl)} ` : ''}${shq(msg)}`
  return `claude ${cont ? '-c ' : ''}${mdl ? `--model ${shq(mdl)} ` : ''}--output-format json --permission-mode acceptEdits -p ${shq(msg)}` // claude
}

// Turn ONE structured-output event into live progress steps (the agent's internal thinking + tool
// use, shown as it works). Returns an array (an event can yield reasoning AND a tool step). Each step
// carries a stable `id` so the poll loop — which re-reads the whole growing file — never re-emits it.
// Schemas verified against real live output (opencode `run --format json`, claude `stream-json`).
function eventToSteps(agent, ev) {
  const out = []
  const t = ev?.type || ''
  if (agent === 'opencode') {
    const part = ev.part || {}
    const pid = part.id || part.callID || ev.id || ''
    // Internal reasoning rides along on tool/step events under metadata.openrouter.reasoning_details.
    const rd = part.metadata?.openrouter?.reasoning_details || ev.metadata?.openrouter?.reasoning_details
    if (Array.isArray(rd)) {
      const think = rd.map((r) => r?.text).filter(Boolean).join(' ').trim()
      if (think) out.push({ id: pid + ':think', phase: 'think', text: think.slice(0, 500) })
    }
    // Tool call → e.g. "read package.json" / "bash npm test".
    if (t === 'tool_use' || part.type === 'tool') {
      const name = part.tool || part.name || 'tool'
      const arg = part.title || firstArg(part.state?.input || part.input)
      out.push({ id: pid + ':tool', phase: 'tool', text: arg ? `${name} ${arg}` : name })
    }
    return out
  }
  if (agent === 'claude') {
    // claude --output-format stream-json: assistant messages carry content blocks.
    const blocks = ev.type === 'assistant' ? (ev.message?.content || []) : []
    for (const b of blocks) {
      if (b.type === 'thinking' && b.thinking) out.push({ id: (b.id || '') + ':think', phase: 'think', text: String(b.thinking).slice(0, 500) })
      if (b.type === 'tool_use') { const arg = firstArg(b.input); out.push({ id: (b.id || '') + ':tool', phase: 'tool', text: arg ? `${b.name} ${arg}` : b.name }) }
    }
    return out
  }
  // codex: best-effort — tool events
  if (t.includes('tool')) out.push({ id: (ev.id || t) + ':tool', phase: 'tool', text: (ev.name || ev.tool || 'tool') })
  return out
}
// A short human label from a tool's input object (first path/command/pattern-ish value).
function firstArg(input) {
  if (!input || typeof input !== 'object') return ''
  const v = input.filePath || input.path || input.command || input.pattern || input.query || Object.values(input)[0]
  return v == null ? '' : String(v).split('/').slice(-1)[0].slice(0, 60)
}

// Parse the agent's structured output → the final assistant text.
function parseReply(agent, raw) {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  if (agent === 'opencode') {
    // JSONL — `text` events stream updates per part. Dedupe by part.id (last update wins), keep order.
    const byPart = new Map(); const order = []
    for (const l of lines) {
      if (!l.startsWith('{')) continue
      try {
        const ev = JSON.parse(l)
        if (ev.type === 'text' && ev.part?.text != null) {
          const id = ev.part.id || ev.part.messageID || order.length
          if (!byPart.has(id)) order.push(id)
          byPart.set(id, ev.part.text)
        }
      } catch { /* skip */ }
    }
    return order.map((id) => byPart.get(id)).join('').trim()
  }
  if (agent === 'claude') {
    // A single JSON object with `.result`. Fall back to scanning lines if stderr got mixed in.
    for (const l of [raw.trim(), ...lines.reverse()]) {
      try { const j = JSON.parse(l); if (typeof j.result === 'string') return j.result.trim(); if (typeof j.text === 'string') return j.text.trim() } catch { /* skip */ }
    }
    return ''
  }
  if (agent === 'codex') {
    // JSONL of items — take the last assistant/agent message text.
    let last = ''
    for (const l of lines) { try { const ev = JSON.parse(l); const t = ev?.message || ev?.text || ev?.content || ev?.item?.text; if (typeof t === 'string' && t.trim()) last = t } catch { /* skip */ } }
    return last.trim()
  }
  return raw.trim()
}

// Drive the machine's agent for one turn → { ready, reply }.
//
// Fly's synchronous exec caps at ~60s, but an agentic task (edit files → git → open PR) runs for
// minutes. So we launch the agent in the BACKGROUND (writing structured output to a file) and POLL
// short execs until the process exits, then read + parse the file. `ready:false` = CLI not installed
// yet (init still running).
export async function agentChat(rental, message, cont, model, { onDelta, onStep } = {}) {
  const agent = agentOf(rental)
  const bin = AGENT_BIN[agent] || 'claude'
  const mdl = model || modelOf(rental)

  const ready = await runExec(rental, ['bash', '-lc', `command -v ${bin} >/dev/null 2>&1 && echo YES || echo NO`], 30)
  if (!(ready.stdout || '').includes('YES')) return { ready: false, reply: '' }

  const tid = Math.random().toString(36).slice(2, 10)
  const outFile = `${NIMBUS_DIR}/turn-${tid}.out`
  const cmd = agentCmd(agent, message, cont, mdl)
  // Launch detached; echo the PID so we can poll for completion.
  const launch = await runExec(rental, ['bash', '-lc',
    `mkdir -p ${NIMBUS_DIR}; cd ${WORKDIR} 2>/dev/null || cd ${HOME}; nohup ${cmd} > ${outFile} 2>&1 & echo NIMBUS_PID=$!`], 60)
  const pid = ((launch.stdout || '').match(/NIMBUS_PID=(\d+)/) || [])[1]
  if (!pid) { // couldn't background it → read whatever landed
    const o = await runExec(rental, ['bash', '-lc', `cat ${outFile} 2>/dev/null`], 30)
    return { ready: true, reply: parseReply(agent, o.stdout || '') || 'The agent could not start this turn.' }
  }

  // Poll until the process exits (cap ~12 min). Each poll reads the growing output file AND checks
  // liveness in one exec, so we can STREAM the reply as it's produced (emit the delta as the parsed
  // text grows) — that's what turns the 3-dot wait into live, growing text in the UI.
  const deadline = Date.now() + 12 * 60 * 1000
  let running = true, last = '', lastRaw = ''
  const seen = new Set() // step ids already emitted (we re-read the whole growing file each poll)
  const SENTINEL = '__NIMBUS_LIVE__'
  const emit = (raw) => {
    if (raw === lastRaw) return
    lastRaw = raw
    // Stream the internal thinking + tool steps as they appear (new events only).
    if (onStep) {
      for (const line of raw.split('\n')) {
        const l = line.trim(); if (!l.startsWith('{')) continue
        let ev; try { ev = JSON.parse(l) } catch { continue }
        for (const s of eventToSteps(agent, ev)) {
          if (!s.id || seen.has(s.id)) continue
          seen.add(s.id); try { onStep(s) } catch { /* ignore */ }
        }
      }
    }
    // Stream the growing final reply text.
    if (onDelta) {
      const text = parseReply(agent, raw)
      if (text && text !== last) { last = text; try { onDelta(text) } catch { /* ignore */ } }
    }
  }
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500))
    const poll = await runExec(rental, ['bash', '-lc',
      `cat ${outFile} 2>/dev/null; echo ${SENTINEL}; kill -0 ${pid} 2>/dev/null && echo RUNNING || echo DONE`], 45).catch(() => null)
    if (!poll) continue
    const out = poll.stdout || ''
    const i = out.lastIndexOf(SENTINEL)
    const raw = i >= 0 ? out.slice(0, i) : out
    emit(raw)
    if (i >= 0 && out.slice(i).includes('DONE')) { running = false; emit(raw); break }
  }

  const o = await runExec(rental, ['bash', '-lc', `cat ${outFile} 2>/dev/null`], 60)
  runExec(rental, ['bash', '-lc', `rm -f ${outFile}`], 20).catch(() => {})
  const reply = parseReply(agent, o.stdout || '') || (running ? 'The task is still running — it’s taking longer than expected.' : '(the agent finished but produced no message)')
  return { ready: true, reply }
}

// ── Real model catalog, fetched from models.dev (the same registry OpenCode uses) — NOT hardcoded.
let _modelsDev = null, _modelsDevAt = 0
async function fetchModelsDev() {
  if (_modelsDev && Date.now() - _modelsDevAt < 6 * 3600 * 1000) return _modelsDev
  const res = await fetch('https://models.dev/api.json')
  if (!res.ok) throw new Error(`models.dev ${res.status}`)
  _modelsDev = await res.json(); _modelsDevAt = Date.now()
  return _modelsDev
}
// Real model list for an agent, fetched from models.dev. Claude → anthropic models, Codex → openai
// models, OpenCode → OpenRouter models (one key, every model → id = openrouter/<model>).
export async function agentModelCatalog(agent) {
  // Claude Code selects its model by ALIAS via --model (opus/sonnet/haiku), gated by the user's
  // subscription tier — NOT by the full anthropic API catalog (most of which a subscription token
  // can't run). So we offer the real CLI selectors the user can actually pick at rent time.
  if (agent === 'claude') return [
    { id: 'opus', label: 'Opus — most capable' },
    { id: 'sonnet', label: 'Sonnet — balanced (default)' },
    { id: 'haiku', label: 'Haiku — fastest' },
  ]
  const data = await fetchModelsDev().catch(() => null)
  if (!data) return []
  const modelsOf = (p) => Object.keys(data[p]?.models || {})
  if (agent === 'codex') return modelsOf('openai').map((m) => ({ id: m, label: m })).sort((a, b) => a.id.localeCompare(b.id))
  // opencode → OpenRouter: opencode model id is openrouter/<openrouter-model-id>
  return modelsOf('openrouter').map((m) => ({ id: `openrouter/${m}`, label: `openrouter/${m}` })).sort((a, b) => a.id.localeCompare(b.id))
}

// The models available for a rental's agent. OpenCode is fetched LIVE from the machine
// (`opencode models`); Claude/Codex use their known model ids.
export async function listAgentModels(rental) {
  const agent = agentOf(rental)
  if (agent === 'claude') {
    return [{ id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'haiku', label: 'Haiku' }]
  }
  if (agent === 'codex') {
    return [{ id: 'gpt-5-codex', label: 'gpt-5-codex' }, { id: 'gpt-5', label: 'gpt-5' }, { id: 'o4-mini', label: 'o4-mini' }]
  }
  // opencode → ask the machine for its real model list
  try {
    const out = await runExec(rental, ['bash', '-lc', 'command -v opencode >/dev/null 2>&1 && opencode models 2>/dev/null | head -60 || true'], 60)
    const ids = (out.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)
    return ids.map((id) => ({ id, label: id }))
  } catch { return [] }
}

// Read the machine's running summary.md (the agent maintains it). '' if missing.
export async function readSummary(rental) {
  try {
    const out = await runExec(rental, ['bash', '-lc', `cat ${SUMMARY_FILE} 2>/dev/null || true`], 30)
    return (out.stdout || '').trim()
  } catch { return '' }
}

// Seed a machine's summary.md with saved content (to RESUME a past session). base64 avoids escaping.
export async function seedSummary(rental, content) {
  if (!content) return
  const b64 = Buffer.from(content, 'utf8').toString('base64')
  await runExec(rental, ['bash', '-lc', `mkdir -p ${NIMBUS_DIR}; echo ${b64} | base64 -d > ${SUMMARY_FILE}`], 30)
}

// Metered actual cost = elapsed run time × the charged (marked-up) per-second rate.
export function meterCost(rental, endMs) {
  const start = rental.runningAt || rental.bootedAt || rental.startedAt // bill from when it went live
  if (!start || rental.priceSecondCharged == null) return null
  const secs = Math.max(0, ((endMs || Date.now()) - start) / 1000)
  return rental.priceSecondCharged * secs
}
