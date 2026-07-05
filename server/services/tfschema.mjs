/**
 * Deterministic field source: real config fields for every AWS/GCP resource, extracted from the
 * Terraform provider schemas (server/.data/tf-aws.json, tf-gcp.json — 1674 AWS + 1282 GCP
 * resources). No LLM invents anything; the fields/types come straight from the provider schema.
 *
 * Dropdown VALUES (instance types, regions, …) are overlaid separately from the live MCP
 * (lib/catalog.mjs); pricing comes from the pricing APIs. This module only answers
 * "what editable fields does resource X have?" deterministically.
 */
import { loadJson } from '../repositories/store.mjs'

const DATA = { aws: loadJson('tf-aws.json', {}), gcp: loadJson('tf-gcp.json', {}) }

// The agent emits friendly node types; map the common ones to their Terraform resource name.
// (Aliases only — the field SCHEMAS for all 1674/1282 resources come from the TF data, not here.)
const ALIAS = {
  aws: {
    'ec2 instance': 'aws_instance', ec2: 'aws_instance', instance: 'aws_instance', 'compute engine': 'aws_instance',
    's3 bucket': 'aws_s3_bucket', s3: 'aws_s3_bucket', bucket: 'aws_s3_bucket', storage: 'aws_s3_bucket',
    'rds postgres': 'aws_db_instance', 'rds mysql': 'aws_db_instance', rds: 'aws_db_instance', database: 'aws_db_instance', db: 'aws_db_instance',
    elasticache: 'aws_elasticache_cluster', redis: 'aws_elasticache_cluster', cache: 'aws_elasticache_cluster', memcached: 'aws_elasticache_cluster',
    'application load balancer': 'aws_lb', 'load balancer': 'aws_lb', alb: 'aws_lb', elb: 'aws_lb', lb: 'aws_lb',
    lambda: 'aws_lambda_function', 'lambda function': 'aws_lambda_function', function: 'aws_lambda_function',
    'dynamodb table': 'aws_dynamodb_table', dynamodb: 'aws_dynamodb_table',
    'sqs queue': 'aws_sqs_queue', sqs: 'aws_sqs_queue', queue: 'aws_sqs_queue',
    'sns topic': 'aws_sns_topic', sns: 'aws_sns_topic',
    'eks cluster': 'aws_eks_cluster', eks: 'aws_eks_cluster',
    'ecs fargate service': 'aws_ecs_service', ecs: 'aws_ecs_service', fargate: 'aws_ecs_service',
    'ebs volume': 'aws_ebs_volume', volume: 'aws_ebs_volume',
    vpc: 'aws_vpc', 'api gateway': 'aws_apigatewayv2_api',
    'cloudfront distribution': 'aws_cloudfront_distribution', cloudfront: 'aws_cloudfront_distribution',
  },
  gcp: {
    'compute engine': 'google_compute_instance', vm: 'google_compute_instance', instance: 'google_compute_instance',
    'cloud run': 'google_cloud_run_v2_service', 'cloud sql': 'google_sql_database_instance', sql: 'google_sql_database_instance',
    'cloud storage': 'google_storage_bucket', bucket: 'google_storage_bucket', storage: 'google_storage_bucket',
    'gke cluster': 'google_container_cluster', gke: 'google_container_cluster',
    'pub/sub topic': 'google_pubsub_topic', pubsub: 'google_pubsub_topic',
    'cloud functions': 'google_cloudfunctions2_function', 'bigquery dataset': 'google_bigquery_dataset',
    memorystore: 'google_redis_instance',
  },
}

/** Resolve a node's (cloud,type) to a real Terraform resource name. */
export function resolveResource(cloud, type) {
  const data = DATA[cloud] || {}
  const t = String(type || '').toLowerCase().trim()
  const alias = (ALIAS[cloud] || {})[t]
  if (alias && data[alias]) return alias
  if (data[t]) return t                       // already a tf resource name
  const toks = t.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)
  let best = null                              // fuzzy: most type-tokens contained in the resource name
  for (const r of Object.keys(data)) {
    const score = toks.filter((tok) => r.includes(tok)).length
    if (score && (!best || score > best.score)) best = { r, score }
  }
  return best ? best.r : null
}

// Low-value fields to hide from the panel (device names, ARNs/IDs, key references).
const NOISE = /(\.device_name$|_arn$|_id$|_key$|target_bucket|kms_key|self_link)/i
const humanize = (k) => k.split('.').pop().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const tfType = (t) => (t === 'bool' ? 'bool' : t === 'number' ? 'number' : 'text')

/** Real editable fields for a node's resource: { resource, primary[], secondary[] } or null.
 *  fields/advanced already curated to useful sizing/config knobs in the extraction. */
export function tfFields(cloud, type) {
  const data = DATA[cloud] || {}
  const resource = resolveResource(cloud, type)
  if (!resource || !data[resource]) return null
  const toField = (f) => ({ key: f.key, label: humanize(f.key), type: tfType(f.type), required: !!f.required, options: [], default: f.type === 'bool' ? false : '' })
  const clean = (arr) => (arr || []).filter((f) => !NOISE.test(f.key) && f.type !== 'block').map(toField)
  return { resource, primary: clean(data[resource].fields), secondary: clean(data[resource].advanced) }
}

/** Leaf name of a (possibly dotted) field key — used to sync agent spec keys with TF field keys. */
export const fieldLeaf = (key) => String(key).split('.').pop()

export const tfResourceCount = () => ({ aws: Object.keys(DATA.aws).length, gcp: Object.keys(DATA.gcp).length })
