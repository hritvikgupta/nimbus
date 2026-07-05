/** Ops routes — manual incident investigation (streamed), on-demand scan, incident history,
 *  and the per-user webhook URLs that external alert sources post to. */
import express from 'express'
import { streamIncident, runScan } from '../agents/ops/run.mjs'
import { addIncident, listIncidents, webhookTokenFor } from '../repositories/ops.mjs'
import { requireUser } from '../middlewares/auth.mjs'

const r = express.Router()
const WEBHOOK_BASE = process.env.WEBHOOK_BASE || `http://localhost:${process.env.AGENT_PORT || 8788}`

// Real-time / manual: "investigate why api is down" — streams the ReAct loop (can open a PR, gated).
r.post('/api/ops/investigate', requireUser, async (req, res) => {
  try { await streamIncident({ userId: req.user.id, messages: req.body?.messages || [], res }) }
  catch (e) { console.error('[ops]', e); if (!res.headersSent) res.status(500).send(String(e?.message || e)) }
})

// On-demand proactive scan (read-only), stored as an incident record.
r.post('/api/ops/scan', requireUser, async (req, res) => {
  try {
    const out = await runScan(req.user.id)
    if (out.ok && out.report && out.report.trim().toLowerCase() !== 'all clear') {
      addIncident(req.user.id, { source: 'scan', title: 'Proactive scan', report: out.report })
    }
    res.json(out)
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }) }
})

r.get('/api/ops/incidents', requireUser, (req, res) => res.json({ incidents: listIncidents(req.user.id) }))

// The user's unique webhook URLs to register in GitHub / AWS SNS / GCP Pub/Sub.
r.get('/api/ops/webhook-urls', requireUser, (req, res) => {
  const token = webhookTokenFor(req.user.id)
  res.json({
    github: `${WEBHOOK_BASE}/api/webhooks/github/${token}`,
    aws: `${WEBHOOK_BASE}/api/webhooks/aws/${token}`,
    gcp: `${WEBHOOK_BASE}/api/webhooks/gcp/${token}`,
  })
})

export default r
