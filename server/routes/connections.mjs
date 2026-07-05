/** Connection routes — per-user cloud grants, Composio app OAuth, and GCP "Connect with Google". */
import express from 'express'
import crypto from 'node:crypto'
import { getConnections, setConnection, removeConnection } from '../repositories/connections.mjs'
import { invalidateUser } from '../libs/mcp.mjs'
import { composioConfigured, authorizeToolkit, listConnectedToolkits, TOOLKIT_CATALOG } from '../libs/composio.mjs'
import { authUrl, exchangeCode, listProjects } from '../libs/gcp-oauth.mjs'
import { requireUser } from '../middlewares/auth.mjs'

const r = express.Router()

/* ---- per-user cloud connections ---- */
r.get('/api/connections', requireUser, (req, res) => {
  res.json({ clouds: Object.keys(getConnections(req.cloudUserId)) })
})

r.post('/api/connections/connect', requireUser, (req, res) => {
  const { cloud, ...grant } = req.body || {}
  if (!['gcp', 'aws', 'azure', 'supabase', 'neon', 'github'].includes(cloud)) return res.status(400).json({ error: 'unknown provider' })

  // GitHub: a personal access token (ghp_… / github_pat_…) — used to clone private repos for analysis.
  if (cloud === 'github') {
    const tok = (grant.token || '').trim()
    if (!tok) return res.status(400).json({ error: 'A GitHub personal access token is required.' })
    grant.token = tok
  }
  // Supabase: a personal access token (sbp_…) is the per-user credential the MCP runs under.
  if (cloud === 'supabase') {
    const tok = (grant.accessToken || '').trim()
    if (!tok) return res.status(400).json({ error: 'A Supabase personal access token is required.' })
    grant.accessToken = tok
  }
  // Neon: an API key (napi_…) sent as a Bearer header to the hosted MCP.
  if (cloud === 'neon') {
    const key = (grant.apiKey || '').trim()
    if (!key) return res.status(400).json({ error: 'A Neon API key is required.' })
    grant.apiKey = key
  }
  // GCP self-service: a pasted Service Account JSON is a complete per-user credential — validate
  // it and auto-derive the project so the user only pastes the one JSON.
  if (cloud === 'gcp' && grant.serviceAccountKey) {
    let parsed
    try { parsed = JSON.parse(grant.serviceAccountKey) }
    catch { return res.status(400).json({ error: 'Service Account JSON is not valid JSON.' }) }
    if (parsed.type !== 'service_account' || !parsed.private_key || !parsed.client_email) {
      return res.status(400).json({ error: 'That is not a Service Account key JSON (need type:"service_account", client_email, private_key).' })
    }
    grant.projectId = grant.projectId || parsed.project_id
    if (!grant.projectId) return res.status(400).json({ error: 'No project_id in the key — add a project ID.' })
  }

  setConnection(req.cloudUserId, cloud, grant)
  invalidateUser(req.cloudUserId) // respawn this user's MCPs with the new creds (does NOT log them out)
  res.json({ ok: true, clouds: Object.keys(getConnections(req.cloudUserId)) })
})

r.post('/api/connections/disconnect', requireUser, (req, res) => {
  removeConnection(req.cloudUserId, req.body?.cloud)
  invalidateUser(req.cloudUserId)
  res.json({ ok: true, clouds: Object.keys(getConnections(req.cloudUserId)) })
})

/* ---- Composio (GitHub + other apps) — per-user OAuth + tools ---- */
r.get('/api/connections/composio/status', requireUser, async (req, res) => {
  const fresh = req.query.fresh === '1' || req.query.fresh === 'true'
  res.json({ configured: composioConfigured(), catalog: TOOLKIT_CATALOG, toolkits: await listConnectedToolkits(req.cloudUserId, { fresh }) })
})
r.post('/api/connections/composio/authorize', requireUser, async (req, res) => {
  try {
    if (!composioConfigured()) return res.status(400).json({ error: 'Composio is not configured on the server.' })
    res.json(await authorizeToolkit(req.cloudUserId, (req.body?.toolkit || 'github').toLowerCase()))
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }) }
})

/* ---- GCP "Connect with Google" OAuth (keyless, per-user) ---- */
const APP_URL = process.env.APP_URL || 'http://localhost:5280'
const REDIRECT_URI = `${APP_URL}/api/connections/gcp/oauth/callback`
const _oauthState = new Map() // state -> userId (short-lived)

r.get('/api/connections/gcp/oauth/start', requireUser, (req, res) => {
  const state = crypto.randomBytes(16).toString('hex')
  _oauthState.set(state, req.cloudUserId)
  setTimeout(() => _oauthState.delete(state), 10 * 60 * 1000)
  res.redirect(authUrl({ redirectUri: REDIRECT_URI, state }))
})

r.get('/api/connections/gcp/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query
  const userId = _oauthState.get(state)
  _oauthState.delete(state)
  if (error) return res.redirect(`${APP_URL}/app/connections?gcp=error`)
  if (!userId || !code) return res.redirect(`${APP_URL}/app/connections?gcp=invalid`)
  try {
    const tok = await exchangeCode({ code, redirectUri: REDIRECT_URI })
    const projects = tok.access_token ? await listProjects(tok.access_token) : []
    setConnection(userId, 'gcp', { refreshToken: tok.refresh_token, projectId: projects[0] || '', projects })
    invalidateUser(userId)
    res.redirect(`${APP_URL}/app/connections?gcp=connected`)
  } catch (e) {
    console.error('[gcp-oauth] callback failed:', e?.message || e)
    res.redirect(`${APP_URL}/app/connections?gcp=failed`)
  }
})

export default r
