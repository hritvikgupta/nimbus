/**
 * Service config + cost — split into two reliable, REAL pieces (no live LLM-as-orchestrator,
 * no dummy fallback):
 *
 *  1. SCHEMA (the manual form): a plain LLM call picks WHICH fields a service needs (no tools,
 *     so the JSON is reliable). Real option lists for instance/machine types, regions and DB
 *     classes are then injected straight from the MCP (server/lib/catalog.mjs). The result is
 *     stored in the persistent catalog so the panel is deterministic + instant afterwards.
 *
 *  2. PRICE (live): a separate grounded call hits the real AWS Price List API / GCP billing via
 *     the MCP for the CURRENT config. If it genuinely can't get a price it returns null — never
 *     a made-up number.
 */
import { generateText, stepCountIs } from 'ai'
import { chatModel } from '../libs/openrouter.mjs'
import { allMcpToolsFor, callMcp } from '../libs/mcp.mjs'
import { getConnections } from '../repositories/connections.mjs'
import { enrichOptions, awsEc2MonthlyUSD } from './catalog.mjs'
import { getCatalogEntry, setCatalogEntry } from '../repositories/catalog-store.mjs'
import { getProjects, getGraph } from '../repositories/projects.mjs'
import { tfFields } from './tfschema.mjs'

/* ---------------- shared JSON parsing ---------------- */
function parseJson(text) {
  if (!text) return null
  let t = String(text).trim().replace(/```(?:json)?/gi, '')
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a === -1 || b === -1) return null
  t = t.slice(a, b + 1)
  for (const c of [t, t.replace(/,\s*([}\]])/g, '$1'), t.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"')]) {
    try { return JSON.parse(c) } catch { /* next */ }
  }
  return null
}
const isConnected = (userId, cloud) => !!cloud && !!userId && Object.keys(getConnections(userId)).includes(cloud)

/* ---------------- 1. SCHEMA (fields) — from the MCP's real command parameters ----------------
   Reliable two-step: (1) fetch the service's REAL create-command parameters straight from the
   MCP in code (deterministic — no LLM orchestrating tools), then (2) a plain no-tools LLM call
   just shapes those real parameters into the field schema (reliable JSON). */
const SCHEMA_RULES = `Output STRICT JSON ONLY (no prose, no fences):
{ "title":"Category · Service", "fields":[ { "key":"camelCase","label":"Human label",
  "type":"select|number|bool|text","options":["..."],"unit":"GB|vCPU|...","default":<value> } ] }
- Pick the 4-7 parameters a user should control for sizing / capability / cost.
- For INSTANCE TYPE / MACHINE TYPE / REGION / DB INSTANCE CLASS fields: set "type":"select" and
  "options":[] (a real list is injected later). For other enumerable params use their real
  allowed values. "default" must match the type. No commentary, no extra keys.`

const SYS_FROM_PARAMS = `You convert a cloud service's REAL create-command parameters (given to
you) into an editable config-panel schema. Use ONLY the given parameters. ${SCHEMA_RULES}`
const SYS_PLAIN = `You generate the editable config schema for ONE cloud service from knowledge of
its real create options. ${SCHEMA_RULES}`

/** Pull the real create command + its full parameter set straight from the MCP. */
async function fetchRealParams(userId, cloud, type) {
  try {
    if (cloud === 'aws') {
      const out = await callMcp(userId, 'aws-api', 'suggest_aws_commands', { query: `create a ${type}` })
      const s = typeof out === 'string' ? out : JSON.stringify(out)
      return s ? s.slice(0, 7000) : null
    }
    return null // GCP: fall back to model-known options + real enrich; gcloud --help mapping is fuzzy
  } catch { return null }
}

async function buildSchema(userId, cloud, type) {
  const grounded = isConnected(userId, cloud)
  const realParams = grounded ? await fetchRealParams(userId, cloud, type) : null
  const system = realParams ? SYS_FROM_PARAMS : SYS_PLAIN
  const prompt = realParams
    ? `Cloud: ${cloud}\nService type: ${type}\n\nThe service's REAL create command and parameters (from the AWS CLI metadata):\n${realParams}\n\nReturn the schema JSON now.`
    : `Cloud: ${cloud}\nService type: ${type}\nReturn the schema JSON now.`
  for (let i = 0; i < 3; i++) {
    const { text } = await generateText({
      model: chatModel(),
      system: system + (i ? '\n\nReturn the JSON object ONLY.' : ''),
      prompt, temperature: 0, maxOutputTokens: 900, maxRetries: 1,
    }).catch(() => ({ text: '' }))
    const j = parseJson(text)
    if (j && Array.isArray(j.fields) && j.fields.length) return { title: j.title || type, fields: j.fields, grounded: !!realParams }
  }
  return null
}

const defaultSpecOf = (fields) => Object.fromEntries((fields || []).map((f) => [f.key, f.default]))
const titleOf = (cloud, resource) => `${cloud.toUpperCase()} · ${String(resource).replace(/^(aws|google)_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`

/**
 * Catalog entry for a service:
 *   · FIELDS  → real config fields from the Terraform provider schema (deterministic, no LLM)
 *   · OPTIONS → real dropdown values overlaid from the live MCP (instance types, regions, …)
 * This is the shared CONTRACT: the agent fills these fields when it creates a node, and the
 * resource panel shows/edits the same fields — one synced config. Built once + cached. No price.
 */
export async function getSchema(userId, cloud, type) {
  const existing = getCatalogEntry(cloud, type)
  if (existing && existing.fields?.length) return existing // cached

  const tf = tfFields(cloud, type)
  if (!tf) return null // resource not found in the provider schema
  const entry = {
    title: titleOf(cloud, tf.resource),
    resource: tf.resource,
    fields: tf.primary,           // useful sizing/config fields from Terraform
    advanced: tf.secondary,       // the rest, available under "advanced"
    source: 'terraform',
    builtAt: Date.now(),
  }
  if (isConnected(userId, cloud)) {
    try { await enrichOptions(userId, cloud, 'us-east-1', entry.fields) } catch { /* keep field as text */ }
    for (const f of entry.fields) {
      if (f.type === 'select' && f.options?.length && (f.default === '' || f.default == null)) {
        f.default = f.options.find((o) => o === 'us-east-1') || f.options[0]
      }
    }
  }
  setCatalogEntry(cloud, type, entry)
  return entry
}

/* ---------------- 2. PRICE (live, real-or-null) ---------------- */
const SYS_PRICE = `You price ONE cloud service configuration using REAL data only.
Use your tools to fetch the actual on-demand price:
 AWS (call_aws): the AWS Price List API lives in us-east-1, e.g.
   aws pricing get-products --service-code AmazonEC2 --region us-east-1 --filters \\
     "Type=TERM_MATCH,Field=instanceType,Value=t3.medium" \\
     "Type=TERM_MATCH,Field=location,Value=US East (N. Virginia)" \\
     "Type=TERM_MATCH,Field=operatingSystem,Value=Linux" \\
     "Type=TERM_MATCH,Field=tenancy,Value=Shared" \\
     "Type=TERM_MATCH,Field=preInstalledSw,Value=NA" \\
     "Type=TERM_MATCH,Field=capacitystatus,Value=Used" --max-items 1
   (RDS→AmazonRDS, S3→AmazonS3, etc. Map region code → the pricing "location" name.) If unsure
   of the command, call suggest_aws_commands first. Keep queries NARROW.
 GCP (run_gcloud_command): query the Cloud Billing catalog / SKUs.
Then output STRICT JSON ONLY (no prose/fences):
{ "estMonthlyUsd": <number>, "costLines": [ {"label":"string","usd":<number>} ],
  "note": "cite the exact command/source you priced from" }
The price MUST reflect the CURRENT config. If you genuinely cannot fetch a real price, output
{ "estMonthlyUsd": null, "costLines": [], "note": "why it's unavailable" }. NEVER invent a number.`

const _priceCache = new Map() // key -> { v, exp }
const PRICE_TTL = 30 * 60 * 1000

async function priceFor(userId, cloud, type, region, spec) {
  const key = `${userId}|${cloud}|${type}|${region}|${JSON.stringify(spec || {})}`
  const hit = _priceCache.get(key)
  if (hit && hit.exp > Date.now()) return hit.v

  // Deterministic pricing for EC2 (instance compute) — direct AWS Price List API, no LLM.
  const it = spec?.instance_type || spec?.instanceType
  if (cloud === 'aws' && it && /ec2|instance/i.test(type)) {
    try {
      const usd = await awsEc2MonthlyUSD(userId, it, region || 'us-east-1')
      if (usd != null) {
        const v = { estMonthlyUsd: usd, costLines: [{ label: `${it} on-demand (Linux, ${region || 'us-east-1'}) · 730 hrs`, usd }], note: `AWS Price List API · ${it}` }
        _priceCache.set(key, { v, exp: Date.now() + PRICE_TTL })
        return v
      }
    } catch { /* fall through to MCP/LLM pricing */ }
  }

  const tools = await allMcpToolsFor(userId, [cloud])
  for (let i = 0; i < 2; i++) {
    const { text } = await generateText({
      model: chatModel(),
      system: SYS_PRICE + (i ? '\n\nReturn the JSON object ONLY.' : ''),
      prompt: `Cloud: ${cloud}\nService type: ${type}\nRegion: ${region || 'us-east-1'}\nConfiguration: ${JSON.stringify(spec || {})}\nReturn the price JSON now.`,
      tools, stopWhen: stepCountIs(8), temperature: 0, maxOutputTokens: 800, maxRetries: 1,
    }).catch(() => ({ text: '' }))
    const j = parseJson(text)
    if (j && ('estMonthlyUsd' in j)) {
      const v = { estMonthlyUsd: j.estMonthlyUsd ?? null, costLines: j.costLines || [], note: j.note || '' }
      _priceCache.set(key, { v, exp: Date.now() + PRICE_TTL })
      return v
    }
  }
  return { estMonthlyUsd: null, costLines: [], note: 'Live price unavailable right now — reopen to retry.' }
}

/* ---------------- combined: schema + price ---------------- */
/**
 * @param {{userId?:string, cloud:string, type:string, region?:string, spec?:object,
 *          knownFields?:Array, priceOnly?:boolean}} input
 */
export async function specFor({ userId, cloud, type }) {
  const grounded = isConnected(userId, cloud)
  const schema = await getSchema(userId, cloud, type)
  if (!schema) return { error: 'Could not load a real configuration for this service — retry.', grounded }
  return { title: schema.title, fields: schema.fields, resource: schema.resource, grounded }
}

/* ---------------- prefetch: warm the catalog for the service types ACTUALLY in use ----------------
   No hardcoded service list — we enumerate the node types that exist in the user's project
   canvases (whatever the design agent created) and build a schema for each. */
export async function prefetchCatalog(userId, clouds) {
  const types = new Map() // `${cloud}:${type}` -> { cloud, type }
  for (const p of getProjects(userId)) {
    for (const n of (getGraph(userId, p.id).nodes || [])) {
      if (clouds.includes(n.cloud)) types.set(catalogKeyOf(n.cloud, n.type), { cloud: n.cloud, type: n.type })
    }
  }
  const result = {}
  for (const { cloud, type } of types.values()) {
    if (getCatalogEntry(cloud, type)) { result[`${cloud}:${type}`] = 'cached'; continue }
    try { result[`${cloud}:${type}`] = (await getSchema(userId, cloud, type)) ? 'built' : 'failed' }
    catch { result[`${cloud}:${type}`] = 'error' }
  }
  return result
}

/** Build + store the schema for one node's service type (fire-and-forget on node creation). */
export async function ensureSchema(userId, cloud, type) {
  if (getCatalogEntry(cloud, type)) return
  try { await getSchema(userId, cloud, type) } catch { /* will build lazily on open */ }
}
const catalogKeyOf = (cloud, type) => `${cloud}:${String(type || '').toLowerCase().trim()}`
