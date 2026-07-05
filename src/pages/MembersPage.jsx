/** Members & access — invite teammates and manage per-member permissions for the shared project. */
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { I, initials } from '../components/workspace/icons.jsx'
import {
  getProjectMembers, inviteProjectMember, removeProjectMember, setMemberPerms,
  getWorkspace, getRepairWorkers,
} from '../lib/api.js'

const CAPS = [
  { key: 'channels', label: 'Channels', hint: 'Team channels + @nimbus chat' },
  { key: 'machines', label: 'Machines & repairs', hint: 'Connected computers + repairs' },
  { key: 'clouds', label: 'Cloud & resources', hint: 'AWS / GCP, overview, cost, resources' },
]
export function MembersPage() {
  const { project, overview } = useOutletContext()
  const [members, setMembers] = useState(null)
  const [isOwner, setIsOwner] = useState(false)
  const [sel, setSel] = useState(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [channels, setChannels] = useState([])
  const [machines, setMachines] = useState([])

  const load = () => getProjectMembers(project.id).then(r => { setMembers(r?.members || []); setIsOwner(!!r?.isOwner) }).catch(() => setMembers([]))
  useEffect(() => {
    if (!project?.id) return
    load()
    getWorkspace(project.id).then(w => setChannels((w?.channels || []).filter(c => c.kind !== 'dm'))).catch(() => setChannels([]))
    getRepairWorkers(project.id).then(r => setMachines(r?.workers || [])).catch(() => setMachines([]))
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const invite = async () => {
    const e = email.trim(); if (!e) return
    setBusy(true); setMsg('')
    try {
      const r = await inviteProjectMember(project.id, e)
      setMembers(r?.members || members)
      setMsg(r?.added ? `${e} added.` : r?.already ? `${e} is already a member.` : r?.invited ? `Invite sent — ${e} joins when they sign up.` : '')
      setEmail('')
    } catch (err) { setMsg(err?.data?.error || 'Could not invite.') } finally { setBusy(false) }
  }
  const remove = async (uid2) => { try { const r = await removeProjectMember(project.id, uid2); setMembers(r?.members || members); if (sel === uid2) setSel(null) } catch { /* */ } }
  const toggle = async (m, cap) => {
    const next = { ...m.perms, [cap]: !m.perms[cap] }
    setMembers(ms => ms.map(x => x.id === m.id ? { ...x, perms: next } : x))
    try { const r = await setMemberPerms(project.id, m.id, { [cap]: next[cap] }); setMembers(r?.members || members) } catch { load() }
  }

  const resources = overview?.resources || []
  const selected = members?.find(m => (m.id || m.email) === sel) || null

  return (
    <div className="cc-members">
      <aside className="cc-mem-list">
        <div className="cc-mem-head"><span>{I.people()}</span> Members of {project?.name}</div>
        {isOwner && (
          <div className="cc-mem-invite">
            <input placeholder="teammate@company.com" value={email} type="email"
              onChange={e => setEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') invite() }} />
            <button disabled={busy || !email.trim()} onClick={invite}>{busy ? '…' : 'Invite'}</button>
          </div>
        )}
        {msg && <div className="cc-mem-msg">{msg}</div>}
        <div className="cc-mem-rows">
          {members === null ? <div className="cc-modal-empty">Loading…</div>
            : members.map((m, i) => (
              <button key={m.id || m.email || i} className={'cc-mem-row' + ((m.id || m.email) === sel ? ' on' : '')} onClick={() => setSel(m.id || m.email)}>
                <span className="cc-dm-av sm">{initials(m.name || m.email)}</span>
                <span className="cc-mem-row-main">
                  <span className="cc-mem-row-name">{m.name || m.email}</span>
                  <span className="cc-mem-row-sub">{m.pending ? 'invited — not joined yet' : m.email}</span>
                </span>
                <span className="cc-act-meta">{m.pending ? 'invited' : m.role}</span>
              </button>
            ))}
        </div>
      </aside>

      <main className="cc-mem-detail">
        {!selected ? (
          <div className="cc-empty"><div className="cc-empty-mark">{I.people({ width: 28, height: 28 })}</div>
            <div className="cc-empty-h">Select a member</div>
            <div className="cc-empty-p">Pick someone on the left to see what they can access in <b>{project?.name}</b> and adjust their permissions.</div></div>
        ) : (
          <>
            <header className="cc-mem-dhead">
              <span className="cc-dm-av lg">{initials(selected.name || selected.email)}</span>
              <div><div className="cc-mem-dname">{selected.name || selected.email}</div><div className="cc-mem-row-sub">{selected.email} · {selected.role}{selected.pending ? ' (pending)' : ''}</div></div>
              {isOwner && selected.role !== 'owner' && !selected.pending && <button className="cc-mem-remove" onClick={() => remove(selected.id)}>Remove</button>}
            </header>

            <div className="cc-mem-sec">Permissions</div>
            <div className="cc-mem-perms">
              {CAPS.map(c => {
                const on = selected.role === 'owner' ? true : selected.perms?.[c.key] !== false
                const locked = selected.role === 'owner' || selected.pending || !isOwner
                return (
                  <div key={c.key} className="cc-mem-perm">
                    <div><div className="cc-mem-perm-l">{c.label}</div><div className="cc-mem-row-sub">{c.hint}</div></div>
                    <button className={'cc-toggle' + (on ? ' on' : '')} disabled={locked} onClick={() => toggle(selected, c.key)}><span /></button>
                  </div>
                )
              })}
            </div>

            <div className="cc-mem-sec">Can access in this project</div>
            <div className="cc-mem-access">
              <AccessGroup title="Channels" allowed={selected.role === 'owner' || selected.perms?.channels !== false}
                items={channels.map(c => '#' + c.name)} empty="No channels yet" />
              <AccessGroup title="Machines" allowed={selected.role === 'owner' || selected.perms?.machines !== false}
                items={machines.map(m => m.host || m.workerId)} empty="No machines connected" />
              <AccessGroup title="Cloud resources" allowed={selected.role === 'owner' || selected.perms?.clouds !== false}
                items={resources.map(rr => `${rr.name} · ${(rr.cloud || '').toUpperCase()}`)} empty="No resources yet" />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
function AccessGroup({ title, allowed, items, empty }) {
  return (
    <div className={'cc-acc-group' + (allowed ? '' : ' off')}>
      <div className="cc-acc-title">{title}{!allowed && <span className="cc-acc-no">no access</span>}</div>
      {!allowed ? <div className="cc-acc-empty">Permission turned off</div>
        : items.length ? <div className="cc-acc-items">{items.map((t, i) => <span key={i} className="cc-acc-chip">{t}</span>)}</div>
          : <div className="cc-acc-empty">{empty}</div>}
    </div>
  )
}

