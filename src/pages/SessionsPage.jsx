/**
 * SessionsPage — a Kanban board of every Nimbus task across the project's machines, built on
 * @dnd-kit (sortable, accessible drag-and-drop). Cards drag within and across the
 * Running / Waiting-for-review / Done columns. "New task" dispatches a job to a chosen machine +
 * model; it runs async and lands as a card.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCorners,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDroppable } from '@dnd-kit/core'
import { I } from '../components/workspace/icons.jsx'
import { REPAIR_ACTIVE, fmtAgo } from '../components/workspace/sessionHelpers.jsx'
import { getRepairTasks, getRepairWorkers, dispatchRepair, setSessionColumn } from '../lib/api.js'

const COLUMNS = [
  { key: 'running', label: 'Running', ico: I.board, empty: 'Nothing running' },
  { key: 'review', label: 'Waiting for review', ico: I.check, empty: 'Nothing to review' },
  { key: 'done', label: 'Done', ico: I.check, empty: 'Nothing done yet' },
]

// Which column a conversation belongs in — live work is always Running; a manual drag wins otherwise.
function columnOf(c) {
  if (REPAIR_ACTIVE.has(c.status) || c.activeTaskId) return 'running'
  if (c.boardColumn) return c.boardColumn
  if (c.status === 'done' && c.result?.prUrl) return 'review'
  return 'done'
}
const isLive = (c) => !!(c && (c.activeTaskId || REPAIR_ACTIVE.has(c.status)))

function footerOf(c) {
  if (isLive(c)) return { ico: I.cloud, text: 'Working…', muted: true }
  if (c.status === 'done' && c.result?.prUrl) return { ico: I.cloud, text: 'PR is ready', pr: true }
  if (c.status === 'failed') return { ico: I.wrench, text: 'Failed' }
  if (c.status === 'stopped') return { ico: I.wrench, text: 'Stopped' }
  const ago = c.lastActive || c.createdAt
  return { ico: I.claude, text: ago ? `${fmtAgo(ago)} ago` : 'Done', done: true }
}

function CardInner({ c, overlay }) {
  const f = footerOf(c)
  return (
    <div className={'sb-card' + (overlay ? ' overlay' : '')}>
      {c.label && <div className="sb-card-label">{c.label}</div>}
      <div className="sb-card-title">{c.title || 'Task'}</div>
      {isLive(c) && <span className="sb-card-dot" />}
      <div className="sb-card-foot">
        <span className="sb-card-foot-ico">{f.ico({ width: 13, height: 13 })}</span>
        <span className={'sb-card-foot-tx' + (f.muted ? ' muted' : '') + (f.pr ? ' pr' : '')}>{f.text}</span>
        {c.result?.prUrl && <span className="sb-card-pr">{I.pr({ width: 12, height: 12 })}</span>}
      </div>
    </div>
  )
}

// A sortable card. Live cards (actively working) are pinned — not draggable.
function SortableCard({ c, onOpen }) {
  const live = isLive(c)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: c.id, disabled: live })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }
  // distinguish a click (open) from a drag — dnd-kit only fires listeners on an actual drag past the activation distance.
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...(live ? {} : listeners)}
      className={'sb-card-wrap' + (live ? ' live' : '')}
      onClick={() => { if (!isDragging) onOpen(c) }}>
      <CardInner c={c} />
    </div>
  )
}

function Column({ col, cards, onOpen }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'col:' + col.key })
  return (
    <div ref={setNodeRef} className={'sb-col' + (isOver ? ' over' : '')}>
      <div className="sb-col-head">
        <span className="sb-col-ico">{col.ico({ width: 15, height: 15 })}</span>
        <span className="sb-col-name">{col.label}</span>
        <span className="sb-col-n">{cards.length}</span>
      </div>
      <SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
        <div className="sb-col-body">
          {cards.length === 0
            ? <div className="sb-col-empty">{col.empty}</div>
            : cards.map(c => <SortableCard key={c.id} c={c} onOpen={onOpen} />)}
        </div>
      </SortableContext>
    </div>
  )
}

function NewTaskModal({ workers, online, busy, err, onRun, onClose }) {
  const [summary, setSummary] = useState('')
  const [worker, setWorker] = useState('')
  const [model, setModel] = useState('')
  return (
    <div className="cc-modal-scrim" onMouseDown={onClose}>
      <div className="cc-modal sb-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="cc-modal-title">{I.nimbus({ width: 20, height: 20 })} Assign a task to Nimbus</div>
        <div className="cc-modal-sub">Nimbus hands this to a connected machine, which drives its Claude Code to do the work and open a PR. It runs async — track it on the board.</div>
        <textarea className="sb-modal-input" autoFocus placeholder="Describe the task — e.g. “Add a learning-rate warmup phase” or “Widen the model hidden dimension”…" value={summary} onChange={e => setSummary(e.target.value)} />
        <div className="sb-modal-row">
          <label className="sb-modal-field">
            <span>Machine</span>
            <select value={worker} onChange={e => setWorker(e.target.value)}>
              <option value="">Any available machine</option>
              {(workers || []).map(w => <option key={w.workerId} value={w.workerId}>{w.host || w.workerId}</option>)}
            </select>
          </label>
          <label className="sb-modal-field">
            <span>Model</span>
            <select value={model} onChange={e => setModel(e.target.value)}>
              <option value="">Machine default</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </label>
        </div>
        <div className={'sb-modal-online' + (online ? ' on' : '')}><span className="cc-repair-dot" />{online ? `${online} machine${online > 1 ? 's' : ''} online` : 'No machine connected'}</div>
        {err && <div className="cc-modal-err">{err}</div>}
        <div className="cc-modal-foot">
          <div className="cc-composer-spacer" />
          <button className="cc-modal-btn ghost" onClick={onClose}>Cancel</button>
          <button className="cc-modal-btn primary" disabled={!summary.trim() || busy} onClick={() => onRun({ summary: summary.trim(), worker, model })}>{busy ? 'Dispatching…' : 'Assign task'}</button>
        </div>
      </div>
    </div>
  )
}

export function SessionsPage() {
  const { project, openConnectModal } = useOutletContext()
  const navigate = useNavigate()
  const [convs, setConvs] = useState(null)
  const [workers, setWorkers] = useState([])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // board = { running:[ids], review:[ids], done:[ids] } — the live, drag-mutated ordering.
  const [board, setBoard] = useState({ running: [], review: [], done: [] })
  const [activeId, setActiveId] = useState(null) // card being dragged (for the overlay)
  const draggingRef = useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // small threshold so clicks still open
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Rented machines are NOT tasks — they live in the left sidebar (Rent a machine), not on this board.
  const load = () => getRepairTasks(project?.id).then(r => setConvs(r?.conversations || [])).catch(() => setConvs([]))
  const loadWorkers = () => getRepairWorkers(project?.id).then(r => setWorkers(r?.workers || [])).catch(() => {})
  useEffect(() => {
    if (!project?.id) { setConvs([]); return }
    setConvs(null); load(); loadWorkers()
    const t = setInterval(() => { if (!draggingRef.current) { load(); loadWorkers() } }, 4000) // pause mid-drag
    return () => clearInterval(t)
  }, [project?.id])

  const online = workers.length

  // index conversations into a lookup + an enriched card map
  const cardMap = useMemo(() => {
    const m = new Map()
    for (const c of convs || []) {
      m.set(c.id, {
        ...c,
        label: c.machineName || (workers.find(w => w.workerId === c.machineId)?.host) || c.repo?.split('/')?.pop() || project?.name || '',
      })
    }
    return m
  }, [convs, workers, project?.name])

  // Rebuild the board layout from server data whenever it changes (but never mid-drag).
  useEffect(() => {
    if (draggingRef.current || convs === null) return
    const next = { running: [], review: [], done: [] }
    for (const c of [...cardMap.values()].sort((a, z) => (z.lastActive || 0) - (a.lastActive || 0))) {
      next[columnOf(c)].push(c.id)
    }
    setBoard(next)
  }, [cardMap, convs])

  const ql = q.trim().toLowerCase()
  const visible = (id) => {
    const c = cardMap.get(id); if (!c) return false
    if (!ql) return true
    return ((c.title || '') + ' ' + (c.label || '')).toLowerCase().includes(ql)
  }
  const colCards = (key) => (board[key] || []).filter(visible).map(id => cardMap.get(id)).filter(Boolean)
  const total = COLUMNS.reduce((n, col) => n + colCards(col.key).length, 0)

  const openCard = (c) => navigate(`/app/repair?c=${encodeURIComponent(c.id)}`)

  // ── dnd-kit handlers ──
  const containerOf = (id) => {
    if (id in board) return id // dropped over a column droppable id directly
    if (typeof id === 'string' && id.startsWith('col:')) return id.slice(4)
    return Object.keys(board).find(k => board[k].includes(id))
  }
  const onDragStart = ({ active }) => { draggingRef.current = true; setActiveId(active.id) }
  const onDragOver = ({ active, over }) => {
    if (!over) return
    const from = containerOf(active.id)
    const to = containerOf(over.id)
    if (!from || !to || from === to) return
    setBoard(prev => {
      const fromIds = prev[from].filter(x => x !== active.id)
      const overIdx = prev[to].indexOf(over.id)
      const toIds = [...prev[to]]
      toIds.splice(overIdx >= 0 ? overIdx : toIds.length, 0, active.id)
      return { ...prev, [from]: fromIds, [to]: toIds }
    })
  }
  const onDragEnd = ({ active, over }) => {
    draggingRef.current = false
    setActiveId(null)
    if (!over) { load(); return }
    const from = Object.keys(board).find(k => board[k].includes(active.id))
    const to = containerOf(over.id)
    if (!from || !to) return
    if (from === to) {
      const oldIdx = board[from].indexOf(active.id)
      const newIdx = board[to].indexOf(over.id)
      if (oldIdx !== newIdx && newIdx >= 0) setBoard(prev => ({ ...prev, [from]: arrayMove(prev[from], oldIdx, newIdx) }))
      return
    }
    setSessionColumn(project?.id, active.id, to).catch(() => load()) // persist the column move
  }
  const onDragCancel = () => { draggingRef.current = false; setActiveId(null) }

  const run = async ({ summary, worker, model }) => {
    if (!project) return
    setBusy(true); setErr('')
    try {
      const d = await dispatchRepair(project.id, { summary, service: project.name, severity: 'task' }, worker || undefined, model || undefined)
      if (!d.ok) {
        setErr(d.reason === 'no-worker' ? 'No machine connected — connect one first.' : d.reason === 'machine-offline' ? 'That machine went offline — pick another.' : d.reason === 'no-repo' ? 'No repo connected to this project.' : 'Could not dispatch.')
        setBusy(false); return
      }
      setBusy(false); setModal(false); load()
    } catch { setErr('Could not dispatch the task.'); setBusy(false) }
  }

  const activeCard = activeId ? cardMap.get(activeId) : null

  return (
    <div className="cc-dash sb-wrap">
      <header className="sb-top">
        <div className="sb-top-l">
          <h2 className="sb-title">Sessions</h2>
          <span className="sb-count">{total}</span>
        </div>
        <div className="sb-top-r">
          <div className="sb-search">{I.search({ width: 14, height: 14 })}<input placeholder="Search sessions" value={q} onChange={e => setQ(e.target.value)} /></div>
          <button className="cc-modal-btn primary sb-new" onClick={() => { setErr(''); setModal(true) }}>{I.plus({ width: 14, height: 14 })} New task</button>
        </div>
      </header>

      <div className="sb-filters">
        {[['all', 'All'], ['running', 'Running'], ['review', 'Waiting for review'], ['done', 'Done']].map(([k, l]) => (
          <button key={k} className={'sb-filter' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l}</button>
        ))}
        <div className="sb-filters-spacer" />
        <button className={'sb-roster' + (online ? ' on' : '')} onClick={openConnectModal}><span className="cc-repair-dot" />{online ? `${online} online` : 'Connect a machine'}</button>
      </div>

      {convs === null ? (
        <div className="sb-empty">Loading sessions…</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners}
          onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
          <div className="sb-board">
            {COLUMNS.filter(col => filter === 'all' || filter === col.key).map(col => (
              <Column key={col.key} col={col} cards={colCards(col.key)} onOpen={openCard} />
            ))}
          </div>
          <DragOverlay>{activeCard ? <CardInner c={activeCard} overlay /> : null}</DragOverlay>
        </DndContext>
      )}

      {modal && <NewTaskModal workers={workers} online={online} busy={busy} err={err} onRun={run} onClose={() => setModal(false)} />}
    </div>
  )
}
