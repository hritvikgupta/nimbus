/**
 * GCP per-user credentials — the parallel of aws.mjs. A user connects GCP by pasting a
 * Service Account JSON key (the GCP equivalent of AWS access keys). We write it to a
 * per-user file and activate it into a per-user gcloud config dir (CLOUDSDK_CONFIG) so the
 * gcloud CLI (gcloud-mcp) authenticates as that SA, and set GOOGLE_APPLICATION_CREDENTIALS
 * so the Node client libs (cloud-run-mcp) do too — each user's MCP sees only their creds.
 *
 * If no key is supplied, the caller falls back to the host's gcloud login (fine for local
 * single-user testing); the SA-key path is the real per-user isolation.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

function resolveGcloud() {
  for (const c of ['/opt/homebrew/bin/gcloud', '/usr/local/bin/gcloud', '/usr/bin/gcloud']) if (fs.existsSync(c)) return c
  return 'gcloud'
}
const GCLOUD = resolveGcloud()
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.data')

const _activated = new Set() // userId:projectId we've already activated this process

/** Write + activate a user's SA key → env for their GCP MCPs. Throws on bad key. */
export async function resolveGcpEnv({ userId, projectId, serviceAccountKey }) {
  const cfgDir = path.join(DATA_DIR, 'gcloud', userId)
  const keyFile = path.join(DATA_DIR, `gcp-${userId}.json`)
  fs.mkdirSync(cfgDir, { recursive: true })
  fs.writeFileSync(keyFile, serviceAccountKey, { mode: 0o600 })

  const key = `${userId}:${projectId || ''}`
  if (!_activated.has(key)) {
    await execFileAsync(
      GCLOUD,
      ['auth', 'activate-service-account', '--key-file', keyFile, ...(projectId ? ['--project', projectId] : [])],
      { env: { ...process.env, CLOUDSDK_CONFIG: cfgDir }, timeout: 20000 },
    )
    _activated.add(key)
  }
  return {
    CLOUDSDK_CONFIG: cfgDir,
    GOOGLE_APPLICATION_CREDENTIALS: keyFile,
    CLOUDSDK_CORE_PROJECT: projectId || '',
  }
}
