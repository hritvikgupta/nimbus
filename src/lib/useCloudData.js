import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { getOverview, getProjects as fetchProjects, createProject as apiCreateProject, prefetchCatalog } from './api.js'

// Shared per-user state. A PROJECT is a user workspace (not a cloud); a user has many.
// The overview (connections + clouds + kpis + resources) is scoped to the ACTIVE project
// server-side. Switching the active project refetches the overview for that project.

const CloudDataContext = createContext(null)

// Active project is shared with the standalone /code page (outside this provider) via localStorage.
export const ACTIVE_PROJECT_KEY = 'nimbus.activeProject'
const readActiveProject = () => { try { return localStorage.getItem(ACTIVE_PROJECT_KEY) } catch { return null } }

function useCloudDataInternal() {
  const [projects, setProjects] = useState([])
  const [activeProjectId, setActiveProjectId] = useState(readActiveProject())
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Load the user's projects (auto-creates a default server-side). Default active = first.
  const loadProjects = useCallback(async () => {
    try {
      const data = await fetchProjects()
      const list = data?.projects || []
      setProjects(list)
      setActiveProjectId((cur) => (cur && list.some((p) => p.id === cur) ? cur : (list[0]?.id || null)))
      return list
    } catch (e) {
      setError(e?.message || 'Failed to load your projects.')
      return []
    }
  }, [])

  // Fetch the overview scoped to the active project. Server claims new resources to it.
  const refresh = useCallback(async (projectId) => {
    const pid = projectId ?? activeProjectId
    if (!pid) return
    setLoading(true)
    setError('')
    try {
      setOverview(await getOverview(pid))
    } catch (e) {
      setError(e?.message || 'Failed to load your cloud data.')
    } finally {
      setLoading(false)
    }
  }, [activeProjectId])

  const setActiveProject = useCallback((id) => setActiveProjectId(id), [])

  const createProject = useCallback(async (name, repo) => {
    const data = await apiCreateProject(name, repo)
    setProjects(data?.projects || [])
    if (data?.project?.id) setActiveProjectId(data.project.id)
    return data?.project || null
  }, [])

  // Persist the active project so the standalone Code page binds to the same one.
  useEffect(() => { try { if (activeProjectId) localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId) } catch { /* ignore */ } }, [activeProjectId])
  // Bootstrap projects once.
  useEffect(() => { loadProjects() }, [loadProjects])
  // Warm the config catalog once a cloud is connected (background prefetch, one time).
  const warmed = useRef(false)
  useEffect(() => {
    if (warmed.current) return
    if (overview && (overview.connections?.length)) { warmed.current = true; prefetchCatalog().catch(() => {}) }
  }, [overview])
  // Refetch overview whenever the active project changes.
  useEffect(() => { if (activeProjectId) refresh(activeProjectId) }, [activeProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeProject = projects.find((p) => p.id === activeProjectId) || null

  return {
    overview, loading, error, refresh, loadProjects,
    projects, activeProjectId, activeProject, setActiveProject, createProject,
  }
}

export function CloudDataProvider({ children }) {
  const value = useCloudDataInternal()
  return createElement(CloudDataContext.Provider, { value }, children)
}

export function useCloudData() {
  const ctx = useContext(CloudDataContext)
  if (!ctx) throw new Error('useCloudData must be used within a CloudDataProvider')
  return ctx
}
