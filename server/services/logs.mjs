/**
 * Live logs — tails recent log events from the user's connected clouds through the same MCP.
 *   AWS → CloudWatch Logs  (aws logs describe-log-groups + filter-log-events)
 *   GCP → Cloud Logging    (gcloud logging read)
 * Returns a merged, newest-first event list. Honest empty state: if a cloud ships no logs
 * (e.g. a bare EC2 with no CloudWatch agent) we say so instead of inventing lines.
 */
import { callMcp } from '../libs/mcp.mjs'
import { getConnections } from '../repositories/connections.mjs'

function parseJson(t) { try { return JSON.parse(t) } catch { return null } }
function unwrapAws(out) {
  const a = parseJson(out)
  if (!Array.isArray(a)) return null
  let p = a[0]?.response?.as_json ?? a[0]?.response
  if (typeof p === 'string') p = parseJson(p)
  return p
}
async function aws(userId, cmd) {
  const out = await callMcp(userId, 'aws-api', 'call_aws', { cli_command: `${cmd} --output json` })
  return unwrapAws(out)
}

const lastSeg = (s) => String(s || '').split('/').filter(Boolean).pop() || ''

async function awsLogs(userId, region, mins, names) {
  const lg = await aws(userId, `aws logs describe-log-groups --region ${region}`)
  let groups = (lg?.logGroups || []).map((g) => g.logGroupName)
  if (!groups.length) {
    return { events: [], note: 'No CloudWatch log groups yet — a bare EC2 needs the CloudWatch agent to ship app logs (Lambda / ECS / Cloud Run log automatically).' }
  }
  if (names) { // scope to this project's resources (group name references a resource name)
    groups = groups.filter((g) => names.some((n) => g.includes(n)))
    if (!groups.length) return { events: [], note: 'No log groups match this project’s resources (they may not be shipping logs).' }
  }
  const start = Date.now() - mins * 60 * 1000
  const picked = groups.slice(0, 6) // cap fan-out
  const sets = await Promise.all(picked.map(async (g) => {
    const d = await aws(userId, `aws logs filter-log-events --region ${region} --log-group-name ${g} --start-time ${start} --limit 50`)
    return (d?.events || []).map((e) => ({ t: e.timestamp, msg: e.message, src: g.replace(/^\/aws\//, ''), res: lastSeg(g), cloud: 'aws' }))
  }))
  const events = sets.flat()
  return { events, note: events.length ? null : 'Log groups exist but no events in this window.' }
}

async function gcpLogs(userId, project, mins, names) {
  try {
    // The gcloud MCP splits every argument on whitespace, so a multi-word log filter
    // (e.g. `severity>=DEFAULT AND NOT logName:"…"`) is shattered into separate argv tokens
    // and gcloud throws UnrecognizedArgumentsError. So pass only single-token filter args,
    // and drop the platform's own audit/admin logs (cloudaudit — the access trail, incl. the
    // BigQuery queries Nimbus runs for the Cost tab; not workload/app logs) in JS below. Pull a
    // generous page so real app logs aren't crowded out of the window by audit entries.
    const args = ['logging', 'read', 'severity>=DEFAULT', '--limit=200', `--freshness=${mins}m`, '--format=json']
    if (project) args.push(`--project=${project}`)
    const out = await callMcp(userId, 'gcloud', 'run_gcloud_command', { args })
    const arr = parseJson(out)
    if (!Array.isArray(arr)) return { events: [], note: 'No recent GCP application logs.' }
    let events = arr
      .filter((e) => !String(e.logName || '').includes('cloudaudit.googleapis.com'))
      .map((e) => {
      const lbl = e.resource?.labels || {}
      const res = lbl.instance_name || lbl.service_name || lbl.revision_name || lbl.database_id || lbl.function_name
        || e.labels?.['compute.googleapis.com/resource_name'] || ''
      return {
        t: new Date(e.timestamp).getTime(),
        msg: e.textPayload || (e.jsonPayload && JSON.stringify(e.jsonPayload)) || e.protoPayload?.methodName || '(structured log)',
        src: e.resource?.type || (e.logName || '').split('/').pop() || 'gcp',
        res, sev: e.severity, cloud: 'gcp',
      }
    })
    if (names) events = events.filter((e) => names.some((n) => (e.res || '').includes(n) || (e.src || '').includes(n)))
    return { events, note: events.length ? null : 'No GCP application logs for this project’s resources in this window (system/audit logs hidden).' }
  } catch (e) {
    return { events: [], note: 'Could not read GCP logs: ' + String(e?.message || e) }
  }
}

/** Merged, newest-first tail across the user's connected clouds.
 *  `names` (array) scopes the tail to the active project's resources; omit for account-wide. */
export async function tailLogs(userId, { cloud, mins = 60, names } = {}) {
  const conns = getConnections(userId)
  // Scoping requested but the project has no resources → nothing to tail (consistent with the
  // project-scoped telemetry/KPIs, which also show empty).
  if (Array.isArray(names) && names.length === 0) {
    return { events: [], notes: ['No resources in this project yet — deploy something to see its logs here.'], clouds: Object.keys(conns), scoped: true }
  }
  const jobs = []
  if ((!cloud || cloud === 'aws') && conns.aws) jobs.push(awsLogs(userId, conns.aws.region || 'us-east-1', mins, names).then((r) => ({ r, c: 'aws' })))
  if ((!cloud || cloud === 'gcp') && conns.gcp) jobs.push(gcpLogs(userId, conns.gcp.projectId, mins, names).then((r) => ({ r, c: 'gcp' })))
  const res = await Promise.all(jobs)
  const events = []
  const notes = []
  for (const { r, c } of res) {
    events.push(...(r.events || []))
    if (r.note) notes.push(`${c.toUpperCase()}: ${r.note}`)
  }
  events.sort((a, b) => b.t - a.t)
  return { events: events.slice(0, 300), notes, clouds: Object.keys(conns), scoped: Array.isArray(names) }
}
