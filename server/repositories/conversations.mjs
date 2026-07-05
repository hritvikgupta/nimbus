/**
 * Conversations store — see docs/conversations-and-parallelism.md.
 *
 * One record per conversation (repair OR direct machine chat). We persist ONLY the chat turns
 * (user/nimbus/claude messages) + metadata (which machine, status, Claude session for resume) — NOT
 * the verbose live bridge log (think/tool/meta steps live only in the in-memory task and are dropped).
 *
 * Persisted to server/.data/conversations.json, scoped by userId.
 */
import crypto from 'node:crypto'
import { loadJson, saveJson } from './store.mjs'

const MAX_MESSAGES = 400   // per conversation
const MAX_CONVERSATIONS = 120 // per user (oldest pruned)

// userId -> { convId -> Conversation }
const _c = new Map(Object.entries(loadJson('conversations.json', {})))
const persist = () => saveJson('conversations.json', Object.fromEntries(_c))
const bag = (userId) => { let b = _c.get(userId); if (!b) { b = {}; _c.set(userId, b) } return b }

/** Create a conversation. `id` defaults to a new uuid; pass one to control it (e.g. == first taskId). */
export function createConversation({ userId, id, kind, projectId, repo, machineId, speaker, title }) {
  const b = bag(userId)
  const cid = id || crypto.randomUUID()
  if (!b[cid]) {
    b[cid] = {
      id: cid, kind, userId, projectId: projectId || null, repo: repo || null,
      machineId: machineId || null, speaker: speaker || (kind === 'repair' ? 'nimbus' : 'user'),
      claudeSessionId: null, workerDir: null, model: null,
      status: 'running', activeTaskId: null, title: (title || (kind === 'repair' ? 'Repair' : 'Session')).slice(0, 80),
      createdAt: Date.now(), lastActive: Date.now(), result: null, messages: [],
    }
    const all = Object.values(b).sort((a, z) => a.lastActive - z.lastActive)
    while (all.length > MAX_CONVERSATIONS) { const old = all.shift(); delete b[old.id] }
    persist()
  }
  return b[cid]
}

/** Append a clean chat turn. role: 'user' | 'nimbus' | 'claude'. */
export function appendMessage(userId, id, { role, text, workSummary }) {
  const rec = bag(userId)[id]; if (!rec) return
  rec.messages.push({ id: crypto.randomUUID(), role, text: String(text || ''), workSummary: workSummary || null, at: Date.now() })
  if (rec.messages.length > MAX_MESSAGES) rec.messages = rec.messages.slice(-MAX_MESSAGES)
  rec.lastActive = Date.now()
  persist()
}

/** Patch metadata: claudeSessionId, workerDir, model, status, activeTaskId, result. */
export function setConvMeta(userId, id, patch = {}) {
  const rec = bag(userId)[id]; if (!rec) return
  for (const k of ['claudeSessionId', 'workerDir', 'model', 'status', 'result', 'machineId', 'boardColumn']) {
    if (patch[k] !== undefined && patch[k] !== null) rec[k] = patch[k]
  }
  if ('activeTaskId' in patch) rec.activeTaskId = patch.activeTaskId // may be explicitly null (cleared)
  rec.lastActive = Date.now()
  persist()
}

/** Is this conversation currently being run by a live task? */
export function activeTaskFor(userId, id) {
  return bag(userId)[id]?.activeTaskId || null
}

/** Sidebar/list (metadata only — no message bodies). */
export function listConversations(userId, { kind, machineId, projectId } = {}) {
  const b = _c.get(userId); if (!b) return []
  return Object.values(b)
    .filter((r) => (kind ? r.kind === kind : true))
    .filter((r) => (machineId ? r.machineId === machineId : true))
    .filter((r) => (projectId ? String(r.projectId) === String(projectId) : true))
    .sort((a, z) => z.lastActive - a.lastActive)
    .map(({ messages, ...meta }) => ({ ...meta, resumable: !!meta.claudeSessionId, messageCount: messages.length }))
}

/** Full record (with messages) for reopening. */
export function getConversation(userId, id) {
  return bag(userId)[id] || null
}
