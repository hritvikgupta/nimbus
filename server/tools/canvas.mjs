/**
 * Canvas tools — the agent's bridge to the project's visual architecture canvas (CloudMap).
 *
 *  · DESIGN mode  → designTools(): the agent draws the architecture as planned, connectable
 *    nodes on the canvas. It does NOT touch any real cloud here.
 *  · AGENT mode   → deployTools(): the agent reads the design back, then provisions it for
 *    real with the cloud MCP tools, flipping each node planned → deployed as it goes.
 *
 * Same shape as the other local tool modules (ai `tool()` + jsonSchema). Every op is scoped
 * to one user + their active project via the graph store in lib/projects.mjs.
 */
import { tool, jsonSchema } from 'ai'
import {
  addGraphNode, connectGraphNodes, removeGraphNode, markNodeDeployed, updateGraphNode,
  getGraph, resolveProjectId,
} from '../repositories/projects.mjs'
import { ensureSchema } from '../services/spec.mjs'
import { projectResources } from '../services/cloud.mjs'

/** A compact snapshot of the canvas the model can reason about — the designed nodes PLUS the
 *  live cloud resources the canvas overlays from real inventory (so the agent sees exactly what
 *  the user sees, not just what was hand-drawn). */
async function canvas(userId, projectId) {
  const pid = resolveProjectId(userId, projectId)
  const g = getGraph(userId, pid)
  const nodes = g.nodes.map((n) => ({ id: n.id, cloud: n.cloud, type: n.type, name: n.name, region: n.region, config: n.config, spec: n.spec || {}, status: n.status, realName: n.realName }))
  // Surface live resources discovered from the connected cloud(s) that aren't already a drawn
  // node — these render on the canvas as LIVE boxes but live in inventory, not the design graph.
  let live = []
  try { live = await projectResources(userId, pid) } catch { live = [] }
  const known = new Set(nodes.flatMap((n) => [n.name, n.realName].filter(Boolean)))
  const liveOnly = live.filter((r) => !known.has(r.name)).map((r) => ({
    id: `live:${r.cloud}:${r.name}`, cloud: r.cloud, type: r.type, name: r.name,
    region: r.region, status: 'live', live: true,
  }))
  return {
    nodes: [...nodes, ...liveOnly],
    edges: g.edges.map((e) => ({ from: e.source, to: e.target })),
  }
}

const empty = { type: 'object', properties: {} }

/* ───────────────────────── DESIGN mode ───────────────────────── */
export function designTools(userId, projectId) {
  return {
    get_canvas: tool({
      description: 'Read the current architecture on the project canvas (its nodes + how they connect). Call this FIRST so you build on what exists instead of duplicating it.',
      inputSchema: jsonSchema(empty),
      execute: async () => canvas(userId, projectId),
    }),

    create_node: tool({
      description: 'Add ONE planned service node to the canvas (a box the user sees and can drag/connect). Use a short human name (web, api, db, lb, cache, bucket) and a real service type for the cloud. Optionally connect it from an existing node in the same call via connectsTo.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          cloud: { type: 'string', enum: ['aws', 'gcp', 'azure'], description: 'which cloud this service lives on' },
          type: { type: 'string', description: 'real service type, e.g. "Application Load Balancer", "EC2 Instance", "RDS Postgres", "S3 Bucket", "Cloud Run", "Cloud SQL", "Cloud Storage"' },
          name: { type: 'string', description: 'short identifier for the node, e.g. "web", "api", "db"' },
          region: { type: 'string', description: 'target region, e.g. "us-east-1" / "us-central1"' },
          config: { type: 'string', description: 'optional one-line sizing note, e.g. "t3.medium · 2 vCPU / 4 GB"' },
          spec: { type: 'object', additionalProperties: true, description: 'the structured config you chose, keyed by the resource\'s REAL field names (the same fields shown in the resource panel). e.g. EC2 → {"instance_type":"t3.medium","volume_size":30}; RDS → {"instance_class":"db.t3.medium","allocated_storage":100,"engine":"postgres","engine_version":"15"}; ElastiCache → {"node_type":"cache.t3.micro","num_cache_nodes":1,"engine":"redis"}. This keeps the canvas node and its panel in sync.' },
          connectsTo: { type: 'string', description: 'optional: name/id of an EXISTING node to draw an edge from (it → this new node)' },
        },
        required: ['cloud', 'type', 'name'],
      }),
      execute: async (a) => {
        const node = addGraphNode(userId, projectId, a)
        if (a.connectsTo) connectGraphNodes(userId, projectId, a.connectsTo, node.id)
        // Warm the config catalog for this service type in the background (built from the MCP's
        // real create-command parameters) so the right-panel form is ready when the user opens it.
        ensureSchema(userId, a.cloud, a.type).catch(() => {})
        return { created: node, canvas: await canvas(userId, projectId) }
      },
    }),

    connect_nodes: tool({
      description: 'Draw a directed edge between two existing nodes to show traffic/data flow (e.g. lb → api, api → db). Reference nodes by their name or id.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      }),
      execute: async ({ from, to }) => ({ ...connectGraphNodes(userId, projectId, from, to), canvas: await canvas(userId, projectId) }),
    }),

    remove_node: tool({
      description: 'Remove a planned node (and its edges) from the canvas. Reference it by name or id.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { node: { type: 'string' } },
        required: ['node'],
      }),
      execute: async ({ node }) => ({ ...removeGraphNode(userId, projectId, node), canvas: await canvas(userId, projectId) }),
    }),
  }
}

/* ───────────────────────── AGENT (deploy) mode ───────────────────────── */
export function deployTools(userId, projectId) {
  return {
    get_design: tool({
      description: 'Read the architecture the user designed on the canvas — the planned nodes and how they connect. Deploy these in dependency order (data stores before the apps that use them). Nodes already "deployed" are live; skip them.',
      inputSchema: jsonSchema(empty),
      execute: async () => canvas(userId, projectId),
    }),

    mark_deployed: tool({
      description: 'Call this AFTER a planned node has actually been provisioned for real, to flip it from planned → live on the canvas. Pass the real resource name (e.g. the instance id / bucket name) so the canvas matches the cloud.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          node: { type: 'string', description: 'name/id of the planned node that was deployed' },
          realName: { type: 'string', description: 'the real resource identifier it became (e.g. i-0abc…, my-bucket)' },
        },
        required: ['node'],
      }),
      execute: async ({ node, realName }) => markNodeDeployed(userId, projectId, node, realName),
    }),

    update_node: tool({
      description: 'Change an existing canvas node — re-point it to a different provider/service, edit its config, or set its status. Use this to RE-POINT a node to a linked managed database: e.g. replacing a Cloud SQL/RDS node with a Neon or Supabase project → set cloud:"neon"|"supabase", a type like "Neon Postgres", the region, a spec with the linked project details, and status:"deployed". Pass the FULL new spec (it replaces the old one).',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          node: { type: 'string', description: 'name/id of the node to update' },
          cloud: { type: 'string', description: 'provider, e.g. "neon", "supabase", "aws", "gcp"' },
          type: { type: 'string', description: 'service type, e.g. "Neon Postgres", "Supabase Postgres"' },
          region: { type: 'string' },
          spec: { type: 'object', additionalProperties: true, description: 'config shown on the node, e.g. {"project":"relay","branch":"main","database":"neondb"} — REPLACES the old spec. Never include passwords/connection secrets.' },
          status: { type: 'string', enum: ['planned', 'deployed'], description: 'set "deployed" once it is live/linked' },
        },
        required: ['node'],
      }),
      execute: async (a) => updateGraphNode(userId, projectId, a.node, a),
    }),
  }
}
