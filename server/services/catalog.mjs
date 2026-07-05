/**
 * Real reference catalogs fetched DIRECTLY from the cloud MCP (no LLM in the loop) — so the
 * config dropdowns (instance types, regions, machine types, DB classes) are guaranteed real
 * and complete, not whatever subset a model decided to query. Cached aggressively since these
 * lists barely change.
 */
import { callMcp } from '../libs/mcp.mjs'

const _cache = new Map() // key -> { v, exp }
async function cached(key, ttlMs, fn) {
  const h = _cache.get(key)
  if (h && h.exp > Date.now()) return h.v
  const v = await fn()
  if (v && v.length) _cache.set(key, { v, exp: Date.now() + ttlMs })
  return v
}

// call_aws returns [{ cli_command, response: { as_json } }]; with a --query the payload is the
// raw query result (here: an array of strings). Pull it out robustly.
// call_aws wraps a --query result as [{response:{as_json:"{\"Result\":[...]}"}}] where as_json is
// itself a JSON STRING. Walk the whole structure, parsing any nested JSON string, and return the
// first array of scalars found (the real list, e.g. under "Result").
function awsQueryArray(out) {
  const visit = (x) => {
    if (typeof x === 'string') {
      const t = x.trim()
      if (t.startsWith('{') || t.startsWith('[')) { try { return visit(JSON.parse(t)) } catch { return null } }
      return null
    }
    if (Array.isArray(x)) {
      if (x.length && x.every((e) => typeof e === 'string' || typeof e === 'number')) return x.map(String)
      for (const e of x) { const r = visit(e); if (r) return r }
      return null
    }
    if (x && typeof x === 'object') { for (const v of Object.values(x)) { const r = visit(v); if (r) return r } }
    return null
  }
  return visit(out)
}

const DAY = 24 * 3600 * 1000

/** Real, current-generation EC2 instance types, sorted by family then size. */
export async function awsInstanceTypes(userId, region = 'us-east-1') {
  return cached(`aws-itypes:${userId}`, DAY, async () => {
    const out = await callMcp(userId, 'aws-api', 'call_aws', {
      cli_command: `aws ec2 describe-instance-types --filters Name=current-generation,Values=true --query "InstanceTypes[].InstanceType" --region ${region} --output json`,
    })
    const list = awsQueryArray(out) || []
    const sizeRank = ['nano', 'micro', 'small', 'medium', 'large', 'xlarge']
    return list.sort((a, b) => {
      const [fa, sa] = a.split('.'), [fb, sb] = b.split('.')
      if (fa !== fb) return fa.localeCompare(fb)
      const ra = sizeRank.indexOf(sa), rb = sizeRank.indexOf(sb)
      return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb) || a.localeCompare(b)
    })
  })
}

/** Real enabled AWS regions. */
export async function awsRegions(userId) {
  return cached(`aws-regions:${userId}`, DAY, async () => {
    const out = await callMcp(userId, 'aws-api', 'call_aws', {
      cli_command: 'aws ec2 describe-regions --query "Regions[].RegionName" --output json',
    })
    return (awsQueryArray(out) || []).sort()
  })
}

/** Real RDS engine/instance classes for an engine. */
export async function awsDbClasses(userId, engine = 'postgres', region = 'us-east-1') {
  return cached(`aws-dbclass:${userId}:${engine}`, DAY, async () => {
    const out = await callMcp(userId, 'aws-api', 'call_aws', {
      cli_command: `aws rds describe-orderable-db-instance-options --engine ${engine} --query "OrderableDBInstanceOptions[].DBInstanceClass" --region ${region} --output json`,
    })
    return [...new Set(awsQueryArray(out) || [])].sort()
  })
}

/** Real GCP machine types in a region's first zone. */
export async function gcpMachineTypes(userId, region = 'us-central1') {
  return cached(`gcp-mtypes:${userId}:${region}`, DAY, async () => {
    const out = await callMcp(userId, 'gcloud', 'run_gcloud_command', {
      args: ['compute', 'machine-types', 'list', `--filter=zone:${region}-a`, '--format=value(name)'],
    })
    const list = String(out || '').trim().split('\n').map((s) => s.trim()).filter(Boolean)
    return [...new Set(list)]
  })
}

// Region code → the AWS Price List "location" display name (factual AWS data, not a heuristic).
const PRICE_LOCATION = {
  'us-east-1': 'US East (N. Virginia)', 'us-east-2': 'US East (Ohio)', 'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)', 'ca-central-1': 'Canada (Central)', 'eu-west-1': 'EU (Ireland)',
  'eu-west-2': 'EU (London)', 'eu-west-3': 'EU (Paris)', 'eu-central-1': 'EU (Frankfurt)',
  'eu-north-1': 'EU (Stockholm)', 'ap-south-1': 'Asia Pacific (Mumbai)', 'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)', 'ap-northeast-1': 'Asia Pacific (Tokyo)', 'ap-northeast-2': 'Asia Pacific (Seoul)',
  'sa-east-1': 'South America (Sao Paulo)',
}

/** Pull the first OnDemand USD/hour from an `aws pricing get-products` payload (PriceList strings). */
function firstOnDemandHourly(out) {
  const grab = (x) => {
    if (typeof x === 'string') { const t = x.trim(); if (t.startsWith('{') || t.startsWith('[')) { try { return grab(JSON.parse(t)) } catch { return null } } return null }
    if (Array.isArray(x)) { for (const e of x) { const r = grab(e); if (r != null) return r } return null }
    if (x && typeof x === 'object') {
      // a product entry: terms.OnDemand.*.priceDimensions.*.pricePerUnit.USD
      const od = x.terms?.OnDemand
      if (od) {
        for (const term of Object.values(od)) for (const dim of Object.values(term.priceDimensions || {})) {
          const usd = parseFloat(dim?.pricePerUnit?.USD)
          if (usd > 0) return usd
        }
      }
      for (const v of Object.values(x)) { const r = grab(v); if (r != null) return r }
    }
    return null
  }
  return grab(out)
}

/** REAL EC2 on-demand monthly USD for an instance type — direct pricing API, deterministic. */
export async function awsEc2MonthlyUSD(userId, instanceType, region = 'us-east-1') {
  const location = PRICE_LOCATION[region] || PRICE_LOCATION['us-east-1']
  const filters = [
    ['instanceType', instanceType], ['location', location], ['operatingSystem', 'Linux'],
    ['tenancy', 'Shared'], ['preInstalledSw', 'NA'], ['capacitystatus', 'Used'],
  ].map(([f, v]) => `Type=TERM_MATCH,Field=${f},Value=${v}`).join(' ')
  const out = await callMcp(userId, 'aws-api', 'call_aws', {
    cli_command: `aws pricing get-products --service-code AmazonEC2 --region us-east-1 --filters ${filters} --max-items 1 --output json`,
  })
  const hourly = firstOnDemandHourly(out)
  return hourly == null ? null : Math.round(hourly * 730 * 100) / 100
}

/** Real GCP regions. */
export async function gcpRegions(userId) {
  return cached(`gcp-regions:${userId}`, DAY, async () => {
    const out = await callMcp(userId, 'gcloud', 'run_gcloud_command', {
      args: ['compute', 'regions', 'list', '--format=value(name)'],
    })
    return String(out || '').trim().split('\n').map((s) => s.trim()).filter(Boolean).sort()
  })
}

/**
 * Replace a field's options with a REAL catalog list when the field is one we can ground
 * directly (instance/machine type, region, DB class). Mutates fields in place; best-effort.
 */
export async function enrichOptions(userId, cloud, region, fields) {
  for (const f of fields || []) {
    const l = `${f.key || ''} ${f.label || ''}`.toLowerCase()
    try {
      if (cloud === 'aws') {
        if (/region/.test(l)) { const r = await awsRegions(userId); if (r?.length) { f.options = r; f.type = 'select' } }
        else if (/db.*class|database.*class|instance.*class/.test(l)) { const r = await awsDbClasses(userId, 'postgres', region); if (r?.length) { f.options = r; f.type = 'select' } }
        else if (/instance.*type|machine.*type|\btype\b/.test(l) && !/storage|volume|os|tenanc/.test(l)) { const r = await awsInstanceTypes(userId, region); if (r?.length) { f.options = r; f.type = 'select' } }
      } else if (cloud === 'gcp') {
        if (/region|location/.test(l)) { const r = await gcpRegions(userId); if (r?.length) { f.options = r; f.type = 'select' } }
        else if (/machine.*type|instance.*type/.test(l)) { const r = await gcpMachineTypes(userId, region); if (r?.length) { f.options = r; f.type = 'select' } }
      }
    } catch { /* keep model options on failure */ }
  }
  return fields
}
