/**
 * Worker API keys — a member generates a key to connect their machine's Nimbus worker to a PROJECT.
 * Keys are stored under the project OWNER's id (so every member's machine registers into the same
 * shared roster) and tagged with the projectId + who created it. The plaintext key is returned ONCE
 * on creation; list never returns it.
 */
import crypto from 'node:crypto'
import { loadJson, saveJson } from './store.mjs'
import { ownerOf } from './projects.mjs'

const _keys = new Map(Object.entries(loadJson('worker-keys.json', {}))) // ownerId -> [{ id, label, key, prefix, projectId, createdBy, createdAt, lastUsed }]
const persist = () => saveJson('worker-keys.json', Object.fromEntries(_keys))

/** Create a key for a project. Returns the record INCLUDING the plaintext `key` (shown once). */
export function createWorkerKey(projectId, label, createdBy = null) {
  const owner = ownerOf(projectId) || createdBy
  const key = 'nwk_' + crypto.randomBytes(24).toString('hex')
  const rec = { id: crypto.randomUUID(), label: (label || 'My machine').slice(0, 60), key, prefix: key.slice(0, 11) + '…', projectId: projectId || null, createdBy, createdAt: Date.now(), lastUsed: null }
  const list = _keys.get(owner) || []
  list.unshift(rec)
  _keys.set(owner, list)
  persist()
  return rec
}

/** Metadata only (never the plaintext key) — the keys for THIS project. */
export function listWorkerKeys(projectId) {
  const owner = ownerOf(projectId)
  if (!owner) return []
  return (_keys.get(owner) || [])
    .filter((k) => !k.projectId || k.projectId === projectId) // legacy keys (no projectId) belong to the owner's projects
    .map(({ key, ...meta }) => meta) // eslint-disable-line no-unused-vars
}

export function revokeWorkerKey(projectId, id) {
  const owner = ownerOf(projectId)
  if (owner) { _keys.set(owner, (_keys.get(owner) || []).filter((k) => k.id !== id)); persist() }
  return { ok: true }
}

/** Resolve a presented key → the OWNER userId it registers under (the shared roster key). Null if unknown. */
export function userForWorkerKey(key) {
  if (!key) return null
  for (const [ownerId, list] of _keys.entries()) {
    const k = list.find((x) => x.key === key)
    if (k) { k.lastUsed = Date.now(); persist(); return ownerId }
  }
  return null
}
