/** Universal search — command palette across this project's resources, channels (+ messages),
 * and the user's Nimbus chats (+ messages). Resources/channels are shared (owner-scoped); the
 * personal Nimbus chats stay per-user. */
import express from 'express'
import { requireUser } from '../middlewares/auth.mjs'
import { memberOwner } from '../repositories/projects.mjs'
import { getWorkspace, getMessages } from '../repositories/workspace.mjs'
import { listChats, getChat } from '../repositories/chats.mjs'
import { projectResources } from '../services/cloud.mjs'

const r = express.Router()

const textOf = (m) => {
  if (typeof m?.text === 'string') return m.text
  if (Array.isArray(m?.parts)) return m.parts.filter((p) => p.type === 'text').map((p) => p.text).join(' ')
  if (typeof m?.content === 'string') return m.content
  if (Array.isArray(m?.content)) return m.content.map((c) => (typeof c === 'string' ? c : c.text || '')).join(' ')
  return ''
}
// A short snippet around the first match, for message results.
const snippet = (text, q) => {
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return text.slice(0, 90)
  const start = Math.max(0, i - 30)
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + 60).trim() + (text.length > i + q.length + 60 ? '…' : '')
}

r.get('/api/search', requireUser, async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase()
  const projectId = req.query.projectId
  if (q.length < 1) return res.json({ results: [] })
  const owner = memberOwner(req.user.id, projectId)
  const results = []

  // Cloud resources (shared)
  try {
    if (owner !== null) {
      const ress = await projectResources(req.cloudUserId, projectId)
      for (const rr of ress) {
        if (`${rr.name} ${rr.type} ${rr.cloud} ${rr.region}`.toLowerCase().includes(q))
          results.push({ kind: 'resource', id: rr.name, title: rr.name, sub: `${rr.type} · ${(rr.cloud || '').toUpperCase()}` })
      }
    }
  } catch { /* ignore */ }

  // Channels + their messages (shared)
  try {
    if (owner) {
      const ws = getWorkspace(owner, projectId)
      for (const ch of (ws.channels || [])) {
        if (ch.kind === 'dm') continue
        if ((ch.name || '').toLowerCase().includes(q)) results.push({ kind: 'channel', id: ch.id, title: '#' + ch.name, sub: 'Channel' })
        const msgs = getMessages(owner, projectId, ch.id) || []
        for (const m of msgs) { const t = textOf(m); if (t.toLowerCase().includes(q)) { results.push({ kind: 'channel-msg', id: ch.id, title: snippet(t, q), sub: 'in #' + ch.name }); break } }
      }
    }
  } catch { /* ignore */ }

  // Nimbus chats (personal) + their messages
  try {
    for (const c of listChats(req.user.id)) {
      if ((c.title || '').toLowerCase().includes(q)) results.push({ kind: 'chat', id: c.id, title: c.title || 'Chat', sub: 'Nimbus chat' })
      const full = getChat(req.user.id, c.id)
      for (const m of (full?.messages || [])) { const t = textOf(m); if (t.toLowerCase().includes(q)) { results.push({ kind: 'chat-msg', id: c.id, title: snippet(t, q), sub: 'in ' + (c.title || 'Nimbus chat') }); break } }
    }
  } catch { /* ignore */ }

  res.json({ results: results.slice(0, 40) })
})

export default r
