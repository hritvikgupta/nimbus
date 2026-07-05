/**
 * Composio integration — connect a USER's external app accounts (GitHub, …) via Composio and
 * expose their tools to the Nimbus agent. Adapted 1:1 from company-brain's proven lib/libs/
 * composio.ts: one server-side COMPOSIO_API_KEY, each Nimbus user mapped to a stable Composio
 * user id. SDK: @composio/core (REST) + @composio/vercel (AI-SDK tool provider — the tools come
 * with a built-in execute, so they drop straight into streamText({ tools })).
 *
 * Per-user throughout: every call is scoped to composioUserId(userId).
 */
import { Composio } from '@composio/core'
import { VercelProvider } from '@composio/vercel'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** Read a key from process.env, else the project .env / .env.local (gitignored). */
function cfg(key) {
  if (process.env[key]) return process.env[key]
  for (const p of [path.resolve(HERE, '..', '..', '.env'), path.resolve(HERE, '..', '..', '.env.local')]) {
    try {
      const m = fs.readFileSync(p, 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm'))
      if (m) return m[1].trim()
    } catch { /* no file */ }
  }
  return ''
}
const API_KEY = cfg('COMPOSIO_API_KEY')

export function composioConfigured() { return !!API_KEY }

let _client, _vercel
function client() {
  if (!API_KEY) throw new Error('COMPOSIO_API_KEY is not set on the server')
  if (!_client) _client = new Composio({ apiKey: API_KEY })
  return _client
}
function vercelClient() {
  if (!API_KEY) throw new Error('COMPOSIO_API_KEY is not set on the server')
  if (!_vercel) _vercel = new Composio({ apiKey: API_KEY, provider: new VercelProvider() })
  return _vercel
}

/** Stable Composio user id for a Nimbus user. */
export function composioUserId(userId) { return `nimbus_${userId}` }

/** Apps we surface in the connections UI (Composio has 1000+ — curated set). */
export const TOOLKIT_CATALOG = [
  { slug: 'github', name: 'GitHub', description: 'Repos, files, issues, pull requests.' },
]

function toolkitSlugOf(item) {
  const raw = item?.toolkit?.slug ?? item?.toolkitSlug ?? item?.toolkit ?? item?.appName ?? ''
  return String(raw).toLowerCase()
}

/* simple per-user TTL cache so we don't round-trip Composio on every chat turn */
const _cache = new Map() // userId -> { at, toolkits }
const TTL = 60 * 1000
export function invalidateComposio(userId) { _cache.delete(userId) }

/** Toolkit slugs this user has a LIVE (ACTIVE) connected account for.
 *  Pass { fresh: true } to bypass the TTL cache (used by the connect-flow poller). */
export async function listConnectedToolkits(userId, { fresh = false } = {}) {
  if (!composioConfigured()) return []
  const c = _cache.get(userId)
  if (!fresh && c && Date.now() - c.at < TTL) return c.toolkits
  try {
    const res = await client().connectedAccounts.list({ userIds: [composioUserId(userId)] })
    const out = new Set()
    for (const it of res?.items ?? []) {
      const tk = toolkitSlugOf(it)
      if (tk && String(it?.status ?? '').toUpperCase() === 'ACTIVE') out.add(tk)
    }
    const toolkits = [...out]
    _cache.set(userId, { at: Date.now(), toolkits })
    return toolkits
  } catch (e) {
    console.error('[composio] listConnectedToolkits failed', e?.message || e)
    return []
  }
}

/** Resolve (or create) a Composio-managed auth config for a toolkit. */
async function managedAuthConfigId(toolkitSlug) {
  const c = client()
  const list = await c.authConfigs.list({ toolkit: toolkitSlug })
  const items = list?.items ?? []
  const existing = items.find((i) => i?.isComposioManaged) ?? items[0]
  if (existing?.id) return String(existing.id)
  const created = await c.authConfigs.create(toolkitSlug, { type: 'use_composio_managed_auth' })
  return String(created?.id ?? '')
}

/** Start an OAuth connect flow for a toolkit → the URL to send the user to. */
export async function authorizeToolkit(userId, toolkitSlug) {
  const authConfigId = await managedAuthConfigId(toolkitSlug)
  if (!authConfigId) throw new Error(`could not resolve an auth config for ${toolkitSlug}`)
  const req = await client().connectedAccounts.link(composioUserId(userId), authConfigId)
  invalidateComposio(userId)
  return { redirectUrl: req?.redirectUrl ?? null, connectionId: req?.id ?? '' }
}

/** The user's GitHub repos (full_name list), via the connected Composio account.
 *  Uses the Vercel-provider tool (its execute has the toolkit version baked in — the raw
 *  client().tools.execute() rejects with "Toolkit version not specified"). */
export async function listGithubRepos(userId) {
  if (!composioConfigured()) return []
  try {
    const cu = composioUserId(userId)
    // Fetch by explicit tool slug — asking by { toolkits:['github'] } returns GitHub's DEFAULT
    // action set, which frequently omits LIST_REPOSITORIES, leaving `t` undefined (→ empty list).
    const SLUG = 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER'
    const tools = await vercelClient().tools.get(cu, { tools: [SLUG] })
    const t = tools?.[SLUG]
    if (!t?.execute) return []
    let out = await t.execute({ per_page: 100, sort: 'updated' }, {})
    if (typeof out === 'string') { try { out = JSON.parse(out) } catch { /* keep string */ } }
    let data = out?.data ?? out
    const arr = Array.isArray(data) ? data : (data?.items || data?.details || data?.repositories || [])
    return (Array.isArray(arr) ? arr : [])
      .map((x) => x?.full_name || (x?.owner?.login && x?.name ? `${x.owner.login}/${x.name}` : x?.name))
      .filter(Boolean).slice(0, 100)
  } catch (e) { console.error('[composio] list repos failed', e?.message || e); return [] }
}

/**
 * Curated GitHub action allowlist. GitHub exposes 800+ Composio tools — dumping them all into an
 * agent blows the context window and degrades tool selection. We hand the agent exactly the
 * actions it needs: read (inspect repo/PRs/commits/CI) + write (branch → commit → PR → comment).
 * Used by both the chat agent and the ops agent.
 */
export const GITHUB_AGENT_TOOLS = [
  // read
  'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER',
  'GITHUB_GET_A_REPOSITORY', 'GITHUB_GET_REPOSITORY_CONTENT', 'GITHUB_GET_A_REPOSITORY_README',
  'GITHUB_GET_A_BRANCH', 'GITHUB_GET_A_REFERENCE', 'GITHUB_GET_A_COMMIT', 'GITHUB_LIST_COMMITS',
  'GITHUB_GET_A_PULL_REQUEST', 'GITHUB_LIST_PULL_REQUESTS', 'GITHUB_LIST_PULL_REQUESTS_FILES',
  'GITHUB_LIST_REPOSITORY_ISSUES', 'GITHUB_SEARCH_CODE', 'GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY',
  // write (gated behind user confirmation by the agent prompt)
  'GITHUB_CREATE_A_REFERENCE', 'GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS', 'GITHUB_COMMIT_MULTIPLE_FILES',
  'GITHUB_CREATE_A_PULL_REQUEST', 'GITHUB_CREATE_AN_ISSUE', 'GITHUB_CREATE_AN_ISSUE_COMMENT',
  'GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST',
]
// Per-toolkit slug allowlists (toolkits not listed here load their default set).
const TOOLKIT_TOOLSLUGS = { github: GITHUB_AGENT_TOOLS }

/**
 * Composio TOOL ROUTER (the professional pattern — mirrors company-brain/worklone).
 *
 * Instead of pre-loading a fixed list of an app's actions (GitHub alone has 800+, and any cap
 * silently drops the one you need), we hand the agent a Tool Router SESSION's meta-tools:
 *   COMPOSIO_SEARCH_TOOLS, COMPOSIO_GET_TOOL_SCHEMAS, COMPOSIO_MULTI_EXECUTE_TOOL,
 *   COMPOSIO_MANAGE_CONNECTIONS, COMPOSIO_REMOTE_BASH_TOOL, COMPOSIO_REMOTE_WORKBENCH.
 * The agent SEARCHES the catalog at runtime, gets the exact tool + schema, and executes it —
 * scoped to THIS user's connected toolkits. Sessions are cached per user across requests.
 */
const _routerSessions = new Map() // key -> Promise<session>
export async function composioRouterTools(userId, toolkitSlugs) {
  if (!composioConfigured() || !toolkitSlugs?.length) return {}
  const cu = composioUserId(userId)
  const key = `${cu}:${[...toolkitSlugs].sort().join(',')}`
  let p = _routerSessions.get(key)
  if (!p) {
    p = vercelClient().create(cu, { toolkits: toolkitSlugs })
    _routerSessions.set(key, p)
    p.catch(() => _routerSessions.delete(key))
  }
  try {
    const session = await p
    return await session.tools()
  } catch (e) {
    console.error('[composio] tool router session failed:', e?.message || e)
    _routerSessions.delete(key)
    return {}
  }
}

/** Vercel AI-SDK tools for this user's connected toolkits — drops into streamText({ tools }). */
export async function connectedAppTools(userId, toolkitSlugs) {
  if (!composioConfigured() || !toolkitSlugs?.length) return {}
  const cu = composioUserId(userId)
  const merged = {}
  for (const tk of toolkitSlugs) {
    try {
      // Scope curated toolkits to their allowlist; others fall back to the toolkit's default set.
      const slugs = TOOLKIT_TOOLSLUGS[String(tk).toLowerCase()]
      const opts = slugs ? { tools: slugs } : { toolkits: [tk], limit: 999 }
      const tools = await vercelClient().tools.get(cu, opts)
      Object.assign(merged, tools)
    } catch (e) {
      console.error(`[composio] tools for "${tk}" failed:`, e?.message || e)
    }
  }
  return merged
}
