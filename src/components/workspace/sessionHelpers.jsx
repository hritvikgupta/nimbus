/* Shared helpers for the repair + machine-session views. */
import { useState } from 'react'

export const REPAIR_STATUS = { pending: 'queued', dispatched: 'dispatched', running: 'running', stopping: 'stopping', stopped: 'stopped', done: 'done', failed: 'failed' }
export const REPAIR_ACTIVE = new Set(['pending', 'dispatched', 'running', 'stopping'])
export const fmtAgo = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h` }

export const WORK_PHASES = new Set(['think', 'tool', 'clone', 'analyze', 'queued', 'push', 'done', 'stopped', 'error'])
export function foldSession(steps) {
  const msgs = []; let work = []
  for (const s of steps || []) {
    if (s.phase === 'meta') continue
    if (s.phase === 'control') {
      const m = (s.text || '').match(/→ Claude:\s*([\s\S]*)$/)
      if (m) msgs.push({ role: 'user', text: m[1] })            // a message we sent into the session
      else work.push({ ...s, note: true })                       // system note (compact, stop…)
    } else if (s.phase === 'claude') {
      const w = work.filter(x => !(x.phase === 'think' && x.text === s.text)) // drop the duplicated final think
      msgs.push({ role: 'assistant', text: s.text, work: w }); work = []
    } else if (WORK_PHASES.has(s.phase)) {
      work.push(s)
    }
  }
  return { msgs, pendingWork: work }
}

export function WorkTimeline({ items, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!items?.length) return null
  return (
    <div className="cc-work">
      <button className="cc-work-toggle" onClick={() => setOpen(o => !o)}>{open ? '▾' : '▸'} {items.length} step{items.length > 1 ? 's' : ''}</button>
      {open && items.map((s, i) => (
        <div className={'cc-work-row ' + (s.phase || '')} key={i}><span className="cc-work-ph">{s.phase}</span><span className="cc-work-tx">{s.text}</span></div>
      ))}
    </div>
  )
}