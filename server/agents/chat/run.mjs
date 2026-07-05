/**
 * Chat agent — Nimbus's ReAct loop, ported 1:1 from company-brain's lib/agents/chat/run.ts.
 * streamText(model, system, messages, tools, stopWhen: stepCountIs(N)) is the ReAct loop:
 * the model reasons, calls a tool, sees the result, and loops until it writes an answer.
 *
 * The ONLY Nimbus-specific part is toolsFor(): it assembles THIS user's toolset —
 * real MCP tools for whichever clouds they connected, falling back to demo tools.
 */
import { streamText, generateText, convertToModelMessages, stepCountIs } from 'ai'
import { chatModel } from '../../libs/openrouter.mjs'
import { allMcpToolsFor } from '../../libs/mcp.mjs'
import { getConnections } from '../../repositories/connections.mjs'
import { demoTools } from '../../tools/demo.mjs'
import { designTools, deployTools } from '../../tools/canvas.mjs'
import { telemetryTools } from '../../tools/telemetry.mjs'
import { codeTools, repoFileTools } from '../../tools/code.mjs'
import { repairTools } from '../../tools/repair.mjs'
import { composioConfigured, listConnectedToolkits, connectedAppTools } from '../../libs/composio.mjs'
import { buildSystemPrompt, buildDesignPrompt } from '../prompts.mjs'

/**
 * Streaming chat for the dashboard UI. Two modes the composer can pick:
 *  · 'design' → the agent ONLY draws the architecture on the project canvas (no real cloud).
 *  · 'agent'  → the agent operates the real clouds (provision/inspect) + can deploy the design.
 * Pipes a UI-message stream to the Express res.
 */
/**
 * Assemble THIS user's agent context — the exact same tools + system prompt for streaming OR
 * non-streaming runs, so everything that "is the Nimbus agent" goes through one place.
 */
export async function buildAgent({ userId, ownerId = userId, mode = 'agent', projectId, repo = null }) {
  // In a SHARED project everything is shared — clouds (AWS/GCP), GitHub, resources, canvas, machines
  // — so all tools are keyed by the project OWNER. (The only per-user thing is the private Nimbus
  // chat history, which lives outside the agent.) `ownerId` defaults to `userId` for solo use.
  const owner = ownerId
  const clouds = Object.keys(getConnections(owner))
  const live = clouds.length > 0
  if (mode === 'design') {
    return { tools: designTools(owner, projectId), system: buildDesignPrompt({ clouds }), maxSteps: 20 }
  }
  // Operate/deploy: real cloud tools (or demo before any connect) + the deploy bridge so it
  // can read the design and flip nodes live as it provisions them.
  const cloudTools = live ? await allMcpToolsFor(owner, clouds) : demoTools
  // Composio connected-app tools (GitHub, …) — the project's connected toolkits (owner-scoped).
  let composioTools = {}
  if (composioConfigured()) {
    try {
      const tks = await listConnectedToolkits(owner)
      if (tks.length) composioTools = await connectedAppTools(owner, tks)
    } catch (e) { console.error('[composio] tools load failed', e?.message || e) }
  }
  // codeTools always available; when a repo is connected, also the iterative repo tools bound to its clone.
  const repoTools = repo ? repoFileTools(owner, projectId) : {}
  // Repair bridge: spin a real machine repair on the SHARED project roster (owner-scoped).
  const repair = repairTools(owner, projectId)
  const tools = { ...cloudTools, ...deployTools(owner, projectId), ...(live ? telemetryTools(owner) : {}), ...codeTools(owner), ...composioTools, ...repoTools, ...repair }
  const system = buildSystemPrompt({ live, clouds, toolNames: Object.keys(tools), deploy: true, repo })
  return { tools, system, maxSteps: repo ? 26 : (live ? 24 : 8) }
}

/** Streaming chat for the dashboard UI (design vs agent mode). Pipes a UI-message stream to res. */
export async function streamChat({ userId, ownerId = userId, messages, res, mode = 'agent', projectId, repo = null }) {
  const { tools, system, maxSteps } = await buildAgent({ userId, ownerId, mode, projectId, repo })
  const result = streamText({
    model: chatModel(), system,
    messages: await convertToModelMessages(messages),
    tools, stopWhen: stepCountIs(maxSteps),
    temperature: 0.2, maxOutputTokens: 2000, maxRetries: 2,
    onError: ({ error }) => console.error('[nimbus-agent] stream error:', error),
  })
  result.pipeUIMessageStreamToResponse(res, { sendReasoning: true })
}

/**
 * Run the SAME Nimbus ReAct agent non-streaming (full toolset + system) and return its final text.
 * Used when something other than the chat UI needs the agent to do work + produce an answer
 * (e.g. composing a repair/feature brief). It's the real agent — it can investigate with its tools.
 */
export async function runAgent({ userId, instruction, mode = 'agent', projectId, repo = null, maxOutputTokens = 1400 }) {
  return runAgentChat({ userId, messages: [{ role: 'user', content: instruction }], mode, projectId, repo, maxOutputTokens })
}

/**
 * Run the SAME agent over a MAINTAINED message history (a conversation), returning its next reply.
 * This is what lets Nimbus hold a turn-by-turn dialogue with Claude (conversation.mjs) — not a
 * one-shot call. `systemAppend` adds a skill/role on top of the agent's own system prompt.
 */
export async function runAgentChat({ userId, messages, mode = 'agent', projectId, repo = null, systemAppend = '', maxOutputTokens = 1400, bare = false }) {
  // `bare`: a pure reasoning call with NO tools — used by the conversation driver, which must trust
  // Claude's reports (the executor holds ground truth) and NOT inspect a repo/clone it can't actually
  // see (the worker's local edits aren't in Nimbus's view). With tools it would contradict Claude.
  if (bare) {
    const { text } = await generateText({
      model: chatModel(), system: systemAppend || 'You are a helpful engineering pair.',
      messages, temperature: 0.2, maxOutputTokens, maxRetries: 2,
    })
    return text || ''
  }
  const { tools, system, maxSteps } = await buildAgent({ userId, mode, projectId, repo })
  const { text } = await generateText({
    model: chatModel(),
    system: systemAppend ? `${system}\n\n${systemAppend}` : system,
    messages,
    tools, stopWhen: stepCountIs(maxSteps),
    temperature: 0.2, maxOutputTokens, maxRetries: 2,
  })
  return text || ''
}
