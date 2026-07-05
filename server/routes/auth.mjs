/** Auth routes — cookie-session signup/login/logout + onboarding flag. */
import express from 'express'
import cookie from 'cookie'
import { signup, login, destroySession, completeOnboarding, SESSION_COOKIE } from '../repositories/auth.mjs'
import { claimInvites } from '../repositories/projects.mjs'
import { requireUser } from '../middlewares/auth.mjs'

const r = express.Router()

// Public deploys set ALLOW_SIGNUP=false to close self-serve registration (login-only). The
// frontend already hides the CTA; this closes the API too so it can't be hit directly.
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false'

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', cookie.serialize(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // HTTPS-only cookie in prod (Fly serves TLS)
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  }))
}

r.post('/api/auth/signup', (req, res) => {
  if (!ALLOW_SIGNUP) return res.status(403).json({ ok: false, error: 'Registration is closed.' })
  const out = signup(req.body || {})
  if (!out.ok) return res.status(400).json(out)
  claimInvites(out.user) // accept any pending project invites sent to this email
  setSessionCookie(res, out.token)
  res.json({ ok: true, user: out.user })
})

r.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {}
  const out = login(email, password)
  if (!out.ok) return res.status(401).json(out)
  claimInvites(out.user) // accept any pending project invites sent to this email
  setSessionCookie(res, out.token)
  res.json({ ok: true, user: out.user })
})

r.post('/api/auth/logout', (req, res) => {
  const cookies = cookie.parse(req.headers.cookie || '')
  destroySession(cookies[SESSION_COOKIE])
  setSessionCookie(res, '')
  res.json({ ok: true })
})

r.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false })
  res.json({ ok: true, user: req.user })
})

r.post('/api/auth/onboarded', requireUser, (req, res) => {
  res.json(completeOnboarding(req.user.id, { org: req.body?.org }))
})

export default r
