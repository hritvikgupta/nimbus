/**
 * Auth middleware for the Express routes (company-brain middlewares/ convention).
 * requireUser reads the session cookie → user; the client never supplies the user id.
 * Every route that touches a user's clouds/agent must scope to req.user.id.
 */
import cookie from 'cookie'
import { getSession, SESSION_COOKIE } from '../repositories/auth.mjs'
import { memberOwner, can } from '../repositories/projects.mjs'

/** Parse the session cookie → attach req.user (or null). Use as app-level middleware. */
export function attachUser(req, _res, next) {
  const cookies = cookie.parse(req.headers.cookie || '')
  req.user = getSession(cookies[SESSION_COOKIE]) || null
  next()
}

/**
 * Resolve the active PROJECT (from the x-nimbus-project header, or ?project/?projectId, or body) to
 * the project OWNER and expose it as req.cloudUserId. Everything in a shared project is shared —
 * clouds (AWS/GCP/GitHub), resources, cost, channels, machines — so cloud-touching routes key off
 * req.cloudUserId (the owner) instead of req.user.id. The ONLY per-user thing is the private Nimbus
 * chat history. Falls back to the user's own id when there's no project context.
 */
export function cloudScope(req, _res, next) {
  const pid = req.headers['x-nimbus-project'] || req.query?.project || req.query?.projectId || req.body?.projectId || null
  req.projectId = pid || null
  if (req.user && pid) {
    const owner = memberOwner(req.user.id, pid)
    // Member with the 'clouds' permission → the project's shared clouds (owner). Otherwise fall back
    // to their own scope (they don't get the shared cloud data).
    req.cloudUserId = (owner && can(pid, req.user.id, 'clouds')) ? owner : req.user.id
  } else {
    req.cloudUserId = req.user?.id || null
  }
  next()
}

/** Guard: 401 unless authenticated. */
export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'Not authenticated.' })
  next()
}
