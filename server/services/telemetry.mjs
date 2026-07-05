/**
 * Live telemetry — real performance metrics for a running resource, read from the cloud's
 * monitoring service through the SAME MCP + credentials the rest of the app uses.
 *
 * NO hardcoded per-service metric catalog. For each resource we ASK the cloud what metrics it
 * publishes, then fetch them:
 *   AWS → `aws cloudwatch list-metrics` (discover) → `get-metric-statistics` (fetch)   [via MCP]
 *   GCP → `metricDescriptors.list` (discover)      → `timeSeries.list` (fetch)         [Monitoring API]
 *
 * This covers ANY of the ~1400 services automatically — whatever the resource actually emits.
 * The panel loops over the user's live resources and calls telemetryFor() per resource.
 */
import { callMcp } from '../libs/mcp.mjs'
import { getConnections } from '../repositories/connections.mjs'
import { refreshAccessToken } from '../libs/gcp-oauth.mjs'

function parseJson(t) { try { return JSON.parse(t) } catch { return null } }

/** call_aws → [{ response:{ as_json } }]; as_json is the payload (object or JSON string). */
function unwrapAws(out) {
  const arr = parseJson(out)
  if (!Array.isArray(arr)) return null
  let p = arr[0]?.response?.as_json ?? arr[0]?.response
  if (typeof p === 'string') p = parseJson(p)
  return p
}
async function aws(userId, cmd) {
  const out = await callMcp(userId, 'aws-api', 'call_aws', { cli_command: `${cmd} --output json` })
  return unwrapAws(out)
}

/** Coarser period for longer windows (basic monitoring is 5-min granularity). */
function periodFor(hours) { return hours <= 3 ? 300 : hours <= 24 ? 900 : 3600 }

/* ───────────────────────── AWS — CloudWatch (discover + fetch) ───────────────────────── */

/** The identifier value(s) a resource appears under in CloudWatch metric dimensions.
 *  Most services use the resource name directly; EC2 metrics key on the InstanceId, so if the
 *  given name isn't already an instance-id we resolve it from the Name tag (one generic lookup). */
async function awsIdentifiers(userId, region, name) {
  const ids = new Set([name])
  if (!/^i-[0-9a-f]+$/i.test(name)) {
    const d = await aws(userId, `aws ec2 describe-instances --region ${region} --filters Name=tag:Name,Values=${name} Name=instance-state-name,Values=running`)
    const inst = (d?.Reservations || []).flatMap((r) => r.Instances || [])[0]
    if (inst?.InstanceId) ids.add(inst.InstanceId)
  }
  return [...ids]
}

async function awsTelemetry(userId, { name, region } = {}, hours = 3) {
  const conns = getConnections(userId)
  region = (region && region !== '—' && region !== 'global') ? region : (conns.aws?.region || 'us-east-1')

  const ids = await awsIdentifiers(userId, region, name)
  // 1) DISCOVER: ask CloudWatch which metrics exist, keep those whose dimensions point at this resource
  const lm = await aws(userId, `aws cloudwatch list-metrics --region ${region}`)
  const published = (lm?.Metrics || []).filter((m) => (m.Dimensions || []).some((d) => ids.includes(d.Value)))
  if (!published.length) {
    return { ok: true, supported: true, found: false, cloud: 'aws', name, region, metrics: [], note: 'No CloudWatch metrics are published for this resource yet.' }
  }
  // dedupe by namespace+metric (keep the first dimension set), cap fan-out
  const seen = new Set()
  const picked = []
  for (const m of published) {
    const k = `${m.Namespace}/${m.MetricName}`
    if (seen.has(k)) continue
    seen.add(k); picked.push(m)
    if (picked.length >= 8) break
  }

  // 2) FETCH each discovered metric's series
  const end = new Date()
  const start = new Date(end.getTime() - hours * 3600 * 1000)
  const iso = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z')
  const period = periodFor(hours)
  const metrics = []
  for (const m of picked) {
    try {
      const dimStr = m.Dimensions.map((d) => `Name=${d.Name},Value=${d.Value}`).join(' ')
      const data = await aws(userId, `aws cloudwatch get-metric-statistics --region ${region} --namespace ${m.Namespace} --metric-name ${m.MetricName} --dimensions ${dimStr} --start-time ${iso(start)} --end-time ${iso(end)} --period ${period} --statistics Average Maximum Sum`)
      const dps = (data?.Datapoints || []).sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp))
      const pick = (p) => p.Average ?? p.Sum ?? p.Maximum
      const points = dps.map((p) => ({ t: new Date(p.Timestamp).getTime(), v: pick(p) }))
      metrics.push({ key: m.MetricName, label: m.MetricName, unit: dps[0]?.Unit || '', points, latest: points.length ? points[points.length - 1].v : null })
    } catch (e) {
      metrics.push({ key: m.MetricName, label: m.MetricName, unit: '', points: [], latest: null, error: String(e?.message || e) })
    }
  }
  return { ok: true, supported: true, found: metrics.some((m) => m.points.length), cloud: 'aws', name, region, rangeHours: hours, period, metrics }
}

/* ───────────────────────── GCP — Cloud Monitoring (discover + fetch) ───────────────────────── */

// The metric domain + monitored-resource type for a GCP service. This is the SERVICE prefix
// (the API domain), NOT a metric list — metrics are still discovered from the cloud.
function gcpDomain(type) {
  const t = String(type || '').toLowerCase()
  if (/compute|gce|\bvm\b|instance/.test(t)) return { prefix: 'compute.googleapis.com/instance', resourceType: 'gce_instance' }
  if (/cloud run|\brun\b|service/.test(t)) return { prefix: 'run.googleapis.com', resourceType: 'cloud_run_revision' }
  if (/cloud sql|\bsql\b|postgres|mysql|database/.test(t)) return { prefix: 'cloudsql.googleapis.com/database', resourceType: 'cloudsql_database' }
  if (/storage|bucket|gcs/.test(t)) return { prefix: 'storage.googleapis.com', resourceType: 'gcs_bucket' }
  return null
}

function gcpNum(value) {
  if (!value) return 0
  if (value.doubleValue != null) return value.doubleValue
  if (value.int64Value != null) return Number(value.int64Value)
  return 0
}

async function gcpTelemetry(userId, { type, name, region } = {}, hours = 3) {
  const conn = getConnections(userId).gcp
  if (!conn?.refreshToken) return { ok: true, found: false, supported: false, note: 'GCP telemetry needs a "Connect with Google" (OAuth) connection.', metrics: [] }
  const dom = gcpDomain(type)
  if (!dom) return { ok: true, found: false, supported: false, note: `No GCP monitoring domain known for "${type}".`, metrics: [] }
  let token
  try { token = await refreshAccessToken(conn.refreshToken) } catch { return { ok: true, found: false, supported: true, note: 'Could not mint a GCP access token.', metrics: [] } }
  const project = conn.projectId
  const base = `https://monitoring.googleapis.com/v3/projects/${project}`

  // 1) DISCOVER metric types this service publishes
  let descriptors = []
  try {
    const url = `${base}/metricDescriptors?filter=${encodeURIComponent(`metric.type = starts_with("${dom.prefix}")`)}&pageSize=200`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const j = await r.json()
    descriptors = (j.metricDescriptors || []).slice(0, 8)
  } catch { /* ignore */ }
  if (!descriptors.length) return { ok: true, found: false, supported: true, cloud: 'gcp', name, region, metrics: [], note: 'No GCP metric descriptors found for this service.' }

  // 2) FETCH each metric's series (scoped to this resource by name across its labels)
  const end = new Date()
  const start = new Date(end.getTime() - hours * 3600 * 1000)
  const period = periodFor(hours)
  const metrics = []
  for (const d of descriptors) {
    try {
      const ratio = d.unit === '1' // dimensionless ratio → show as percent
      const url = `${base}/timeSeries`
        + `?filter=${encodeURIComponent(`metric.type="${d.type}" AND resource.type="${dom.resourceType}"`)}`
        + `&interval.startTime=${encodeURIComponent(start.toISOString())}`
        + `&interval.endTime=${encodeURIComponent(end.toISOString())}`
        + `&aggregation.alignmentPeriod=${period}s&aggregation.perSeriesAligner=ALIGN_MEAN`
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const j = await r.json()
      const series = j.timeSeries || []
      const match = series.find((s) => JSON.stringify({ ...(s.resource?.labels), ...(s.metric?.labels) }).includes(name)) || series[0]
      const points = (match?.points || [])
        .map((p) => ({ t: new Date(p.interval.endTime).getTime(), v: gcpNum(p.value) * (ratio ? 100 : 1) }))
        .sort((a, b) => a.t - b.t)
      const label = d.type.split('/').slice(-2).join('/')
      metrics.push({ key: d.type, label, unit: ratio ? 'percent' : (d.unit || ''), points, latest: points.length ? points[points.length - 1].v : null })
    } catch (e) {
      metrics.push({ key: d.type, label: d.type, unit: d.unit || '', points: [], latest: null, error: String(e?.message || e) })
    }
  }
  return { ok: true, supported: true, found: metrics.some((m) => m.points.length), cloud: 'gcp', name, region, rangeHours: hours, period, metrics }
}

/* ───────────────────────── dispatch + agent digest ───────────────────────── */

/** Full telemetry (datapoint series) for one resource — dispatches by cloud. */
export async function telemetryFor(userId, resource = {}, hours = 3) {
  const cloud = resource.cloud || 'aws'
  if (cloud === 'gcp') return gcpTelemetry(userId, resource, hours)
  if (cloud === 'aws') return awsTelemetry(userId, resource, hours)
  return { ok: true, found: false, supported: false, note: `Telemetry isn't wired for "${cloud}" yet.`, metrics: [] }
}

/** Pretty-print one metric's latest value for the agent digest (units come from the cloud). */
function fmtLatest(m) {
  if (m.latest == null) return `${m.label}: n/a`
  let v = Number(m.latest)
  const u = String(m.unit || '').toLowerCase()
  if (u.includes('percent')) v = `${v.toFixed(1)}%`
  else if (u.includes('byte') || u === 'by') v = v > 1e9 ? `${(v / 1e9).toFixed(1)}GB` : v > 1e6 ? `${(v / 1e6).toFixed(1)}MB` : v > 1e3 ? `${(v / 1e3).toFixed(1)}KB` : `${Math.round(v)}B`
  else if (u === 'seconds' || u === 's') v = `${(v * 1000).toFixed(0)}ms`
  else if (u.includes('millisecond') || u === 'ms') v = `${v.toFixed(0)}ms`
  else v = Number.isInteger(v) ? v : v.toFixed(1)
  return `${m.label}=${v}`
}

/** Compact telemetry digest for the chat agent (latest values, one line). */
export async function telemetrySummary(userId, resource, hours = 1) {
  const t = await telemetryFor(userId, resource, hours)
  if (!t.supported) return { found: false, supported: false, note: t.note }
  if (!t.found) return { found: false, supported: true, note: t.note || 'No datapoints in range (resource may be brand-new or idle).' }
  return { found: true, name: t.name, region: t.region, rangeHours: hours, summary: t.metrics.map(fmtLatest).join(', ') }
}
