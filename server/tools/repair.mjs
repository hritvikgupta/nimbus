/**
 * Repair tools — let the Nimbus chat agent spin a REAL machine repair (the same pipeline as the
 * Repair tab): dispatch a brief to a connected machine, whose Claude Code fixes the code and opens
 * a PR, with Nimbus driving it turn-by-turn. The agent must ask the user which MACHINE + MODEL
 * before dispatching (use list_repair_machines first).
 */
import { tool, jsonSchema } from 'ai'
import { getProjectRepo } from '../repositories/projects.mjs'
import { composeBrief } from '../services/brief.mjs'
import { startConversation } from '../services/conversation.mjs'
import { createConversation, appendMessage } from '../repositories/conversations.mjs'
import { listWorkers, createTask, dispatch, pushStep } from '../services/repair.mjs'

const MODELS = ['opus', 'sonnet', 'haiku'] // '' / omitted = the machine's default model
const EXECUTOR = { claude: 'Claude Code', opencode: 'OpenCode', codex: 'Codex' } // agent → executor name in the driver prompt

export function repairTools(userId, projectId) {
  return {
    list_repair_machines: tool({
      description: 'List the connected machines that can run a repair. Machines are either a teammate’s local computer (runs Claude Code) or a rented Nimbus Cloud machine (runs its chosen agent — Claude or OpenCode — on a model fixed when it was rented). ALWAYS call this before dispatch_repair to ask the user which machine to use. For a RENTED machine do NOT pass a model — it already has one.',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => {
        const repo = getProjectRepo(projectId)
        const machines = listWorkers(userId).map((w) => ({
          workerId: w.workerId,
          host: w.host || w.workerId,
          kind: w.rented ? 'rented-cloud' : 'local-computer',
          agent: w.rented ? (w.agent || 'claude') : 'claude',
          // A rented machine's model is fixed at rent time; a local Claude Code machine can be told opus/sonnet/haiku.
          model: w.rented ? (w.model || 'default') : null,
          modelSelectable: !w.rented,
        }))
        return { repo: repo || null, machines, localModels: MODELS, note: 'Only local computers accept a model choice; rented machines run their rent-time agent + model.' }
      },
    }),
    dispatch_repair: tool({
      description:
        "Spin up a real repair on a connected machine: it clones the project repo, makes the fix/feature you describe, and opens a PR — with Nimbus driving its coding agent turn-by-turn. Works with BOTH a teammate's local computer (Claude Code) and a rented Nimbus Cloud machine (its rent-time agent — Claude or OpenCode). This is the SAME pipeline as the Repair tab. " +
        'Before calling this, confirm with the user which machine (workerId from list_repair_machines). Pass a model ONLY for a local computer; a rented machine already has its model fixed. After dispatching, tell the user it is running in the Repair tab.',
      inputSchema: jsonSchema({
        type: 'object',
        required: ['summary', 'workerId'],
        properties: {
          summary: { type: 'string', description: 'What to fix/build — a clear one-paragraph brief of the task for the coding agent.' },
          hypothesis: { type: 'string', description: 'Optional: your suspected root cause or approach, to guide the agent.' },
          workerId: { type: 'string', description: 'Which connected machine to run on (from list_repair_machines). Required — ask the user.' },
          model: { type: 'string', description: "ONLY for a local computer (Claude Code): 'opus' | 'sonnet' | 'haiku'. Omit for a rented machine (it uses its rent-time model) or for the local default." },
        },
      }),
      execute: async ({ summary, hypothesis, workerId, model }) => {
        const repo = getProjectRepo(projectId)
        if (!repo) return { ok: false, error: 'No repo connected to this project — connect one first.' }
        const online = listWorkers(userId)
        if (!online.length) return { ok: false, error: 'No machine is connected. Ask the user to connect a machine in the Repair tab.' }
        if (!workerId) return { ok: false, error: 'workerId is required — call list_repair_machines and ask the user which machine.' }
        const target = online.find((w) => w.workerId === workerId)
        if (!target) return { ok: false, error: `Machine "${workerId}" is offline. Available: ${online.map((w) => w.workerId).join(', ')}` }
        // A rented machine runs its rent-time agent + model — ignore any model the agent tried to pass.
        if (target.rented) model = null
        else if (model && !MODELS.includes(model)) return { ok: false, error: `Unknown model "${model}". Use one of: ${MODELS.join(', ')} (or omit for default).` }

        const incident = { summary: summary || '', hypothesis: hypothesis || '' }
        const task = createTask({ userId, projectId, repo, incident, targetWorkerId: workerId, model: model || null })
        const conv = createConversation({ userId, id: task.id, kind: 'repair', projectId, repo, machineId: workerId, speaker: 'nimbus', title: incident.summary || 'Repair' })
        task.conversationId = conv.id

        ;(async () => {
          try {
            pushStep(userId, task.id, { phase: 'framing', text: 'Nimbus is analyzing your request and the repo…' })
            const brief = await composeBrief(userId, projectId, { request: incident.summary, hypothesis: incident.hypothesis, logs: [] })
            task.incident = { ...task.incident, brief }
            appendMessage(userId, conv.id, { role: 'nimbus', text: brief })
            const d = dispatch(task)
            if (!d.ok) { pushStep(userId, task.id, { phase: 'error', text: 'No machine online to run the repair.' }); return }
            startConversation(userId, task.id, brief, repo, projectId, EXECUTOR[target.agent] || 'Claude Code')
          } catch (e) { pushStep(userId, task.id, { phase: 'error', text: 'Could not start the repair: ' + (e?.message || e) }) }
        })()

        return { ok: true, taskId: task.id, machine: workerId, model: model || 'machine default', repo, note: 'Repair dispatched. It is now running on the machine and visible in the Repair tab.' }
      },
    }),
  }
}
