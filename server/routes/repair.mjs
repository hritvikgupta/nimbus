/**
 * Repair-with-shared-compute routes (Phase 1). See docs/shared-compute-repair.md.
 *   Worker side (held-open + reports):
 *     · GET  /api/repair/worker/stream                  → SSE the worker holds open; we push tasks down it
 *     · POST /api/repair/worker/tasks/:id/event         → worker reports a progress step
 *     · POST /api/repair/worker/tasks/:id/result        → worker reports the final result
 *   Control / UI side:
 *     · GET  /api/repair/workers                         → online worker roster (for the UI)
 *     · POST /api/repair/dispatch                        → create + push a repair task to a worker
 *     · GET  /api/repair/tasks/:id/stream                → SSE the UI watches for live progress
 */
import express from 'express'
import { requireUser } from '../middlewares/auth.mjs'
import { getProjectRepo, memberOwner, isMember, can } from '../repositories/projects.mjs'
import { createWorkerKey, listWorkerKeys, revokeWorkerKey, userForWorkerKey } from '../repositories/workerkeys.mjs'
import { composeBrief } from '../services/brief.mjs'
import { startConversation } from '../services/conversation.mjs'
import { createConversation, listConversations, getConversation, activeTaskFor, appendMessage, setConvMeta } from '../repositories/conversations.mjs'
import {
  listWorkers, pollTask, createTask, heartbeat, forgetWorker,
  getTask, getTaskById, listTasks, dispatch, pushStep, setResult, subscribeUi, unsubscribeUi,
  pushControl, pollControl, pushTurn,
} from '../services/repair.mjs'

const r = express.Router()
const EXECUTOR = { claude: 'Claude Code', opencode: 'OpenCode', codex: 'Codex' } // agent → executor name in the driver prompt

// Repairs, machines and conversations are SHARED across project members → keyed by the project owner.
// Resolve the owner for a project (403 if the user isn't a member).
function ownerOr403(req, res, projectId) {
  const owner = memberOwner(req.user.id, projectId)
  if (owner === null) { res.status(403).json({ error: 'You are not a member of this project.' }); return null }
  if (projectId && !can(projectId, req.user.id, 'machines')) { res.status(403).json({ error: 'You do not have access to this project’s machines.' }); return null }
  return owner
}
// For task-id-only routes: resolve the task, authorize via its project membership + 'machines' perm.
function taskOwnerOr(req, res, taskId) {
  const t = getTaskById(taskId)
  if (!t) { res.status(404).json({ error: 'task not found' }); return null }
  if (!can(t.projectId, req.user.id, 'machines')) { res.status(403).json({ error: 'not allowed' }); return null }
  return t.userId // = the project owner the task is keyed under
}
const sseHead = (res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  })
  res.write('\n')
}

// Worker auth — by API key (Authorization: Bearer <key>, x-nimbus-key, or ?key=). Sets req.workerUserId.
function requireWorker(req, res, next) {
  const key = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-nimbus-key'] || req.query.key
  const userId = userForWorkerKey(key)
  if (!userId) return res.status(401).json({ error: 'invalid or missing worker key' })
  req.workerUserId = userId
  next()
}

/* ---- worker API keys (generated per-PROJECT; visible to all members) ---- */
r.get('/api/repair/keys', requireUser, (req, res) => {
  if (ownerOr403(req, res, req.query.projectId) === null) return
  res.json({ keys: listWorkerKeys(req.query.projectId) })
})
r.post('/api/repair/keys', requireUser, (req, res) => {
  if (ownerOr403(req, res, req.body?.projectId) === null) return
  res.json({ key: createWorkerKey(req.body?.projectId, req.body?.label, req.user.id) })
})
r.delete('/api/repair/keys/:id', requireUser, (req, res) => {
  if (ownerOr403(req, res, req.query.projectId) === null) return
  res.json(revokeWorkerKey(req.query.projectId, req.params.id))
})

/* ---- worker (API-key auth): LONG-POLL for the next repair task ---- */
r.post('/api/repair/worker/poll', requireWorker, async (req, res) => {
  const { workerId = 'worker', host, os, claude } = req.body || {}
  const task = await pollTask(req.workerUserId, workerId, { host, os, hasClaudeCode: !!claude })
  if (!task) return res.json({ task: null })
  res.json({
    task: {
      taskId: task.id, projectId: task.projectId, repo: task.repo, incident: task.incident, mode: task.mode || 'repair',
      constraints: { prOnly: true, noSecrets: true, permissionMode: 'acceptEdits', model: task.model || null,
        resume: task.resume || null,
        allowedTools: ['Read', 'Edit', 'Bash(git:*)', 'Bash(gh:*)', 'Bash(npm:*)'] },
    },
  })
})

/* ---- worker → server: progress + result (API-key auth) ---- */
r.post('/api/repair/worker/tasks/:id/event', requireWorker, (req, res) =>
  res.json(pushStep(req.workerUserId, req.params.id, req.body || {})))
r.post('/api/repair/worker/tasks/:id/result', requireWorker, (req, res) =>
  res.json(setResult(req.workerUserId, req.params.id, req.body || {})))

/* ---- worker ← server: LONG-POLL for control commands (message / stop / done) while running ---- */
r.post('/api/repair/worker/tasks/:id/control-poll', requireWorker, async (req, res) => {
  heartbeat(req.workerUserId, req.body?.workerId) // keep the machine on the roster while it's busy
  res.json({ cmd: await pollControl(req.workerUserId, req.params.id) })
})

/* ---- worker → server: report Claude's reply after a turn (drives the conversation) ---- */
r.post('/api/repair/worker/tasks/:id/turn', requireWorker, (req, res) =>
  res.json(pushTurn(req.workerUserId, req.params.id, req.body?.reply || '')))

/* ---- UI / Nimbus → control a running repair (stop / talk to Claude) ---- */
r.post('/api/repair/tasks/:id/stop', requireUser, (req, res) => {
  const owner = taskOwnerOr(req, res, req.params.id); if (owner === null) return
  res.json(pushControl(owner, req.params.id, { type: 'stop', reason: req.body?.reason }))
})
r.post('/api/repair/tasks/:id/message', requireUser, (req, res) => {
  const owner = taskOwnerOr(req, res, req.params.id); if (owner === null) return
  res.json(pushControl(owner, req.params.id, { type: 'message', text: (req.body?.text || '').trim() }))
})
r.post('/api/repair/tasks/:id/compact', requireUser, (req, res) => {
  const owner = taskOwnerOr(req, res, req.params.id); if (owner === null) return
  res.json(pushControl(owner, req.params.id, { type: 'compact' }))
})

/* ---- control / UI ---- */
r.get('/api/repair/workers', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.query.projectId); if (owner === null) return
  res.json({ workers: listWorkers(owner) })
})

// Remove a connected machine from the roster (sidebar ✕). It reappears if its CLI keeps polling.
r.delete('/api/repair/workers/:workerId', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.query.projectId); if (owner === null) return
  res.json(forgetWorker(owner, req.params.workerId))
})

// Live repairs (in-memory, for the active SSE view) + persisted repair conversations (the list).
r.get('/api/repair/tasks', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.query.projectId); if (owner === null) return
  res.json({ tasks: listTasks(owner, req.query.projectId), conversations: listConversations(owner, { kind: 'repair', projectId: req.query.projectId }) })
})

r.post('/api/repair/dispatch', requireUser, (req, res) => {
  const { projectId, incident, workerId, model } = req.body || {}
  const userId = ownerOr403(req, res, projectId); if (userId === null) return
  const repo = getProjectRepo(projectId)
  if (!repo) return res.json({ ok: false, reason: 'no-repo' })
  const online = listWorkers(userId)
  if (!online.length) return res.json({ ok: false, reason: 'no-worker' })
  // Choose which connected machine Nimbus drives. If one was picked, it must be online.
  const target = workerId ? online.find((w) => w.workerId === workerId) : null
  if (workerId && !target) return res.json({ ok: false, reason: 'machine-offline' })
  // A rented machine runs its rent-time agent + model — never override its model from the picker.
  const executor = EXECUTOR[target?.rented ? (target.agent || 'claude') : 'claude'] || 'Claude Code'
  const taskModel = target?.rented ? null : (model || null)
  const task = createTask({ userId, projectId, repo, incident: incident || {}, targetWorkerId: workerId || null, model: taskModel })
  // A repair = a 'repair' conversation (Nimbus ↔ Claude on a chosen machine). conv id == first taskId.
  const conv = createConversation({ userId, id: task.id, kind: 'repair', projectId, repo, machineId: workerId || null, speaker: 'nimbus', title: incident?.summary || 'Repair' })
  task.conversationId = conv.id
  res.json({ ok: true, taskId: task.id, conversationId: conv.id, repo })
  ;(async () => {
    pushStep(userId, task.id, { phase: 'framing', text: 'Nimbus is analyzing your request and the repo…' })
    const brief = await composeBrief(userId, projectId, { request: incident?.summary || '', hypothesis: incident?.hypothesis || '', logs: incident?.logExcerpts || [] })
    task.incident = { ...task.incident, brief }
    appendMessage(userId, conv.id, { role: 'nimbus', text: brief }) // the first instruction (clean chat)
    const d = dispatch(task)
    if (!d.ok) { pushStep(userId, task.id, { phase: 'error', text: 'No machine online to run the repair.' }); return }
    startConversation(userId, task.id, brief, repo, projectId, executor) // Nimbus pairs with the machine's agent turn-by-turn
  })()
})

/* ---- DIRECT machine session: talk to a chosen machine's Claude (NO Nimbus agent in the loop) ----
   New session, RESUME an idle conversation, or REATTACH to one that's already running. */
r.post('/api/repair/session', requireUser, (req, res) => {
  const { projectId, workerId, message, model, resumeId } = req.body || {}
  const first = (message || '').trim()
  if (!first) return res.json({ ok: false, reason: 'empty' })
  const userId = ownerOr403(req, res, projectId); if (userId === null) return

  if (resumeId) {
    const conv = getConversation(userId, resumeId)
    if (!conv) return res.json({ ok: false, reason: 'not-found' })
    // REATTACH: if this conversation is already live, route the message into the running Claude — never
    // spawn a second Claude on the same dir/session (that corrupts the transcript).
    const liveTaskId = activeTaskFor(userId, resumeId)
    if (liveTaskId && getTask(userId, liveTaskId)) {
      pushControl(userId, liveTaskId, { type: 'message', text: first })
      return res.json({ ok: true, taskId: liveTaskId, conversationId: resumeId, reattached: true })
    }
    // RESUME an idle conversation with Claude's saved context, on its original machine.
    if (!conv.claudeSessionId || !conv.workerDir) return res.json({ ok: false, reason: 'not-resumable' })
    if (!listWorkers(userId).some((w) => w.workerId === conv.machineId)) return res.json({ ok: false, reason: 'machine-offline' })
    const task = createTask({
      userId, projectId: conv.projectId, repo: conv.repo, mode: 'session', targetWorkerId: conv.machineId,
      model: model || null, conversationId: conv.id, resume: { sessionId: conv.claudeSessionId, dir: conv.workerDir },
      incident: { summary: first, brief: first, service: 'session' },
    })
    appendMessage(userId, conv.id, { role: 'user', text: first })
    const d = dispatch(task)
    if (!d.ok) return res.json({ ok: false, reason: d.reason })
    return res.json({ ok: true, taskId: task.id, conversationId: conv.id, repo: conv.repo })
  }

  // NEW session.
  const repo = getProjectRepo(projectId)
  if (!repo) return res.json({ ok: false, reason: 'no-repo' })
  if (!workerId) return res.json({ ok: false, reason: 'no-machine' })
  if (!listWorkers(userId).some((w) => w.workerId === workerId)) return res.json({ ok: false, reason: 'machine-offline' })
  const task = createTask({
    userId, projectId, repo, mode: 'session', targetWorkerId: workerId, model: model || null,
    incident: { summary: first, brief: first, service: 'session' },
  })
  const conv = createConversation({ userId, id: task.id, kind: 'direct', projectId, repo, machineId: workerId, speaker: 'user', title: first })
  task.conversationId = conv.id
  appendMessage(userId, conv.id, { role: 'user', text: first }) // the first message
  const d = dispatch(task)
  if (!d.ok) return res.json({ ok: false, reason: d.reason })
  res.json({ ok: true, taskId: task.id, conversationId: conv.id, repo })
})

/* ---- conversation history (direct sessions + repairs) — shared, owner-scoped ---- */
r.get('/api/repair/sessions', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.query.projectId); if (owner === null) return
  res.json({ sessions: listConversations(owner, { kind: 'direct', projectId: req.query.projectId, machineId: req.query.workerId }) })
})
r.get('/api/repair/sessions/:id', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.query.projectId); if (owner === null) return
  const rec = getConversation(owner, req.params.id)
  return rec ? res.json({ session: rec }) : res.status(404).json({ error: 'not found' })
})
r.get('/api/repair/conversations/:id', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.query.projectId); if (owner === null) return
  const rec = getConversation(owner, req.params.id)
  return rec ? res.json({ conversation: rec }) : res.status(404).json({ error: 'not found' })
})

// Move a card across the Sessions board — set a conversation's status (won't touch a live task).
r.patch('/api/repair/conversations/:id', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.body?.projectId); if (owner === null) return
  const rec = getConversation(owner, req.params.id)
  if (!rec) return res.status(404).json({ error: 'not found' })
  const column = req.body?.column
  if (!['running', 'review', 'done'].includes(column)) return res.status(400).json({ error: 'bad column' })
  setConvMeta(owner, req.params.id, { boardColumn: column })
  res.json({ ok: true, column })
})

r.get('/api/repair/tasks/:id/stream', requireUser, (req, res) => {
  const owner = taskOwnerOr(req, res, req.params.id); if (owner === null) return
  sseHead(res)
  subscribeUi(owner, req.params.id, res)
  req.on('close', () => unsubscribeUi(owner, req.params.id, res))
})

export default r
