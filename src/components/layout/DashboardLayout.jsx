import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { ChevronDown } from '../common/Icons.jsx'
import CloudMap from './CloudMap.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { CloudDataProvider, useCloudData } from '../../lib/useCloudData.js'
import '../../styles/workspace.css'

// Initials for a project avatar (first two letters of its name).
function projInitials(name) {
  return (name || '?').replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
}

// Horizontal mono-caps tabs (replace the old left sidebar nav).
const TABS = [
  { to: '/app/chat',         label: 'Chat' },
  { to: '/app/overview',     label: 'Overview' },
  { to: '/app/resources',    label: 'Resources' },
  { to: '/app/cost',         label: 'Cost' },
  { to: '/app/connections',  label: 'Connections' },
]

function Shell() {
  const [projOpen, setProjOpen] = useState(false)
  const [newName, setNewName] = useState(null) // null = modal closed; string = open
  const [newRepo, setNewRepo] = useState('')   // optional GitHub repo bound to the new project
  const [creating, setCreating] = useState(false)
  const [graphTick, setGraphTick] = useState(0) // bumped after an agent turn → canvas reloads its design
  const navigate = useNavigate()
  const auth = useAuth()
  const {
    overview, refresh,
    projects, activeProject, setActiveProject, createProject,
  } = useCloudData()

  // The selected PROJECT (workspace). Resources are already scoped to it server-side.
  const project = activeProject
  const resources = overview?.resources || []
  const cloudCount = overview?.connections?.length ?? Object.keys(overview?.clouds || {}).length ?? 0

  // Full reload to /login so no stale app state survives the logout.
  const logout = async () => { try { await auth.logout() } finally { window.location.assign('/login') } }
  const avatarInitials = projInitials(project?.name)

  const openNewProject = () => { setProjOpen(false); setNewName(''); setNewRepo('') }
  const submitNewProject = async () => {
    const name = (newName || '').trim()
    if (!name) return
    const repo = (newRepo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '')
    setCreating(true)
    try { await createProject(name, repo || null); setNewName(''); setNewRepo(''); setNewName(null) }
    catch (e) { setNewName(null) }
    finally { setCreating(false) }
  }

  return (
    <div className="ws">
      {/* ───────── LEFT: cloud map canvas ───────── */}
      <section className="ws-left">
        <header className="ws-top">
          <div className="ws-top-left">
            <div className="ws-wsbtn" onClick={() => setProjOpen(o => !o)}>
              <span className="ws-ws-av">{avatarInitials}</span>
              <ChevronDown size={13} />
              {projOpen && (
                <div className="ws-proj-menu" onClick={e => e.stopPropagation()}>
                  <div className="ws-proj-lbl">PROJECTS</div>
                  {projects.map(p => (
                    <div key={p.id}
                      className={'ws-proj-row' + (p.id === project?.id ? ' on' : '')}
                      onClick={() => { setActiveProject(p.id); setProjOpen(false) }}>
                      <span className="ws-proj-av">{projInitials(p.name)}</span>
                      <span className="ws-proj-nm">{p.name}</span>
                      {p.id === project?.id && <span className="ws-proj-ck">✓</span>}
                    </div>
                  ))}
                  <div className="ws-proj-row ws-proj-new" onClick={openNewProject}>
                    <span className="ws-proj-av">+</span>
                    <span className="ws-proj-nm">New project</span>
                  </div>
                </div>
              )}
            </div>
            <span className="ws-proj-title">{project?.name || 'No project'}</span>
            <button className="ws-code-toggle" onClick={() => navigate('/code')}
              title="Open the Code workspace — chat with @nimbus about your repo">
              <span className="ws-code-lbl">Code</span>
              <span className="ws-code-switch"><span className="ws-code-dot" /></span>
            </button>
          </div>
        </header>

        <div className="ws-canvas-wrap">
          <CloudMap project={project} resources={resources} graphTick={graphTick} />
        </div>

        <div className="ws-statusbar">
          ● {cloudCount} CLOUD{cloudCount === 1 ? '' : 'S'} › {resources.length} RESOURCE{resources.length === 1 ? '' : 'S'} › READINESS
        </div>
      </section>

      {/* ───────── RIGHT: tabbed panel ───────── */}
      <aside className="ws-right">
        <nav className="ws-tabs">
          {TABS.map(t => (
            <NavLink key={t.to} to={t.to}
              className={({ isActive }) => 'ws-tab' + (isActive ? ' on' : '')}>
              {t.label}
            </NavLink>
          ))}
          <div className="ws-tabs-spacer" />
          <button className="ws-tab-act" onClick={() => navigate('/')} title="Back to site (stays signed in)">↩</button>
          <button className="ws-tab-act logout" onClick={logout} title="Log out">⏻</button>
        </nav>
        <div className="ws-panel-body">
          <Outlet context={{ project, refresh, bumpGraph: () => setGraphTick(t => t + 1) }} />
        </div>
      </aside>

      {/* themed "new project" modal (replaces the native window.prompt) */}
      {newName !== null && (
        <div className="ws-modal-overlay" onClick={() => setNewName(null)}>
          <div className="ws-modal" onClick={e => e.stopPropagation()}>
            <div className="ws-modal-title">New project</div>
            <div className="ws-modal-sub">A workspace for the resources your agent builds — and the repo the Code tab discusses.</div>
            <input
              className="ws-modal-input"
              autoFocus
              placeholder="Project name — e.g. Acme Production"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitNewProject(); if (e.key === 'Escape') setNewName(null) }}
            />
            <input
              className="ws-modal-input"
              style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
              placeholder="GitHub repo (optional) — owner/repo"
              value={newRepo}
              onChange={e => setNewRepo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitNewProject(); if (e.key === 'Escape') setNewName(null) }}
            />
            <div className="ws-modal-actions">
              <button className="ws-modal-btn ghost" onClick={() => setNewName(null)}>Cancel</button>
              <button className="ws-modal-btn primary" disabled={!newName.trim() || creating} onClick={submitNewProject}>
                {creating ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DashboardLayout() {
  return (
    <CloudDataProvider>
      <Shell />
    </CloudDataProvider>
  )
}
