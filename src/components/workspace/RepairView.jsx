import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { I, initials } from './icons.jsx'
import { foldSession, WorkTimeline, REPAIR_STATUS, REPAIR_ACTIVE, fmtAgo } from './sessionHelpers.jsx'
import {
  getRepairTasks, getRepairWorkers, dispatchRepair, getRepairConversation, stopRepair, messageRepair,
} from '../../lib/api.js'

export function RepairView({ project, navigate, onConnect, openConvId }) {
  const [workers, setWorkers] = useState(null)
  const [convs, setConvs] = useState(null)  // persisted repair conversations (survive restarts)
  const [tasks, setTasks] = useState([])    // live in-memory tasks (for SSE of a running repair)
  const [sel, setSel] = useState('new')     // 'new' | <conversationId>
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [steps, setSteps] = useState([])    // live timeline (SSE) for a running repair
  const [convMsgs, setConvMsgs] = useState(null) // persisted clean messages for a stored repair
  const [result, setResult] = useState(null)
  const [talk, setTalk] = useState('')
  const [pickWorker, setPickWorker] = useState('') // '' = let Nimbus choose; else a specific machine
  const [pickModel, setPickModel] = useState('')   // '' = machine default; else opus/sonnet/haiku
  const esRef = useRef(null)
  const loadTasks = () => getRepairTasks(project?.id).then(r => { setTasks(r?.tasks || []); setConvs(r?.conversations || []) }).catch(() => setConvs([]))
  const loadWorkers = () => getRepairWorkers(project?.id).then(r => setWorkers(r?.workers || [])).catch(() => setWorkers([]))
  useEffect(() => {
    setSel('new'); setSteps([]); setConvMsgs(null); setResult(null); esRef.current?.close()  // reset when project changes
    loadWorkers(); loadTasks()
    const t = setInterval(() => { loadWorkers(); loadTasks() }, 4000)
    return () => { clearInterval(t); esRef.current?.close() }
  }, [project?.id])

  const watch = (id) => {
    setSteps([]); setResult(null)
    esRef.current?.close()
    const es = new EventSource(`/api/repair/tasks/${id}/stream`)
    esRef.current = es
    es.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data) } catch { return }
      if (ev.type === 'snapshot') { setSteps(ev.task?.steps || []); if (ev.task?.result) setResult(ev.task.result) }
      else if (ev.type === 'step') setSteps(s => [...s, ev.step])
      else if (ev.type === 'result') { setResult(ev.result); es.close(); loadTasks() }
    }
  }
  // Open a stored repair: if it's still live, watch the SSE timeline; else load its persisted messages.
  // A repair conversation's id IS its task id, so when it's still active we can stream it even if the
  // activeTaskId guard hasn't been written yet (race right after dispatch).
  const liveIdFor = (conv) => conv?.activeTaskId || (REPAIR_ACTIVE.has(conv?.status) ? conv?.id : null)
  const openRepair = async (conv) => {
    setSel(conv.id); setSteps([]); setConvMsgs(null); setResult(null); esRef.current?.close()
    const liveId = liveIdFor(conv)
    if (liveId) { watch(liveId); return }
    try { const r = await getRepairConversation(project?.id, conv.id); setConvMsgs(r?.conversation?.messages || []) } catch { setConvMsgs([]) }
  }
  const run = async () => {
    if (!summary.trim() || !project) return
    setBusy(true); setErr('')
    try {
      const d = await dispatchRepair(project.id, { summary: summary.trim(), service: project.name, severity: 'down' }, pickWorker || undefined, pickModel || undefined)
      if (!d.ok) { setErr(d.reason === 'no-worker' ? 'No machine connected — click “Connect a machine”.' : d.reason === 'machine-offline' ? 'That machine went offline — pick another.' : d.reason === 'no-repo' ? 'No repo connected to this project.' : 'Could not dispatch.'); setBusy(false); return }
      setSummary(''); setBusy(false); setSel(d.conversationId || d.taskId); setConvMsgs(null); watch(d.taskId); loadTasks()
    } catch { setErr('Could not dispatch repair.'); setBusy(false) }
  }
  // Deep-link from the Sessions board (?c=<id>) — open that conversation ONCE when it first loads.
  // (Must not re-fire on the 4s poll, or it would keep yanking the user back to ?c= after they
  // manually click another repair.)
  const deepLinkedRef = useRef('')
  useEffect(() => {
    if (!openConvId || !convs) return
    if (deepLinkedRef.current === openConvId) return // already honored this link
    const c = convs.find(x => x.id === openConvId)
    if (c) { deepLinkedRef.current = openConvId; openRepair(c) }
  }, [openConvId, convs])

  const online = (workers || []).length
  const selWorker = (workers || []).find(w => w.workerId === pickWorker) || null // the machine picked for a new repair
  const selConv = (convs || []).find(c => c.id === sel)
  const liveTaskId = liveIdFor(selConv)
  const viewingStored = convMsgs !== null && !liveTaskId
  const liveStatus = result?.status || selConv?.status || 'running'

  return (
    <>
      <aside className="cc-side cc-repair-side">
        <div className="cc-files-head"><span className="cc-files-ico">{I.wrench()}</span><span className="cc-files-repo">Repairs</span><button className="cc-files-refresh" title="Refresh" onClick={loadTasks}>{I.refresh()}</button></div>
        <div className={'cc-repair-roster' + (online ? ' on' : '')}><span className="cc-repair-dot" />{workers === null ? 'Checking…' : online ? `${online} machine${online > 1 ? 's' : ''} online` : 'No machine connected'}</div>
        <button className="cc-gh-btn sm cc-connect-machine" onClick={onConnect}>{I.github()} Connect a machine</button>
        <button className={'cc-side-chan' + (sel === 'new' ? ' on' : '')} onClick={() => { setSel('new'); setErr('') }}><span className="cc-side-ico">{I.plus()}</span>New repair</button>
        <div className="cc-side-section"><span>Previous fixes</span></div>
        {convs === null ? <div className="cc-tree-empty">Loading…</div>
          : !convs.length ? <div className="cc-tree-empty">No repairs yet. Incidents auto-dispatch here.</div>
          : convs.map(c => (
            <button key={c.id} className={'cc-side-chan cc-repair-navrow' + (sel === c.id ? ' on' : '')} onClick={() => openRepair(c)}>
              <span className={'cc-repair-badge ' + c.status}>{REPAIR_STATUS[c.status] || c.status}</span>
              <span className="cc-repair-nav-tx">{c.title || 'Repair'}</span>
            </button>
          ))}
      </aside>

      <main className="cc-main">
        <header className="cc-top">
          <div className="cc-top-name">{I.wrench()}<span>{sel === 'new' ? 'New repair' : (selConv?.title || 'Repair')}</span></div>
          <div className="cc-top-spacer" />
        </header>
        <div className="cc-scroll">
          {sel === 'new' ? (
            <div className="cc-repair-main">
              <div className="cc-repair-card">
                <div className="cc-repair-card-h">Describe the issue</div>
                <div className="cc-repair-card-sub">Nimbus pushes this to a connected machine, which drives its Claude Code to find the root cause and open a PR on <b>{project?.repo || 'the repo'}</b>.</div>
                <label className="cc-repair-machine">Run on{' '}
                  <select value={pickWorker} onChange={e => setPickWorker(e.target.value)}>
                    <option value="">any available machine</option>
                    {(workers || []).map(w => <option key={w.workerId} value={w.workerId}>{(w.host || w.workerId) + (w.rented ? ` · ${(w.agent || 'claude')} (cloud)` : '')}</option>)}
                  </select>
                  {online ? <span className="cc-repair-machine-n">{online} online</span> : <span className="cc-repair-machine-n off">none online</span>}
                </label>
                {/* Model choice applies only to a local Claude Code machine — a rented machine runs its rent-time model. */}
                {selWorker?.rented ? (
                  <div className="cc-repair-machine">Model <span className="cc-repair-machine-n">{(selWorker.agent || 'claude')} · {selWorker.model || 'default'} · set at rent</span></div>
                ) : (
                  <label className="cc-repair-machine">Model{' '}
                    <select value={pickModel} onChange={e => setPickModel(e.target.value)}>
                      <option value="">machine default</option>
                      <option value="opus">Opus</option>
                      <option value="sonnet">Sonnet</option>
                      <option value="haiku">Haiku</option>
                    </select>
                  </label>
                )}
                <textarea className="cc-repair-input" placeholder="What's broken? Paste the error / failing logs…" value={summary} onChange={e => setSummary(e.target.value)} />
                {err && <div className="cc-modal-err">{err}</div>}
                <button className="cc-modal-btn primary" style={{ alignSelf: 'flex-start' }} disabled={!summary.trim() || busy} onClick={run}>{busy ? 'Dispatching…' : 'Run repair'}</button>
              </div>
            </div>
          ) : (
            <div className="cc-repair-main">
              <div className="cc-repair-detail-head">
                <span className={'cc-repair-badge ' + liveStatus}>{REPAIR_STATUS[liveStatus] || liveStatus}</span>
                <span className="cc-repair-detail-repo">{selConv?.repo}</span>
                {(result?.prUrl || selConv?.result?.prUrl) && <a className="cc-repair-detail-pr" href={result?.prUrl || selConv?.result?.prUrl} target="_blank" rel="noreferrer">View PR ↗</a>}
              </div>
              {viewingStored ? (
                /* a finished repair, reopened from storage — the clean Nimbus ↔ Claude transcript */
                <div className="cc-thread">
                  {convMsgs.length === 0 && <div className="cc-modal-empty">No transcript saved.</div>}
                  {convMsgs.map((m, i) => {
                    const isNimbus = m.role === 'nimbus'
                    return (
                      <div className="cc-msg" key={i}>
                        <span className={'cc-msg-av' + (isNimbus ? ' n' : ' c')}>{isNimbus ? I.nimbus() : I.claude()}</span>
                        <div className="cc-msg-main">
                          <div className="cc-msg-head"><span className="cc-msg-name">{isNimbus ? 'Nimbus' : 'Claude'}{m.workSummary && <span className="cc-msg-bot">{m.workSummary}</span>}</span></div>
                          <div className="cc-msg-body"><div className="cc-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text || ''}</ReactMarkdown></div></div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
              <div className="cc-repair-card">
                <div className="cc-repair-card-h">What happened</div>
                <div className="cc-repair-steps">
                  {steps.length === 0 && !result && <div className="cc-modal-empty">Waiting for the worker…</div>}
                  {steps.map((s, i) => (
                    <div className={'cc-repair-step ' + (s.phase || '')} key={i}>
                      <span className="cc-repair-step-dot" /><span className="cc-repair-step-ph">{s.phase}</span><span className="cc-repair-step-tx">{s.text}</span>
                    </div>
                  ))}
                  {!result && steps.length > 0 && <div className="cc-repair-step running"><span className="cc-repair-step-dot" /><span className="cc-repair-step-tx">working…</span></div>}
                </div>
                {result && (
                  <div className={'cc-repair-result ' + result.status}>
                    {result.status === 'failed' ? <>Repair failed: {result.error || 'see steps'}</>
                      : result.status === 'stopped' ? <>Stopped by Nimbus.</>
                      : result.prUrl ? <>Done — <a href={result.prUrl} target="_blank" rel="noreferrer">view the PR ↗</a></>
                      : <>Done — {result.rootCause ? 'no code change needed.' : 'pushed a branch; open a PR to review.'}</>}
                  </div>
                )}
                {!result && liveTaskId && REPAIR_ACTIVE.has(liveStatus) && (
                  <div className="cc-repair-controls">
                    <input className="cc-repair-talk" placeholder="Talk to Claude — steer it…" value={talk}
                      onChange={e => setTalk(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && talk.trim()) { messageRepair(liveTaskId, talk.trim()).catch(() => {}); setTalk('') } }} />
                    <button className="cc-modal-btn ghost sm" disabled={!talk.trim()} onClick={() => { messageRepair(liveTaskId, talk.trim()).catch(() => {}); setTalk('') }}>Send</button>
                    <button className="cc-repair-stop" onClick={() => stopRepair(liveTaskId).catch(() => {})}>Stop</button>
                  </div>
                )}
              </div>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
