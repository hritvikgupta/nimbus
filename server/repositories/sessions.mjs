/**
 * Direct machine-session history (per user → project → machine), persisted to disk
 * (server/.data/machine-sessions.json). Each record is one "session thread" you can reopen and
 * RESUME on the same machine. We store the transcript steps Nimbus captured plus the linkage Claude
 * needs to resume: the Claude `sessionId` and the worker-side clone `dir`.
 *
 * Isolation boundary is userId; scoped further by (projectId, workerId) for the sidebar dropdown.
 */
import { loadJson, saveJson } from './store.mjs'

const MAX_STEPS = 600   // cap transcript size per session
const MAX_SESSIONS = 80 // cap stored sessions per user (oldest pruned)

// userId -> { rootId -> record }
const _s = new Map(Object.entries(loadJson('machine-sessions.json', {})))
const persist = () => saveJson('machine-sessions.json', Object.fromEntries(_s))

const bag = (userId) => { let b = _s.get(userId); if (!b) { b = {}; _s.set(userId, b) } return b }

/** Create (or return) a session record. Called when a NEW direct session starts. */
export function createSession({ userId, id, projectId, workerId, repo, title }) {
  const b = bag(userId)
  if (!b[id]) {
    b[id] = {
      id, userId, projectId: projectId || null, workerId: workerId || null, repo: repo || null,
      title: (title || 'Session').slice(0, 80), sessionId: null, dir: null,
      createdAt: Date.now(), lastActive: Date.now(), status: 'running', steps: [],
    }
    // prune oldest if over cap
    const ids = Object.values(b).sort((a, z) => a.lastActive - z.lastActive)
    while (ids.length > MAX_SESSIONS) { const old = ids.shift(); delete b[old.id] }
    persist()
  }
  return b[id]
}

/** Append a captured step to a session's transcript (and bump lastActive). */
export function appendSessionStep(userId, id, step) {
  const rec = bag(userId)[id]; if (!rec) return
  rec.steps.push(step)
  if (rec.steps.length > MAX_STEPS) rec.steps = rec.steps.slice(-MAX_STEPS)
  rec.lastActive = Date.now()
  persist()
}

/** Record Claude's resume linkage / status as the worker reports it. */
export function setSessionMeta(userId, id, patch) {
  const rec = bag(userId)[id]; if (!rec) return
  if (patch.sessionId) rec.sessionId = patch.sessionId
  if (patch.dir) rec.dir = patch.dir
  if (patch.status) rec.status = patch.status
  rec.lastActive = Date.now()
  persist()
}

/** Sidebar list (metadata only — no transcript bodies). */
export function listSessions(userId, { projectId, workerId } = {}) {
  const b = _s.get(userId); if (!b) return []
  return Object.values(b)
    .filter((r) => (projectId ? String(r.projectId) === String(projectId) : true))
    .filter((r) => (workerId ? r.workerId === workerId : true))
    .sort((a, z) => z.lastActive - a.lastActive)
    .map(({ steps, ...meta }) => ({ ...meta, resumable: !!meta.sessionId })) // drop bodies
}

/** Full record (with transcript) for reopening a session. */
export function getSession(userId, id) {
  return bag(userId)[id] || null
}
