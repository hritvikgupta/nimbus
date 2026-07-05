// Tiny fetch helpers for the Nimbus backend (auth + connections).
// All requests send cookies so the httpOnly session cookie rides along.

// The active project id — shared with the server so cloud data (clouds/resources/cost) resolves to
// the PROJECT (its owner), since everything in a shared project is shared.
function activeProjectId() { try { return localStorage.getItem('nimbus.activeProject') || '' } catch { return '' } }

async function request(path, { method = 'GET', body } = {}) {
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  const pid = activeProjectId()
  if (pid) headers['x-nimbus-project'] = pid
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { data = null }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `Request failed (${res.status})`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

/* ---------- auth ---------- */
export const authApi = {
  me: () => request('/api/auth/me'),
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  signup: (email, password, name, org) => request('/api/auth/signup', { method: 'POST', body: { email, password, name, org } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  completeOnboarding: (org) => request('/api/auth/onboarded', { method: 'POST', body: { org } }),
}

/* ---------- connections ---------- */
export const connectionsApi = {
  list: () => request('/api/connections'),
  connect: (cloud, grant = {}) => request('/api/connections/connect', { method: 'POST', body: { cloud, ...grant } }),
  disconnect: (cloud) => request('/api/connections/disconnect', { method: 'POST', body: { cloud } }),
}

/* ---------- projects (workspaces) ---------- */
export const getProjects = () => request('/api/projects')
export const createProject = (name, repo) => request('/api/projects', { method: 'POST', body: { name, repo } })
export const setProjectRepo = (id, repo) => request(`/api/projects/${encodeURIComponent(id)}/repo`, { method: 'PUT', body: { repo } })
export const getGraph = (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/graph`)
export const saveGraph = (projectId, graph) =>
  request(`/api/projects/${encodeURIComponent(projectId)}/graph`, { method: 'PUT', body: graph })
export const updateNode = (projectId, nodeId, patch) =>
  request(`/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`, { method: 'PATCH', body: patch })
export const deleteNode = (projectId, nodeId) =>
  request(`/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`, { method: 'DELETE' })
// Catalog-backed config fields (real MCP options) + live cost for a service.
export const getSpec = (body) => request('/api/spec', { method: 'POST', body })
// Live config of a deployed resource, read from the cloud via the MCP.
export const getLiveConfig = (body) => request('/api/resource/live', { method: 'POST', body })
// Live performance metrics (CloudWatch / Cloud Monitoring) for a deployed resource.
export const getTelemetry = (body) => request('/api/resource/telemetry', { method: 'POST', body })
// Live logs tail across connected clouds (CloudWatch Logs / Cloud Logging).
export const getLogs = (params = {}) => request('/api/logs?' + new URLSearchParams(params).toString())
// GitHub repos (via Composio) for the onboarding picker + repo analysis (Repomix).
export const getGithubRepos = () => request('/api/github/repos')
export const analyzeRepo = (repo) => request('/api/code/analyze', { method: 'POST', body: { repo } })
// Real analysis structure (services / clouds / datastores / languages) for the onboarding map.
export const getRepoSummary = (repo) => request('/api/code/summary' + (repo ? `?repo=${encodeURIComponent(repo)}` : ''))
// Warm the config catalog for all node service types (background, fire-and-forget).
export const prefetchCatalog = () => request('/api/catalog/prefetch', { method: 'POST' })

/* ---------- cloud data (per-user real state, scoped to the active project) ---------- */
export const getOverview = (projectId) =>
  request('/api/overview' + (projectId ? `?project=${encodeURIComponent(projectId)}` : ''))
export const getResources = (projectId) =>
  request('/api/resources' + (projectId ? `?project=${encodeURIComponent(projectId)}` : ''))
export const getCost = () => request('/api/cost')

/* ---------- chat sessions ---------- */
export const listChats = () => request('/api/chats')
export const createChat = (title) => request('/api/chats', { method: 'POST', body: { title } })
export const getChat = (id) => request(`/api/chats/${encodeURIComponent(id)}`)
export const saveChat = (id, patch) => request(`/api/chats/${encodeURIComponent(id)}`, { method: 'PUT', body: patch })
export const deleteChat = (id) => request(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' })
/* ---------- code-chat workspace (Slack/hilos-style team space) ---------- */
const pq = (projectId) => '?projectId=' + encodeURIComponent(projectId || '')
export const getWorkspace = (projectId) => request('/api/workspace' + pq(projectId))
export const createChannel = (projectId, name) => request('/api/workspace/channels', { method: 'POST', body: { projectId, name } })
export const deleteChannel = (projectId, id) => request(`/api/workspace/channels/${encodeURIComponent(id)}` + pq(projectId), { method: 'DELETE' })
export const getChannelMessages = (projectId, id) => request(`/api/workspace/channels/${encodeURIComponent(id)}/messages` + pq(projectId))
export const saveChannelMessages = (projectId, id, messages) =>
  request(`/api/workspace/channels/${encodeURIComponent(id)}/messages`, { method: 'PUT', body: { projectId, messages } })
// Code-editor view: pull (clone) the active project's repo, read a file, check clone state.
export const pullRepo = (projectId, force = false) => request('/api/workspace/pull', { method: 'POST', body: { projectId, force } })
export const getRepoFile = (projectId, path) =>
  request('/api/workspace/file?projectId=' + encodeURIComponent(projectId || '') + '&path=' + encodeURIComponent(path))
export const getCloneState = (projectId) => request('/api/workspace/clone-state?projectId=' + encodeURIComponent(projectId || ''))
// GitHub (Composio) connect — start OAuth + poll status (so the repo picker can list your repos).
export const composioStatus = () => request('/api/connections/composio/status?fresh=1')
export const composioAuthorize = (toolkit = 'github') =>
  request('/api/connections/composio/authorize', { method: 'POST', body: { toolkit } })

/* ---------- rented compute (Fly machine catalog — read-only, for the "Rent a machine" modal) ---------- */
export const getFlyMachines = () => request('/api/fly/machines')
export const getRentals = (projectId) => request('/api/rentals?projectId=' + encodeURIComponent(projectId || ''))
export const createRental = (projectId, body) => request('/api/rentals', { method: 'POST', body: { projectId, ...body } })
export const stopRental = (projectId, id) => request('/api/rentals/' + encodeURIComponent(id), { method: 'PATCH', body: { projectId, status: 'stopped' } })
export const rentalChat = (projectId, id, message) => request('/api/rentals/' + encodeURIComponent(id) + '/chat', { method: 'POST', body: { projectId, message } })
export const getRentalModels = (projectId, id) => request('/api/rentals/' + encodeURIComponent(id) + '/models?projectId=' + encodeURIComponent(projectId || ''))
export const getSummaries = (projectId) => request('/api/summaries?projectId=' + encodeURIComponent(projectId || ''))
export const getAgentModels = (agent) => request('/api/agent-models?agent=' + encodeURIComponent(agent || 'claude'))
// Subscription-login (OAuth) for agents that don't use an API key (Claude Code).
export const getOAuthAgents = () => request('/api/rentals/oauth/agents')
export const startAgentOAuth = (agent) => request('/api/rentals/oauth/start', { method: 'POST', body: { agent } })
export const exchangeAgentOAuth = (oauthId, code) => request('/api/rentals/oauth/exchange', { method: 'POST', body: { oauthId, code } })

/* ---------- universal search (command palette) ---------- */
export const search = (q, projectId) =>
  request('/api/search?q=' + encodeURIComponent(q) + '&projectId=' + encodeURIComponent(projectId || ''))

/* ---------- project members (shared projects) ---------- */
export const getProjectMembers = (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/members`)
export const inviteProjectMember = (projectId, email) =>
  request(`/api/projects/${encodeURIComponent(projectId)}/members`, { method: 'POST', body: { email } })
export const removeProjectMember = (projectId, userId) =>
  request(`/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' })
export const setMemberPerms = (projectId, userId, perms) =>
  request(`/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: { perms } })
export const deleteProject = (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' })

/* ---------- shared-compute repair (project-scoped) ---------- */
export const getRepairWorkers = (projectId) => request('/api/repair/workers?projectId=' + encodeURIComponent(projectId || ''))
export const forgetMachine = (projectId, workerId) => request('/api/repair/workers/' + encodeURIComponent(workerId) + '?projectId=' + encodeURIComponent(projectId || ''), { method: 'DELETE' })
export const getRepairTasks = (projectId) => request('/api/repair/tasks' + (projectId ? '?projectId=' + encodeURIComponent(projectId) : ''))
export const dispatchRepair = (projectId, incident, workerId, model) =>
  request('/api/repair/dispatch', { method: 'POST', body: { projectId, incident, workerId, model } })
// Direct machine session — talk to a chosen machine's Claude (no Nimbus agent in the loop).
export const startMachineSession = (projectId, workerId, message, model) =>
  request('/api/repair/session', { method: 'POST', body: { projectId, workerId, message, model } })
export const compactSession = (taskId) => request(`/api/repair/tasks/${encodeURIComponent(taskId)}/compact`, { method: 'POST' })
export const resumeMachineSession = (projectId, resumeId, message, model) =>
  request('/api/repair/session', { method: 'POST', body: { projectId, resumeId, message, model } })
export const listMachineSessions = (projectId, workerId) =>
  request('/api/repair/sessions?projectId=' + encodeURIComponent(projectId || '') + '&workerId=' + encodeURIComponent(workerId || ''))
export const getMachineSession = (projectId, id) => request('/api/repair/sessions/' + encodeURIComponent(id) + '?projectId=' + encodeURIComponent(projectId || ''))
export const getRepairConversation = (projectId, id) => request('/api/repair/conversations/' + encodeURIComponent(id) + '?projectId=' + encodeURIComponent(projectId || ''))
// Move a card across the Sessions board (running | review | done).
export const setSessionColumn = (projectId, id, column) =>
  request('/api/repair/conversations/' + encodeURIComponent(id), { method: 'PATCH', body: { projectId, column } })
export const stopRepair = (taskId) => request(`/api/repair/tasks/${encodeURIComponent(taskId)}/stop`, { method: 'POST' })
export const messageRepair = (taskId, text) => request(`/api/repair/tasks/${encodeURIComponent(taskId)}/message`, { method: 'POST', body: { text } })
// worker API keys (connect a machine to a PROJECT — visible to all members)
export const listWorkerKeys = (projectId) => request('/api/repair/keys?projectId=' + encodeURIComponent(projectId || ''))
export const createWorkerKey = (projectId, label) => request('/api/repair/keys', { method: 'POST', body: { projectId, label } })
export const revokeWorkerKey = (projectId, id) => request(`/api/repair/keys/${encodeURIComponent(id)}?projectId=` + encodeURIComponent(projectId || ''), { method: 'DELETE' })

export const getConnections = () => request('/api/connections')
export const connectCloud = (cloud, body = {}) => request('/api/connections/connect', { method: 'POST', body: { cloud, ...body } })
export const disconnectCloud = (cloud) => request('/api/connections/disconnect', { method: 'POST', body: { cloud } })
