/**
 * Repo files for the Code workspace — clones the workspace's connected repo to a persistent temp
 * dir (cached per user) and serves its file tree + file contents to the editor view. Reuses the
 * read-only, path-confined primitives from repoworkspace.mjs. The clone is kept alive between
 * requests (unlike the agent's per-query clone) so browsing the tree is instant after one pull.
 */
import fs from 'node:fs'
import { cloneRepo, listFiles, readFileSafe } from './repoworkspace.mjs'
import { getProjectRepo, resolveProjectId } from '../repositories/projects.mjs'

const _clones = new Map() // `${userId}:${projectId}` -> { repo, dir, fileCount, at }
const keyOf = (userId, projectId) => `${userId}:${resolveProjectId(userId, projectId)}`

/**
 * Ensure the active project's repo is cloned locally and return its dir. Reused by BOTH the Files
 * view and the agent's codebase tools, so the agent reads from the SAME persistent clone (instant,
 * no re-clone per tool call). force=true re-pulls fresh.
 */
export async function ensureClone(userId, projectId, { force = false } = {}) {
  const repo = getProjectRepo(projectId)
  if (!repo) return { ok: false, error: 'No repository connected to this project — connect one first.' }
  const key = keyOf(userId, projectId)
  const cached = _clones.get(key)
  if (cached && cached.repo === repo && !force && fs.existsSync(cached.dir)) {
    return { ok: true, repo, dir: cached.dir, fileCount: cached.fileCount }
  }
  if (cached?.dir) { try { fs.rmSync(cached.dir, { recursive: true, force: true }) } catch { /* ignore */ } }
  let ws
  try { ws = await cloneRepo(userId, repo) }
  catch (e) { return { ok: false, error: String(e?.message || e) } }
  _clones.set(key, { repo, dir: ws.dir, fileCount: ws.fileCount, at: Date.now() })
  return { ok: true, repo, dir: ws.dir, fileCount: ws.fileCount }
}

/** Clone (or reuse) the active project's repo and return its file tree. force=true re-pulls fresh. */
export async function pullRepoFiles(userId, projectId, { force = false } = {}) {
  const e = await ensureClone(userId, projectId, { force })
  if (!e.ok) return e
  return { ok: true, repo: e.repo, fileCount: e.fileCount, ...listFiles(e.dir, '.', 3000) }
}

/** Read one file from the project's pulled clone (capped at 64KB by readFileSafe). */
export function repoFileContent(userId, projectId, path) {
  const c = _clones.get(keyOf(userId, projectId))
  if (!c || !fs.existsSync(c.dir)) return { ok: false, error: 'Repo not pulled yet — open Files to pull it.' }
  return readFileSafe(c.dir, path)
}

/** Is this project's repo already pulled? (for the UI to show pull state without re-cloning) */
export function cloneState(userId, projectId) {
  const repo = getProjectRepo(projectId)
  const c = _clones.get(keyOf(userId, projectId))
  return { repo: repo || null, pulled: !!(c && c.repo === repo && fs.existsSync(c.dir)), fileCount: c?.fileCount || 0 }
}
