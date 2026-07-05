/**
 * Conversation driver — Nimbus pairing with Claude. For each repair, the SAME Nimbus ReAct agent
 * holds a turn-by-turn dialogue with the Claude on the worker (over the bridge), async, until the
 * issue is resolved. Not a one-shot, not a fixed-timer watchdog — a maintained conversation.
 *
 *   send instruction → Claude replies (worker reports it) → Nimbus reads it + responds → repeat
 *   → Nimbus says DONE (finalize → PR) or STOP (abort).
 */
import { runAgentChat } from '../agents/chat/run.mjs'
import { getTask, pushControl, pushStep, waitTurn } from './repair.mjs'

const MAX_TURNS = 16

export function startConversation(userId, taskId, brief, repo, projectId = null, executor = 'Claude Code') {
  const skill = `You are Nimbus pairing with ${executor} (the executor) to carry out a task in the repo "${repo}".
${executor} does the actual editing on the machine, in a LOCAL clone you cannot see. It holds the
ground truth about the files — you do NOT. Never claim what is or isn't in the code yourself; you have no
access to its working copy. Drive it like a senior engineer over chat, one message at a time, using ONLY
what ${executor} tells you.
After each of its replies, reply with EXACTLY one of:
  · a concrete next instruction (build on what it just reported), OR
  · if you want to confirm something, ASK it for evidence (e.g. "show the diff" / "grep for X and paste it") — never assert it yourself, OR
  · "DONE" — when it has reported the task implemented + verified (tests/checks it ran), OR
  · "STOP: <reason>" — if it's clearly going wrong.
If it says it already did something, trust it (or ask it to show proof) — do not insist it hasn't.
Keep it natural and specific.`

  const messages = [{
    role: 'user',
    content: `Task to accomplish (already sent to Claude as its first instruction):\n${brief}\n\nWait for Claude's replies and drive it to completion.`,
  }]

  ;(async () => {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const reply = await waitTurn(userId, taskId)            // Claude's latest reply
      const t = getTask(userId, taskId)
      if (!t || ['done', 'failed', 'stopped'].includes(t.status)) return
      if (reply == null) { pushControl(userId, taskId, { type: 'done' }); return } // Claude ended/idle → finalize
      messages.push({ role: 'user', content: `Claude replied:\n${reply}` })

      let next = ''
      try { next = (await runAgentChat({ userId, messages, systemAppend: skill, maxOutputTokens: 500, bare: true })).trim() }
      catch { pushControl(userId, taskId, { type: 'done' }); return }
      messages.push({ role: 'assistant', content: next })

      if (/^\s*DONE\b/i.test(next)) { pushStep(userId, taskId, { phase: 'supervise', text: 'Nimbus: task looks complete — finalizing.' }); pushControl(userId, taskId, { type: 'done' }); return }
      if (/^\s*STOP\b/i.test(next)) { pushControl(userId, taskId, { type: 'stop', reason: next.replace(/^\s*STOP:?\s*/i, '').slice(0, 160) }); return }
      pushControl(userId, taskId, { type: 'message', text: next })   // tell Claude the next step
    }
    pushControl(userId, taskId, { type: 'done' }) // turn cap reached → finalize what we have
  })().catch(() => {})
}
