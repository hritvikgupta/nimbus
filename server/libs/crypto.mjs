/**
 * App-level encryption for secrets at rest (cloud credentials). AES-256-GCM (authenticated —
 * tampering is detected on decrypt). The master key comes from the NIMBUS_ENC_KEY env secret,
 * never from the repo or the DB.
 *
 * Used by connections.mjs so clients' AWS/GCP keys are ciphertext in the database. Plaintext only
 * ever lives in process memory at use time.
 *
 * Key: NIMBUS_ENC_KEY = base64-encoded 32 random bytes. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * In production it is REQUIRED (the process refuses to start without it). In dev, if unset, a key
 * is generated once and cached to server/.data/.enckey so local work needs no setup.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ALGO = 'aes-256-gcm'
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.data')
const DEV_KEY_FILE = path.join(DATA_DIR, '.enckey')

let _key // cached 32-byte Buffer
function key() {
  if (_key) return _key
  const env = process.env.NIMBUS_ENC_KEY
  if (env) {
    const b = Buffer.from(env, 'base64')
    if (b.length !== 32) throw new Error('NIMBUS_ENC_KEY must be base64-encoded 32 bytes')
    return (_key = b)
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NIMBUS_ENC_KEY is required in production (base64 32 bytes). Generate one and set it as a secret.')
  }
  // Dev convenience: generate + cache a key so local runs work without setup.
  try {
    const cached = fs.readFileSync(DEV_KEY_FILE, 'utf8').trim()
    const b = Buffer.from(cached, 'base64')
    if (b.length === 32) return (_key = b)
  } catch { /* no cached key yet */ }
  const gen = crypto.randomBytes(32)
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DEV_KEY_FILE, gen.toString('base64'), { mode: 0o600 })
  console.warn('[crypto] NIMBUS_ENC_KEY not set — generated a dev key at server/.data/.enckey. Set NIMBUS_ENC_KEY in production.')
  return (_key = gen)
}

/** Encrypt any JSON-serializable value → a tagged envelope safe to store. */
export function encryptJson(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key(), iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  return { __enc__: 1, iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') }
}

/** Decrypt an envelope produced by encryptJson → the original value. */
export function decryptJson(env) {
  const iv = Buffer.from(env.iv, 'base64')
  const tag = Buffer.from(env.tag, 'base64')
  const ct = Buffer.from(env.ct, 'base64')
  const d = crypto.createDecipheriv(ALGO, key(), iv)
  d.setAuthTag(tag)
  const pt = Buffer.concat([d.update(ct), d.final()])
  return JSON.parse(pt.toString('utf8'))
}

/** True if a stored value is an encryption envelope (vs legacy plaintext). */
export function isEncrypted(x) {
  return Boolean(x && typeof x === 'object' && x.__enc__)
}
