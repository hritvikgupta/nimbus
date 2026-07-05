/**
 * Code-chat WORKSPACE store (per-user, per-PROJECT), persisted to disk (server/.data/workspaces.json).
 *
 * This is the Slack/hilos-style team space: a set of channels and the messages in each channel,
 * scoped to the active project (so switching projects switches channels + chat history). @nimbus
 * participates as a member — its turns are stored as normal assistant UIMessages so the same
 * AgentThread renderer shows them. The isolation boundary is (userId, projectId); the repo itself
 * lives on the project (repositories/projects.mjs).
 */
import crypto from 'node:crypto'
import { loadJson, saveJson } from './store.mjs'

// "userId::projectId" -> { channels:[{id,name,topic,kind}], messages:{ [channelId]: UIMessage[] } }
const _ws = new Map(Object.entries(loadJson('workspaces.json', {})))
const persist = () => saveJson('workspaces.json', Object.fromEntries(_ws))

const key = (userId, projectId) => `${userId}::${projectId || '_default'}`

/** Get (or lazily create) the project's workspace with a default #general channel + Nimbus DM. */
export function getWorkspace(userId, projectId) {
  const k = key(userId, projectId)
  let w = _ws.get(k)
  if (!w) {
    const general = { id: crypto.randomUUID(), name: 'general', topic: 'Talk to your code with @nimbus', kind: 'channel' }
    const dm = { id: crypto.randomUUID(), name: 'Nimbus', topic: 'Direct message with the Nimbus agent', kind: 'dm' }
    w = { channels: [general, dm], messages: { [general.id]: [], [dm.id]: [] } }
    _ws.set(k, w)
    persist()
  }
  return w
}

/** Light meta for the sidebar (no message bodies). */
export function workspaceMeta(userId, projectId) {
  const w = getWorkspace(userId, projectId)
  return {
    channels: w.channels.map((c) => ({ ...c, count: (w.messages[c.id] || []).length })),
  }
}

export function createChannel(userId, projectId, name) {
  const w = getWorkspace(userId, projectId)
  const clean = String(name || '').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'channel'
  const ch = { id: crypto.randomUUID(), name: clean, topic: '', kind: 'channel' }
  w.channels.push(ch)
  w.messages[ch.id] = []
  persist()
  return ch
}

export function deleteChannel(userId, projectId, channelId) {
  const w = getWorkspace(userId, projectId)
  const ch = w.channels.find((c) => c.id === channelId)
  if (!ch || ch.kind === 'dm' || ch.name === 'general') return { ok: false } // keep #general + the Nimbus DM
  w.channels = w.channels.filter((c) => c.id !== channelId)
  delete w.messages[channelId]
  persist()
  return { ok: true }
}

export function getMessages(userId, projectId, channelId) {
  const w = getWorkspace(userId, projectId)
  return w.messages[channelId] || []
}

export function saveMessages(userId, projectId, channelId, messages) {
  const w = getWorkspace(userId, projectId)
  if (!w.channels.some((c) => c.id === channelId)) return { ok: false }
  w.messages[channelId] = Array.isArray(messages) ? messages : []
  persist()
  return { ok: true, count: w.messages[channelId].length }
}
