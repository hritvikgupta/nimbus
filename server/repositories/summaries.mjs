/** Session summaries stored on OUR end (off-machine), so they survive machine teardown and can be
 * used to RESUME a past session on a new/restarted machine. Keyed per project owner; one entry per
 * source machine (rental), updated in place as the agent maintains its summary.md.
 * Stored as { [ownerId]: Summary[] } in server/.data/summaries.json. */
import { loadJson, saveJson } from './store.mjs'
import crypto from 'node:crypto'

const FILE = 'summaries.json'
const all = () => loadJson(FILE, {})
const write = (d) => saveJson(FILE, d)

const titleFrom = (content, fallback) => {
  const line = (content || '').split('\n').map((s) => s.trim().replace(/^[-*#>\s]+/, '')).find(Boolean)
  return (line ? line.slice(0, 70) : fallback) || 'Session'
}

export function listSummaries(owner, projectId) {
  const list = all()[owner] || []
  return (projectId ? list.filter((s) => s.projectId === projectId) : list).sort((a, b) => b.updatedAt - a.updatedAt)
}
export function getSummary(owner, id) {
  return (all()[owner] || []).find((s) => s.id === id) || null
}

// Upsert keyed by sourceId (the rental that produced it) so a machine's summary updates in place.
export function upsertSummary(owner, { sourceId, projectId, agent, size, content }) {
  if (!content || !content.trim()) return null
  const d = all(); const list = d[owner] || []
  const now = Date.now()
  const title = titleFrom(content, `${agent || 'agent'}${size ? ` · ${size}` : ''}`)
  const i = list.findIndex((s) => s.sourceId === sourceId)
  if (i >= 0) list[i] = { ...list[i], content, title, agent, size, updatedAt: now }
  else list.unshift({ id: 'sum-' + crypto.randomUUID().slice(0, 8), sourceId, projectId, agent, size, title, content, createdAt: now, updatedAt: now })
  d[owner] = list; write(d)
  return i >= 0 ? list[i] : list[0]
}
