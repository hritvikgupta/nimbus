/** Rented-machine routes — the "Rent a machine" flow persists a rental record here. Scoped per
 * project (shared with members, keyed by the project owner), same as repairs/machines.
 *   · GET   /api/rentals?projectId=…   → this project's rentals
 *   · POST  /api/rentals               → create a rental (no VM booted yet → status 'provisioning')
 *   · PATCH /api/rentals/:id           → stop a rental (status 'stopped')
 *
 * Cost is computed SERVER-SIDE from our cached raw provider rate × margin, so the client can't set
 * its own price. The margin itself is never returned as a line item. See docs/rented-compute.md. */
import express from 'express'
import { requireUser } from '../middlewares/auth.mjs'
import { memberOwner, can, getProjectRepo } from '../repositories/projects.mjs'
import { listRentals, createRental, updateRental } from '../repositories/rentals.mjs'
import { rawSize, MARKUP } from '../services/pricing.mjs'
import { agentChat, listAgentModels, agentModelCatalog } from '../services/provisioner.mjs'
import { startOAuth, exchangeOAuth, oauthAgents } from '../services/agent-oauth.mjs'
import { listSummaries } from '../repositories/summaries.mjs'
import crypto from 'node:crypto'

const r = express.Router()

const AGENTS = new Set(['claude', 'codex', 'opencode'])
// Allowed rental durations in hours (null = open-ended, billed hourly). Mirrors the modal presets.
const DURATIONS = new Set([1, 6, 24, 72, 168])

// Never expose the injected API key to the client.
const safe = (r) => { const { apiKey, ...rest } = r; return rest }

function ownerOr403(req, res, projectId) {
  const owner = memberOwner(req.user.id, projectId)
  if (owner === null) { res.status(403).json({ error: 'You are not a member of this project.' }); return null }
  if (projectId && !can(projectId, req.user.id, 'machines')) { res.status(403).json({ error: 'No access to this project’s machines.' }); return null }
  return owner
}

r.get('/api/rentals', requireUser, (req, res) => {
  const projectId = req.query.projectId || ''
  const owner = ownerOr403(req, res, projectId); if (owner === null) return
  res.json({ rentals: listRentals(owner, projectId).map(safe) })
})

// Real model catalog for an agent (fetched from models.dev) — for the Rent modal's model picker.
r.get('/api/agent-models', requireUser, async (req, res) => {
  const agent = ['claude', 'codex', 'opencode'].includes(req.query.agent) ? req.query.agent : 'claude'
  try { res.json({ agent, models: await agentModelCatalog(agent) }) }
  catch (e) { res.json({ agent, models: [], error: String(e?.message || e) }) }
})

// Which agents authenticate via subscription OAuth (not an API key) — the modal asks the UI to
// run the "Connect" flow for these instead of showing a key field.
r.get('/api/rentals/oauth/agents', requireUser, (_req, res) => res.json({ agents: oauthAgents() }))

// Begin a subscription login for an OAuth agent (Claude) → { oauthId, authUrl }.
r.post('/api/rentals/oauth/start', requireUser, (req, res) => {
  try { res.json({ ok: true, ...startOAuth(req.body?.agent || 'claude') }) }
  catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }) }
})

// Finish the login: exchange the pasted code for the token the VM will use → { token }.
r.post('/api/rentals/oauth/exchange', requireUser, async (req, res) => {
  const { oauthId, code } = req.body || {}
  try { res.json({ ok: true, ...(await exchangeOAuth(oauthId, code)) }) }
  catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }) }
})

// Saved session summaries for this project — used to RESUME a past session on a new machine.
r.get('/api/summaries', requireUser, (req, res) => {
  const projectId = req.query.projectId || ''
  const owner = ownerOr403(req, res, projectId); if (owner === null) return
  const list = listSummaries(owner, projectId).map((s) => ({ id: s.id, title: s.title, agent: s.agent, size: s.size, updatedAt: s.updatedAt }))
  res.json({ summaries: list })
})

r.post('/api/rentals', requireUser, (req, res) => {
  const { projectId, size, agent, model, durationHours, apiKey, resumeSummaryId } = req.body || {}
  const owner = ownerOr403(req, res, projectId); if (owner === null) return
  if (!size) return res.status(400).json({ error: 'size is required' })
  if (!AGENTS.has(agent)) return res.status(400).json({ error: 'unknown coding agent' })
  if (!apiKey || !String(apiKey).trim()) return res.status(400).json({ error: 'an API key is required to boot the machine' })

  const hours = durationHours == null ? null : Number(durationHours)
  if (hours != null && !DURATIONS.has(hours)) return res.status(400).json({ error: 'invalid duration' })

  // Authoritative cost from our cached RAW rate × margin (never trust a client-sent price).
  const raw = rawSize(size)
  const priceSecondRaw = raw?.priceSecond ?? null
  const priceSecondCharged = priceSecondRaw != null ? priceSecondRaw * MARKUP : null
  const estimatedCost = priceSecondCharged != null && hours != null ? priceSecondCharged * hours * 3600 : null

  const now = Date.now()
  const rental = {
    id: 'rent-' + crypto.randomUUID().slice(0, 8),
    projectId,
    userId: owner,
    createdBy: req.user.id,
    createdByName: req.user.name || req.user.email || 'You',
    size,
    cpus: raw?.cpus ?? null,
    memoryMb: raw?.memoryMb ?? null,
    cpuKind: raw?.cpuKind ?? null,
    agent,                   // the CLI (claude / codex / opencode)
    model: model || '',      // the model, chosen up front ('' = the agent's own default)
    repo: getProjectRepo(projectId) || null, // cloned onto the machine at boot
    resumeSummaryId: resumeSummaryId || null, // seed this saved summary onto the machine to resume
    apiKey: String(apiKey),  // injected into the machine at boot, then cleared from the record
    durationHours: hours,
    priceSecondRaw,       // our cost (internal)
    priceSecondCharged,   // what the customer is billed
    estimatedCost,        // charged rate × duration
    actualCost: null,     // filled by metering once a real VM runs
    requestedAt: now,       // when Rent was clicked
    startedAt: now,         // kept for sorting; the billable/expiry clock starts at runningAt
    runningAt: null,        // set when the machine reaches 'started' (timer starts here)
    expiresAt: null,        // computed at runningAt = runningAt + durationHours (not during boot)
    status: 'provisioning', // no VM booted yet
  }
  createRental(owner, rental)
  res.json({ ok: true, rental: safe(rental) })
})

r.patch('/api/rentals/:id', requireUser, (req, res) => {
  const { projectId, status } = req.body || {}
  const owner = ownerOr403(req, res, projectId); if (owner === null) return
  if (status && status !== 'stopped') return res.status(400).json({ error: 'unsupported status' })
  // Request teardown → the lifecycle loop destroys the machine, meters cost, then marks it 'stopped'.
  const updated = updateRental(owner, req.params.id, { status: 'stopping', stopRequestedAt: Date.now() })
  if (!updated) return res.status(404).json({ error: 'rental not found' })
  res.json({ ok: true, rental: safe(updated) })
})

// Direct chat with the agent running ON the rented machine (drives it via Fly exec). Same idea as
// the direct machine-session chat, but the machine is a rented Fly VM. Nimbus-driven turns use the
// same agentChat() under the hood.
r.post('/api/rentals/:id/chat', requireUser, async (req, res) => {
  const { projectId, message } = req.body || {}
  const owner = ownerOr403(req, res, projectId); if (owner === null) return
  const rental = listRentals(owner, projectId).find((x) => x.id === req.params.id)
  if (!rental) return res.status(404).json({ error: 'rental not found' })
  if (rental.status !== 'running') return res.status(409).json({ error: 'machine is not running yet', status: rental.status })
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'message is required' })

  try {
    const out = await agentChat(rental, String(message).trim(), !!rental.chatStarted)
    if (!out.ready) return res.json({ ok: true, ready: false, reply: 'The agent is still installing on the machine — give it a few seconds and try again.' })
    if (!rental.chatStarted) updateRental(owner, rental.id, { chatStarted: true })
    res.json({ ok: true, ready: true, reply: out.reply })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// The real models for this rented machine's agent (OpenCode fetched live from the machine).
r.get('/api/rentals/:id/models', requireUser, async (req, res) => {
  const projectId = req.query.projectId || ''
  const owner = ownerOr403(req, res, projectId); if (owner === null) return
  const rental = listRentals(owner, projectId).find((x) => x.id === req.params.id)
  if (!rental) return res.status(404).json({ error: 'rental not found' })
  try { res.json({ agent: rental.agent, models: await listAgentModels(rental) }) }
  catch (e) { res.json({ agent: rental.agent, models: [], error: String(e?.message || e) }) }
})

export default r
