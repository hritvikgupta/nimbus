/**
 * Per-user cloud inventory — the REAL data behind the dashboard. For each cloud the user
 * has actually connected, we query their account through the cloned MCP servers and
 * normalize the result into the resource shape the UI renders. Nothing connected ⇒ empty
 * (no mock data). GCP auth missing/expired ⇒ that cloud yields [] with a note, the rest
 * still works. This is what makes Overview/Resources/Cost reflect the signed-in user.
 *
 * NOTE: live GCP data requires valid credentials for this user. Locally that means
 * `gcloud auth application-default login` (the MCP inherits HOME → ADC). In production it's
 * the per-user impersonated token minted in lib/connections.mjs.
 */
import { callMcp } from '../libs/mcp.mjs'
import { getConnections } from '../repositories/connections.mjs'
import { getProjects, getAssignments, assignResource } from '../repositories/projects.mjs'

const norm = (r) => ({ status: 'healthy', region: '—', cost: '—', ...r })

function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

/** Run a gcloud list command via the MCP and return parsed JSON rows (or []). */
async function gcloudJson(userId, args) {
  try {
    const out = await callMcp(userId, 'gcloud', 'run_gcloud_command', { args: [...args, '--format=json'] })
    const data = parseJson(out)
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

/** Real GCP inventory for one user (best-effort across resource types). */
async function gcpResources(userId, conn) {
  const project = conn.projectId
  // Use --project=VALUE (equals): gcloud's lint-gcloud-commands rejects the space form.
  const projArgs = project ? [`--project=${project}`] : []
  const sets = await Promise.all([
    gcloudJson(userId, ['run', 'services', 'list', ...projArgs]).then((rows) =>
      rows.map((s) => norm({
        name: s.metadata?.name || s.name, type: 'Cloud Run', cloud: 'gcp',
        region: s.metadata?.labels?.['cloud.googleapis.com/location'] || s.region || '—',
        status: 'healthy',
      }))),
    gcloudJson(userId, ['compute', 'instances', 'list', ...projArgs]).then((rows) =>
      rows.map((i) => norm({
        name: i.name, type: 'Compute Engine', cloud: 'gcp',
        region: (i.zone || '').split('/').pop() || '—',
        status: i.status === 'RUNNING' ? 'healthy' : 'degraded',
      }))),
    gcloudJson(userId, ['sql', 'instances', 'list', ...projArgs]).then((rows) =>
      rows.map((d) => norm({
        name: d.name, type: 'Cloud SQL', cloud: 'gcp', region: d.region || '—',
        status: d.state === 'RUNNABLE' ? 'healthy' : 'degraded',
      }))),
    gcloudJson(userId, ['storage', 'buckets', 'list', ...projArgs]).then((rows) =>
      rows.map((b) => norm({
        name: (b.name || '').replace('gs://', ''), type: 'Cloud Storage', cloud: 'gcp',
        region: b.location || '—', status: 'healthy',
      }))),
  ])
  return sets.flat()
}

/** Collect EVERY array stored under `key` anywhere in a parsed structure, flattened.
 *  AWS nests repeated collections (e.g. ec2 describe-instances → Reservations[].Instances[]),
 *  so we must gather all matches across siblings, not just the first one. */
function deepCollectArrays(obj, key, out = []) {
  if (!obj || typeof obj !== 'object') return out
  if (Array.isArray(obj[key])) out.push(...obj[key])
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') deepCollectArrays(v, key, out)
  }
  return out
}

/** Deep-find the first array stored under `key` anywhere in a parsed structure. */
function deepFindArray(obj, key) {
  if (!obj || typeof obj !== 'object') return null
  if (Array.isArray(obj[key])) return obj[key]
  for (const v of Object.values(obj)) {
    const found = deepFindArray(v, key)
    if (found) return found
  }
  return null
}

/** Run an AWS CLI command via the cloned awslabs aws-api MCP, return rows under `key`.
 *  call_aws returns [{ cli_command, response: { error, as_json } }] — the payload on
 *  success is in response.as_json (object or JSON string). */
async function awsJson(userId, cmd, key) {
  try {
    const out = await callMcp(userId, 'aws-api', 'call_aws', { cli_command: `${cmd} --output json` })
    const arr = parseJson(out)
    // Gather ALL arrays under `key` (AWS nests repeated collections, e.g.
    // Reservations[].Instances[]) — taking only the first would miss everything but the
    // first reservation/page.
    if (!Array.isArray(arr)) return deepCollectArrays(arr, key)
    for (const item of arr) {
      let payload = item?.response?.as_json ?? item?.response
      if (typeof payload === 'string') payload = parseJson(payload)
      const rows = deepCollectArrays(payload, key)
      if (rows.length) return rows
    }
    return []
  } catch { return [] }
}

/** Real AWS inventory for one user (best-effort across resource types). */
async function awsResources(userId, conn) {
  const region = conn.region || 'us-east-1'
  const sets = await Promise.all([
    awsJson(userId, `aws ec2 describe-instances --region ${region}`, 'Instances').then((rows) =>
      // Drop terminated / shutting-down instances — they're gone (AWS still lists them ~1h).
      rows.filter((i) => !['terminated', 'shutting-down'].includes(i.State?.Name))
        .map((i) => norm({
          name: (i.Tags || []).find((t) => t.Key === 'Name')?.Value || i.InstanceId,
          type: 'EC2 Instance', cloud: 'aws', region,
          status: i.State?.Name === 'running' ? 'healthy' : 'degraded',
        }))),
    awsJson(userId, `aws rds describe-db-instances --region ${region}`, 'DBInstances').then((rows) =>
      rows.map((d) => norm({
        name: d.DBInstanceIdentifier, type: `RDS ${d.Engine || ''}`.trim(), cloud: 'aws', region,
        status: d.DBInstanceStatus === 'available' ? 'healthy' : 'degraded',
      }))),
    awsJson(userId, `aws s3api list-buckets`, 'Buckets').then((rows) =>
      rows.map((b) => norm({ name: b.Name, type: 'S3 Bucket', cloud: 'aws', region: 'global', status: 'healthy' }))),
    awsJson(userId, `aws lambda list-functions --region ${region}`, 'Functions').then((rows) =>
      rows.map((f) => norm({ name: f.FunctionName, type: 'Lambda', cloud: 'aws', region, status: 'healthy' }))),
  ])
  return sets.flat()
}

/** All real resources for a user across their connected clouds. */
export async function listResources(userId) {
  const conns = getConnections(userId)
  const jobs = []
  if (conns.gcp) jobs.push(gcpResources(userId, conns.gcp))
  if (conns.aws) jobs.push(awsResources(userId, conns.aws))
  // Azure: no connector cloned yet → connected but no inventory (honest: no fabricated rows).
  const sets = await Promise.all(jobs)
  return sets.flat()
}

const resourceKey = (r) => `${r.cloud}:${r.name}`

/** Resolve the active project id: fall back to the user's first project if missing/unknown. */
function resolveProjectId(userId, projectId) {
  const projects = getProjects(userId)
  const match = projects.find((p) => p.id === projectId)
  return (match || projects[0]).id
}

/**
 * The live resources belonging to ONE project (mixed clouds). We compute ALL live resources
 * across the user's connected clouds, then:
 *   1. CLAIM any resource that has no assignment yet for the active project — this is how a
 *      resource the agent just created (while this project is active) gets tagged to it.
 *   2. Return only the resources assigned to this project.
 */
export async function projectResources(userId, projectId) {
  const pid = resolveProjectId(userId, projectId)
  const all = await listResources(userId)
  const assignments = getAssignments(userId)
  const out = []
  for (const r of all) {
    const key = resourceKey(r)
    let assigned = assignments[key]
    if (!assigned) { assignResource(userId, key, pid); assigned = pid } // claim newly-appeared resource
    if (assigned === pid) out.push(r)
  }
  return out
}

/** Dashboard summary derived from REAL state — connections + project-scoped live inventory. */
export async function overview(userId, projectId) {
  const conns = getConnections(userId)
  const clouds = Object.keys(conns)
  const resources = await projectResources(userId, projectId) // already scoped to the project
  const byCloud = {}
  for (const r of resources) {
    if (!byCloud[r.cloud]) byCloud[r.cloud] = { resources: 0, status: 'connected' }
    byCloud[r.cloud].resources++
  }
  return {
    connections: clouds, // all connected clouds (Connections tab + "N clouds connected" pill)
    clouds: byCloud,     // aggregates from the FILTERED (project) set
    gcpProjectId: conns.gcp?.projectId || null,
    kpis: {
      resources: resources.length,
      clouds: clouds.length,
      degraded: resources.filter((r) => r.status !== 'healthy').length,
    },
    resources,
  }
}
