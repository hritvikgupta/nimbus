/**
 * Repair-with-shared-compute — control-plane side. See docs/shared-compute-repair.md.
 *
 * The worker is a CLI installed on a team member's machine (`nimbus connect <key>`). It **polls** us
 * for repair tasks (long-poll: we hold the request up to ~25s, return a task the moment one is queued,
 * else empty and it polls again). It reports progress + the result back via POSTs. The BROWSER still
 * watches a task live over SSE (same-origin) — that part is unchanged.
 *
 * In-memory (Phase 1/2): roster (recent pollers) + queue + live tasks live for the process lifetime.
 */
import crypto from 'node:crypto'
import { appendMessage, setConvMeta } from '../repositories/conversations.mjs'

const sse = (res, obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`) } catch { /* closed */ } }
// Append a CLEAN chat turn to the task's conversation (skips empty). Never stores the raw bridge log.
function recordMessage(task, role, text, workSummary = null) {
  if (!task?.conversationId) return
  if (!String(text || '').trim()) return
  appendMessage(task.userId, task.conversationId, { role, text, workSummary })
}
const ONLINE_MS = 35000 // a worker counts as "online" if it polled within this window

const _tasks = new Map()    // taskId -> { id, userId, projectId, repo, incident, status, steps[], result, workerId, uiSubs:Set, createdAt }
const _pending = new Map()  // userId -> [task,...]            (queued, waiting for a worker to claim)
const _waiters = new Map()  // userId -> [{ workerId, resolve },...]  (long-poll calls parked, waiting for a task)
const _pollers = new Map()  // userId -> Map<workerId, { info, lastSeen }>  (the online roster, from polls)

/* ---------- workers (roster from polls) ---------- */
function touchPoller(userId, workerId, info) {
  const map = _pollers.get(userId) || new Map()
  map.set(workerId, { info: { ...info, workerId }, lastSeen: Date.now() })
  _pollers.set(userId, map)
}
export function listWorkers(userId) {
  const map = _pollers.get(userId); if (!map) return []
  const now = Date.now()
  return [...map.values()].filter((w) => now - w.lastSeen < ONLINE_MS).map((w) => ({ ...w.info, lastSeen: w.lastSeen }))
}
function hasOnlineWorker(userId) { return listWorkers(userId).length > 0 }

/** Drop a machine from the online roster (the sidebar "remove"). If its CLI keeps polling it will
 *  re-register on its next poll — this just clears it now (e.g. a machine you've stopped using). */
export function forgetWorker(userId, workerId) {
  const map = _pollers.get(userId)
  const existed = map?.delete(workerId) || false
  return { ok: true, existed }
}

/** Keep a worker on the roster while it's busy running a task (it isn't calling /worker/poll then). */
export function heartbeat(userId, workerId) {
  if (!workerId) return
  const map = _pollers.get(userId); const e = map?.get(workerId)
  if (e) e.lastSeen = Date.now()
  else touchPoller(userId, workerId, {}) // unknown (e.g. after restart) — register minimally
}

/**
 * Long-poll: a worker asks for its next task. Returns a Promise that resolves to a task (claimed by
 * this worker) or null after a timeout. The CLI calls this in a loop.
 */
export function pollTask(userId, workerId, info = {}, { timeoutMs = 25000 } = {}) {
  touchPoller(userId, workerId, info)
  // A task can be targeted at a specific machine (direct sessions) or untargeted (any machine).
  const claimable = (t) => !t.targetWorkerId || t.targetWorkerId === workerId
  const q = _pending.get(userId)
  if (q && q.length) {
    const i = q.findIndex(claimable)
    if (i >= 0) { const [task] = q.splice(i, 1); task.workerId = workerId; return Promise.resolve(task) }
  }
  return new Promise((resolve) => {
    const entry = { workerId, done: false, resolve }
    const arr = _waiters.get(userId) || []; arr.push(entry); _waiters.set(userId, arr)
    const finish = (task) => {
      if (entry.done) return; entry.done = true
      const a = _waiters.get(userId) || []; const i = a.indexOf(entry); if (i >= 0) a.splice(i, 1)
      if (task) task.workerId = workerId
      resolve(task || null)
    }
    entry.fire = finish
    setTimeout(() => finish(null), timeoutMs)
  })
}

/* ---------- tasks ---------- */
export function createTask({ userId, projectId, repo, incident, mode = 'repair', targetWorkerId = null, model = null, conversationId = null, resume = null }) {
  const task = {
    id: crypto.randomUUID(), userId, projectId, repo, incident: incident || {},
    mode, targetWorkerId, model, conversationId, resume,
    status: 'pending', steps: [], result: null, workerId: null, uiSubs: new Set(), createdAt: Date.now(),
    _toolsSinceTurn: 0,
  }
  _tasks.set(task.id, task)
  return task
}
export function getTask(userId, taskId) {
  const t = _tasks.get(taskId)
  return t && t.userId === userId ? t : null
}
/** Look up a task by id only (no owner check) — caller authorizes via project membership. */
export function getTaskById(taskId) { return _tasks.get(taskId) || null }
export function listTasks(userId, projectId) {
  return [...(_tasks.values())]
    .filter((t) => t.userId === userId && t.mode !== 'session' && (projectId ? String(t.projectId) === String(projectId) : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 30)
    .map((t) => ({
      id: t.id, repo: t.repo, status: t.status,
      service: t.incident?.service || '', summary: t.incident?.summary || '',
      createdAt: t.createdAt, prUrl: t.result?.prUrl || null,
      lastStep: t.steps[t.steps.length - 1]?.text || '',
    }))
}

/** Queue a task for an online worker (or a specific one). Returns { ok } or { ok:false, reason }. */
export function dispatch(task) {
  // Targeted dispatch (direct sessions) must reach that exact machine; else any online worker.
  if (task.targetWorkerId) {
    if (!listWorkers(task.userId).some((w) => w.workerId === task.targetWorkerId)) return { ok: false, reason: 'machine-offline' }
  } else if (!hasOnlineWorker(task.userId)) return { ok: false, reason: 'no-worker' }
  task.status = 'dispatched'
  // mark the conversation as live with this task (the one-live-run guard)
  if (task.conversationId) setConvMeta(task.userId, task.conversationId, { activeTaskId: task.id, status: 'running' })
  const waiters = _waiters.get(task.userId) || []
  const i = waiters.findIndex((w) => !task.targetWorkerId || w.workerId === task.targetWorkerId)
  if (i >= 0) waiters[i].fire(task)                              // hand straight to the matching parked poll
  else { const q = _pending.get(task.userId) || []; q.push(task); _pending.set(task.userId, q) } // else queue
  pushStep(task.userId, task.id, { phase: 'queued', text: task.targetWorkerId ? `Sent to ${task.targetWorkerId}` : 'Queued for a connected machine' })
  return { ok: true }
}

/* ---------- control channel: server → running worker/Claude (stop / talk) ----------
   The worker long-polls control-poll WHILE a task runs; we push commands down it so the Nimbus
   server agent (or the UI) can STOP the Claude run or SEND it a steering message mid-flight. */
const _control = new Map()        // taskId -> [cmd,...]
const _controlWaiters = new Map() // taskId -> [{ fire, done }]

export function pushControl(userId, taskId, cmd) {
  const t = _tasks.get(taskId); if (!t || t.userId !== userId) return { ok: false }
  const w = _controlWaiters.get(taskId)
  if (w && w.length) w[0].fire(cmd)
  else { const q = _control.get(taskId) || []; q.push(cmd); _control.set(taskId, q) }
  const who = t.mode === 'session' ? 'You' : 'Nimbus'
  if (cmd.type === 'stop') { t.status = 'stopping'; pushStep(userId, taskId, { phase: 'control', text: `${who} stopped Claude${cmd.reason ? ` — ${cmd.reason}` : ''}` }) }
  else if (cmd.type === 'compact') pushStep(userId, taskId, { phase: 'control', text: `${who} asked Claude to /compact` })
  else if (cmd.type === 'message') {
    pushStep(userId, taskId, { phase: 'control', text: `${who} → Claude: ${cmd.text}` })
    recordMessage(t, t.mode === 'session' ? 'user' : 'nimbus', cmd.text) // clean chat turn
  }
  return { ok: true }
}
export function pollControl(userId, taskId, { timeoutMs = 20000 } = {}) {
  const t = _tasks.get(taskId); if (!t || t.userId !== userId) return Promise.resolve(null)
  const q = _control.get(taskId)
  if (q && q.length) return Promise.resolve(q.shift())
  return new Promise((resolve) => {
    const entry = { done: false, fire: (c) => { if (entry.done) return; entry.done = true; const a = _controlWaiters.get(taskId) || []; const i = a.indexOf(entry); if (i >= 0) a.splice(i, 1); resolve(c || null) } }
    const arr = _controlWaiters.get(taskId) || []; arr.push(entry); _controlWaiters.set(taskId, arr)
    setTimeout(() => entry.fire(null), timeoutMs)
  })
}

/* ---------- turn channel: running worker/Claude → server (Claude's reply each turn) ----------
   The worker reports Claude's reply after each turn; the conversation driver awaits it to respond. */
const _turns = new Map()       // taskId -> [reply,...]
const _turnWaiters = new Map() // taskId -> [{ fire, done }]

export function pushTurn(userId, taskId, reply) {
  const t = _tasks.get(taskId); if (!t || t.userId !== userId) return { ok: false }
  const w = _turnWaiters.get(taskId)
  if (w && w.length) w[0].fire(reply)
  else { const q = _turns.get(taskId) || []; q.push(reply); _turns.set(taskId, q) }
  t._live = '' // turn done → the partial is now the persisted reply; clear the live delta
  pushStep(userId, taskId, { phase: 'claude', text: String(reply || '') }) // full reply (live view)
  // persist the clean chat turn (with a one-line work summary, not the raw log)
  const n = t._toolsSinceTurn || 0
  recordMessage(t, 'claude', reply, n ? `ran ${n} tool${n > 1 ? 's' : ''}` : null)
  t._toolsSinceTurn = 0
  return { ok: true }
}
export function waitTurn(userId, taskId, { timeoutMs = 600000 } = {}) {
  const t = _tasks.get(taskId); if (!t || t.userId !== userId) return Promise.resolve(null)
  const q = _turns.get(taskId)
  if (q && q.length) return Promise.resolve(q.shift())
  return new Promise((resolve) => {
    const entry = { done: false, fire: (r) => { if (entry.done) return; entry.done = true; const a = _turnWaiters.get(taskId) || []; const i = a.indexOf(entry); if (i >= 0) a.splice(i, 1); resolve(r ?? null) } }
    const arr = _turnWaiters.get(taskId) || []; arr.push(entry); _turnWaiters.set(taskId, arr)
    setTimeout(() => entry.fire(null), timeoutMs)
  })
}

/* ---------- worker → server (live reply streaming) ----------
   The growing assistant text for the in-flight turn. NOT persisted to t.steps (the final reply is
   persisted by pushTurn); this is a live view delta only, so the UI can render text as it appears —
   the same "professional" growing-text feel as the Nimbus chat, over the machine bridge. */
export function pushDelta(userId, taskId, text) {
  const t = _tasks.get(taskId); if (!t || t.userId !== userId) return { ok: false }
  t._live = String(text || '') // kept so a mid-turn reattach can show the partial (see snapshot)
  for (const res of t.uiSubs) sse(res, { type: 'delta', text: t._live })
  return { ok: true }
}

/* ---------- worker → server (progress + result) ---------- */
export function pushStep(userId, taskId, step) {
  const t = _tasks.get(taskId); if (!t || t.userId !== userId) return { ok: false }
  const s = { ...step, at: Date.now() }
  t.steps.push(s)
  if (t.status === 'dispatched' || t.status === 'pending') t.status = 'running'
  if (s.phase === 'tool') t._toolsSinceTurn = (t._toolsSinceTurn || 0) + 1
  // Capture Claude's resume linkage + model from meta steps (persist to the conversation, not the log).
  if (s.phase === 'meta' && t.conversationId && (s.sessionId || s.dir || s.model)) {
    setConvMeta(userId, t.conversationId, { claudeSessionId: s.sessionId, workerDir: s.dir, model: s.model, machineId: t.workerId })
  }
  for (const res of t.uiSubs) sse(res, { type: 'step', step: s, status: t.status }) // live view only — NOT persisted
  return { ok: true }
}
export function setResult(userId, taskId, result) {
  const t = _tasks.get(taskId); if (!t || t.userId !== userId) return { ok: false }
  t.result = result || {}
  t.status = ['failed', 'stopped'].includes(result?.status) ? result.status : 'done'
  for (const res of t.uiSubs) sse(res, { type: 'result', result: t.result, status: t.status })
  // conversation: clear the live-run guard, record final status + any result (e.g. PR url)
  if (t.conversationId) setConvMeta(userId, t.conversationId, { activeTaskId: null, status: t.status, result: result?.prUrl ? { prUrl: result.prUrl } : undefined })
  return { ok: true }
}

/* ---------- UI subscription (browser watches a task live over SSE) ---------- */
export function subscribeUi(userId, taskId, res) {
  const t = _tasks.get(taskId); if (!t || t.userId !== userId) return false
  sse(res, { type: 'snapshot', task: { id: t.id, repo: t.repo, status: t.status, steps: t.steps, result: t.result, live: t._live || '' } })
  t.uiSubs.add(res)
  return true
}
export function unsubscribeUi(userId, taskId, res) {
  const t = _tasks.get(taskId); if (t) t.uiSubs.delete(res)
}

/* keep browser SSE streams alive through proxies */
setInterval(() => {
  for (const t of _tasks.values()) for (const res of t.uiSubs) sse(res, { type: 'ping' })
}, 25000).unref?.()
