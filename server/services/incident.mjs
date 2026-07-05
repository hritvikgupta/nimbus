/**
 * Incident orchestrator — the wire that turns a detected incident into a FIX, per
 * docs/shared-compute-repair.md. This is the decision point in the diagram:
 *
 *   detect (CloudWatch/GCP)  →  root-cause (read-only, Nimbus cloud)  →  DISPATCH the fix:
 *        · a worker is online for this user + the project has a repo  →  push the fix to the worker
 *          (it drives that machine's Claude Code → opens a PR)
 *        · otherwise                                                  →  central fallback (record the
 *          triage; the manual ops agent / a human takes it from here — no surprise auto-PR)
 *
 * Called by the webhook receiver (real-time) and the scheduled scan (safety net).
 */
import { investigate } from '../agents/ops/run.mjs'
import { getProjectRepo } from '../repositories/projects.mjs'
import { listWorkers, createTask, dispatch, pushStep } from './repair.mjs'
import { composeBrief } from './brief.mjs'
import { startConversation } from './conversation.mjs'
import { addIncident } from '../repositories/ops.mjs'

/**
 * Route an incident to a fix.
 * @param {string} userId
 * @param {{ title:string, text?:string, hypothesis?:string, service?:string, logExcerpts?:string[] }} incident
 *   Pass `hypothesis` to skip the read-only investigate pass (e.g. the scan already produced a report).
 */
export async function handleIncident(userId, incident) {
  const { title = 'Incident', text = '', service = 'auto', logExcerpts = [] } = incident || {}

  // 1. ROOT-CAUSE on Nimbus cloud (read-only) — unless the caller already has a report.
  let hypothesis = incident?.hypothesis || ''
  if (!hypothesis && text) {
    try {
      const out = await investigate(userId, text)
      hypothesis = out?.ok ? out.report : (out?.skipped ? `(not investigated: ${out.skipped})` : '')
    } catch (e) { console.error('[incident] investigate failed', e?.message || e) }
  }

  // 2. Find the repo to fix (active/first project's bound repo).
  const repo = getProjectRepo(userId)

  // 3. DISPATCH: prefer an online worker (shared compute); else central fallback.
  const workers = listWorkers(userId)
  if (repo && workers.length) {
    const task = createTask({
      userId, projectId: null, repo,
      incident: { service, severity: 'down', summary: title, hypothesis, logExcerpts },
    })
    // Nimbus frames a grounded brief from the root cause + repo before handing it to the worker.
    pushStep(userId, task.id, { phase: 'framing', text: 'Nimbus is framing the fix from the root cause…' })
    const brief = await composeBrief(userId, null, { request: title, hypothesis, logs: logExcerpts })
    task.incident = { ...task.incident, brief }
    const d = dispatch(task)
    if (d.ok) {
      startConversation(userId, task.id, brief, repo) // Nimbus pairs with Claude turn-by-turn
      addIncident(userId, { source: service, title, report: `${hypothesis || '(triage pending)'}\n\n→ Dispatched fix to worker ${d.workerId} (task ${task.id}).` })
      console.log(`[incident] ${userId}: dispatched fix to worker ${d.workerId} (task ${task.id})`)
      return { routed: 'worker', taskId: task.id, workerId: d.workerId, repo }
    }
  }

  // central fallback — record the triage; a human / the manual ops agent takes it (no auto-PR).
  addIncident(userId, { source: service, title, report: hypothesis || (repo ? '(no worker online — left for central/manual repair)' : '(no repo connected to a project)') })
  console.log(`[incident] ${userId}: no worker available → central fallback (${repo ? 'repo set' : 'no repo'})`)
  return { routed: 'central', repo }
}
