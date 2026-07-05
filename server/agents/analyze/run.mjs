/**
 * Codebase-analysis agent — the real, grounded replacement for the Repomix one-shot.
 *
 * Pipeline: clone the repo → run a Vercel-AI-SDK tool-calling loop where the model investigates
 * the REAL source with read-only tools (read_manifests / list_files / read_file / search_code),
 * following the analyze-codebase SKILL.md playbook → it ends by calling record_analysis with a
 * cited architecture map → we store it (same shape the onboarding map + chat agent already read).
 *
 * Per-user, sandboxed, read-only. Nothing is asserted without a file the agent actually opened.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateText, stepCountIs } from 'ai'
import { chatModel } from '../../libs/openrouter.mjs'
import { loadJson, saveJson } from '../../repositories/store.mjs'
import { cloneRepo } from '../../services/repoworkspace.mjs'
import { repoTools } from '../../tools/repotools.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = fs.readFileSync(path.join(HERE, '..', 'skills', 'analyze-codebase', 'SKILL.md'), 'utf8')
  .replace(/^---[\s\S]*?---\n/, '') // drop frontmatter; keep the playbook body as the system prompt

const ROLE_CODE = { api: 'api', frontend: 'web', worker: 'job', cli: 'cli', desktop: 'app', infra: 'infra', service: 'svc', lib: 'lib' }
const codeFor = (s) => (ROLE_CODE[String(s.role || '').toLowerCase()] || String(s.name || 'svc').replace(/[^a-z0-9]/gi, '').slice(0, 4) || 'svc').toLowerCase()

// Map the agent's grounded output → the structure shape the onboarding map + summary endpoint read.
function toStructure(payload, fileCount) {
  const p = payload || {}
  return {
    fileCount,
    summary: p.summary || '',
    kind: p.kind || '',
    languages: (p.languages || []).map((n) => (typeof n === 'string' ? { name: n } : n)),
    clouds: (p.clouds || []).filter((c) => c && c.key && c.evidence).map((c) => ({
      key: String(c.key).toLowerCase(), name: c.name || c.key, evidence: c.evidence, usedFor: c.usedFor || '', wiring: c.wiring || '',
    })),
    datastores: (p.datastores || []).filter((d) => d && d.name && d.evidence).map((d) => ({ name: d.name, evidence: d.evidence })),
    services: (p.components || []).slice(0, 6).map((s) => ({ code: codeFor(s), name: s.name, detail: s.detail || s.path || s.role || '', role: s.role || '', path: s.path || '' })),
    integrations: (p.integrations || []).filter((i) => i && i.name),
    entrypoints: p.entrypoints || [],
    notes: p.notes || '',
    analyzedBy: 'agent',
  }
}

/** Clone + agent-investigate a repo. Returns { ok, repo, files, structure } and stores it per-user. */
export async function analyzeRepoAgent(userId, repoInput) {
  let ws
  try { ws = await cloneRepo(userId, repoInput) }
  catch (e) { return { ok: false, error: String(e?.message || e) } }

  const sink = {}
  try {
    await generateText({
      model: chatModel(),
      system: SKILL,
      prompt: `A repository (${ws.info.ownerRepo}, ${ws.fileCount} tracked files) is cloned and ready. Investigate it and finish by calling record_analysis with the grounded, cited map. Start with read_manifests.`,
      tools: repoTools(ws.dir, sink),
      stopWhen: stepCountIs(20),
      temperature: 0,
      maxRetries: 2,
    })
  } catch (e) {
    ws.cleanup()
    return { ok: false, error: `analysis failed: ${String(e?.message || e).slice(0, 180)}` }
  }

  const fileCount = ws.fileCount
  ws.cleanup() // remove the clone; we keep only the grounded findings

  if (!sink.result) return { ok: false, error: 'the agent did not produce an analysis — try again' }
  const structure = toStructure(sink.result, fileCount)

  const idx = loadJson('repos-index.json', {})
  const list = (idx[userId] || []).filter((r) => r.slug !== ws.info.slug)
  const entry = { slug: ws.info.slug, repo: ws.info.ownerRepo, analyzedAt: Date.now(), files: fileCount, structure }
  idx[userId] = [entry, ...list]
  saveJson('repos-index.json', idx)
  return { ok: true, repo: ws.info.ownerRepo, files: fileCount, structure, note: 'Analyzed by the codebase agent (grounded in the real source).' }
}
