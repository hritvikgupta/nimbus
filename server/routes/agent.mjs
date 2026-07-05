/** Agent route — the streaming ReAct chat (scoped to req.user.id). */
import express from 'express'
import { streamChat } from '../agents/chat/run.mjs'
import { requireUser } from '../middlewares/auth.mjs'
import { memberOwner, getProjectRepo } from '../repositories/projects.mjs'

const r = express.Router()

r.post('/api/agent', requireUser, async (req, res) => {
  try {
    const { messages = [], mode, projectId } = req.body || {}
    const ownerId = memberOwner(req.user.id, projectId)
    if (ownerId === null) return res.status(403).send('You are not a member of this project.')
    const repo = getProjectRepo(projectId) // bind the agent to the project's connected repo (shared, owner-scoped)
    await streamChat({ userId: req.user.id, ownerId, messages, res, mode, projectId, repo })
  } catch (e) {
    console.error('[nimbus-agent]', e)
    if (!res.headersSent) res.status(500).send(String(e?.message || e))
  }
})

export default r
