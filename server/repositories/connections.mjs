/**
 * Per-user cloud connection store, persisted to disk (server/.data/connections.json) so
 * connections survive backend restarts. In the real product this is a DB table keyed by
 * user_id holding each user's cloud grant (GCP project + impersonated SA / OAuth, AWS
 * role ARN / keys). The isolation boundary is the same shape: every MCP call runs under
 * THIS user's credentials, never a shared one.
 *
 * Flow this mirrors:
 *   user signs up -> logs in -> clicks "Connect AWS/GCP" -> we store their grant here ->
 *   the agent spawns/calls the MCP with that user's (short-lived) credentials.
 */
import { loadJson, saveJson } from './store.mjs'
import { encryptJson, decryptJson, isEncrypted } from '../libs/crypto.mjs'

// Credentials are stored ENCRYPTED at rest (AES-256-GCM). The whole userId→connections map is one
// encrypted envelope; plaintext lives only in the in-memory _conns Map at use time.
function loadConns() {
  const raw = loadJson('connections.json', {})
  if (isEncrypted(raw)) { try { return decryptJson(raw) } catch (e) { console.error('[connections] decrypt failed:', e?.message); return {} } }
  return raw // legacy plaintext — re-encrypted on first persist() below
}

/** userId -> { gcp?: {...}, aws?: {...} } — loaded (and decrypted) on startup. */
const _conns = new Map(Object.entries(loadConns()))
function persist() { saveJson('connections.json', encryptJson(Object.fromEntries(_conns))) }

// One-time migration: if what we loaded was legacy plaintext, rewrite it encrypted now.
if (_conns.size > 0 && !isEncrypted(loadJson('connections.json', {}))) {
  persist()
  console.warn('[connections] migrated plaintext credentials → encrypted at rest')
}

export function getConnections(userId) {
  return _conns.get(userId) || {}
}

/** User ids that have at least one cloud connected (for the scheduled ops scan). */
export function connectedUserIds() {
  return [..._conns.entries()].filter(([, conns]) => Object.keys(conns || {}).length > 0).map(([userId]) => userId)
}

export function setConnection(userId, cloud, conn) {
  const cur = _conns.get(userId) || {}
  cur[cloud] = conn
  _conns.set(userId, cur)
  persist()
  return cur
}

export function removeConnection(userId, cloud) {
  const cur = _conns.get(userId) || {}
  delete cur[cloud]
  _conns.set(userId, cur)
  persist()
  return cur
}

export function isConnected(userId, cloud) {
  return Boolean((_conns.get(userId) || {})[cloud])
}

/**
 * The env a per-user MCP process is spawned with. THIS is the isolation point: each
 * user's MCP subprocess only ever sees THEIR credentials.
 *
 * Production: mint a short-lived impersonated token here (GCP serviceAccountTokenCreator
 * / AWS STS AssumeRole) and inject it. Demo: pass through what we stored. We deliberately
 * do NOT inherit the parent's ambient gcloud login for a connected user — that would leak
 * the host identity across users.
 */
export function mcpEnvFor(userId, cloud) {
  const conn = getConnections(userId)[cloud]
  if (!conn) return null
  if (cloud === 'gcp') {
    return {
      // a real impl sets GOOGLE_APPLICATION_CREDENTIALS to a per-request token file,
      // or CLOUDSDK_AUTH_ACCESS_TOKEN to the impersonated access token.
      CLOUDSDK_CORE_PROJECT: conn.projectId || '',
      ...(conn.accessToken ? { CLOUDSDK_AUTH_ACCESS_TOKEN: conn.accessToken } : {}),
      ...(conn.credentialsFile ? { GOOGLE_APPLICATION_CREDENTIALS: conn.credentialsFile } : {}),
    }
  }
  if (cloud === 'aws') {
    return {
      AWS_REGION: conn.region || 'us-east-1',
      // Local/dev: a named profile from ~/.aws (HOME is passed through), or static keys.
      // The cross-account Role ARN path is handled async in resolveMcpEnv (STS).
      ...(conn.profile ? { AWS_API_MCP_PROFILE_NAME: conn.profile } : {}),
      ...(conn.accessKeyId ? { AWS_ACCESS_KEY_ID: conn.accessKeyId } : {}),
      ...(conn.secretAccessKey ? { AWS_SECRET_ACCESS_KEY: conn.secretAccessKey } : {}),
      ...(conn.sessionToken ? { AWS_SESSION_TOKEN: conn.sessionToken } : {}),
    }
  }
  if (cloud === 'supabase') {
    // The Supabase MCP authenticates with a personal access token via this env var.
    return { SUPABASE_ACCESS_TOKEN: conn.accessToken || '' }
  }
  return {}
}

/**
 * Async env resolver used at MCP spawn time. Same as mcpEnvFor, except AWS connections that
 * supplied a cross-account `roleArn` get SHORT-LIVED credentials minted via STS AssumeRole
 * (the real per-user path). Falls back to the static env (keys / profile / host chain) if
 * no roleArn, or if assume-role fails.
 */
export async function resolveMcpEnv(userId, cloud) {
  const conn = getConnections(userId)[cloud]
  if (!conn) return null
  if (cloud === 'gcp' && conn.refreshToken) {
    try {
      const { oauthMcpEnv } = await import('../libs/gcp-oauth.mjs')
      return await oauthMcpEnv({ userId, projectId: conn.projectId, refreshToken: conn.refreshToken })
    } catch (e) {
      console.error(`[gcp-oauth] env failed for ${userId}:`, e?.message || e)
    }
  }
  if (cloud === 'gcp' && conn.serviceAccountKey) {
    try {
      const { resolveGcpEnv } = await import('../libs/gcp.mjs')
      return await resolveGcpEnv({ userId, projectId: conn.projectId, serviceAccountKey: conn.serviceAccountKey })
    } catch (e) {
      console.error(`[gcp] activate-service-account failed for ${userId}:`, e?.message || e)
      // fall through to static env (host gcloud login)
    }
  }
  if (cloud === 'aws' && conn.roleArn) {
    try {
      const { assumeRole } = await import('../libs/aws.mjs')
      return await assumeRole({
        roleArn: conn.roleArn, externalId: conn.externalId,
        region: conn.region || 'us-east-1', sessionName: `nimbus-${userId}`,
      })
    } catch (e) {
      console.error(`[aws] assume-role failed for ${userId}:`, e?.message || e)
      // fall through to static env (e.g. host base creds) so the call still attempts
    }
  }
  return mcpEnvFor(userId, cloud)
}
