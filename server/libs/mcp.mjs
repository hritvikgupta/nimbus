/**
 * MCP bridge — spawns the cloned Google Cloud MCP servers over stdio and exposes their
 * tools to the AI SDK. Directly mirrors company-brain's lib/agents/brain/client.ts
 * (StdioClientTransport -> listTools -> dynamicTool), with ONE key difference: the
 * connection cache is keyed per USER, not per company, and each user's MCP subprocess is
 * spawned with THAT user's credentials (see lib/connections.mjs). That is what makes the
 * same agent serve many users separately — User A's tools talk to A's cloud only.
 *
 * Two servers are wired (both cloned into server/mcp):
 *   · gcloud      → @google-cloud/gcloud-mcp  (run_gcloud_command — full gcloud surface)
 *   · cloud-run   → @google-cloud/cloud-run-mcp (deploy / list / logs for Cloud Run)
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dynamicTool, jsonSchema } from 'ai'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { resolveMcpEnv, getConnections } from '../repositories/connections.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MCP_DIR = path.resolve(HERE, '..', 'mcp')

/** Resolve `uvx` (the AWS MCP runner) to an absolute path — the spawned process's PATH may
 *  not include ~/.local/bin, so don't rely on a bare `uvx`. */
function resolveUvx() {
  const candidates = [
    path.join(process.env.HOME || '', '.local', 'bin', 'uvx'),
    '/opt/homebrew/bin/uvx', '/usr/local/bin/uvx',
  ]
  for (const c of candidates) if (existsSync(c)) return c
  try { return execFileSync('command', ['-v', 'uvx'], { shell: '/bin/zsh' }).toString().trim() } catch {}
  return 'uvx'
}
const UVX = resolveUvx()
const AWS_API_DIR = path.join(MCP_DIR, 'aws-mcp', 'src', 'aws-api-mcp-server')

/** Resolve `npx` (used to run published MCP servers like Supabase's). npm/npx sit next to the
 *  node binary, so prefer that absolute path; fall back to common locations / bare `npx`. */
function resolveNpx() {
  const local = path.join(path.dirname(process.execPath), 'npx')
  if (existsSync(local)) return local
  for (const c of ['/opt/homebrew/bin/npx', '/usr/local/bin/npx']) if (existsSync(c)) return c
  return 'npx'
}
const NPX = resolveNpx()

/** How to launch each cloned MCP server, and which connected cloud it needs. */
const SERVERS = {
  gcloud: {
    cloud: 'gcp',
    command: process.execPath, // node
    args: [path.join(MCP_DIR, 'gcloud-mcp', 'packages', 'gcloud-mcp', 'dist', 'bundle.js')],
  },
  'cloud-run': {
    cloud: 'gcp',
    command: process.execPath,
    args: [path.join(MCP_DIR, 'cloud-run-mcp', 'mcp-server.js')],
  },
  'aws-api': {
    cloud: 'aws',
    command: UVX, // runs the cloned awslabs aws-api-mcp-server (Python) via uv
    args: ['--from', AWS_API_DIR, 'awslabs.aws-api-mcp-server'],
  },
  // Supabase's official MCP — FULL management (create/alter tables, write SQL, run migrations,
  // deploy edge functions, manage branches/projects). Per-user auth via SUPABASE_ACCESS_TOKEN
  // in the scoped env. The agent still confirms before destructive changes (prompt rule 5).
  supabase: {
    cloud: 'supabase',
    command: NPX,
    args: ['-y', '@supabase/mcp-server-supabase@latest'],
  },
  // Neon's official MCP — run locally with the user's API key (their hosted MCP requires an
  // OAuth browser flow; the local server takes the key directly, matching our paste-a-key UX).
  // Args are built per-user so each spawn gets THAT user's key.
  neon: {
    cloud: 'neon',
    command: NPX,
    args: (conn) => ['-y', '@neondatabase/mcp-server-neon', 'start', conn.apiKey || ''],
  },
}

// Persist across reloads; one live connection per (userId::server). Spawning a 2nd
// server for the same user is wasteful and some servers single-lock, so we reuse.
const _conns = new Map() // key -> Promise<{ client, tools }>

function bridgeTools(client, mcpTools) {
  const tools = {}
  for (const t of mcpTools) {
    tools[t.name] = dynamicTool({
      // Keep the FULL tool description — it IS the MCP's teaching layer. gcloud's
      // run_gcloud_command embeds ~1.8k chars of "## Instructions:" (format/filter rules,
      // restrictions); AWS's call_aws is longer still. Truncating it starves the agent of
      // how to use the tool, so we keep a generous budget.
      description: (t.description ?? '').slice(0, 8000),
      inputSchema: jsonSchema(t.inputSchema ?? { type: 'object', properties: {} }),
      execute: async (args) => {
        const r = await client.callTool({ name: t.name, arguments: args ?? {} })
        const content = r.content ?? []
        return (content.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n') || '(no content)').slice(0, 8000)
      },
    })
  }
  return tools
}

async function connect(userId, serverId) {
  const spec = SERVERS[serverId]
  let transport
  if (spec.transport === 'http') {
    // Hosted MCP (e.g. Neon) — connect over Streamable HTTP with this user's auth header.
    const conn = getConnections(userId)[spec.cloud] || {}
    const headers = spec.headers ? spec.headers(conn) : {}
    transport = new StreamableHTTPClientTransport(new URL(spec.url), { requestInit: { headers } })
  } else {
    // Local stdio MCP — spawn the process with a SCOPED env: PATH for the binary + ONLY this
    // user's creds. We do NOT forward the whole parent env (that would leak the host login).
    const env = await resolveMcpEnv(userId, spec.cloud) // per-user creds (STS for AWS roleArn); null if not connected
    const conn = getConnections(userId)[spec.cloud] || {}
    const args = typeof spec.args === 'function' ? spec.args(conn) : spec.args // per-user args (e.g. Neon key)
    transport = new StdioClientTransport({
      command: spec.command,
      args,
      env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', ...(env || {}) },
    })
  }
  const client = new Client({ name: `nimbus-${userId}-${serverId}`, version: '1.0.0' })
  await client.connect(transport)
  const { tools } = await client.listTools()
  return { client, tools: bridgeTools(client, tools) }
}

const _connAt = new Map()   // key -> spawn time (for TTL refresh)
const _connUsed = new Map() // key -> last-used time (for idle eviction)
const TTL_MS = 45 * 60 * 1000 // re-spawn before a ~1h OAuth access token expires
// Idle eviction: each active user with a connected cloud holds live MCP subprocess(es). To keep
// memory bounded under many users, drop a connection that hasn't been used in IDLE_MS — the next
// request just re-spawns it (~1s). Only *currently active* users cost memory.
const IDLE_MS = 5 * 60 * 1000

function dropKey(key) {
  const p = _conns.get(key)
  _conns.delete(key); _connAt.delete(key); _connUsed.delete(key)
  p?.then(({ client }) => client.close?.()).catch(() => {})
}

/** Drop all cached MCP processes for a user (call when their credentials change). */
export function invalidateUser(userId) {
  for (const key of [..._conns.keys()]) if (key.startsWith(`${userId}::`)) dropKey(key)
}

// Reap connections idle longer than IDLE_MS. Returns how many were dropped. Exported so it's
// unit-testable against the real connection maps.
export function reapIdle(now = Date.now()) {
  let reaped = 0
  for (const key of [..._conns.keys()]) if (now - (_connUsed.get(key) || 0) > IDLE_MS) { dropKey(key); reaped++ }
  return reaped
}
// Periodic sweep so subprocess count tracks *active* users, not total users.
const _sweeper = setInterval(() => reapIdle(), 60 * 1000)
_sweeper.unref?.() // don't keep the process alive just for the sweep

// Test-only hooks (seed a fake live connection / inspect presence) so eviction can be verified
// without spawning a real cloud subprocess. Not used by app code.
export function __seedConnForTest(key, lastUsedMs) {
  _conns.set(key, Promise.resolve({ client: { close() {} }, tools: {} }))
  _connAt.set(key, lastUsedMs); _connUsed.set(key, lastUsedMs)
}
export function __hasConnForTest(key) { return _conns.has(key) }

async function conn(userId, serverId) {
  const key = `${userId}::${serverId}`
  _connUsed.set(key, Date.now()) // mark active on every use
  // refresh a connection whose creds (e.g. OAuth access token) may have expired
  if (_conns.has(key) && Date.now() - (_connAt.get(key) || 0) > TTL_MS) dropKey(key)
  let p = _conns.get(key)
  if (!p) {
    p = connect(userId, serverId)
    _conns.set(key, p); _connAt.set(key, Date.now())
    p.catch(() => dropKey(key)) // allow retry on failure
  }
  return p
}

/** Tools for one cloned MCP server, for one user (cached). */
export async function mcpTools(userId, serverId) {
  return (await conn(userId, serverId)).tools
}

/** Call a single MCP tool deterministically (for server logic, not the LLM). Returns text. */
export async function callMcp(userId, serverId, name, args = {}) {
  const { client } = await conn(userId, serverId)
  const r = await client.callTool({ name, arguments: args })
  const content = r.content ?? []
  return content.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n')
}

/** All MCP tools available to a user given their connected clouds. Skips servers whose
 *  cloud the user hasn't connected, and skips silently if a server fails to start. */
export async function allMcpToolsFor(userId, connectedClouds) {
  const wanted = Object.entries(SERVERS).filter(([, s]) => connectedClouds.includes(s.cloud))
  const sets = await Promise.all(
    wanted.map(async ([id]) => {
      try { return await mcpTools(userId, id) }
      catch (e) { console.error(`[mcp] ${id} failed for ${userId}:`, e?.message || e); return {} }
    }),
  )
  return Object.assign({}, ...sets)
}

export const MCP_SERVER_IDS = Object.keys(SERVERS)
