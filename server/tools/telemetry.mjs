/**
 * Telemetry tool — lets the chat agent read LIVE performance metrics for a running resource
 * (CloudWatch on AWS, Cloud Monitoring on GCP) so it can answer "how is X doing / is it under
 * load / any errors?" with real data instead of guessing. Backed by lib/telemetry.mjs (the
 * same deterministic fetcher the resource panel uses).
 */
import { tool, jsonSchema } from 'ai'
import { telemetrySummary } from '../services/telemetry.mjs'

export function telemetryTools(userId) {
  return {
    get_telemetry: tool({
      description: 'Read LIVE performance metrics (CPU, network traffic, request count, latency, errors, connections) for a running resource from the cloud monitoring service. Use this whenever the user asks how a service is performing, its load/traffic, or whether it is healthy — this returns real monitoring data, not an estimate.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          cloud: { type: 'string', enum: ['aws', 'gcp'], description: 'which cloud the resource is on (default aws)' },
          name: { type: 'string', description: 'resource identifier: EC2 Name tag or instance-id, RDS identifier, Lambda function name, ELB name, ElastiCache cluster id; GCP instance/service/sql name' },
          type: { type: 'string', description: 'service type, e.g. "EC2 Instance", "RDS Postgres", "Lambda", "Application Load Balancer", "ElastiCache", "Compute Engine", "Cloud Run", "Cloud SQL"' },
          region: { type: 'string', description: 'region, e.g. us-east-1 (optional)' },
          hours: { type: 'number', description: 'lookback window in hours (default 1)' },
        },
        required: ['name', 'type'],
      }),
      execute: async ({ cloud, name, type, region, hours }) =>
        telemetrySummary(userId, { cloud: cloud || 'aws', name, type, region }, hours || 1),
    }),
  }
}
