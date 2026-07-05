/**
 * Ops persistence — incident reports (the ops agent's findings) and per-user webhook tokens
 * (so external alert sources hit a unique, user-scoped URL: /api/webhooks/:provider/:token).
 */
import crypto from 'node:crypto'
import { loadJson, saveJson } from './store.mjs'

const INCIDENTS = 'incidents.json'   // { [userId]: [ { id, source, title, report, at } ] }
const TOKENS = 'webhook-tokens.json' // { [token]: userId }

/* ---- incidents ---- */
export function addIncident(userId, rec) {
  const db = loadJson(INCIDENTS, {})
  const entry = { id: crypto.randomUUID(), at: Date.now(), ...rec }
  db[userId] = [entry, ...(db[userId] || [])].slice(0, 100)
  saveJson(INCIDENTS, db)
  return entry
}
export function listIncidents(userId) {
  return (loadJson(INCIDENTS, {})[userId] || [])
}

/* ---- per-user webhook token ---- */
export function webhookTokenFor(userId) {
  const db = loadJson(TOKENS, {})
  for (const [tok, uid] of Object.entries(db)) if (uid === userId) return tok
  const token = crypto.randomBytes(24).toString('hex')
  db[token] = userId
  saveJson(TOKENS, db)
  return token
}
export function userForToken(token) {
  return loadJson(TOKENS, {})[token] || null
}
