/**
 * RentalChatModal — a direct chat session with the coding agent running ON a rented machine.
 * Each message is executed on the machine via Fly exec (server-side) and the reply streamed back.
 * Same feel as a direct machine session, but the machine is a rented Fly VM. See docs/rented-compute.md.
 */
import { useEffect, useRef, useState } from 'react'
import { I } from './icons.jsx'
import { rentalChat } from '../../lib/api.js'

const AGENT_LABEL = { claude: 'Claude Code', codex: 'Codex CLI', opencode: 'OpenCode' }

export function RentalChatModal({ projectId, rental, onClose }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [messages, busy])

  const send = async () => {
    const text = draft.trim()
    if (!text || busy) return
    setDraft(''); setBusy(true)
    setMessages((m) => [...m, { role: 'user', text }])
    try {
      const res = await rentalChat(projectId, rental.id, text)
      setMessages((m) => [...m, { role: 'agent', text: res?.reply || '(no output)', pending: !res?.ready }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'agent', text: e?.message || 'The machine could not run the agent.', error: true }])
    } finally { setBusy(false) }
  }

  return (
    <div className="cc-modal-scrim" onMouseDown={onClose}>
      <div className="cc-modal rchat" onMouseDown={(e) => e.stopPropagation()}>
        <header className="rchat-head">
          <span className="rchat-ico">{I.cpu({ width: 16, height: 16 })}</span>
          <div className="rchat-head-main">
            <div className="rchat-title">Nimbus Cloud · {rental.size}</div>
            <div className="rchat-sub">{AGENT_LABEL[rental.model] || rental.model} · {rental.cpus} vCPU · running on a rented machine</div>
          </div>
          <button className="canvas-res-x" onClick={onClose} title="Close">{I.x()}</button>
        </header>

        <div className="rchat-scroll" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="rchat-empty">
              <div className="rchat-empty-h">Talk to the agent on this machine</div>
              <div className="rchat-empty-p">Every message runs on the rented machine via <b>{AGENT_LABEL[rental.model] || rental.model}</b>. Ask it anything — it runs there, not here.</div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={'rchat-msg ' + m.role}>
              <span className="rchat-av">{m.role === 'user' ? I.at({ width: 13, height: 13 }) : I.cpu({ width: 13, height: 13 })}</span>
              <div className={'rchat-body' + (m.error ? ' error' : '') + (m.pending ? ' pending' : '')}>{m.text}</div>
            </div>
          ))}
          {busy && <div className="rchat-msg agent"><span className="rchat-av">{I.cpu({ width: 13, height: 13 })}</span><div className="rchat-body"><span className="typing"><i /><i /><i /></span></div></div>}
        </div>

        <div className="rchat-composer">
          <textarea rows={1} value={draft} placeholder="Message the machine's agent…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          <button className="cc-send" onClick={send} disabled={!draft.trim() || busy}>{I.send()}</button>
        </div>
      </div>
    </div>
  )
}

export default RentalChatModal
