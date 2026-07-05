/**
 * Demo / fallback tools — used when a user has NOT connected a real cloud yet, so the
 * chat still shows a working tool timeline. Once a user connects GCP, the real MCP tools
 * (server/lib/mcp.mjs) take over. Same shape as company-brain's local tool modules
 * (ai `tool()` + jsonSchema).
 */
import { tool, jsonSchema } from 'ai'

const RESOURCES = [
  { name: 'prod-api-alb', type: 'Load Balancer', cloud: 'aws', region: 'eu-west-1', status: 'healthy', cost_usd_mo: 24 },
  { name: 'prod-api-asg', type: 'Auto Scaling', cloud: 'aws', region: 'eu-west-1', status: 'healthy', cost_usd_mo: 310 },
  { name: 'prod-postgres', type: 'RDS Postgres', cloud: 'aws', region: 'eu-west-1', status: 'healthy', cost_usd_mo: 280 },
  { name: 'staging-run-web', type: 'Cloud Run', cloud: 'gcp', region: 'us-central1', status: 'healthy', cost_usd_mo: 42 },
  { name: 'staging-sql', type: 'Cloud SQL', cloud: 'gcp', region: 'us-central1', status: 'degraded', cost_usd_mo: 95 },
  { name: 'analytics-vmss', type: 'VM Scale Set', cloud: 'azure', region: 'westeurope', status: 'healthy', cost_usd_mo: 420 },
]

export const demoTools = {
  list_cloud_resources: tool({
    description: "List the user's cloud resources across connected clouds. Optionally filter by cloud. (demo data — connect a cloud for live results)",
    inputSchema: jsonSchema({
      type: 'object',
      properties: { cloud: { type: 'string', enum: ['aws', 'gcp', 'azure'], description: 'optional cloud filter' } },
    }),
    execute: async ({ cloud }) => RESOURCES.filter((r) => !cloud || r.cloud === cloud),
  }),
  estimate_cost: tool({
    description: 'Estimate the monthly USD cost of a proposed stack or change.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: { stack: { type: 'string', description: 'what to estimate, e.g. "3-tier app on AWS"' } },
      required: ['stack'],
    }),
    execute: async ({ stack }) => ({
      stack, estimate_usd_per_month: 340,
      assumptions: ['ECS Fargate 2→6 tasks', 'RDS t4g.medium Multi-AZ', 'ALB + CloudFront'],
      note: 'Graviton (t4g) saves ~20% vs equivalent x86.',
    }),
  }),
}
