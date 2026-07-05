/**
 * Code tools — let the Nimbus chat agent analyze the user's GitHub repos and read their code, so
 * it can understand the stack, find which cloud/DB providers the code uses, and design the
 * resources it needs on the canvas.
 *
 * analyze_repo runs the codebase-analysis AGENT (clone → investigate the real source → grounded,
 * cited map). read_codebase clones shallow on demand and greps the real source — no Repomix dump.
 */
import { tool, jsonSchema } from 'ai'
import { listRepos } from '../services/codeanalysis.mjs'
import { analyzeRepoAgent } from '../agents/analyze/run.mjs'
import { cloneRepo, searchCode, listFiles, readFileSafe, readManifests } from '../services/repoworkspace.mjs'
import { ensureClone } from '../services/repofiles.mjs'

/**
 * Claude-Code-style codebase tools, bound to the ACTIVE PROJECT's already-cloned repo. The agent
 * uses these to investigate the repo iteratively — list a dir, read a file, grep — like an engineer
 * (vs. the one-shot analyze_repo). Reads the SAME persistent clone the Files view uses (no re-clone
 * per call). Only added to the agent when a repo is connected to the project (the Code channel).
 */
export function repoFileTools(userId, projectId) {
  const dir = async () => ensureClone(userId, projectId) // clones once, reused after
  return {
    repo_overview: tool({
      description: 'START HERE for a connected repo. Returns the README + every dependency/build/IaC manifest (package.json, requirements.txt, go.mod, Dockerfile, docker-compose, *.tf, serverless.yml, CI, …) — the authoritative picture of the stack. Use this before answering "what is this repo / what stack".',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => { const c = await dir(); return c.ok ? readManifests(c.dir) : c },
    }),
    list_repo_files: tool({
      description: 'List files/folders under a path in the connected repo (skips node_modules/.git/dist). Use to understand structure and find entrypoints. Omit path for the repo root.',
      inputSchema: jsonSchema({ type: 'object', properties: { path: { type: 'string', description: 'subdirectory (default repo root)' } } }),
      execute: async ({ path: p }) => { const c = await dir(); return c.ok ? listFiles(c.dir, p || '.') : c },
    }),
    read_repo_file: tool({
      description: 'Read a file from the connected repo (capped at 64KB) to inspect the real code. Cite the path:line for anything you conclude.',
      inputSchema: jsonSchema({ type: 'object', properties: { path: { type: 'string', description: 'file path relative to repo root' } }, required: ['path'] }),
      execute: async ({ path: p }) => { const c = await dir(); return c.ok ? readFileSafe(c.dir, p) : c },
    }),
    grep_repo: tool({
      description: 'Grep the connected repo source for a pattern (case-insensitive). Use to find usage/definitions — a function, import, env var ("DATABASE_URL"), a dependency ("@aws-sdk"), etc. Returns file:line matches.',
      inputSchema: jsonSchema({ type: 'object', properties: { pattern: { type: 'string' }, glob: { type: 'string', description: 'optional pathspec, e.g. "*.ts"' } }, required: ['pattern'] }),
      execute: async ({ pattern, glob }) => { const c = await dir(); return c.ok ? searchCode(c.dir, pattern, { glob }) : c },
    }),
  }
}

export function codeTools(userId) {
  return {
    analyze_repo: tool({
      description: 'Clone and analyze a GitHub repository with the codebase agent — it reads the real source and returns a grounded, cited architecture map (what it is, components, the cloud/DB providers it actually uses with evidence). Call this when the user asks you to look at / deploy / understand a repo.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { repo: { type: 'string', description: 'GitHub repo URL or owner/repo (private repos need the user’s GitHub connection)' } },
        required: ['repo'],
      }),
      execute: async ({ repo }) => analyzeRepoAgent(userId, repo),
    }),

    list_repos: tool({
      description: 'List the repositories this user has already analyzed (with their grounded structure).',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => ({ repos: listRepos(userId) }),
    }),

    read_codebase: tool({
      description: 'Search a GitHub repo’s real source (clones it shallow on demand and greps). Pass a query like "@aws-sdk", "DATABASE_URL", "PrismaClient", "google-cloud", an import, or an env var to confirm exactly how/where something is used (with file:line). Omit query to list the file tree.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'GitHub repo URL or owner/repo' },
          query: { type: 'string', description: 'optional search term (grep)' },
        },
        required: ['repo'],
      }),
      execute: async ({ repo, query }) => {
        let ws
        try { ws = await cloneRepo(userId, repo) }
        catch (e) { return { ok: false, error: String(e?.message || e) } }
        try {
          if (!query) return { ok: true, repo: ws.info.ownerRepo, ...listFiles(ws.dir, '.') }
          return { ok: true, repo: ws.info.ownerRepo, ...(await searchCode(ws.dir, query)) }
        } finally { ws.cleanup() }
      },
    }),
  }
}
