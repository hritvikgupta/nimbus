import { useEffect, useState } from 'react'
import { I } from './icons.jsx'
import { fmtAgo } from './sessionHelpers.jsx'
import { listWorkerKeys, createWorkerKey, revokeWorkerKey } from '../../lib/api.js'

export function ConnectMachineModal({ onClose, projectId }) {
  const [keys, setKeys] = useState(null)
  const [label, setLabel] = useState('')
  const [created, setCreated] = useState(null) // plaintext key, shown once
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const load = () => listWorkerKeys(projectId).then(r => setKeys(r?.keys || [])).catch(() => setKeys([]))
  useEffect(() => { load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  const gen = async () => { setBusy(true); try { const r = await createWorkerKey(projectId, label || 'My machine'); setCreated(r.key?.key); setLabel(''); load() } finally { setBusy(false) } }
  const revoke = async (id) => { await revokeWorkerKey(projectId, id).catch(() => {}); load() }
  const cmd = created ? `npm install -g @nimbus/cli\nnimbus start ${created}` : ''
  const copy = () => { navigator.clipboard?.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  return (
    <div className="cc-modal-scrim" onMouseDown={onClose}>
      <div className="cc-modal cc-connectmodal" onMouseDown={e => e.stopPropagation()}>
        <div className="cc-modal-title">Connect a machine</div>
        <div className="cc-modal-sub">Generate a worker key, then run the command on any machine with <b>Claude Code</b> + <b>gh</b> installed. It holds a connection to Nimbus and runs repairs there.</div>
        {created ? (
          <div className="cc-connect-created">
            <div className="cc-connect-h">Install the Nimbus CLI on the machine, then connect it:</div>
            <div className="cc-connect-cmd"><pre className="cc-connect-pre">{cmd}</pre><button className="cc-modal-btn ghost sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
            <div className="cc-modal-err" style={{ color: 'var(--muted)' }}>Runs in the background. Check it with <code>nimbus status</code> / <code>nimbus logs -f</code>, stop with <code>nimbus stop</code>. Key shown once. Needs Claude Code + git + gh. Local dev: add <code>--url http://localhost:8788</code>.</div>
            <div className="cc-modal-foot"><div className="cc-composer-spacer" /><button className="cc-modal-btn primary" onClick={() => setCreated(null)}>Done</button></div>
          </div>
        ) : (
          <>
            <div className="cc-connect-gen">
              <input className="cc-modal-search" style={{ flex: 1 }} placeholder="Label (e.g. my-laptop)" value={label} onChange={e => setLabel(e.target.value)} />
              <button className="cc-modal-btn primary" disabled={busy} onClick={gen}>{busy ? 'Generating…' : 'Generate key'}</button>
            </div>
            <div className="cc-modal-list">
              {keys === null ? <div className="cc-modal-empty">Loading…</div>
                : !keys.length ? <div className="cc-modal-empty">No machines connected yet.</div>
                : keys.map(k => (
                  <div className="cc-key-row" key={k.id}>
                    <span className="cc-key-label">{k.label}</span>
                    <span className="cc-key-prefix">{k.prefix}</span>
                    <span className="cc-key-used">{k.lastUsed ? `used ${fmtAgo(k.lastUsed)} ago` : 'never used'}</span>
                    <button className="cc-key-revoke" onClick={() => revoke(k.id)} title="Revoke">✕</button>
                  </div>
                ))}
            </div>
            <div className="cc-modal-foot"><div className="cc-composer-spacer" /><button className="cc-modal-btn ghost" onClick={onClose}>Close</button></div>
          </>
        )}
      </div>
    </div>
  )
}