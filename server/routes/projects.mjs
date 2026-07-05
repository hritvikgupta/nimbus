/** Project (workspace) routes — projects, members, the editable canvas graph, and node edits. */
import express from 'express'
import {
  getProjects, createProject, setProjectRepo, getGraph, saveGraph, updateGraphNode, removeGraphNode,
  memberOwner, ownerOf, isOwner, listMembers, inviteMember, removeMember, deleteProject, setMemberPerms,
} from '../repositories/projects.mjs'
import { requireUser } from '../middlewares/auth.mjs'

const r = express.Router()

// Resolve the OWNER id for an owner-scoped store, or send 403 if the user isn't a project member.
function ownerOr403(req, res, projectId) {
  const owner = memberOwner(req.user.id, projectId)
  if (owner === null) { res.status(403).json({ error: 'You are not a member of this project.' }); return null }
  return owner
}

r.get('/api/projects', requireUser, (req, res) => {
  res.json({ projects: getProjects(req.user.id) })
})
r.post('/api/projects', requireUser, (req, res) => {
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'A project name is required.' })
  const project = createProject(req.user.id, name, (req.body?.repo || '').trim() || null)
  res.json({ project, projects: getProjects(req.user.id) })
})
// Bind / change the GitHub repo for a project (the Code tab's repo). Members only.
r.put('/api/projects/:id/repo', requireUser, (req, res) => {
  if (ownerOr403(req, res, req.params.id) === null) return
  const p = setProjectRepo(req.params.id, (req.body?.repo || '').trim() || null)
  res.json(p ? { ok: true, project: p } : { ok: false, error: 'project not found' })
})

/* ---- members (owner can invite/remove; any member can view) ---- */
r.get('/api/projects/:id/members', requireUser, (req, res) => {
  if (ownerOr403(req, res, req.params.id) === null) return
  res.json({ members: listMembers(req.params.id), isOwner: isOwner(req.params.id, req.user.id) })
})
r.post('/api/projects/:id/members', requireUser, (req, res) => {
  if (ownerOr403(req, res, req.params.id) === null) return
  if (!isOwner(req.params.id, req.user.id)) return res.status(403).json({ error: 'Only the project owner can invite members.' })
  const out = inviteMember(req.params.id, req.body?.email, 'member', req.user.id)
  res.json({ ...out, members: listMembers(req.params.id) })
})
r.patch('/api/projects/:id/members/:userId', requireUser, (req, res) => {
  if (ownerOr403(req, res, req.params.id) === null) return
  if (!isOwner(req.params.id, req.user.id)) return res.status(403).json({ error: 'Only the project owner can change permissions.' })
  setMemberPerms(req.params.id, req.params.userId, req.body?.perms || {})
  res.json({ ok: true, members: listMembers(req.params.id) })
})
r.delete('/api/projects/:id/members/:userId', requireUser, (req, res) => {
  if (ownerOr403(req, res, req.params.id) === null) return
  if (!isOwner(req.params.id, req.user.id)) return res.status(403).json({ error: 'Only the project owner can remove members.' })
  const out = removeMember(req.params.id, req.params.userId)
  res.json({ ...out, members: listMembers(req.params.id) })
})
r.delete('/api/projects/:id', requireUser, (req, res) => {
  if (!isOwner(req.params.id, req.user.id)) return res.status(403).json({ error: 'Only the project owner can delete the project.' })
  deleteProject(req.params.id)
  res.json({ ok: true, projects: getProjects(req.user.id) })
})

// Editable canvas layout (node positions + user-drawn edges) per project — shared, owner-scoped.
r.get('/api/projects/:id/graph', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.params.id); if (owner === null) return
  res.json(getGraph(owner, req.params.id))
})
r.put('/api/projects/:id/graph', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.params.id); if (owner === null) return
  res.json(saveGraph(owner, req.params.id, req.body || {}))
})

// Manual control of a canvas node from the right panel (PATCH = edit spec, DELETE = remove).
r.patch('/api/projects/:id/nodes/:nodeId', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.params.id); if (owner === null) return
  res.json(updateGraphNode(owner, req.params.id, req.params.nodeId, req.body || {}))
})
r.delete('/api/projects/:id/nodes/:nodeId', requireUser, (req, res) => {
  const owner = ownerOr403(req, res, req.params.id); if (owner === null) return
  res.json(removeGraphNode(owner, req.params.id, req.params.nodeId))
})

export default r
