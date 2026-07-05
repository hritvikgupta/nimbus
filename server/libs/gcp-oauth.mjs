/**
 * GCP "Connect with Google" OAuth — the keyless, per-user path for orgs that block service
 * account keys (iam.disableServiceAccountKeyCreation). Uses the EXACT OAuth client the
 * cloud-run-mcp ships in its `.env.gcloud-sdk-oauth` (the Google Cloud SDK client) and its
 * documented endpoints — we are not inventing a client.
 *
 *   client    = 32555940559.apps.googleusercontent.com  (gcloud SDK OAuth client)
 *   auth      = https://accounts.google.com/o/oauth2/v2/auth
 *   token     = https://oauth2.googleapis.com/token
 *   scope     = cloud-platform
 *
 * Flow: user clicks "Connect with Google" → consents → we get a refresh token → per MCP
 * spawn we (a) write an ADC "authorized_user" file for cloud-run-mcp's GoogleAuth and
 * (b) mint a fresh access token for gcloud-mcp's CLOUDSDK_AUTH_ACCESS_TOKEN. Both auth as
 * THAT user, with auto-refresh — true per-user, no keys.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '32555940559.apps.googleusercontent.com'
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || 'ZmssLNjJy2998hD4CTg2ejr2'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.data')

/** The Google consent URL to send the user to. */
export function authUrl({ redirectUri, state }) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // → refresh token
    prompt: 'consent',
    state,
  })
  return `${AUTH_ENDPOINT}?${p.toString()}`
}

/** Exchange the auth code for { access_token, refresh_token }. */
export async function exchangeCode({ code, redirectUri }) {
  const r = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  })
  if (!r.ok) throw new Error(`token exchange failed: ${await r.text()}`)
  return r.json()
}

/** Mint a fresh access token from a stored refresh token. */
export async function refreshAccessToken(refreshToken) {
  const r = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })
  if (!r.ok) throw new Error(`token refresh failed: ${await r.text()}`)
  return (await r.json()).access_token
}

/** List the user's active projects (Cloud Resource Manager) with an access token. */
export async function listProjects(accessToken) {
  const r = await fetch('https://cloudresourcemanager.googleapis.com/v1/projects', {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) return []
  const d = await r.json()
  return (d.projects || []).filter((p) => p.lifecycleState === 'ACTIVE').map((p) => p.projectId)
}

/**
 * Env for this user's GCP MCPs from their OAuth refresh token:
 *  - GOOGLE_APPLICATION_CREDENTIALS → an ADC "authorized_user" file (cloud-run-mcp / ADC,
 *    auto-refreshes)
 *  - CLOUDSDK_AUTH_ACCESS_TOKEN → a fresh bearer token (gcloud-mcp / gcloud CLI)
 */
export async function oauthMcpEnv({ userId, projectId, refreshToken }) {
  const keyFile = path.join(DATA_DIR, `gcp-oauth-${userId}.json`)
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(keyFile, JSON.stringify({
    type: 'authorized_user', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refreshToken,
  }), { mode: 0o600 })
  const accessToken = await refreshAccessToken(refreshToken)
  return {
    GOOGLE_APPLICATION_CREDENTIALS: keyFile,
    CLOUDSDK_AUTH_ACCESS_TOKEN: accessToken,
    CLOUDSDK_CORE_PROJECT: projectId || '',
  }
}
