/**
 * Actual cloud spend (not estimates) for the connected accounts.
 *  · AWS  → Cost Explorer (`aws ce get-cost-and-usage`) via the MCP — real month-to-date spend.
 *  · GCP  → real spend lives only in the Cloud Billing → BigQuery export; until that's set up we
 *           report needs-setup so the COST tab can show the instructions.
 *
 * Each cloud returns a status the UI renders honestly:
 *   ready       → { total, byService[] }
 *   needs-setup → user must enable Cost Explorer / BigQuery export (instructions shown)
 *   error       → something else went wrong (message)
 */
import { callMcp } from '../libs/mcp.mjs'
import { getConnections } from '../repositories/connections.mjs'
import { refreshAccessToken } from '../libs/gcp-oauth.mjs'

// call_aws → [{response:{as_json:"{...}"}}] where as_json is a JSON string. Find the CE payload.
function deepFindCE(out) {
  const find = (x) => {
    if (typeof x === 'string') { const t = x.trim(); if (t[0] === '{' || t[0] === '[') { try { return find(JSON.parse(t)) } catch { return null } } return null }
    if (Array.isArray(x)) { for (const e of x) { const r = find(e); if (r) return r } return null }
    if (x && typeof x === 'object') { if (x.ResultsByTime) return x; for (const v of Object.values(x)) { const r = find(v); if (r) return r } }
    return null
  }
  return find(out)
}

/** Real AWS spend grouped by service for [start,end). */
export async function awsSpend(userId, start, end) {
  const cmd = `aws ce get-cost-and-usage --time-period Start=${start},End=${end} --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE --output json`
  let out
  try { out = String(await callMcp(userId, 'aws-api', 'call_aws', { cli_command: cmd })) } catch (e) { return { status: 'error', message: String(e?.message || e) } }
  if (/not enabled for cost explorer|AccessDenied/i.test(out)) return { status: 'needs-setup' }
  // Cost Explorer just enabled → data not ingested yet (AWS lags ~24h).
  if (/DataUnavailableException|data is not available|might not be ingested/i.test(out)) return { status: 'pending' }
  const data = deepFindCE(out)
  if (!data?.ResultsByTime) return { status: 'error', message: 'Unexpected Cost Explorer response.' }
  const groups = data.ResultsByTime[0]?.Groups || []
  const byService = groups
    .map((g) => ({ service: g.Keys?.[0] || '—', usd: parseFloat(g.Metrics?.UnblendedCost?.Amount || '0') }))
    .filter((x) => x.usd > 0).sort((a, b) => b.usd - a.usd)
  const total = Math.round(byService.reduce((s, x) => s + x.usd, 0) * 100) / 100
  return { status: 'ready', currency: 'USD', total, byService }
}

async function bqGet(token, url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  return r.ok ? r.json() : null
}

/**
 * GCP spend — queries the Cloud Billing → BigQuery export. We mint the user's OAuth token,
 * discover the `gcp_billing_export_*` table in their project, and aggregate cost by service for
 * the current month. Returns needs-setup if no export, pending if the table hasn't populated yet.
 */
export async function gcpSpend(userId) {
  const conn = getConnections(userId).gcp
  const project = conn?.projectId
  if (!project || !conn?.refreshToken) return { status: 'needs-setup' }
  let token
  try { token = await refreshAccessToken(conn.refreshToken) } catch { return { status: 'needs-setup' } }
  if (!token) return { status: 'needs-setup' }

  // Discover the billing-export table across the project's datasets.
  const ds = await bqGet(token, `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets`)
  if (!ds?.datasets?.length) return { status: 'needs-setup' }
  let dataset = null, table = null
  for (const d of ds.datasets) {
    const dsId = d.datasetReference.datasetId
    const tabs = await bqGet(token, `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets/${dsId}/tables`)
    const t = tabs?.tables?.find((x) => /gcp_billing_export/.test(x.tableReference.tableId))
    if (t) { dataset = dsId; table = t.tableReference.tableId; break }
  }
  // A dataset exists but the export table hasn't been created yet → export on, data not landed.
  if (!table) return { status: 'pending' }

  // Real spend by service for the current invoice month.
  const sql = `SELECT service.description AS service, SUM(cost) AS cost
    FROM \`${project}.${dataset}.${table}\`
    WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
    GROUP BY service ORDER BY cost DESC`
  const r = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 25000 }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = data?.error?.message || ''
    if (/not found|Not found/i.test(msg)) return { status: 'pending' } // export on, table not created yet
    return { status: 'error', message: msg || 'BigQuery query failed.' }
  }
  const byService = (data.rows || [])
    .map((row) => ({ service: row.f?.[0]?.v || '—', usd: parseFloat(row.f?.[1]?.v || '0') }))
    .filter((x) => x.usd > 0).sort((a, b) => b.usd - a.usd)
  const total = Math.round(byService.reduce((s, x) => s + x.usd, 0) * 100) / 100
  return { status: 'ready', currency: 'USD', total, byService }
}

/** Actual spend for every connected cloud, month-to-date. */
export async function costFor(userId) {
  const conns = getConnections(userId)
  const now = new Date()
  const start = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  const end = now.toISOString().slice(0, 10)
  const out = { period: { start, end } }
  if (conns.aws) out.aws = await awsSpend(userId, start, end)
  if (conns.gcp) out.gcp = await gcpSpend(userId)
  return out
}
