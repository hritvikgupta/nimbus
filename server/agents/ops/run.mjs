/**
 * Ops / incident agent — Nimbus's on-call SRE. Same ReAct family as the chat agent, but pointed at
 * an operations toolset (logs, inventory, cost, telemetry, the cloud MCP, the repo, and curated
 * GitHub write actions) and driven by the incident-response SKILL.md playbook.
 *
 * Two entry points:
 *   · streamIncident() → manual/real-time: streams the investigation to the UI (or a webhook caller).
 *   · runScan()        → scheduled proactive health scan: read-only, returns a findings report.
 *
 * Reads are autonomous; writes (open a PR, change infra) are gated on user confirmation by the SKILL.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { streamText, generateText, convertToModelMessages, stepCountIs } from 'ai'
import { chatModel } from '../../libs/openrouter.mjs'
import { allMcpToolsFor } from '../../libs/mcp.mjs'
import { getConnections } from '../../repositories/connections.mjs'
import { composioConfigured, listConnectedToolkits, connectedAppTools } from '../../libs/composio.mjs'
import { opsTools } from '../../tools/ops.mjs'
import { telemetryTools } from '../../tools/telemetry.mjs'
import { codeTools } from '../../tools/code.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = fs.readFileSync(path.join(HERE, '..', 'skills', 'incident-response', 'SKILL.md'), 'utf8')
  .replace(/^---[\s\S]*?---\n/, '')

/** Assemble this user's ops toolset (read observability + repo + curated GitHub writes). */
async function opsTooling(userId) {
  const clouds = Object.keys(getConnections(userId))
  const live = clouds.length > 0
  const cloud = live ? await allMcpToolsFor(userId, clouds) : {}
  let github = {}
  if (composioConfigured()) {
    try {
      const tks = await listConnectedToolkits(userId)
      // Direct curated GitHub tools (GITHUB_CREATE_A_REFERENCE / _PULL_REQUEST / …). The Tool
      // Router's search→execute flow proved unreliable for WRITES with our model (it stalls on
      // MANAGE_CONNECTIONS); the direct tools open PRs reliably.
      if (tks.includes('github')) github = await connectedAppTools(userId, ['github'])
    } catch (e) { console.error('[ops] github tools load failed', e?.message || e) }
  }
  const tools = { ...cloud, ...opsTools(userId), ...(live ? telemetryTools(userId) : {}), ...codeTools(userId), ...github }
  return { tools, clouds, live }
}

function systemFor(clouds) {
  return `${SKILL}\n\nConnected clouds: ${clouds.join(', ') || 'none'}. Today: ${new Date().toISOString().slice(0, 10)}.`
}

/** Manual / real-time incident investigation — streams the ReAct loop to res. */
export async function streamIncident({ userId, messages, res }) {
  const { tools, clouds } = await opsTooling(userId)
  const result = streamText({
    model: chatModel(),
    system: systemFor(clouds),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(28),
    temperature: 0.2,
    maxOutputTokens: 2500,
    maxRetries: 2,
    onError: ({ error }) => console.error('[ops-agent] stream error:', error),
  })
  result.pipeUIMessageStreamToResponse(res, { sendReasoning: true })
}

/** Event-driven investigation (webhook/alert) — READ-ONLY triage. Returns a findings report. */
export async function investigate(userId, incident) {
  const { tools, clouds, live } = await opsTooling(userId)
  if (!live) return { ok: false, skipped: 'no cloud connected' }
  const { text } = await generateText({
    model: chatModel(),
    system: systemFor(clouds),
    prompt: `An operational alert fired. Investigate it (read-only) and produce an incident summary with evidence and a recommended action. Do NOT make any cloud changes; if a code fix is warranted you may say so but do not open a PR unprompted in this automated pass.\n\nALERT:\n${incident}`,
    tools,
    stopWhen: stepCountIs(22),
    temperature: 0,
    maxRetries: 2,
  })
  return { ok: true, clouds, report: text, at: Date.now() }
}

/** Scheduled proactive scan — READ-ONLY. Returns a findings report (no changes made). */
export async function runScan(userId) {
  const { tools, clouds, live } = await opsTooling(userId)
  if (!live) return { ok: false, skipped: 'no cloud connected' }
  const { text } = await generateText({
    model: chatModel(),
    system: systemFor(clouds),
    prompt: 'PROACTIVE HEALTH SCAN (read-only — do NOT make any changes). Check: running resources and their status, recent errors/crashes in logs, error-rate/latency/CPU telemetry, and cost anomalies. Report ONLY real problems, each with evidence and a recommended action. If everything is healthy, reply exactly "all clear".',
    tools,
    stopWhen: stepCountIs(20),
    temperature: 0,
    maxRetries: 2,
  })
  return { ok: true, clouds, report: text, at: Date.now() }
}
