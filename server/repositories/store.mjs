/**
 * Persistence layer for the backend. Originally a JSON-file store (one file per collection under
 * server/.data); now backed by SQLite (better-sqlite3) so concurrent writes are safe and durable
 * under many users — no more whole-file rewrites clobbering each other.
 *
 * The public interface is UNCHANGED and synchronous — `loadJson(name, fallback)` /
 * `saveJson(name, data)` — so every existing call site keeps working with zero changes. Each
 * "file name" (e.g. 'users.json') is one row in a key→JSON table.
 *
 * On first run it auto-migrates any existing server/.data/*.json into the DB (one-time seed), so
 * current users/projects/connections carry over. To later move to Postgres for multi-machine
 * scaling, swap this one file (call sites still don't change).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.data')
const DB_FILE = path.join(DATA_DIR, 'nimbus.db')

fs.mkdirSync(DATA_DIR, { recursive: true })
const db = new Database(DB_FILE)
db.pragma('journal_mode = WAL')   // WAL → concurrent readers don't block the writer
db.pragma('synchronous = NORMAL') // durable + fast
db.exec('CREATE TABLE IF NOT EXISTS kv (name TEXT PRIMARY KEY, data TEXT NOT NULL)')

const _get = db.prepare('SELECT data FROM kv WHERE name = ?')
const _put = db.prepare('INSERT INTO kv (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data')

// ── One-time migration: seed the DB from any legacy .data/*.json files ────────────────────────
function migrateLegacyFiles() {
  const already = db.prepare("SELECT 1 FROM kv WHERE name = '__migrated__'").get()
  if (already) return
  const seed = db.transaction(() => {
    let n = 0
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (!f.endsWith('.json')) continue
      try {
        const raw = fs.readFileSync(path.join(DATA_DIR, f), 'utf8')
        JSON.parse(raw) // validate
        _put.run(f, raw)
        n++
      } catch { /* skip unreadable/invalid files */ }
    }
    _put.run('__migrated__', JSON.stringify({ at: Date.now(), files: n }))
  })
  try { seed() } catch { /* if .data is unreadable, start fresh */ }
}
migrateLegacyFiles()

// ── Seed committed reference data (server/seed/*.json) ────────────────────────────────────────
// Static, non-secret reference the app needs but that isn't user data — e.g. the Terraform
// provider schemas (tf-aws.json / tf-gcp.json) that drive resource config fields. Committed to the
// repo so a fresh clone works out of the box. Loaded only if the key is ABSENT, so it never
// overwrites a value a running instance already has.
function seedReferenceData() {
  const SEED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed')
  if (!fs.existsSync(SEED_DIR)) return
  const putIfAbsent = db.prepare('INSERT INTO kv (name, data) VALUES (?, ?) ON CONFLICT(name) DO NOTHING')
  for (const f of fs.readdirSync(SEED_DIR)) {
    if (!f.endsWith('.json')) continue
    try {
      const raw = fs.readFileSync(path.join(SEED_DIR, f), 'utf8')
      JSON.parse(raw) // validate
      putIfAbsent.run(f, raw)
    } catch { /* skip unreadable/invalid seed files */ }
  }
}
try { seedReferenceData() } catch { /* seed dir optional */ }

export function loadJson(name, fallback) {
  try {
    const row = _get.get(name)
    return row ? JSON.parse(row.data) : fallback
  } catch { return fallback }
}

export function saveJson(name, data) {
  _put.run(name, JSON.stringify(data))
}
