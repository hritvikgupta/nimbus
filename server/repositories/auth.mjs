/**
 * Auth service — user store + cookie sessions. Mirrors company-brain's services/auth.ts
 * shape (login/signup/getSession + SESSION_COOKIE), simplified to a JSON-file store so the
 * demo persists across restarts without a DB. Passwords are scrypt-hashed; sessions are
 * random opaque tokens. The session's userId is the per-user isolation key the agent +
 * MCP layer scope every request to.
 */
import crypto from 'node:crypto'

export const SESSION_COOKIE = 'nimbus_session'

import { loadJson, saveJson } from './store.mjs'

// The user store lives in the shared DB (via store.mjs) so concurrent signups/logins are safe.
function load() { return loadJson('users.json', { users: [] }) }
function save(db) { saveJson('users.json', db) }
// token -> userId, persisted so logins survive backend restarts.
const _sessions = new Map(Object.entries(loadJson('sessions.json', {})))
function persistSessions() { saveJson('sessions.json', Object.fromEntries(_sessions)) }

function hashPw(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}
function verifyPw(password, stored) {
  const [salt, hash] = stored.split(':')
  const test = crypto.scryptSync(password, salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'))
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, org: u.org || '', onboarded: u.onboarded !== false }
}

export function signup({ email, password, name, org }) {
  email = (email || '').trim().toLowerCase()
  if (!email || !password) return { ok: false, error: 'Email and password are required.' }
  const db = load()
  if (db.users.some((u) => u.email === email)) return { ok: false, error: 'An account with that email already exists.' }
  // New accounts start NOT onboarded → routed through the setup wizard. Existing accounts (no
  // `onboarded` field) are treated as onboarded so they aren't disrupted.
  const user = { id: crypto.randomUUID(), email, name: name || email.split('@')[0], org: (org || '').trim(), pw: hashPw(password), onboarded: false, createdAt: Date.now() }
  db.users.push(user)
  save(db)
  return { ok: true, user: publicUser(user), token: createSession(user.id) }
}

/** Mark a user's onboarding complete (and optionally set/update the org name). */
export function completeOnboarding(userId, { org } = {}) {
  const db = load()
  const user = db.users.find((u) => u.id === userId)
  if (!user) return { ok: false, error: 'user not found' }
  user.onboarded = true
  if (org && org.trim()) user.org = org.trim()
  save(db)
  return { ok: true, user: publicUser(user) }
}

export function login(email, password) {
  email = (email || '').trim().toLowerCase()
  const db = load()
  const user = db.users.find((u) => u.email === email)
  if (!user || !verifyPw(password, user.pw)) return { ok: false, error: 'Invalid email or password.' }
  return { ok: true, user: publicUser(user), token: createSession(user.id) }
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex')
  _sessions.set(token, userId)
  persistSessions()
  return token
}

export function destroySession(token) {
  if (token) { _sessions.delete(token); persistSessions() }
}

/** Look up a user by email (case-insensitive) → public user, or null. Used for project invites. */
export function getUserByEmail(email) {
  const e = (email || '').trim().toLowerCase()
  if (!e) return null
  const u = load().users.find((x) => x.email === e)
  return u ? publicUser(u) : null
}

/** Look up a user by id → public user, or null. Used to render project member lists. */
export function getUserById(id) {
  const u = load().users.find((x) => x.id === id)
  return u ? publicUser(u) : null
}

/** Resolve a session token → the public user, or null. */
export function getSession(token) {
  const userId = token && _sessions.get(token)
  if (!userId) return null
  const user = load().users.find((u) => u.id === userId)
  return user ? publicUser(user) : null
}
