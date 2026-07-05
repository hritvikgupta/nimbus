// Per-service editable configuration schemas. Each canvas node maps (by its service type) to
// a professional, service-specific set of fields the user can tweak — e.g. an EC2 node exposes
// instance type + root volume + OS; an RDS node exposes class + engine + storage. These specs
// persist on the design node and the agent honors them when it deploys.

const SCHEMAS = {
  ec2: {
    title: 'Compute · EC2 instance',
    fields: [
      { key: 'instanceType', label: 'Instance type', type: 'select', default: 't3.medium',
        options: ['t3.micro', 't3.small', 't3.medium', 't3.large', 't3.xlarge', 'm5.large', 'm5.xlarge', 'c5.large', 'c5.xlarge', 'r5.large'] },
      { key: 'volumeGb', label: 'Root volume', type: 'number', unit: 'GB', default: 20, min: 8, max: 16000 },
      { key: 'os', label: 'OS / AMI', type: 'select', default: 'Amazon Linux 2023',
        options: ['Amazon Linux 2023', 'Ubuntu 22.04 LTS', 'Ubuntu 20.04 LTS', 'Debian 12', 'Red Hat 9'] },
      { key: 'count', label: 'Instances', type: 'number', default: 1, min: 1, max: 20 },
    ],
  },
  rds: {
    title: 'Database · RDS',
    fields: [
      { key: 'instanceClass', label: 'DB instance class', type: 'select', default: 'db.t3.medium',
        options: ['db.t3.micro', 'db.t3.small', 'db.t3.medium', 'db.t3.large', 'db.r6g.large', 'db.m6g.large'] },
      { key: 'engineVersion', label: 'Engine version', type: 'select', default: 'PostgreSQL 16',
        options: ['PostgreSQL 16', 'PostgreSQL 15', 'PostgreSQL 14', 'MySQL 8.0'] },
      { key: 'storageGb', label: 'Allocated storage', type: 'number', unit: 'GB', default: 100, min: 20, max: 64000 },
      { key: 'multiAz', label: 'Multi-AZ (HA)', type: 'bool', default: false },
    ],
  },
  s3: {
    title: 'Storage · S3 bucket',
    fields: [
      { key: 'versioning', label: 'Versioning', type: 'bool', default: true },
      { key: 'encryption', label: 'Encryption', type: 'select', default: 'SSE-S3', options: ['SSE-S3', 'SSE-KMS'] },
      { key: 'blockPublic', label: 'Block public access', type: 'bool', default: true },
      { key: 'storageClass', label: 'Default class', type: 'select', default: 'STANDARD',
        options: ['STANDARD', 'STANDARD_IA', 'INTELLIGENT_TIERING', 'GLACIER_IR'] },
    ],
  },
  elasticache: {
    title: 'Cache · ElastiCache',
    fields: [
      { key: 'engine', label: 'Engine', type: 'select', default: 'redis', options: ['redis', 'memcached'] },
      { key: 'nodeType', label: 'Node type', type: 'select', default: 'cache.t3.micro',
        options: ['cache.t3.micro', 'cache.t3.small', 'cache.t3.medium', 'cache.r6g.large'] },
      { key: 'nodes', label: 'Nodes', type: 'number', default: 1, min: 1, max: 6 },
    ],
  },
  alb: {
    title: 'Networking · Load balancer',
    fields: [
      { key: 'scheme', label: 'Scheme', type: 'select', default: 'internet-facing', options: ['internet-facing', 'internal'] },
      { key: 'listener', label: 'Listener', type: 'select', default: 'HTTPS:443', options: ['HTTPS:443', 'HTTP:80', 'HTTP:80 + HTTPS:443'] },
      { key: 'idleTimeout', label: 'Idle timeout', type: 'number', unit: 's', default: 60, min: 1, max: 4000 },
    ],
  },
  lambda: {
    title: 'Compute · Lambda',
    fields: [
      { key: 'runtime', label: 'Runtime', type: 'select', default: 'nodejs20.x', options: ['nodejs20.x', 'python3.12', 'python3.11', 'go1.x', 'java21'] },
      { key: 'memoryMb', label: 'Memory', type: 'number', unit: 'MB', default: 256, min: 128, max: 10240 },
      { key: 'timeoutS', label: 'Timeout', type: 'number', unit: 's', default: 30, min: 1, max: 900 },
    ],
  },
  cloudrun: {
    title: 'Compute · Cloud Run',
    fields: [
      { key: 'cpu', label: 'CPU', type: 'select', default: '1', options: ['0.5', '1', '2', '4'] },
      { key: 'memory', label: 'Memory', type: 'select', default: '512Mi', options: ['256Mi', '512Mi', '1Gi', '2Gi', '4Gi'] },
      { key: 'minInstances', label: 'Min instances', type: 'number', default: 0, min: 0, max: 100 },
      { key: 'maxInstances', label: 'Max instances', type: 'number', default: 10, min: 1, max: 1000 },
    ],
  },
  cloudsql: {
    title: 'Database · Cloud SQL',
    fields: [
      { key: 'tier', label: 'Tier', type: 'select', default: 'db-custom-2-7680',
        options: ['db-f1-micro', 'db-g1-small', 'db-custom-1-3840', 'db-custom-2-7680', 'db-custom-4-15360'] },
      { key: 'engineVersion', label: 'Engine version', type: 'select', default: 'POSTGRES_16', options: ['POSTGRES_16', 'POSTGRES_15', 'MYSQL_8_0'] },
      { key: 'storageGb', label: 'Storage', type: 'number', unit: 'GB', default: 50, min: 10, max: 65536 },
      { key: 'ha', label: 'High availability', type: 'bool', default: false },
    ],
  },
  gcs: {
    title: 'Storage · Cloud Storage',
    fields: [
      { key: 'storageClass', label: 'Storage class', type: 'select', default: 'STANDARD', options: ['STANDARD', 'NEARLINE', 'COLDLINE', 'ARCHIVE'] },
      { key: 'versioning', label: 'Versioning', type: 'bool', default: false },
      { key: 'uniformAccess', label: 'Uniform access', type: 'bool', default: true },
    ],
  },
  generic: {
    title: 'Service',
    fields: [
      { key: 'size', label: 'Size / tier', type: 'text', default: '' },
      { key: 'notes', label: 'Notes', type: 'text', default: '' },
    ],
  },
}

/** Pick the schema for a service type string (e.g. "EC2 Instance", "RDS Postgres"). */
export function schemaFor(type) {
  const t = (type || '').toLowerCase()
  if (/ec2|compute engine|instance|vm\b/.test(t) && !/sql|run/.test(t)) return SCHEMAS.ec2
  if (/rds/.test(t)) return SCHEMAS.rds
  if (/cloud sql|cloudsql/.test(t)) return SCHEMAS.cloudsql
  if (/s3|^bucket| bucket/.test(t)) return SCHEMAS.s3
  if (/cloud storage|gcs/.test(t)) return SCHEMAS.gcs
  if (/elasticache|cache|redis|memcache/.test(t)) return SCHEMAS.elasticache
  if (/load balancer|alb|elb|balancer/.test(t)) return SCHEMAS.alb
  if (/lambda|function/.test(t)) return SCHEMAS.lambda
  if (/cloud run|cloudrun/.test(t)) return SCHEMAS.cloudrun
  return SCHEMAS.generic
}

/** Seed spec values from saved spec, falling back to schema defaults. */
export function seedSpec(schema, saved = {}) {
  const out = {}
  for (const f of schema.fields) out[f.key] = saved[f.key] ?? f.default
  return out
}
