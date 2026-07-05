// ---- Demo chrome only. Live cloud data (resources/cost/overview/connections) comes
// from the backend per-user API, NOT from here. These are non-cloud UI extras. ----

// Two agent MODES selectable in the chat composer:
//  · design → the agent draws the architecture as nodes on the project canvas (no real cloud)
//  · agent  → the agent operates the real clouds and deploys what was designed
export const agents = [
  { id: 'design', name: 'Design', role: 'Lay the architecture out on the canvas', mode: 'design', color: '#5b8def' },
  { id: 'agent',  name: 'Agent',  role: 'Deploy the design to your cloud',        mode: 'agent',  color: '#8b5cf6' },
]

export const activity = [
  { t: '2m ago',  agent: 'Architect', color: '#c8c8c8', text: 'Provisioned ALB + 2× t3.medium behind autoscaling group in eu-west-1', tag: 'AWS' },
  { t: '14m ago', agent: 'CostGuard', color: '#a6a6a6', text: 'Rightsized 6 over-provisioned instances → projected saving $1,240/mo', tag: 'AWS' },
  { t: '38m ago', agent: 'Architect', color: '#c8c8c8', text: 'Deployed Cloud Run service + Cloud SQL (Postgres) for staging', tag: 'GCP' },
  { t: '1h ago',  agent: 'Sentinel',  color: '#8a8a8a', text: 'Flagged public S3 bucket "user-uploads" → applied block-public-access', tag: 'AWS' },
  { t: '3h ago',  agent: 'Migrator',  color: '#707070', text: 'Generated Terraform to mirror Azure VM scale set onto GCP MIG', tag: 'Azure→GCP' },
]
