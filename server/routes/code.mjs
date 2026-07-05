/** Code-analysis routes — GitHub repo list (Composio), analyze/list/read/summary (agent). */
import express from 'express'
import { listRepos, readCodebase, repoSummary } from '../services/codeanalysis.mjs'
import { analyzeRepoAgent } from '../agents/analyze/run.mjs'
import { listGithubRepos } from '../libs/composio.mjs'
import { requireUser } from '../middlewares/auth.mjs'

const r = express.Router()

// The user's GitHub repos (via Composio) — for the onboarding repo picker.
r.get('/api/github/repos', requireUser, async (req, res) => res.json({ repos: await listGithubRepos(req.user.id) }))

r.get('/api/code/repos', requireUser, (req, res) => res.json({ repos: listRepos(req.user.id) }))
r.post('/api/code/analyze', requireUser, async (req, res) => {
  try { res.json(await analyzeRepoAgent(req.user.id, req.body?.repo || '')) }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }) }
})
r.post('/api/code/read', requireUser, (req, res) => {
  const { repo, query } = req.body || {}; res.json(readCodebase(req.user.id, repo, query))
})
// Latest grounded analysis (services, clouds, datastores, languages) for the onboarding map.
r.get('/api/code/summary', requireUser, (req, res) => res.json({ summary: repoSummary(req.user.id, req.query.repo) }))

export default r
