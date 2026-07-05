/**
 * Repo investigation tools — the read-only toolset the codebase-analysis agent uses to explore a
 * cloned repo (see agents/skills/analyze-codebase/SKILL.md). Bound to one clone `dir`; everything
 * is path-confined and read-only. `record_analysis` is the agent's single structured output.
 */
import { tool, jsonSchema } from 'ai'
import { listFiles, readFileSafe, searchCode, readManifests } from '../services/repoworkspace.mjs'

/** Build tools bound to a clone dir. `sink.result` receives the agent's final analysis. */
export function repoTools(dir, sink) {
  return {
    read_manifests: tool({
      description: 'START HERE. Returns the README plus every dependency/build/IaC manifest in the repo (package.json, requirements.txt, go.mod, Gemfile, pom.xml, Dockerfile, docker-compose, *.tf, serverless.yml, .env.example, CI). This is the authoritative list of what the code actually pulls in.',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => readManifests(dir),
    }),
    list_files: tool({
      description: 'List files/folders under a path in the repo (skips node_modules/.git/dist). Use to understand the directory structure and find entrypoints.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { path: { type: 'string', description: 'subdirectory to list (default repo root)' } },
      }),
      execute: async ({ path: p }) => listFiles(dir, p || '.'),
    }),
    read_file: tool({
      description: 'Read a file from the repo (capped at 64KB) to inspect real code — entrypoints, config, schema, usage. Cite the path as evidence for anything you conclude.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { path: { type: 'string', description: 'file path relative to repo root' } },
        required: ['path'],
      }),
      execute: async ({ path: p }) => readFileSafe(dir, p),
    }),
    search_code: tool({
      description: 'Grep the repo source for a pattern (case-insensitive). Use to confirm real usage — e.g. "@aws-sdk", "boto3", "google-cloud", "createClient", "DATABASE_URL", "PrismaClient", an import, an env var. Returns file:line matches.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'text/regex to search for' },
          glob: { type: 'string', description: 'optional pathspec, e.g. "*.ts" or "infra/*"' },
        },
        required: ['pattern'],
      }),
      execute: async ({ pattern, glob }) => searchCode(dir, pattern, { glob }),
    }),
    record_analysis: tool({
      description: 'Call ONCE at the end with the grounded architecture map. Every clouds/datastores/integrations item MUST include real evidence (a file path you read). If a provider is not actually in the code, omit it.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          summary: { type: 'string' },
          kind: { type: 'string' },
          languages: { type: 'array', items: { type: 'string' } },
          components: { type: 'array', items: { type: 'object', properties: {
            name: { type: 'string' }, path: { type: 'string' }, role: { type: 'string' }, detail: { type: 'string' },
          }, required: ['name'] } },
          clouds: { type: 'array', items: { type: 'object', properties: {
            key: { type: 'string' }, name: { type: 'string' }, usedFor: { type: 'string' }, wiring: { type: 'string' }, evidence: { type: 'string' },
          }, required: ['key', 'evidence'] } },
          datastores: { type: 'array', items: { type: 'object', properties: {
            name: { type: 'string' }, evidence: { type: 'string' },
          }, required: ['name', 'evidence'] } },
          integrations: { type: 'array', items: { type: 'object', properties: {
            name: { type: 'string' }, evidence: { type: 'string' },
          }, required: ['name'] } },
          entrypoints: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['summary', 'kind'],
      }),
      execute: async (payload) => { sink.result = payload; return { ok: true, recorded: true } },
    }),
  }
}
