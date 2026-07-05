/** Cloud-data + inspection routes — overview, resources, cost, live config, telemetry, spec, logs. */
import express from 'express'
import { overview, projectResources } from '../services/cloud.mjs'
import { costFor } from '../services/billing.mjs'
import { specFor, prefetchCatalog } from '../services/spec.mjs'
import { liveConfig } from '../services/live.mjs'
import { telemetryFor } from '../services/telemetry.mjs'
import { tailLogs } from '../services/logs.mjs'
import { getConnections } from '../repositories/connections.mjs'
import { requireUser } from '../middlewares/auth.mjs'

const r = express.Router()

/* real per-user cloud data, scoped to the active project */
r.get('/api/overview', requireUser, async (req, res) => {
  try { res.json(await overview(req.cloudUserId, req.query.project)) }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }) }
})
r.get('/api/resources', requireUser, async (req, res) => {
  try { res.json({ resources: await projectResources(req.cloudUserId, req.query.project) }) }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }) }
})
r.get('/api/cost', requireUser, async (req, res) => {
  try { res.json(await costFor(req.cloudUserId)) }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }) }
})

/* per-resource inspection (read from the cloud via the MCP) */
r.post('/api/resource/live', requireUser, async (req, res) => {
  try { const { cloud, type, name, region } = req.body || {}; res.json(await liveConfig(req.cloudUserId, cloud, type, name, region)) }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }) }
})
r.post('/api/resource/telemetry', requireUser, async (req, res) => {
  try { const { cloud, type, name, region, hours } = req.body || {}; res.json(await telemetryFor(req.cloudUserId, { cloud, type, name, region }, hours || 3)) }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }) }
})

/* live logs tail across the connected clouds */
r.get('/api/logs', requireUser, async (req, res) => {
  try {
    const names = ('names' in req.query) ? String(req.query.names).split(',').map((s) => s.trim()).filter(Boolean) : undefined
    res.json(await tailLogs(req.cloudUserId, { cloud: req.query.cloud, mins: Number(req.query.mins) || 60, names }))
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }) }
})

/* model-driven config schema + monthly cost for ANY service */
r.post('/api/spec', requireUser, async (req, res) => {
  try { res.json(await specFor({ ...(req.body || {}), userId: req.cloudUserId })) }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }) }
})
r.post('/api/catalog/prefetch', requireUser, (req, res) => {
  const clouds = Object.keys(getConnections(req.cloudUserId))
  prefetchCatalog(req.cloudUserId, clouds).catch((e) => console.error('[prefetch]', e?.message || e))
  res.json({ started: true, clouds })
})

export default r
