/**
 * Per-user chat sessions, persisted to disk (server/.data/chats.json) like the other stores.
 * Each session keeps its full UIMessage list so the user can switch back to an old conversation
 * or start a new one — the professional session model (list / create / open / save / delete).
 */
import crypto from 'node:crypto'
import { loadJson, saveJson } from './store.mjs'

const _chats = new Map(Object.entries(loadJson('chats.json', {}))) // userId -> [{ id, title, messages, createdAt, updatedAt }]
const persist = () => saveJson('chats.json', Object.fromEntries(_chats))

/** Lightweight list for the switcher (no message bodies), newest first. */
export function listChats(userId) {
  return (_chats.get(userId) || [])
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, count: (c.messages || []).length }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function createChat(userId, title = 'New chat') {
  const list = _chats.get(userId) || []
  const chat = { id: crypto.randomUUID(), title: title || 'New chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() }
  list.unshift(chat)
  _chats.set(userId, list)
  persist()
  return chat
}

export function getChat(userId, id) {
  return (_chats.get(userId) || []).find((c) => c.id === id) || null
}

export function saveChat(userId, id, patch) {
  const list = _chats.get(userId) || []
  const c = list.find((x) => x.id === id)
  if (!c) return null
  if (Array.isArray(patch.messages)) c.messages = patch.messages
  if (patch.title) c.title = patch.title
  c.updatedAt = Date.now()
  persist()
  return c
}

export function deleteChat(userId, id) {
  _chats.set(userId, (_chats.get(userId) || []).filter((c) => c.id !== id))
  persist()
  return { ok: true }
}
