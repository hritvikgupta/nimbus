/**
 * Nimbus brief composer — Nimbus is the USER'S agent. Before a request is handed to the executor
 * (Claude Code on the worker), the SAME Nimbus ReAct agent (full toolset: repo, cloud, GitHub, logs)
 * reframes the user's raw request into a grounded, professional engineering BRIEF. Works for any
 * intent — a bug fix, a change, or a NEW FEATURE — never assumed or hardcoded.
 *
 * This does NOT make its own model call: it runs `runAgent` (the real agent), so it can actually
 * investigate the repo/cloud before writing the brief.
 */
import { runAgent } from '../agents/chat/run.mjs'
import { getProjectRepo } from '../repositories/projects.mjs'

export async function composeBrief(userId, projectId, { request = '', hypothesis = '', logs = [] } = {}) {
  const repo = getProjectRepo(projectId) // so the agent gets the repo tools + code context
  const instruction = `A teammate sent this request through Nimbus. Do NOT implement it — you are only
writing a TASK BRIEF that a coding agent (Claude Code) will then carry out in the connected repository.

REQUEST:
${request || '(none)'}
${hypothesis ? `\nROOT-CAUSE / CONTEXT you already found:\n${hypothesis}\n` : ''}${logs?.length ? `\nLOGS:\n${logs.join('\n').slice(0, 2000)}\n` : ''}

Use your tools to investigate the ACTUAL connected repo (and cloud/logs if relevant) so the brief is
specific to this codebase. The request may be a fix, a change, or a new feature — handle whatever it is.
Then output ONLY the brief as plain markdown: the goal (the user's real intent), the concrete files/areas
to change, the approach, and acceptance criteria / how to verify. No preamble, no implementation, no PR.`
  try {
    const text = await runAgent({ userId, instruction, mode: 'agent', projectId, repo, maxOutputTokens: 1200 })
    return (text || '').trim() || request
  } catch (e) {
    console.error('[brief] compose failed:', e?.message || e)
    return request // fall back to the raw request so the repair still runs
  }
}
