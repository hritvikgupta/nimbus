/**
 * Code-chat workspace routes (per-user). The Slack/hilos-style team space:
 *   · GET    /api/workspace                         → repo + channel list
 *   · POST   /api/workspace/repo                    → connect a GitHub repo to the workspace
 *   · POST   /api/workspace/channels                → create a channel
 *   · DELETE /api/workspace/channels/:id            → delete a channel
 *   · GET    /api/workspace/channels/:id/messages   → channel history
 *   · PUT    /api/workspace/channels/:id/messages   → persist channel history (after a turn)
 *   · POST   /api/workspace/agent                   → stream a @nimbus reply (ReAct, repo-aware)
 */
import express from 'express'
import { requireUser } from '../middlewares/auth.mjs'
import { streamChat } from '../agents/chat/run.mjs'
import {
  workspaceMeta, createChannel, deleteChannel,
  getMessages, saveMessages,
} from '../repositories/workspace.mjs'
import { getProjectRepo, memberOwner, can } from '../repositories/projects.mjs'
import { pullRepoFiles, repoFileContent, cloneState } from '../services/repofiles.mjs'

const r = express.Router()

// Channels + the repo clone are SHARED across members → keyed by the project owner. Requires the
// 'channels' permission. Returns the owner id, or sends 403 and returns null.
function ownerOr403(req, res, projectId) {
  const owner = memberOwner(req.user.id, projectId)
  if (owner === null) { res.status(403).json({ error: 'You are not a member of this project.' }); return null }
  if (projectId && !can(projectId, req.user.id, 'channels')) { res.status(403).json({ error: 'You do not have access to this project’s channels.' }); return null }
  return owner
}

r.get('/api/workspace', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.query.projectId); if (owner === null) return
  res.json(workspaceMeta(owner, req.query.projectId))
})

// Code-editor view: pull (clone) the active PROJECT's repo → file tree; read a file; clone state.
r.post('/api/workspace/pull', requireUser, async (req, res) => {
  const owner = ownerOr403(req, res, req.body?.projectId); if (owner === null) return
  res.json(await pullRepoFiles(owner, req.body?.projectId, { force: !!req.body?.force }))
})
r.get('/api/workspace/file', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.query.projectId); if (owner === null) return
  res.json(repoFileContent(owner, req.query.projectId, req.query.path || ''))
})
r.get('/api/workspace/clone-state', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.query.projectId); if (owner === null) return
  res.json(cloneState(owner, req.query.projectId))
})

r.post('/api/workspace/channels', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.body?.projectId); if (owner === null) return
  res.json(createChannel(owner, req.body?.projectId, req.body?.name))
})
r.delete('/api/workspace/channels/:id', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.query.projectId); if (owner === null) return
  res.json(deleteChannel(owner, req.query.projectId, req.params.id))
})

r.get('/api/workspace/channels/:id/messages', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.query.projectId); if (owner === null) return
  res.json({ messages: getMessages(owner, req.query.projectId, req.params.id) })
})
r.put('/api/workspace/channels/:id/messages', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.body?.projectId); if (owner === null) return
  res.json(saveMessages(owner, req.body?.projectId, req.params.id, req.body?.messages))
})

// Stream a @nimbus reply. Cloud tools run under the MEMBER's own clouds (personal); the canvas +
// shared stores resolve to the project owner.
r.post('/api/workspace/agent', requireUser, async (req, res) => {
  try {
    const { messages = [], projectId } = req.body || {}
    const owner = memberOwner(req.user.id, projectId)
    if (owner === null) return res.status(403).send('You are not a member of this project.')
    const repo = getProjectRepo(projectId) // repo is bound to the active project
    await streamChat({ userId: req.user.id, ownerId: owner, messages, res, mode: 'agent', projectId, repo })
  } catch (e) {
    console.error('[codechat]', e)
    if (!res.headersSent) res.status(500).send(String(e?.message || e))
  }
})

export default r
