/**
 * Agent OAuth (subscription login) — Claude Code and Codex CLI don't take a plain API key; they
 * authenticate against a Claude/ChatGPT SUBSCRIPTION via OAuth. A rented machine is headless (no
 * browser), and Fly `exec` has no TTY to drive the interactive `claude setup-token` prompt — so we
 * drive the OAuth PKCE flow OURSELVES from the server:
 *
 *   start()    → build the authorize URL (with a PKCE challenge we keep) → user opens it, signs into
 *                their own subscription, approves, and claude.ai shows a one-time code.
 *   exchange() → user pastes that code back → we POST it (with the code_verifier) to the token
 *                endpoint → we get the long-lived token that Claude Code reads from
 *                CLAUDE_CODE_OAUTH_TOKEN. That token is injected on the VM at boot.
 *
 * OAuth constants are Claude Code's own public client (the same values `claude setup-token` uses).
 */
import crypto from 'node:crypto'

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// Claude Code's public OAuth client (headless / setup-token flow).
const CLAUDE = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorize: 'https://claude.ai/oauth/authorize',
  token: 'https://platform.claude.com/v1/oauth/token',
  redirect: 'https://platform.claude.com/oauth/code/callback',
  scope: 'user:profile user:inference user:sessions:claude_code user:mcp_servers',
}

const PROVIDERS = { claude: CLAUDE }
export function oauthAgents() { return Object.keys(PROVIDERS) }

// Pending PKCE sessions (verifier + state), keyed by a short id. Expire after 15 min.
const _pending = new Map()
const TTL = 15 * 60 * 1000
function sweep() { const now = Date.now(); for (const [k, v] of _pending) if (now - v.at > TTL) _pending.delete(k) }

// Begin an OAuth login → { oauthId, authUrl }. The client opens authUrl in a new tab.
export function startOAuth(agent) {
  const p = PROVIDERS[agent]
  if (!p) throw new Error(`agent "${agent}" does not use OAuth`)
  sweep()
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const state = b64url(crypto.randomBytes(32))
  const oauthId = b64url(crypto.randomBytes(9))
  _pending.set(oauthId, { agent, verifier, state, at: Date.now() })

  const u = new URL(p.authorize)
  u.searchParams.set('code', 'true')            // manual mode: show the code for the user to copy
  u.searchParams.set('client_id', p.clientId)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('redirect_uri', p.redirect)
  u.searchParams.set('scope', p.scope)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('state', state)
  return { oauthId, authUrl: u.toString() }
}

// Finish the login: exchange the pasted code for the token → { token }.
// claude.ai returns the code as "<code>#<state>"; split it and verify the state.
export async function exchangeOAuth(oauthId, rawCode) {
  const s = _pending.get(oauthId)
  if (!s) throw new Error('this login expired — start again')
  const p = PROVIDERS[s.agent]
  const [code, stateFromCode] = String(rawCode || '').trim().split('#')
  if (!code) throw new Error('paste the code shown after you approve')

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: p.redirect,
    client_id: p.clientId,
    code_verifier: s.verifier,
    state: stateFromCode || s.state,
  })
  const res = await fetch(p.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${text.slice(0, 200)}`)
  let json; try { json = JSON.parse(text) } catch { throw new Error('token endpoint returned a non-JSON response') }
  const token = json.access_token || json.token
  if (!token) throw new Error('no access_token in the token response')
  _pending.delete(oauthId)
  return { token, expiresIn: json.expires_in || null }
}
