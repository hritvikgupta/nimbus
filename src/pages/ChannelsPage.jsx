/**
 * The workspace's routed views beside the sidebar: the Nimbus chat / channels / direct machine
 * sessions (ChannelsPage), plus the thin Files and Repair page wrappers. URL-driven.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { AgentMessage } from '../components/chat/AgentThread.jsx'
import { Agents } from '../components/sections/index.jsx'
import { I, initials, uid, firstText } from '../components/workspace/icons.jsx'
import { FilesExplorer } from '../components/workspace/FilesExplorer.jsx'
import { MachineView } from '../components/workspace/MachineView.jsx'
import { RepairView } from '../components/workspace/RepairView.jsx'
import { RentMachineModal } from '../components/workspace/RentMachineModal.jsx'
import {
  getWorkspace, createChannel as apiCreateChannel, deleteChannel as apiDeleteChannel,
  getChannelMessages, saveChannelMessages, getRepairTasks, getRentals, stopRental, forgetMachine,
} from '../lib/api.js'

function ChannelActivity({ project, overview, navigate, onConnect }) {
  const [repairs, setRepairs] = useState(null)
  useEffect(() => {
    if (!project?.id) { setRepairs([]); return }
    getRepairTasks(project.id).then(r => setRepairs(r?.conversations || [])).catch(() => setRepairs([]))
  }, [project?.id])

  const resources = overview?.resources || []
  const repList = repairs || []
  const dotFor = (s) => s === 'healthy' || s === 'done' ? '#3fb950' : s === 'running' ? '#d29922' : s === 'failed' ? '#f85149' : '#8b949e'
  const empty = !resources.length && !repList.length

  if (empty) {
    return (
      <div className="cc-empty">
        <div className="cc-empty-mark">{I.grid({ width: 28, height: 28 })}</div>
        <div className="cc-empty-h">Nothing here yet</div>
        <div className="cc-empty-p">When @nimbus provisions resources or runs a repair for this project, it shows up here — each one clickable.</div>
        {!project?.repo && <button className="cc-connect-btn" onClick={onConnect}>{I.github()} Connect a repo</button>}
      </div>
    )
  }

  return (
    <div className="cc-activity">
      {resources.length > 0 && (
        <>
          <div className="cc-act-sec">Resources</div>
          {resources.map(r => (
            <button key={r.name} className="cc-act-row" onClick={() => navigate(`/app/resources/${encodeURIComponent(r.name)}`)}>
              <span className="cc-act-dot" style={{ background: dotFor(r.status) }} />
              <span className="cc-act-main">
                <span className="cc-act-title">{r.name}</span>
                <span className="cc-act-sub">{r.type} · {(r.cloud || '').toUpperCase()}{r.region ? ` · ${r.region}` : ''}</span>
              </span>
              <span className="cc-act-meta">{r.status || 'planned'}</span>
            </button>
          ))}
        </>
      )}
      {repList.length > 0 && (
        <>
          <div className="cc-act-sec">Repairs</div>
          {repList.map(c => {
            const pr = c.result?.prUrl
            return (
              <button key={c.id} className="cc-act-row"
                onClick={() => pr ? window.open(pr, '_blank', 'noopener') : navigate('/app/repair')}>
                <span className="cc-act-dot" style={{ background: dotFor(c.status) }} />
                <span className="cc-act-main">
                  <span className="cc-act-title">{c.title || 'Repair'}</span>
                  <span className="cc-act-sub">{c.status}{pr ? ' · PR ready' : ''}</span>
                </span>
                <span className="cc-act-meta">{pr ? 'Open PR ↗' : 'View'}</span>
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}

/* ════════════════════════ Chat (Home Nimbus chat + channels + direct machine sessions) ════════════════════════ */
export function ChannelsPage() {
  const {
    project, projects, switchProject, createProject, projOpen, setProjOpen, repo, machines,
    openRepoModal, openConnectModal, overview, graphTick, userName, navigate, openTarget,
  } = useOutletContext()
  const { channelId, chatId, workerId } = useParams() // the view is driven by the URL
  const [newProj, setNewProj] = useState(null) // inline "new project" input (null = closed)
  const appliedTarget = useRef(0)

  const [channels, setChannels] = useState([])
  const [newChannel, setNewChannel] = useState(null)
  const [tab, setTab] = useState('messages')
  const [agentsCanvas, setAgentsCanvas] = useState(false) // Home/Nimbus chat's canvas open state
  const [draft, setDraft] = useState('')
  const [rentOpen, setRentOpen] = useState(false) // "Rent a machine" modal (rented-compute idea)
  const [rentals, setRentals] = useState([]) // active rented machines (shown in the sidebar)
  const [hiddenMachines, setHiddenMachines] = useState(() => new Set()) // computers removed from the sidebar (optimistic)
  // Sidebar hover tooltip — rendered in a body PORTAL (position:fixed) so the sidebar's overflow
  // (it scrolls, and collapses to a 60px rail) can never clip it. Text comes from each button's data-tip.
  const [tip, setTip] = useState(null)
  const onSideOver = (e) => {
    const el = e.target.closest?.('[data-tip]')
    if (!el) { setTip(null); return }
    const r = el.getBoundingClientRect()
    // To the RIGHT of the button, vertically centered — never clipped by the sidebar's overflow.
    setTip({ text: el.getAttribute('data-tip'), x: Math.round(r.right + 10), y: Math.round(r.top + r.height / 2) })
  }

  // ── view derived from the route: /app/chat[/:chatId] = home, /channels/:id = channel, /machine/:id = machine
  const active = channelId ? (channels.find(c => c.id === channelId) || null) : null
  // A rented machine may not be on the polled roster yet (in-memory, resets on API restart) — fall back
  // to our running rentals so clicking a green machine ALWAYS opens its MachineView, never a channel.
  const rentalWorker = (id) => {
    const r = rentals.find(x => x.id === id && x.status === 'running')
    return r ? { workerId: r.id, host: `Nimbus Cloud · ${r.size}`, rented: true, agent: r.agent, model: r.model } : null
  }
  const machine = workerId ? (machines.find(w => w.workerId === workerId) || rentalWorker(workerId)) : null
  const home = !channelId && !workerId

  const projRef = useRef(null); projRef.current = project?.id || null

  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/workspace/agent',
    prepareSendMessagesRequest: ({ messages, body }) => ({ body: { ...(body || {}), messages, projectId: projRef.current } }),
  }), [])
  const { messages, sendMessage, status, setMessages } = useChat({ transport })
  const streaming = status === 'submitted' || status === 'streaming'

  const activeRef = useRef(null); activeRef.current = active
  const messagesRef = useRef(messages); messagesRef.current = messages
  const scrollRef = useRef(null)
  const taRef = useRef(null)
  const isDM = active?.kind === 'dm'

  const openChannel = (ch) => navigate(`/app/channels/${ch.id}`) // routes drive the view

  // Load this project's channels (channels + chat are per-project).
  useEffect(() => {
    if (!project?.id) return
    getWorkspace(project.id).then(w => { setChannels(w.channels || []) }).catch(() => {})
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll this project's rented machines (they live in the sidebar; lifecycle changes their status).
  useEffect(() => {
    if (!project?.id) { setRentals([]); return }
    const load = () => getRentals(project.id).then(r => setRentals(r?.rentals || [])).catch(() => {})
    load(); const t = setInterval(load, 5000); return () => clearInterval(t)
  }, [project?.id])

  // Load the active channel's messages whenever the channel in the URL changes.
  useEffect(() => {
    setTab('messages')
    if (!channelId || !project?.id) { setMessages([]); return }
    getChannelMessages(project.id, channelId).then(r => setMessages(r?.messages || [])).catch(() => setMessages([]))
  }, [channelId, project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Search-palette deep-link → navigate to the right URL (works even when already on the page).
  useEffect(() => {
    if (!openTarget || openTarget.n === appliedTarget.current) return
    appliedTarget.current = openTarget.n
    if (openTarget.kind === 'chat') navigate(`/app/chat/${openTarget.id}`)
    else if (openTarget.kind === 'channel') navigate(`/app/channels/${openTarget.id}`)
  }, [openTarget]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist a channel's history when a @nimbus turn finishes.
  const wasStreaming = useRef(false)
  useEffect(() => {
    if (wasStreaming.current && !streaming) {
      const ch = activeRef.current, msgs = messagesRef.current
      if (ch && msgs.length) {
        saveChannelMessages(projRef.current, ch.id, msgs).catch(() => {})
        setChannels(cs => cs.map(c => c.id === ch.id ? { ...c, count: msgs.length } : c))
      }
    }
    wasStreaming.current = streaming
  }, [streaming])

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [messages, streaming, active?.id])

  const post = (text) => {
    const t = (text || '').trim()
    if (!t || streaming) return
    setDraft(''); if (taRef.current) taRef.current.style.height = 'auto'
    const mention = isDM || /@nimbus\b/i.test(t)
    if (mention) {
      void sendMessage({ text: t })
    } else {
      const next = [...messagesRef.current, { id: uid(), role: 'user', parts: [{ type: 'text', text: t }] }]
      setMessages(next)
      if (activeRef.current) {
        saveChannelMessages(projRef.current, activeRef.current.id, next).catch(() => {})
        setChannels(cs => cs.map(c => c.id === activeRef.current.id ? { ...c, count: next.length } : c))
      }
    }
  }

  const addChannel = async () => {
    const name = (newChannel || '').trim()
    if (!name) { setNewChannel(null); return }
    try { const ch = await apiCreateChannel(projRef.current, name); setChannels(cs => [...cs, ch]); setNewChannel(null); openChannel(ch) }
    catch { setNewChannel(null) }
  }
  const removeChannel = async (e, ch) => {
    e.stopPropagation()
    try { await apiDeleteChannel(projRef.current, ch.id) } catch { /* ignore */ }
    const next = channels.filter(c => c.id !== ch.id); setChannels(next)
    if (active?.id === ch.id) navigate(next[0] ? `/app/channels/${next[0].id}` : '/app/chat')
  }

  const grow = (el) => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }
  const mentionNimbus = () => { setDraft(d => (/@nimbus/i.test(d) ? d : ('@nimbus ' + d).trimStart())); taRef.current?.focus() }

  const chanList = channels.filter(c => c.kind !== 'dm')
  const hasMsgs = messages.length > 0

  return (
    <>
      {/* ── sidebar (auto-collapses when the Home canvas is open, to make room) ── */}
      <aside className={'cc-side' + (home && agentsCanvas ? ' collapsed' : '')}
        onMouseOver={onSideOver} onMouseOut={() => setTip(null)}>
        {tip && createPortal(
          <div className="cc-tip-float" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>,
          document.body,
        )}
        <div className="cc-side-proj">
          <button className="cc-proj-btn" onClick={() => setProjOpen(o => !o)} data-tip="Switch project">
            <span className="cc-proj-dot" /><span className="cc-proj-name">{project?.name || 'Project'}</span>
            <span className={'cc-proj-cv' + (projOpen ? ' open' : '')}>{I.caret()}</span>
          </button>
          {projOpen && <div className="cc-proj-scrim" onClick={() => setProjOpen(false)} />}
          {projOpen && (
            <div className="cc-proj-menu">
              <div className="cc-proj-lbl">PROJECT — each binds its own repo</div>
              {projects.map(p => (
                <button key={p.id} className={'cc-proj-row' + (p.id === project?.id ? ' on' : '')} onClick={() => switchProject(p.id)}>
                  <span className="cc-proj-nm">{p.name}</span>
                  <span className={'cc-proj-repo' + (p.repo ? '' : ' none')}>{p.repo || 'no repo'}</span>
                </button>
              ))}
              {newProj === null ? (
                <button className="cc-proj-row cc-proj-add" onClick={() => setNewProj('')}>
                  <span className="cc-proj-nm">{I.plus({ width: 13, height: 13 })} New project</span>
                </button>
              ) : (
                <div className="cc-proj-newrow">
                  <input autoFocus value={newProj} placeholder="Project name" onChange={e => setNewProj(e.target.value)}
                    onKeyDown={async e => {
                      if (e.key === 'Enter' && newProj.trim()) { const p = await createProject(newProj.trim()); setNewProj(null); setProjOpen(false); if (p?.id) switchProject(p.id) }
                      if (e.key === 'Escape') setNewProj(null)
                    }} />
                </div>
              )}
            </div>
          )}
          <button className="cc-connect" onClick={openRepoModal} data-tip={repo ? 'Change the connected repository' : 'Connect a repository to this project'}>
            {I.github()}{repo ? <span className="cc-connect-repo">{repo}</span> : 'Connect repo'}
          </button>
          <button className="cc-connect" onClick={() => navigate('/app/members')} data-tip="Members & access">
            {I.people()}Members
          </button>
        </div>

        <button className={'cc-side-chan cc-home-row' + (home ? ' on' : '')}
          onClick={() => navigate('/app/chat')} data-tip="Chat with Nimbus">
          <span className="cc-msg-av n cc-home-av">{I.nimbus({ width: 18, height: 18 })}</span>Nimbus
        </button>

        <div className="cc-side-section">
          <span>Rent a machine</span>
          <button className="cc-side-add" data-tip="Rent a hosted machine" onClick={() => setRentOpen(true)}>{I.plus()}</button>
        </div>
        {(() => {
          const active = rentals.filter(r => !['stopped', 'expired', 'failed'].includes(r.status))
          if (active.length === 0) return (
            <button className="cc-side-chan cc-mach-empty" onClick={() => setRentOpen(true)} data-tip="Rent a hosted machine on demand">
              <span className="cc-side-ico">{I.cloud()}</span>Rent a machine
            </button>
          )
          return active.map(r => {
            const running = r.status === 'running'
            const stop = async (e) => { e.stopPropagation(); try { await stopRental(project.id, r.id) } catch { /* ignore */ } setRentals(rs => rs.map(x => x.id === r.id ? { ...x, status: 'stopping' } : x)) }
            return (
              <button key={r.id} className={'cc-side-chan' + (workerId === r.id ? ' on' : '')}
                onClick={() => running && navigate(`/app/machine/${r.id}`)}
                data-tip={running ? `${r.agent || 'claude'} · ${r.model || 'default'} — open & chat` : `Machine is ${r.status}…`}>
                <span className="cc-side-ico">{I.cloud()}</span>{r.size}
                <span className={'cc-dm-dot' + (running ? '' : ' warn')} />
                <span className="cc-side-x" onClick={stop} title="Stop & destroy this machine">✕</span>
              </button>
            )
          })
        })()}

        <div className="cc-side-section">
          <span>Computers</span>
          <button className="cc-side-add" data-tip="Connect a machine" onClick={openConnectModal}>{I.plus()}</button>
        </div>
        {(() => {
          // Rented machines are in the roster too (so MachineView + repair picker see them), but they
          // have their own sidebar section above — don't list them twice here.
          const computers = machines.filter(m => !m.rented && !hiddenMachines.has(m.workerId))
          if (computers.length === 0) return (
            <button className="cc-side-chan cc-mach-empty" onClick={openConnectModal} data-tip="Connect a teammate’s computer">
              <span className="cc-side-ico">{I.cpu()}</span>Connect a machine
            </button>
          )
          return computers.map(m => {
            const forget = async (e) => {
              e.stopPropagation()
              setHiddenMachines(s => new Set(s).add(m.workerId)) // optimistic remove from the sidebar
              try { await forgetMachine(project.id, m.workerId) } catch { /* ignore */ }
            }
            return (
              <button key={m.workerId} className={'cc-side-chan' + (machine?.workerId === m.workerId ? ' on' : '')}
                onClick={() => navigate(`/app/machine/${m.workerId}`)} data-tip="Talk to this machine’s Claude directly">
                <span className="cc-side-ico">{I.cpu()}</span>{m.host || m.workerId}
                <span className="cc-dm-dot" />
                <span className="cc-side-x" onClick={forget} title="Remove this machine from the sidebar">✕</span>
              </button>
            )
          })
        })()}

        <div className="cc-side-section">
          <span>Channels</span>
          <button className="cc-side-add" data-tip="Create channel" onClick={() => setNewChannel('')}>{I.plus()}</button>
        </div>
        {chanList.map(c => (
          <button key={c.id} className={'cc-side-chan' + (active?.id === c.id ? ' on' : '')} onClick={() => openChannel(c)} data-tip={`Open #${c.name}`}>
            <span className="cc-side-ico">{I.hash()}</span>{c.name}
            {c.name !== 'general' && <span className="cc-side-x" onClick={(e) => removeChannel(e, c)}>✕</span>}
          </button>
        ))}
        {newChannel !== null && (
          <div className="cc-side-chan new">
            <span className="cc-side-ico">{I.hash()}</span>
            <input autoFocus value={newChannel} placeholder="new-channel" onChange={e => setNewChannel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addChannel(); if (e.key === 'Escape') setNewChannel(null) }} onBlur={addChannel} />
          </div>
        )}
      </aside>

      {/* ── main ── */}
      {home ? (
        <div className="cc-agents-wrap"><Agents chatId={chatId} onChatChange={(id) => navigate(id ? `/app/chat/${id}` : '/app/chat')} onCanvasChange={setAgentsCanvas} /></div>
      ) : machine ? (
        <MachineView project={project} worker={machine} userName={userName} navigate={navigate}
          onClose={() => navigate('/app/chat')} />
      ) : (
      <main className="cc-main">
        <header className="cc-top">
          <div className="cc-top-name">
            {isDM ? <span className="cc-dm-av">N</span> : <span className="cc-side-ico">{I.hash()}</span>}
            {active?.name || '…'}
          </div>
          <div className="cc-top-spacer" />
        </header>

        {!isDM && (
          <nav className="cc-subtabs">
            {['messages', 'activity'].map(t => (
              <button key={t} className={'cc-subtab' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </nav>
        )}

        <div className="cc-scroll" ref={scrollRef}>
          {tab === 'activity' && !isDM ? (
            <ChannelActivity project={project} overview={overview} navigate={navigate} onConnect={openRepoModal} />
          ) : !hasMsgs ? (
            <div className="cc-empty">
              <div className="cc-empty-mark">{isDM ? 'N' : I.hash({ width: 30, height: 30 })}</div>
              <div className="cc-empty-h">{isDM ? 'Message Nimbus' : `This is the beginning of #${active?.name || 'general'}`}</div>
              <div className="cc-empty-p">{isDM ? 'Ask Nimbus anything about your repo, PRs, or cloud — it investigates with real tools.' : 'Say hello — or @mention Nimbus to get started.'}</div>
              <div className="cc-empty-p2">{repo ? <>Connected to <b>{repo}</b> — ask <b>@nimbus</b> what changed.</> : 'Connect a repo so @nimbus can read your code right here.'}</div>
              {!repo && <button className="cc-connect-btn" onClick={openRepoModal}>{I.github()} Connect GitHub</button>}
            </div>
          ) : (
            <div className="cc-thread">
              {messages.map((m, i) => {
                const isUser = m.role === 'user'
                const live = streaming && i === messages.length - 1 && !isUser
                return (
                  <div className="cc-msg" key={m.id ?? i}>
                    <span className={'cc-msg-av' + (isUser ? '' : ' n')}>{isUser ? initials(userName) : I.nimbus()}</span>
                    <div className="cc-msg-main">
                      <div className="cc-msg-head"><span className="cc-msg-name">{isUser ? userName : 'Nimbus'}{!isUser && <span className="cc-msg-bot">APP</span>}</span></div>
                      <div className="cc-msg-body">
                        {isUser
                          ? <div className="cc-msg-text">{firstText(m)}</div>
                          : <AgentMessage message={m} streaming={live} />}
                      </div>
                    </div>
                  </div>
                )
              })}
              {streaming && messages[messages.length - 1]?.role === 'user' && (
                <div className="cc-msg"><span className="cc-msg-av n">{I.nimbus()}</span><div className="cc-msg-main"><div className="cc-msg-head"><span className="cc-msg-name">Nimbus<span className="cc-msg-bot">APP</span></span></div><div className="cc-msg-body"><span className="typing"><i /><i /><i /></span></div></div></div>
              )}
            </div>
          )}
        </div>

        {(isDM || tab === 'messages') && (
        <div className="cc-composer-wrap">
          <div className="cc-composer">
            <textarea ref={taRef} rows={1} value={draft}
              placeholder={isDM ? 'Message Nimbus' : `Message #${active?.name || 'general'}`}
              onChange={e => { setDraft(e.target.value); grow(e.target) }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(draft) } }} />
            <div className="cc-composer-bar">
              <button className="cc-cb" title="Attach">{I.plus()}</button>
              <button className="cc-cb" title="Format">{I.aa()}</button>
              <button className="cc-cb" title="Emoji">{I.emoji()}</button>
              <button className="cc-cb" title="Mention Nimbus" onClick={mentionNimbus}>{I.at()}</button>
              <div className="cc-composer-spacer" />
              <button className="cc-send" onClick={() => post(draft)} disabled={!draft.trim() || streaming}>{I.send()}</button>
            </div>
          </div>
          <div className="cc-composer-hint">{isDM ? 'Nimbus replies to every message here.' : 'Type @nimbus to ask the agent — it reads your code, PRs and cloud.'}</div>
        </div>
        )}
      </main>
      )}

      {rentOpen && <RentMachineModal projectId={project?.id} onClose={() => setRentOpen(false)}
        onCreated={(r) => { setRentals(rs => [r, ...rs]); setRentOpen(false) }} />}
    </>
  )
}


export function FilesPage() {
  const { repo, project, openRepoModal } = useOutletContext()
  const navigate = useNavigate()
  return <FilesExplorer repo={repo} projectId={project?.id} navigate={navigate} onConnect={openRepoModal} />
}

export function RepairPage() {
  const { project, openConnectModal } = useOutletContext()
  const navigate = useNavigate()
  const openConvId = new URLSearchParams(useLocation().search).get('c') || ''
  return <RepairView project={project} navigate={navigate} onConnect={openConnectModal} openConvId={openConvId} />
}
