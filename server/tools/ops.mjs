/**
 * Ops tools — read-only cloud observability the ops/incident agent uses to investigate: tail logs,
 * read live resource inventory, and pull spend. These wrap the same services the dashboard uses,
 * so the agent gets structured, reliable results (vs. free-form MCP calls). All READ-only.
 */
import { tool, jsonSchema } from 'ai'
import { tailLogs } from '../services/logs.mjs'
import { costFor } from '../services/billing.mjs'
import { listResources } from '../services/cloud.mjs'

export function opsTools(userId) {
  return {
    get_logs: tool({
      description: 'Tail recent logs across the connected clouds (CloudWatch Logs / GCP Cloud Logging). Use to see errors, crashes, or why a service is failing. Optionally scope by cloud, lookback minutes, and resource names.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          cloud: { type: 'string', description: 'aws | gcp (optional — defaults to all connected)' },
          mins: { type: 'number', description: 'lookback window in minutes (default 60)' },
          names: { type: 'array', items: { type: 'string' }, description: 'optional resource names to scope to' },
        },
      }),
      execute: async ({ cloud, mins, names }) => tailLogs(userId, { cloud, mins: mins || 60, names }),
    }),
    list_resources: tool({
      description: 'List the live cloud resources currently running in the connected accounts (real inventory via the MCP). Use to see what exists, its status, region, and type — to correlate with logs/cost.',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => ({ resources: await listResources(userId) }),
    }),
    get_cost: tool({
      description: 'Get actual cloud spend for the connected accounts (AWS Cost Explorer / GCP billing). Use to investigate a cost spike — what is driving the bill.',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => costFor(userId),
    }),
  }
}
