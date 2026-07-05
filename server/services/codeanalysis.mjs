/**
 * Code analysis — clone + pack a user's GitHub repo with Repomix, store it per-user, and let
 * the Nimbus agent read/query it (to understand the stack, find which cloud/DB providers the
 * code uses, and design the resources it needs on the canvas).
 *
 * Repomix (`--remote`) clones the repo, compresses it with tree-sitter (token-efficient), and
 * runs a secret-detection security check that EXCLUDES suspicious files — so we never persist
 * credentials. The packed file is stored under server/.data/repos/<userId>/<slug>.md, indexed
 * in repos-index.json. Storage is UNCONDITIONAL (even if no cloud provider is detected).
 *
 * Per-user throughout: every call is scoped to userId, and private repos clone with THAT user's
 * GitHub token (connections.mjs). Nothing is shared across users.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateText } from 'ai'
import { getConnections } from '../repositories/connections.mjs'
import { loadJson, saveJson } from '../repositories/store.mjs'
import { chatModel } from '../libs/openrouter.mjs'

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.data')
const REPO_DIR = path.join(DATA_DIR, 'repos')

function resolveNpx() {
  const local = path.join(path.dirname(process.execPath), 'npx')
  return fs.existsSync(local) ? local : 'npx'
}
const NPX = resolveNpx()

/** Parse various repo forms (url, owner/repo, git@…) → { ownerRepo, httpsUrl, slug }. */
export function parseRepo(input) {
  let s = String(input || '').trim().replace(/\.git$/, '')
  let owner, repo
  const m = s.match(/github\.com[/:]([^/]+)\/([^/?#]+)/i)
  if (m) { owner = m[1]; repo = m[2] }
  else { const p = s.split('/').filter(Boolean); if (p.length >= 2) { owner = p[p.length - 2]; repo = p[p.length - 1] } }
  if (!owner || !repo) return null
  const ownerRepo = `${owner}/${repo}`
  return {
    owner, repo, ownerRepo,
    httpsUrl: `https://github.com/${ownerRepo}`,
    slug: ownerRepo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  }
}

function runRepomix(remote, outFile) {
  return new Promise((resolve, reject) => {
    execFile(
      NPX,
      ['-y', 'repomix', '--remote', remote, '--compress', '--style', 'markdown', '--output', outFile],
      { timeout: 240000, maxBuffer: 1 << 28, env: { ...process.env } },
      (err, stdout, stderr) => err ? reject(new Error(String(stderr || err.message || '').slice(0, 400))) : resolve(stdout || ''),
    )
  })
}

function parseSummary(stdout, content) {
  const num = (re) => { const m = stdout.match(re); return m ? Number(m[1].replace(/,/g, '')) : null }
  const files = num(/Total Files:\s*([\d,]+)/) ?? (content.match(/^## File:/gm) || []).length
  const tokens = num(/Total Tokens:\s*([\d,]+)/)
  return { files, tokens }
}

/* ---- real structure detection (deterministic scan of the packed repo — no hardcoding) ---- */

// Every "## File: <path>" header Repomix emits → the real file list of the repo.
function filePaths(content) {
  const out = []
  const re = /^## File:\s*(.+)$/gm
  let m
  while ((m = re.exec(content))) out.push(m[1].trim())
  return out
}

const EXT_LANG = { js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', py: 'Python', go: 'Go', rb: 'Ruby', java: 'Java', kt: 'Kotlin', rs: 'Rust', php: 'PHP', cs: 'C#', swift: 'Swift', scala: 'Scala', ex: 'Elixir', exs: 'Elixir' }

// Cloud-provider signatures — matched against the actual packed source.
const CLOUD_SIGS = [
  { key: 'aws', name: 'Amazon Web Services', re: /aws-sdk|@aws-sdk\/|\bboto3\b|amazonaws\.com|provider\s+"aws"|serverless\.yml|lambda_handler|\bAWS_(ACCESS|REGION|SECRET)/i },
  { key: 'gcp', name: 'Google Cloud', re: /@google-cloud\/|google-cloud-[a-z]|googleapis\.com|GOOGLE_APPLICATION_CREDENTIALS|provider\s+"google"|cloudfunctions|\bgcloud\b/i },
  { key: 'azure', name: 'Microsoft Azure', re: /@azure\/|azure-sdk|AZURE_[A-Z]|azurewebsites\.net|provider\s+"azurerm"/i },
  { key: 'supabase', name: 'Supabase', re: /@supabase\/|supabase\.co|SUPABASE_(URL|KEY|ANON)/i },
  { key: 'neon', name: 'Neon', re: /neon\.tech|@neondatabase\/|NEON_/i },
  { key: 'cloudflare', name: 'Cloudflare', re: /wrangler\.toml|@cloudflare\/|cloudflareworkers/i },
  { key: 'vercel', name: 'Vercel', re: /vercel\.json|@vercel\//i },
]
const DB_SIGS = [
  { key: 'postgres', name: 'PostgreSQL', re: /postgres|psycopg|pg8000|"pg"|POSTGRES_|prisma|drizzle-orm/i },
  { key: 'mysql', name: 'MySQL', re: /\bmysql\b|mysql2|mariadb/i },
  { key: 'mongodb', name: 'MongoDB', re: /mongodb|mongoose/i },
  { key: 'redis', name: 'Redis', re: /\bredis\b|ioredis/i },
  { key: 'dynamodb', name: 'DynamoDB', re: /dynamodb|DynamoDBClient/i },
  { key: 'sqlite', name: 'SQLite', re: /sqlite/i },
]
const ORM_SIGS = [
  { name: 'Prisma', re: /prisma/i }, { name: 'Drizzle', re: /drizzle-orm/i }, { name: 'TypeORM', re: /typeorm/i },
  { name: 'Sequelize', re: /sequelize/i }, { name: 'SQLAlchemy', re: /sqlalchemy/i }, { name: 'Mongoose', re: /mongoose/i },
]
// service-role inference from directory/file names
const ROLE_SIGS = [
  { code: 'api', name: 'REST / HTTP API', re: /(express|fastify|fastapi|flask|gin-gonic|@nestjs|router|routes|controllers)/i },
  { code: 'auth', name: 'Auth service', re: /(passport|jsonwebtoken|\bjwt\b|oauth|next-auth|clerk|cognito)/i },
  { code: 'job', name: 'Background workers', re: /(bull|bullmq|celery|sidekiq|worker|queue|cron|sqs)/i },
  { code: 'web', name: 'Web frontend', re: /(next|react|vue|svelte|vite|angular)/i },
  { code: 'fn', name: 'Serverless functions', re: /(lambda|cloudfunctions|functions\/|handler\.)/i },
]

function uniq(a) { return [...new Set(a)] }

// Derive real "services" from the repo's directory layout (monorepo roots), else from detected roles.
function deriveServices(paths, content) {
  const counts = new Map()
  for (const p of paths) {
    const m = p.match(/(?:^|\/)?(services|apps|packages|cmd|functions|modules)\/([^/]+)\//i)
    if (m) { const name = m[2]; counts.set(name, (counts.get(name) || 0) + 1) }
  }
  let services = [...counts.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, n]) => ({ code: name.slice(0, 4).toLowerCase(), name, detail: `${n} files · /${name}` }))
  if (services.length === 0) {
    // no monorepo layout — infer from frameworks/roles actually present in the code
    services = ROLE_SIGS.filter((r) => r.re.test(content)).slice(0, 5)
      .map((r) => ({ code: r.code, name: r.name, detail: 'detected in code' }))
  }
  return services
}

// Repomix prepends a "Directory Structure" tree before the files — grab it for the model.
function directoryTree(content) {
  const m = content.match(/#+\s*(Directory Structure|Repository Structure)[\s\S]*?\n([\s\S]*?)\n#+\s/i)
  return m ? m[2].slice(0, 8000) : ''
}

/**
 * REAL architecture analysis — the model reads the actual packed code (Repomix) and returns a
 * grounded JSON description of THIS repo: what it is, its real services (with paths), the cloud
 * providers it uses (with evidence), and its data layer. No keyword guessing, no templates.
 */
export async function analyzeArchitecture(content) {
  const tree = directoryTree(content)
  // Send the file tree + a large head of the packed code (already token-compressed by Repomix).
  const code = content.slice(0, 90000)
  const prompt = `You are a senior staff engineer doing a real architecture review. Below is a repository packed by Repomix (a real export of the actual code: a directory tree followed by file contents).

Analyze ONLY what is actually in the code. Do NOT invent services, clouds, or databases that aren't there. If something isn't present, omit it. Be specific to THIS repo (use real names and paths from the tree).

Return STRICT JSON (no markdown, no prose) with this exact shape:
{
  "summary": "one concrete sentence: what this repo actually is",
  "kind": "e.g. macOS app / web app / API service / CLI / library / monorepo",
  "languages": ["actual languages, most-used first"],
  "services": [ { "name": "real component name", "path": "real dir/file path", "role": "api|frontend|worker|cli|desktop|service|infra|lib", "detail": "short, specific" } ],
  "clouds": [ { "key": "aws|gcp|azure|supabase|neon|cloudflare|vercel|fly", "name": "provider name", "evidence": "the file/SDK/string that proves it" } ],
  "datastores": [ { "name": "Postgres|Redis|...", "evidence": "where it's used" } ]
}

Keep services to the real top-level components (max 6). If there are no cloud providers in the code, return "clouds": [].

=== DIRECTORY TREE ===
${tree}

=== PACKED CODE (truncated) ===
${code}`

  try {
    const { text } = await generateText({ model: chatModel(), prompt, temperature: 0 })
    const jsonStr = (text.match(/\{[\s\S]*\}/) || [])[0]
    if (!jsonStr) return null
    const parsed = JSON.parse(jsonStr)
    // normalize cloud keys
    if (Array.isArray(parsed.clouds)) parsed.clouds = parsed.clouds.map((c) => ({ key: String(c.key || '').toLowerCase(), name: c.name || c.key, evidence: c.evidence || '' })).filter((c) => c.key)
    if (Array.isArray(parsed.services)) parsed.services = parsed.services.slice(0, 6)
    return parsed
  } catch (e) {
    console.error('[codeanalysis] model analysis failed:', e?.message || e)
    return null
  }
}

// short tile code for a service node, from its role then its name
const ROLE_CODE = { api: 'api', frontend: 'web', worker: 'job', cli: 'cli', desktop: 'app', infra: 'infra', service: 'svc', lib: 'lib' }
function codeFor(s) { return (ROLE_CODE[String(s.role || '').toLowerCase()] || String(s.name || 'svc').replace(/[^a-z0-9]/gi, '').slice(0, 4) || 'svc').toLowerCase() }

// Prefer the model's grounded read; fall back to / union with the deterministic scan.
function mergeStructure(d, ai) {
  if (!ai) return d
  const cloudMap = new Map()
  for (const c of d.clouds) cloudMap.set(c.key, { key: c.key, name: c.name })
  for (const c of (ai.clouds || [])) cloudMap.set(c.key, { key: c.key, name: c.name, evidence: c.evidence })
  const services = (ai.services && ai.services.length)
    ? ai.services.map((s) => ({ code: codeFor(s), name: s.name, detail: s.path || s.detail || s.role || '', role: s.role || '', path: s.path || '' }))
    : d.services
  const datastores = (ai.datastores && ai.datastores.length)
    ? ai.datastores.map((x) => ({ key: String(x.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6), name: x.name, evidence: x.evidence || '' }))
    : d.datastores
  return {
    fileCount: d.fileCount,
    summary: ai.summary || '',
    kind: ai.kind || '',
    languages: d.languages.length ? d.languages : (ai.languages || []).map((n) => ({ name: n })),
    clouds: [...cloudMap.values()],
    datastores,
    orms: d.orms,
    services,
    analyzedBy: 'model',
  }
}

function extractStructure(content) {
  const paths = filePaths(content)
  const langCount = {}
  for (const p of paths) { const e = (p.split('.').pop() || '').toLowerCase(); if (EXT_LANG[e]) langCount[EXT_LANG[e]] = (langCount[EXT_LANG[e]] || 0) + 1 }
  const languages = Object.entries(langCount).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, files: n })).slice(0, 6)
  const clouds = CLOUD_SIGS.filter((s) => s.re.test(content)).map((s) => ({ key: s.key, name: s.name }))
  const datastores = DB_SIGS.filter((s) => s.re.test(content)).map((s) => ({ key: s.key, name: s.name }))
  const orms = ORM_SIGS.filter((s) => s.re.test(content)).map((s) => s.name)
  const services = deriveServices(paths, content)
  return { fileCount: paths.length, languages, clouds, datastores, orms: uniq(orms), services }
}

/** Clone + pack a repo, store it for this user. Returns a summary (no code, no secrets). */
export async function analyzeRepo(userId, repoInput) {
  const info = parseRepo(repoInput)
  if (!info) return { ok: false, error: `Couldn't parse a GitHub repo from "${repoInput}". Use a URL or owner/repo.` }
  const token = getConnections(userId).github?.token
  // private repos need auth embedded in the clone URL; public repos clone fine with owner/repo
  const remote = token ? `https://${token}@github.com/${info.ownerRepo}.git` : info.ownerRepo

  fs.mkdirSync(path.join(REPO_DIR, userId), { recursive: true })
  const outFile = path.join(REPO_DIR, userId, `${info.slug}.md`)
  try { await runRepomix(remote, outFile) }
  catch (e) {
    const msg = String(e?.message || e)
    const hint = /authentication|not found|403|404/i.test(msg) ? ' (private repo? connect GitHub with a token that can read it)' : ''
    return { ok: false, error: `Repomix failed: ${msg.slice(0, 200)}${hint}` }
  }
  const content = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : ''
  const summary = parseSummary('', content)
  // Real architecture: the model reads the actual packed code; deterministic scan is the backstop.
  const deterministic = extractStructure(content)
  const ai = await analyzeArchitecture(content)
  const structure = mergeStructure(deterministic, ai)

  const idx = loadJson('repos-index.json', {})
  const list = (idx[userId] || []).filter((r) => r.slug !== info.slug)
  const entry = { slug: info.slug, repo: info.ownerRepo, file: path.relative(DATA_DIR, outFile), analyzedAt: Date.now(), ...summary, structure }
  idx[userId] = [entry, ...list]
  saveJson('repos-index.json', idx)
  return { ok: true, ...entry, note: 'Analyzed and stored. Use read_codebase to inspect the stack and provider usage.' }
}

/** The latest analysis entry (incl. real structure) for a repo, or the most recent one. */
export function repoSummary(userId, ref) {
  const list = listRepos(userId)
  if (!list.length) return null
  if (!ref) return list[0]
  return list.find((r) => r.slug === ref || r.repo === ref || r.repo.toLowerCase().endsWith('/' + String(ref).toLowerCase())) || list[0]
}

/** Repos this user has analyzed (summaries only). */
export function listRepos(userId) {
  return loadJson('repos-index.json', {})[userId] || []
}

function loadRepo(userId, ref) {
  const list = listRepos(userId)
  const e = list.find((r) => r.slug === ref || r.repo === ref || r.repo.toLowerCase().endsWith('/' + String(ref).toLowerCase()))
  if (!e) return null
  try { return { entry: e, content: fs.readFileSync(path.join(DATA_DIR, e.file), 'utf8') } } catch { return null }
}

/** Read/search a stored repo. With `query`, returns matching code sections; without, the structure + head. */
export function readCodebase(userId, ref, query, maxChars = 12000) {
  const r = loadRepo(userId, ref)
  if (!r) return { ok: false, error: `"${ref}" hasn't been analyzed. Call analyze_repo first (or list_repos to see what's available).` }
  const { content, entry } = r
  if (!query) {
    return { ok: true, repo: entry.repo, files: entry.files, excerpt: content.slice(0, maxChars), truncated: content.length > maxChars }
  }
  const q = String(query).toLowerCase()
  const lines = content.split('\n')
  let curFile = ''
  const hits = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## File:')) curFile = lines[i]
    if (lines[i].toLowerCase().includes(q)) {
      hits.push((curFile ? curFile + '\n' : '') + lines.slice(Math.max(0, i - 2), i + 3).join('\n'))
      if (hits.join('\n---\n').length > maxChars) break
    }
  }
  return { ok: true, repo: entry.repo, matches: hits.length, excerpt: hits.join('\n---\n').slice(0, maxChars) || `(no lines matched "${query}" — try read_codebase with no query to see the structure)` }
}
