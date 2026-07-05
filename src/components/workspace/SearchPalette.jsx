import { useEffect, useRef, useState } from 'react'
import { search as apiSearch } from '../../lib/api.js'
import { I } from './icons.jsx'

export function SearchPalette({ project, navigate, onTarget, onClose }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [sel, setSel] = useState(0)
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    clearTimeout(timer.current)
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    timer.current = setTimeout(() => {
      apiSearch(q.trim(), project?.id).then(r => { setResults(r?.results || []); setSel(0) }).catch(() => setResults([])).finally(() => setLoading(false))
    }, 180)
    return () => clearTimeout(timer.current)
  }, [q, project?.id])

  const iconFor = (k) => k === 'resource' ? I.server({ width: 15, height: 15 }) : k.startsWith('chat') ? I.nimbus({ width: 16, height: 16 }) : I.hash({ width: 15, height: 15 })
  const open = (r) => {
    if (!r) return
    if (r.kind === 'resource') navigate(`/app/resources/${encodeURIComponent(r.id)}`)
    else {
      const kind = (r.kind === 'chat' || r.kind === 'chat-msg') ? 'chat' : 'channel'
      onTarget?.({ kind, id: r.id, n: Date.now() }) // reactive — works even when already on /app/channels
      navigate('/app/channels')
    }
    onClose()
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); open(results[sel]) }
    else if (e.key === 'Escape') onClose()
  }

  return (
    <div className="cc-cmd-scrim" onMouseDown={onClose}>
      <div className="cc-cmd" onMouseDown={e => e.stopPropagation()}>
        <div className="cc-cmd-input">
          {I.search({ width: 18, height: 18 })}
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search resources, channels, chats and messages…" />
          {loading && <span className="cc-cmd-spin" />}
        </div>
        <div className="cc-cmd-list">
          {!q.trim() ? <div className="cc-cmd-empty">Type to search across this project — cloud resources, channels, your Nimbus chats, and specific messages.</div>
            : results.length === 0 && !loading ? <div className="cc-cmd-empty">No matches for “{q}”.</div>
              : results.map((r, i) => (
                <button key={r.kind + r.id + i} className={'cc-cmd-row' + (i === sel ? ' on' : '')}
                  onMouseEnter={() => setSel(i)} onClick={() => open(r)}>
                  <span className="cc-cmd-ico">{iconFor(r.kind)}</span>
                  <span className="cc-cmd-main"><span className="cc-cmd-title">{r.title}</span><span className="cc-cmd-sub">{r.sub}</span></span>
                  <span className="cc-cmd-kind">{r.kind === 'resource' ? 'Resource' : r.kind === 'channel' ? 'Channel' : r.kind === 'chat' ? 'Chat' : r.kind === 'channel-msg' ? 'Message' : 'Message'}</span>
                </button>
              ))}
        </div>
        <div className="cc-cmd-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> Select</span><span><kbd>↵</kbd> Open</span><div className="cc-composer-spacer" /><span><kbd>esc</kbd> Close</span>
        </div>
      </div>
    </div>
  )
}
