/** Chat-session routes (per-user). */
import express from 'express'
import { listChats, createChat, getChat, saveChat, deleteChat } from '../repositories/chats.mjs'
import { requireUser } from '../middlewares/auth.mjs'

const r = express.Router()

r.get('/api/chats', requireUser, (req, res) => res.json({ chats: listChats(req.user.id) }))
r.post('/api/chats', requireUser, (req, res) => res.json(createChat(req.user.id, req.body?.title)))
r.get('/api/chats/:id', requireUser, (req, res) => { const c = getChat(req.user.id, req.params.id); c ? res.json(c) : res.status(404).json({ error: 'not found' }) })
r.put('/api/chats/:id', requireUser, (req, res) => res.json(saveChat(req.user.id, req.params.id, req.body || {}) || { error: 'not found' }))
r.delete('/api/chats/:id', requireUser, (req, res) => res.json(deleteChat(req.user.id, req.params.id)))

export default r
