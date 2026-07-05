/**
 * Per-user PROJECT (workspace) store + resource→project assignments, persisted to disk
 * (server/.data/projects.json, server/.data/assignments.json) like connections.mjs.
 *
 * MODEL: a project is a USER WORKSPACE (e.g. "Acme Production"), NOT a cloud. One user has
 * many projects. Inside a single project the agent can create resources from ANY cloud
 * (AWS + GCP mixed). Each created resource is tagged to the active project via an
 * assignment keyed by `${cloud}:${name}`. The CloudMap canvas + Overview/Resources/Cost
 * tabs show only the SELECTED project's assigned resources (mixed clouds).
 */
import crypto from 'node:crypto'
import { loadJson, saveJson } from './store.mjs'
import { getUserByEmail, getUserById } from './auth.mjs'

/* ---------- projects: FLAT map projectId -> { id, name, repo, ownerId, members:[{userId,role}], createdAt }
   A project is a SHARED workspace: the owner can invite members (by email); every member sees the
   same channels, machines and repairs. Cloud credentials stay personal (never shared). ---------- */
const _projects = new Map()
;(function loadProjects() {
  const raw = loadJson('projects.json', {})
  for (const [key, val] of Object.entries(raw)) {
    if (Array.isArray(val)) {
      // MIGRATE old per-user shape: { userId: [ {id,name,repo} ] } → flat, owner = that user.
      for (const p of val) {
        _projects.set(p.id, { id: p.id, name: p.name, repo: p.repo || null, ownerId: key, members: [{ userId: key, role: 'owner' }], createdAt: p.createdAt || Date.now() })
      }
    } else if (val && val.id) {
      const p = val
      _projects.set(p.id, { ...p, members: p.members?.length ? p.members : [{ userId: p.ownerId || key, role: 'owner' }], ownerId: p.ownerId || (p.members?.find((m) => m.role === 'owner')?.userId) || key })
    }
  }
})()
function persistProjects() { saveJson('projects.json', Object.fromEntries(_projects)) }

/* ---------- pending email invites: emailLower -> [{ projectId, role, invitedBy, at }] ---------- */
const _invites = new Map(Object.entries(loadJson('invites.json', {})))
function persistInvites() { saveJson('invites.json', Object.fromEntries(_invites)) }

/** Get a project by id (the shared record), or null. */
export function getProject(projectId) { return _projects.get(projectId) || null }
/** The user who owns the project (for keying shared, owner-scoped stores). */
export function ownerOf(projectId) { return _projects.get(projectId)?.ownerId || null }
export function isMember(projectId, userId) { return !!_projects.get(projectId)?.members?.some((m) => m.userId === userId) }
export function isOwner(projectId, userId) { return _projects.get(projectId)?.ownerId === userId }

/* ---------- per-member permissions ---------- */
export const CAPABILITIES = ['channels', 'machines', 'clouds'] // what a member can be granted/denied
const ALL_PERMS = () => ({ channels: true, machines: true, clouds: true })

/** Effective permissions for a user on a project. Owner → all. Member with no perms set → all (default open). */
export function memberPerms(projectId, userId) {
  const p = _projects.get(projectId)
  if (!p) return ALL_PERMS()
  if (p.ownerId === userId) return ALL_PERMS()
  const m = p.members?.find((x) => x.userId === userId)
  if (!m) return { channels: false, machines: false, clouds: false }
  return { ...ALL_PERMS(), ...(m.perms || {}) }
}
/** Can `userId` use capability `cap` on `projectId`? */
export function can(projectId, userId, cap) {
  if (!isMember(projectId, userId)) return false
  return memberPerms(projectId, userId)[cap] !== false
}
/** Owner sets a member's permissions (partial patch of channels/machines/clouds). */
export function setMemberPerms(projectId, userId, perms) {
  const p = _projects.get(projectId)
  if (!p) return { ok: false }
  const m = p.members?.find((x) => x.userId === userId)
  if (!m || m.userId === p.ownerId) return { ok: false }
  m.perms = { ...ALL_PERMS(), ...(m.perms || {}) }
  for (const c of CAPABILITIES) if (c in (perms || {})) m.perms[c] = !!perms[c]
  persistProjects()
  return { ok: true }
}

/**
 * Authorize + resolve: if `userId` is a member of `projectId`, return the project OWNER's id (the key
 * shared owner-scoped stores — channels, repairs, canvas, machine roster — are read/written under).
 * Returns null if the user is NOT a member (caller should 403). If projectId is missing/unknown,
 * falls back to the user's own id so personal/no-project calls keep working.
 */
export function memberOwner(userId, projectId) {
  if (!projectId) return userId
  const p = _projects.get(projectId)
  if (!p) return userId
  return p.members?.some((m) => m.userId === userId) ? p.ownerId : null
}

/** Return the projects this user is a MEMBER of, auto-creating a default "Project 1" if they have none. */
export function getProjects(userId) {
  let list = [..._projects.values()].filter((p) => p.members?.some((m) => m.userId === userId))
  if (!list.length) {
    const p = { id: crypto.randomUUID(), name: 'Project 1', repo: null, ownerId: userId, members: [{ userId, role: 'owner' }], createdAt: Date.now() }
    _projects.set(p.id, p)
    persistProjects()
    list = [p]
  }
  // Owner first, then by creation time — stable order for the dropdown.
  return list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

export function createProject(userId, name, repo) {
  const project = { id: crypto.randomUUID(), name: (name || 'Untitled project').trim(), repo: repo || null, ownerId: userId, members: [{ userId, role: 'owner' }], createdAt: Date.now() }
  _projects.set(project.id, project)
  persistProjects()
  return project
}

/** Bind a GitHub repo (owner/repo) to a project — what the Code tab + @nimbus read. */
export function setProjectRepo(projectId, repo) {
  const p = _projects.get(projectId)
  if (!p) return null
  p.repo = repo || null
  persistProjects()
  return p
}

/** The repo bound to a project. */
export function getProjectRepo(projectId) {
  return _projects.get(projectId)?.repo || null
}

export function renameProject(projectId, name) {
  const p = _projects.get(projectId)
  if (p) { p.name = (name || p.name).trim(); persistProjects() }
  return p || null
}

export function deleteProject(projectId) {
  _projects.delete(projectId)
  persistProjects()
  return true
}

/* ---------- membership ---------- */
/** Member list with public user info (id, email, name) + role. */
export function listMembers(projectId) {
  const p = _projects.get(projectId)
  if (!p) return []
  const members = (p.members || []).map((m) => ({ ...(getUserById(m.userId) || { id: m.userId, email: '(unknown)', name: '(unknown)' }), role: m.role, perms: m.role === 'owner' ? ALL_PERMS() : { ...ALL_PERMS(), ...(m.perms || {}) } }))
  // Pending invites (not yet accepted) shown as greyed entries.
  const pending = [..._invites.entries()].flatMap(([email, list]) =>
    list.filter((i) => i.projectId === projectId).map((i) => ({ id: null, email, name: email, role: i.role, pending: true })))
  return [...members, ...pending]
}

/** Invite a user (by email) to a project. If they have an account, add them now; else store a pending invite. */
export function inviteMember(projectId, email, role = 'member', invitedBy = null) {
  const p = _projects.get(projectId)
  if (!p) return { ok: false, error: 'project not found' }
  const e = (email || '').trim().toLowerCase()
  if (!e) return { ok: false, error: 'email required' }
  const existing = getUserByEmail(e)
  if (existing) {
    if (existing.id === p.ownerId || p.members.some((m) => m.userId === existing.id)) return { ok: true, already: true }
    p.members.push({ userId: existing.id, role })
    persistProjects()
    return { ok: true, added: true }
  }
  // No account yet → pending invite, claimed when they sign up with this email.
  const list = _invites.get(e) || []
  if (!list.some((i) => i.projectId === projectId)) { list.push({ projectId, role, invitedBy, at: Date.now() }); _invites.set(e, list); persistInvites() }
  return { ok: true, invited: true }
}

/** Remove a member from a project (cannot remove the owner). */
export function removeMember(projectId, userId) {
  const p = _projects.get(projectId)
  if (!p) return { ok: false }
  if (p.ownerId === userId) return { ok: false, error: 'cannot remove the owner' }
  p.members = p.members.filter((m) => m.userId !== userId)
  persistProjects()
  return { ok: true }
}

/** On login/signup, convert any pending email invites for this user into memberships. */
export function claimInvites(user) {
  const e = (user?.email || '').trim().toLowerCase()
  if (!e) return
  const list = _invites.get(e)
  if (!list?.length) return
  for (const inv of list) {
    const p = _projects.get(inv.projectId)
    if (p && !p.members.some((m) => m.userId === user.id)) p.members.push({ userId: user.id, role: inv.role || 'member' })
  }
  _invites.delete(e)
  persistInvites()
  persistProjects()
}

/* ---------- assignments: userId -> { [`${cloud}:${name}`]: projectId } ---------- */
const _assignments = new Map(Object.entries(loadJson('assignments.json', {})))
function persistAssignments() { saveJson('assignments.json', Object.fromEntries(_assignments)) }

export function getAssignments(userId) {
  return _assignments.get(userId) || {}
}

export function assignResource(userId, resourceKey, projectId) {
  const cur = _assignments.get(userId) || {}
  cur[resourceKey] = projectId
  _assignments.set(userId, cur)
  persistAssignments()
  return cur
}

/* ---------- canvas graph: userId -> { [projectId]: { positions, edges } } ----------
   The editable CloudMap layout per project: node positions (keyed by resourceKey) and the
   user-drawn edges. Persisted so the canvas survives reloads. */
const _graphs = new Map(Object.entries(loadJson('graphs.json', {})))
function persistGraphs() { saveJson('graphs.json', Object.fromEntries(_graphs)) }

export function getGraph(userId, projectId) {
  const byProject = _graphs.get(userId) || {}
  const g = byProject[projectId] || {}
  // `nodes` = agent-designed (planned/deployed) service nodes the agent draws in Design mode.
  return { positions: g.positions || {}, edges: g.edges || [], nodes: g.nodes || [] }
}

export function saveGraph(userId, projectId, graph) {
  const cur = getGraph(userId, projectId)
  const byProject = _graphs.get(userId) || {}
  // Merge: the client PUT only sends positions+edges, so preserve agent-authored `nodes`.
  byProject[projectId] = {
    positions: graph?.positions ?? cur.positions,
    edges: graph?.edges ?? cur.edges,
    nodes: graph?.nodes ?? cur.nodes,
  }
  _graphs.set(userId, byProject)
  persistGraphs()
  return byProject[projectId]
}

/* ---------- agent ↔ canvas: design-node operations (used by the Design/Agent tools) ---------- */

/** Resolve the active project id, falling back to the user's first project. */
export function resolveProjectId(userId, projectId) {
  const list = getProjects(userId)
  return (list.find((p) => p.id === projectId) || list[0]).id
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const findNode = (g, ref) => g.nodes.find((n) => n.id === ref || n.name === ref || n.id === 'design:' + slug(ref))

/** Add a planned service node to the project canvas. Returns the created node. */
export function addGraphNode(userId, projectId, node) {
  const pid = resolveProjectId(userId, projectId)
  const g = getGraph(userId, pid)
  const base = 'design:' + (slug(node.name) || crypto.randomUUID().slice(0, 6))
  let id = base, i = 2
  while (g.nodes.some((n) => n.id === id)) id = `${base}-${i++}`
  const n = {
    id, cloud: node.cloud || 'aws', type: node.type || 'Service',
    name: node.name || id.replace('design:', ''), region: node.region || '',
    config: node.config || '', spec: (node.spec && typeof node.spec === 'object') ? node.spec : {},
    status: 'planned',
  }
  g.nodes.push(n)
  saveGraph(userId, pid, g)
  return n
}

/** Draw an edge between two existing nodes (referenced by id or name). */
export function connectGraphNodes(userId, projectId, fromRef, toRef) {
  const pid = resolveProjectId(userId, projectId)
  const g = getGraph(userId, pid)
  const from = findNode(g, fromRef), to = findNode(g, toRef)
  if (!from || !to) return { ok: false, error: `node not found: ${!from ? fromRef : toRef}` }
  const id = `${from.id}__${to.id}`
  if (!g.edges.some((e) => e.id === id)) g.edges.push({ id, source: from.id, target: to.id })
  saveGraph(userId, pid, g)
  return { ok: true, edge: { from: from.id, to: to.id } }
}

/** Remove a planned node (and its edges/position) from the canvas. */
export function removeGraphNode(userId, projectId, ref) {
  const pid = resolveProjectId(userId, projectId)
  const g = getGraph(userId, pid)
  const node = findNode(g, ref)
  if (!node) return { ok: false, error: `node not found: ${ref}` }
  g.nodes = g.nodes.filter((n) => n.id !== node.id)
  g.edges = g.edges.filter((e) => e.source !== node.id && e.target !== node.id)
  delete g.positions[node.id]
  saveGraph(userId, pid, g)
  return { ok: true, removed: node.id }
}

/** Update a node's editable fields (region/type/config) + service spec (instance size etc.). */
export function updateGraphNode(userId, projectId, ref, patch) {
  const pid = resolveProjectId(userId, projectId)
  const g = getGraph(userId, pid)
  const node = findNode(g, ref)
  if (!node) return { ok: false, error: `node not found: ${ref}` }
  if (patch.name) node.name = patch.name
  if (patch.cloud) node.cloud = patch.cloud        // re-point to a different provider (e.g. neon)
  if (patch.region) node.region = patch.region
  if (patch.type) node.type = patch.type
  if (patch.config !== undefined) node.config = patch.config
  if (patch.spec && typeof patch.spec === 'object') node.spec = patch.spec // REPLACE (repaint-safe)
  if (patch.status) node.status = patch.status
  if (patch.realName) node.realName = patch.realName
  saveGraph(userId, pid, g)
  return { ok: true, node }
}

/** Flip a planned node to deployed once the real resource has been provisioned.
 *  We DON'T rename the node (its id + label are the stable canvas identity that edges hang
 *  off of) — we record `realName` separately so the canvas can match this node to the live
 *  inventory row. Keeping the id stable is what keeps edges attached across deploy. */
export function markNodeDeployed(userId, projectId, ref, realName) {
  const pid = resolveProjectId(userId, projectId)
  const g = getGraph(userId, pid)
  const node = findNode(g, ref)
  if (!node) return { ok: false, error: `node not found: ${ref}` }
  node.status = 'deployed'
  if (realName) node.realName = realName
  saveGraph(userId, pid, g)
  return { ok: true, node }
}
