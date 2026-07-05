/**
 * AppShell — the far-left icon rail + shared layout for the whole workspace. Holds the project
 * roster, the connect-repo / connect-machine modals, the ⌘K command palette and the About modal,
 * and renders the active routed section via <Outlet> with a shared context.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import WelcomeTour, { hasSeenWelcome } from '../components/common/WelcomeTour.jsx'
import { CloudDataProvider, useCloudData } from '../lib/useCloudData.js'
import { I, initials } from '../components/workspace/icons.jsx'
import { RepoModal } from '../components/workspace/FilesExplorer.jsx'
import { ConnectMachineModal } from '../components/workspace/ConnectMachineModal.jsx'
import { SearchPalette } from '../components/workspace/SearchPalette.jsx'
import { getRepairWorkers, setProjectRepo, pullRepo } from '../lib/api.js'
import '../styles/workspace.css'
import '../styles/codechat.css'

// Where the docs live: in dev the Fumadocs site runs on its own port; in production it's the
// docs.<root-domain> subdomain served by the same server (see server/server.mjs).
function docsUrl() {
  const { hostname, protocol } = window.location
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:3400/docs'
  const root = hostname.replace(/^(app|www)\./, '')
  return `${protocol}//docs.${root}`
}

function AppShellInner() {
  const navigate = useNavigate()
  const auth = useAuth()
  const user = auth?.user
  const userName = user?.name || user?.email?.split('@')[0] || 'You'

  const { projects, activeProject, setActiveProject, createProject, loadProjects, overview, refresh } = useCloudData()
  const project = activeProject
  const repo = project?.repo || null

  const [projOpen, setProjOpen] = useState(false)
  const [repoModal, setRepoModal] = useState(false)
  const [connectModal, setConnectModal] = useState(false)
  const [machines, setMachines] = useState([])
  const [graphTick, setGraphTick] = useState(0)
  const [showTour, setShowTour] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [openTarget, setOpenTarget] = useState(null) // {kind:'channel'|'chat', id, n} — from the search palette

  // ⌘K / Ctrl-K opens the command palette anywhere in the app.
  useEffect(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true) } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])

  // First-run welcome tour — auto-open once per user the first time they reach the workspace.
  useEffect(() => {
    if (user?.id && !hasSeenWelcome(user.id)) setShowTour(true)
  }, [user?.id])

  // Poll the connected-machine roster (shared by Chat's Computers rail + Repair's machine picker).
  useEffect(() => {
    if (!project?.id) return
    const load = () => getRepairWorkers(project.id).then(r => setMachines(r?.workers || [])).catch(() => {})
    load(); const t = setInterval(load, 5000); return () => clearInterval(t)
  }, [project?.id])

  const saveRepo = async (r) => {
    if (!project) return
    try { await setProjectRepo(project.id, r); await loadProjects(); setRepoModal(false); pullRepo(project.id, true).catch(() => {}) }
    catch { /* ignore */ }
  }
  const switchProject = (id) => { setActiveProject(id); setProjOpen(false) }
  const logout = async () => { try { await auth?.logout?.() } finally { window.location.assign('/login') } }

  const ctx = {
    project, projects, switchProject, createProject, projOpen, setProjOpen, repo, machines,
    openRepoModal: () => setRepoModal(true), openConnectModal: () => setConnectModal(true),
    saveRepo, refresh, overview, graphTick, bumpGraph: () => setGraphTick(t => t + 1), userName, navigate, openTarget,
  }

  const rail = (to, icon, label) => (
    <NavLink to={to} data-tip={label} className={({ isActive }) => 'cc-rail-ico' + (isActive ? ' on' : '')}>{icon}</NavLink>
  )

  // Hover tooltip for the rail — rendered in a body PORTAL (position:fixed) so it's never clipped,
  // placed just right of the hovered icon. Text comes from each item's data-tip attribute.
  const [railTip, setRailTip] = useState(null)
  const onRailOver = (e) => {
    const el = e.target.closest?.('[data-tip]')
    if (!el) { setRailTip(null); return }
    const r = el.getBoundingClientRect()
    setRailTip({ text: el.getAttribute('data-tip'), x: Math.round(r.right + 10), y: Math.round(r.top + r.height / 2) })
  }

  return (
    <div className="ws cc">
      {railTip && createPortal(<div className="cc-tip-float" style={{ left: railTip.x, top: railTip.y }}>{railTip.text}</div>, document.body)}
      {/* ── far-left icon rail (replaces the old Dashboard⇄Code toggle) ── */}
      <div className="cc-rail" onMouseOver={onRailOver} onMouseOut={() => setRailTip(null)}>
        <button className="cc-rail-ws" data-tip="Nimbus">{I.nimbus({ width: 24, height: 24 })}</button>
        <button className="cc-rail-ico" data-tip="Search (⌘K)" onClick={() => setSearchOpen(true)}>{I.search({ width: 17, height: 17 })}</button>
        {rail('/app/chat', I.chat(), 'Chat, channels & machines')}
        {rail('/app/canvas', I.layout(), 'Canvas — architecture')}
        {rail('/app/files', I.doc(), 'Code & files')}
        {rail('/app/sessions', I.board(), 'Sessions — task board')}
        {rail('/app/repair', I.wrench(), 'Repairs')}
        <div className="cc-rail-div" />
        {rail('/app/overview', I.grid(), 'Overview')}
        {rail('/app/resources', I.server(), 'Resources')}
        {rail('/app/cost', I.coin(), 'Cost')}
        {rail('/app/connections', I.plug(), 'Connections')}
        {rail('/app/members', I.people(), 'Members & access')}
        <div className="cc-rail-spacer" />
        <a className="cc-rail-ico" href={docsUrl()} target="_blank" rel="noreferrer" data-tip="Docs ↗">{I.book()}</a>
        <button className="cc-rail-ico cc-rail-about" onClick={() => setShowTour(true)} data-tip="About Nimbus — how it works">{I.nimbus({ width: 22, height: 22 })}</button>
        <button className="cc-rail-ico" data-tip="Back to site" onClick={() => navigate('/')}>↩</button>
        <button className="cc-rail-ico logout" data-tip="Log out" onClick={logout}>⏻</button>
        <span className="cc-rail-me" data-tip={userName}>{initials(userName)}</span>
      </div>

      <Outlet context={ctx} />

      {repoModal && <RepoModal current={repo} onClose={() => setRepoModal(false)} onSave={saveRepo} />}
      {connectModal && <ConnectMachineModal projectId={project?.id} onClose={() => setConnectModal(false)} />}
      {showTour && <WelcomeTour userId={user?.id} onClose={() => setShowTour(false)} />}
      {searchOpen && <SearchPalette project={project} navigate={navigate} onTarget={setOpenTarget} onClose={() => setSearchOpen(false)} />}
    </div>
  )
}

export default function AppShell() {
  return (
    <CloudDataProvider>
      <AppShellInner />
    </CloudDataProvider>
  )
}

/* Wraps a dashboard section (Overview / Resources / Cost / Connections) so it fills the area
 * to the right of the rail with its own scroll. */
export function DashPanel({ children }) {
  return <div className="cc-dash">{children}</div>
}