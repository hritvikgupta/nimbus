/**
 * Consistent snapshot of the SQLite store. Uses better-sqlite3's online backup API, so it's safe
 * to run while the server is live (WAL). Writes a timestamped copy under server/.data/backups/ and
 * keeps the most recent KEEP files.
 *
 * Run:      npm run backup
 * Schedule: cron / a Fly scheduled machine calling this every few hours.
 * Restore:  stop the API, copy the chosen backup over server/.data/nimbus.db (remove -wal/-shm
 *           sidecars first), then start the API. See docs/production-readiness/tier-0-blockers.md.
 *
 * For real durability in production, ship these backups off-box (S3/R2) or use LiteFS replication.
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.data')
const DB_FILE = path.join(DATA_DIR, 'nimbus.db')
const BACKUP_DIR = path.join(DATA_DIR, 'backups')
const KEEP = Number(process.env.BACKUP_KEEP || 24)

if (!fs.existsSync(DB_FILE)) { console.error('no nimbus.db to back up at', DB_FILE); process.exit(1) }
fs.mkdirSync(BACKUP_DIR, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dest = path.join(BACKUP_DIR, `nimbus-${stamp}.db`)

const db = new Database(DB_FILE, { readonly: true })
await db.backup(dest)
db.close()

// prune old backups, keep newest KEEP
const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('nimbus-') && f.endsWith('.db')).sort()
for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.unlinkSync(path.join(BACKUP_DIR, f))

const size = (fs.statSync(dest).size / 1024).toFixed(0)
console.log(`✓ backup → ${path.relative(process.cwd(), dest)} (${size} KB); keeping ${Math.min(files.length, KEEP)} backups`)
