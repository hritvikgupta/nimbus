import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { I, initials } from './icons.jsx'
import { foldSession, fmtAgo } from './sessionHelpers.jsx'
import { WorkGroup } from '../chat/AgentThread.jsx'
import '../../styles/agentchat.css'
import {
  listMachineSessions, getMachineSession, startMachineSession, resumeMachineSession,
  compactSession, stopRepair, messageRepair,
} from '../../lib/api.js'

const CLAUDE_MODELS = [{ id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'haiku', label: 'Haiku' }]
const AGENT_NAME = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode' }

// One short status line from a step's text (strip markdown) — used as the live shimmer label.
const shortLine = (t) => {
  const l = (t || '').trim().split('\n').map((x) => x.trim()).filter(Boolean).pop() || ''
  return l.replace(/[*_`#>]/g, '').replace(/[….]+\s*$/, '').slice(0, 90)
}
// Render the machine's phase-steps in the SAME collapsible "work group" the Nimbus chat uses:
// shimmering live status → "Worked for Ns", with reasoning + tool rows in a dotted timeline.
function Work({ steps, streaming }) {
  const list = steps || []
  const mapped = list.map((s) => s.phase === 'tool'
    ? { type: 'tool', name: s.text, state: 'done' }
    : { type: 'reasoning', text: s.text })
  if (!mapped.length && !streaming) return null
  const last = list[list.length - 1]
  const liveLabel = last ? shortLine(last.text) : undefined
  return <WorkGroup steps={mapped} streaming={streaming} liveLabel={liveLabel} />
}

export function MachineView({ project, worker, userName, navigate, onClose }) {
  const [taskId, setTaskId] = useState(null)
  const [base, setBase] = useState([])       // transcript loaded from a reopened/old session
  const [live, setLive] = useState([])       // steps from the current live task (SSE)
  const [streamText, setStreamText] = useState('') // in-flight reply, growing live (delta events)
  const [result, setResult] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [model, setModel] = useState('')     // '' = machine default; else a model id (normal Claude machines)
  const agent = worker?.rented ? (worker.agent || 'claude') : 'claude'
  const agentName = AGENT_NAME[agent] || 'Claude'
  const [threadId, setThreadId] = useState(null) // the session thread we're viewing/continuing
  const [sessions, setSessions] = useState([])   // history for the dropdown
  const [histOpen, setHistOpen] = useState(false)
  const [metaState, setMetaState] = useState({}) // header gauge (model/tokens) — kept across turns
  const esRef = useRef(null)
  const scrollRef = useRef(null)
  const threadRef = useRef(null); threadRef.current = threadId

  const loadSessions = () => listMachineSessions(project?.id, worker?.workerId).then(r => setSessions(r?.sessions || [])).catch(() => {})

  // Reset when switching machines / project.
  useEffect(() => {
    setTaskId(null); setBase([]); setLive([]); setStreamText(''); setResult(null); setErr(''); setThreadId(null); setHistOpen(false); setMetaState({}); setModel(''); esRef.current?.close()
    loadSessions()
    return () => esRef.current?.close()
  }, [worker?.workerId, project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [base, live, result, streamText])

  // Pull the persisted clean messages for the conversation we're viewing (source of truth).
  const refreshBase = async () => {
    const id = threadRef.current; if (!id) return
    try { const r = await getMachineSession(project?.id, id); setBase(r?.session?.messages || []) } catch { /* */ }
  }
  const applyMeta = (s) => { if (s?.phase === 'meta') setMetaState(m => ({ ...m, ...s })) }
  // live holds ONLY the in-flight turn's steps. Completed turns come from `base` (persisted) — so we
  // never double-render after a refresh/reattach. On each completed turn, refresh base + clear live.
  const watch = (id) => {
    esRef.current?.close()
    const es = new EventSource(`/api/repair/tasks/${id}/stream`)
    esRef.current = es
    es.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data) } catch { return }
      if (ev.type === 'snapshot') {
        const steps = ev.task?.steps || []
        steps.forEach(applyMeta)
        const lastClaude = steps.map(s => s.phase).lastIndexOf('claude')
        setLive(lastClaude >= 0 ? steps.slice(lastClaude + 1) : steps) // keep only the in-progress tail
        setStreamText(ev.task?.live || '') // resume the in-flight partial reply if there is one
        if (ev.task?.result) setResult(ev.task.result)
        refreshBase()
      } else if (ev.type === 'delta') {
        setStreamText(ev.text || '') // the growing reply for the current turn
      } else if (ev.type === 'step') {
        applyMeta(ev.step)
        if (ev.step.phase === 'claude') { refreshBase(); setLive([]); setStreamText('') } // turn done → it's now in base
        else setLive(s => [...s, ev.step])
      } else if (ev.type === 'result') { setResult(ev.result); refreshBase(); setLive([]); setStreamText(''); es.close(); loadSessions() }
    }
  }

  // Open a stored session from the dropdown: show its transcript; the next message will RESUME it.
  const openSession = async (id) => {
    setHistOpen(false); esRef.current?.close()
    setTaskId(null); setLive([]); setStreamText(''); setResult(null); setErr(''); setMetaState({})
    try {
      const r = await getMachineSession(project?.id, id)
      setBase(r?.session?.messages || []); setThreadId(id)
      // if this conversation is still live, reattach to its running task instead of resuming
      const live = r?.session?.activeTaskId
      if (live) { setTaskId(live); watch(live) }
    } catch { setErr('Could not load that session.') }
  }

  const send = async () => {
    const text = draft.trim(); if (!text || busy) return
    setDraft('')
    const live2 = taskId && !result // an active task we can message directly
    if (live2) { messageRepair(taskId, text).catch(() => {}); return }
    setBusy(true); setErr('')
    try {
      const d = threadId
        ? await resumeMachineSession(project.id, threadId, text, model || undefined)   // continue a stored session (Claude --resume)
        : await startMachineSession(project.id, worker.workerId, text, model || undefined) // brand-new session
      if (!d.ok) {
        setErr(d.reason === 'machine-offline' ? 'That machine is offline.' : d.reason === 'no-repo' ? 'Connect a repo to this project first.' : d.reason === 'not-resumable' ? 'That session can’t be resumed (no saved Claude context).' : 'Could not start the session.')
        setBusy(false); return
      }
      // resuming: the new task's live steps render below the loaded transcript (base stays).
      if (!threadId) setThreadId(d.conversationId)
      setLive([]); setResult(null); setTaskId(d.taskId); setBusy(false); watch(d.taskId)
    } catch { setErr('Could not start the session.'); setBusy(false) }
  }

  const ended = result || false
  const active = taskId && !result
  const meta = metaState
  const liveChat = foldSession(live)
  // Unified chat: persisted clean messages (base) + the in-flight turn folded from live steps.
  const msgs = [
    ...base.map(m => ({ role: m.role, text: m.text, summary: m.workSummary })),
    ...liveChat.msgs.map(m => ({ role: m.role === 'user' ? 'user' : 'claude', text: m.text, steps: m.work })),
  ]
  const last = msgs[msgs.length - 1]
  const waiting = active && (liveChat.pendingWork.length > 0 || (last && last.role === 'user'))
  const newSession = () => { if (active) stopRepair(taskId).catch(() => {}); setTaskId(null); setBase([]); setLive([]); setStreamText(''); setResult(null); setErr(''); setThreadId(null); setHistOpen(false); setMetaState({}) }
  const fmtAgo = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d` }

  return (
    <main className="cc-main">
      <header className="cc-top">
        <div className="cc-top-name">{I.cpu()}<span>{worker?.host || worker?.workerId || 'Machine'}</span>
          <span className={'cc-mach-dot' + (worker ? ' on' : '')} /></div>
        {meta.model
          ? <span className="cc-mach-gauge"><b>{meta.model}</b>{meta.inputTokens != null && <> · {(meta.inputTokens / 1000).toFixed(1)}k in · {meta.outputTokens || 0} out</>}{meta.costUsd != null && <> · ${meta.costUsd.toFixed(3)}</>}</span>
          : !taskId && !threadId
            ? (worker?.rented
                ? <span className="cc-mach-sub">{agentName}{worker.model ? ` · ${worker.model}` : ' · default'} · set at rent</span>
                : <span className="cc-mach-modelpick">model{' '}
                    <select value={model} onChange={e => setModel(e.target.value)}>
                      <option value="">machine default</option>
                      {CLAUDE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </span>)
            : <span className="cc-mach-sub">{agentName} on this machine · {project?.repo || 'no repo'}</span>}
        <div className="cc-top-spacer" />
        {active && <button className="cc-modal-btn ghost sm" title="Compress the session context (/compact)" onClick={() => compactSession(taskId).catch(() => {})}>Compact</button>}
        {/* History dropdown — reopen + resume a past session on this machine */}
        <div className="cc-hist">
          <button className="cc-modal-btn ghost sm" onClick={() => { if (!histOpen) loadSessions(); setHistOpen(o => !o) }} title="Past sessions on this machine">History ▾</button>
          {histOpen && <div className="cc-hist-scrim" onClick={() => setHistOpen(false)} />}
          {histOpen && (
            <div className="cc-hist-menu">
              <div className="cc-hist-lbl">SESSIONS · {worker?.host || worker?.workerId}</div>
              {sessions.length === 0 ? <div className="cc-hist-empty">No past sessions</div>
                : sessions.map(s => (
                  <button key={s.id} className={'cc-hist-row' + (threadId === s.id ? ' on' : '')} onClick={() => openSession(s.id)}>
                    <span className="cc-hist-title">{s.title}</span>
                    <span className="cc-hist-meta">{fmtAgo(s.lastActive)}{s.resumable ? '' : ' · view'}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
        {(taskId || threadId) && <button className="cc-modal-btn ghost sm" title="End this session and start fresh" onClick={newSession}>New session</button>}
        {active && <button className="cc-repair-stop" onClick={() => stopRepair(taskId).catch(() => {})}>Stop</button>}
        <button className="cc-connect" onClick={onClose} title="Back to channels">✕</button>
      </header>
      <div className="cc-scroll" ref={scrollRef}>
        {msgs.length === 0 && !active ? (
          <div className="cc-empty">
            <div className="cc-empty-mark">{I.cpu({ width: 30, height: 30 })}</div>
            <div className="cc-empty-h">Talk to {worker?.host || worker?.workerId}</div>
            <div className="cc-empty-p">This drives <b>{agentName}</b> directly on that machine — no Nimbus in between. It clones <b>{project?.repo || 'the project repo'}</b> and does whatever you ask (and can open a PR itself if you tell it to). Use <b>History</b> to reopen and resume a past session.</div>
          </div>
        ) : (
          <div className="cc-thread">
            {msgs.map((m, i) => {
              const isUser = m.role === 'user'
              return (
                <div className="cc-msg" key={i}>
                  <span className={'cc-msg-av' + (isUser ? '' : ' c')}>{isUser ? initials(userName) : I.claude()}</span>
                  <div className="cc-msg-main">
                    <div className="cc-msg-head"><span className="cc-msg-name">{isUser ? userName : agentName}{!isUser && <span className="cc-msg-bot">{worker?.host || 'machine'}</span>}</span></div>
                    <div className="cc-msg-body">
                      {m.steps && <Work steps={m.steps} />}
                      {m.summary && !m.steps && <div className="cc-work"><span className="cc-work-toggle" style={{ cursor: 'default' }}>{m.summary}</span></div>}
                      {isUser
                        ? <div className="cc-msg-text">{m.text}</div>
                        : <div className="cc-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text || ''}</ReactMarkdown></div>}
                    </div>
                  </div>
                </div>
              )
            })}
            {(waiting || streamText) && (
              <div className="cc-msg">
                <span className="cc-msg-av c">{I.claude()}</span>
                <div className="cc-msg-main">
                  <div className="cc-msg-head"><span className="cc-msg-name">{agentName}<span className="cc-msg-bot">{worker?.host || 'machine'}</span></span></div>
                  <div className="cc-msg-body">
                    <Work steps={liveChat.pendingWork} streaming />
                    {streamText
                      ? <div className="agent-md cc-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown><span className="stream-caret" /></div>
                      : null}
                  </div>
                </div>
              </div>
            )}
            {ended && <div className={'cc-repair-result ' + result.status} style={{ margin: '4px 0 0 44px' }}>{result.status === 'stopped' ? 'Session stopped.' : 'Session ended.'}</div>}
          </div>
        )}
      </div>
      <div className="cc-composer-wrap">
        {err && <div className="cc-modal-err" style={{ margin: '0 16px 6px' }}>{err}</div>}
        <div className="cc-composer">
          <textarea rows={1} value={draft}
            placeholder={active ? `Reply to ${agentName} on this machine…` : threadId ? `Continue this session — resumes ${agentName} with its context…` : `Tell ${worker?.host || 'this machine'}'s ${agentName} what to do…`}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            disabled={busy} />
          <div className="cc-composer-bar">
            <div className="cc-composer-spacer" />
            <button className="cc-send" onClick={send} disabled={!draft.trim() || busy}>{I.send()}</button>
          </div>
        </div>
        <div className="cc-composer-hint">{threadId && !active ? `Sending will resume this ${agentName} session with its full prior context.` : `Direct to ${worker?.host || worker?.workerId}'s ${agentName} · messages go straight over the Nimbus bridge.`}</div>
      </div>
    </main>
  )
}

