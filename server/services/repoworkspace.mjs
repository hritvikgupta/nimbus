/**
 * Repo workspace — clone a GitHub repo to a temp dir and expose READ-ONLY, path-confined
 * primitives the analysis agent investigates with (tree / read / grep / manifests). No network
 * for the agent, no writes, everything sandboxed under the clone dir. This replaces the
 * Repomix one-shot dump: the agent reads the REAL source, like an engineer.
 *
 * Per-user: private repos clone with THAT user's GitHub token (connections.mjs).
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getConnections } from '../repositories/connections.mjs'
import { parseRepo } from './codeanalysis.mjs'

const MAX_FILE_BYTES = 64 * 1024
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'out', 'vendor', 'target', '.venv', '__pycache__', 'coverage', '.turbo'])
// Files worth reading wholesale for orientation (manifests + IaC + CI).
const MANIFEST_NAMES = [
  'package.json', 'requirements.txt', 'pyproject.toml', 'Pipfile', 'go.mod', 'Gemfile', 'pom.xml',
  'build.gradle', 'Cargo.toml', 'composer.json', 'Package.swift', '.env.example', '.env.sample',
  'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile', 'serverless.yml', 'serverless.yaml',
  'vercel.json', 'netlify.toml', 'wrangler.toml', 'fly.toml', 'app.yaml', 'Procfile',
]
const README_RE = /^readme(\.md|\.rst|\.txt)?$/i

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 180000, maxBuffer: 1 << 27, ...opts }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message || '').slice(0, 300))) : resolve(stdout || ''))
  })
}

/** Clone a repo (shallow) into a fresh temp dir. Returns { dir, info, fileCount, cleanup }. */
export async function cloneRepo(userId, repoInput) {
  const info = parseRepo(repoInput)
  if (!info) throw new Error(`Couldn't parse a GitHub repo from "${repoInput}".`)
  const token = getConnections(userId).github?.token
  const remote = token ? `https://${token}@github.com/${info.ownerRepo}.git` : `https://github.com/${info.ownerRepo}.git`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nimbus-repo-${info.slug}-`))
  try {
    await run('git', ['clone', '--depth', '1', '--single-branch', remote, dir])
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true })
    const msg = String(e?.message || e)
    const hint = /authentication|denied|not found|403|404|could not read/i.test(msg) ? ' (private repo? connect GitHub with a token that can read it)' : ''
    throw new Error(`git clone failed: ${msg.slice(0, 180)}${hint}`)
  }
  let fileCount = 0
  try { fileCount = (await run('git', ['-C', dir, 'ls-files'])).split('\n').filter(Boolean).length } catch { /* ignore */ }
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } }
  return { dir, info, fileCount, cleanup }
}

/** Resolve a user path safely INSIDE the clone dir (blocks traversal). */
function safeResolve(dir, rel) {
  const abs = path.resolve(dir, rel || '.')
  if (abs !== dir && !abs.startsWith(dir + path.sep)) throw new Error('path escapes the repository')
  return abs
}

/** A bounded recursive file listing (skips heavy/ignored dirs). */
export function listFiles(dir, sub = '.', limit = 400) {
  const root = safeResolve(dir, sub)
  const out = []
  const walk = (d, depth) => {
    if (out.length >= limit || depth > 6) return
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= limit) break
      if (e.isDirectory() && IGNORE_DIRS.has(e.name)) continue
      const abs = path.join(d, e.name)
      const rel = path.relative(dir, abs)
      if (e.isDirectory()) { out.push(rel + '/'); walk(abs, depth + 1) }
      else out.push(rel)
    }
  }
  walk(root, 0)
  return { count: out.length, truncated: out.length >= limit, files: out }
}

/** Read one file (capped), with line numbers for citing. */
export function readFileSafe(dir, rel) {
  const abs = safeResolve(dir, rel)
  let stat
  try { stat = fs.statSync(abs) } catch { return { ok: false, error: `not found: ${rel}` } }
  if (stat.isDirectory()) return { ok: false, error: `${rel} is a directory — use list_files` }
  const buf = fs.readFileSync(abs)
  if (buf.includes(0)) return { ok: false, error: `${rel} looks binary` }
  const truncated = buf.length > MAX_FILE_BYTES
  return { ok: true, path: rel, bytes: stat.size, truncated, content: buf.slice(0, MAX_FILE_BYTES).toString('utf8') }
}

/** grep the tracked source for a pattern. Uses git grep (fast, respects the repo). */
export async function searchCode(dir, pattern, { glob, max = 60 } = {}) {
  if (!pattern || !pattern.trim()) return { ok: false, error: 'empty pattern' }
  const args = ['-C', dir, 'grep', '-n', '-I', '--no-color', '-i', '-e', pattern]
  if (glob) args.push('--', glob)
  let out = ''
  try { out = await run('git', args) }
  catch (e) { if (/exit code 1/i.test(String(e?.message))) return { ok: true, pattern, matches: 0, hits: [] }; /* grep=no match */ }
  const lines = out.split('\n').filter(Boolean).slice(0, max)
  return { ok: true, pattern, matches: lines.length, truncated: lines.length >= max, hits: lines }
}

/** Read README + every dependency/build/IaC manifest present (the orientation bundle). */
export function readManifests(dir) {
  const found = {}
  const top = (() => { try { return fs.readdirSync(dir, { withFileTypes: true }) } catch { return [] } })()
  // root-level manifests + README
  for (const e of top) {
    if (!e.isFile()) continue
    if (MANIFEST_NAMES.includes(e.name) || README_RE.test(e.name)) {
      const r = readFileSafe(dir, e.name); if (r.ok) found[e.name] = r.content
    }
  }
  // nested manifests one or two levels deep (monorepos, /infra, /services/*)
  const { files } = listFiles(dir, '.', 600)
  for (const rel of files) {
    if (rel.endsWith('/')) continue
    const base = path.basename(rel)
    const isTf = rel.endsWith('.tf')
    if ((MANIFEST_NAMES.includes(base) || isTf) && !found[rel] && Object.keys(found).length < 30) {
      if (found[base]) continue // already have root copy
      const r = readFileSafe(dir, rel); if (r.ok) found[rel] = r.content.slice(0, 8000)
    }
  }
  return { ok: true, files: found, note: Object.keys(found).length ? '' : 'no standard manifests found at the root' }
}
