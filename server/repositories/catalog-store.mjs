/**
 * Persistent catalog of service config SCHEMAS (server/.data/catalog.json).
 *
 * A schema = the editable fields for a service type (e.g. "aws:ec2 instance") with REAL option
 * lists already baked in. It's built ONCE (AI picks the fields, the MCP fills the real option
 * values), then stored — so the right-side config panel reads a deterministic, real, manual
 * form with no per-open LLM call and no dummy fallback.
 */
import { loadJson, saveJson } from './store.mjs'

const _cat = new Map(Object.entries(loadJson('catalog.json', {})))
const persist = () => saveJson('catalog.json', Object.fromEntries(_cat))

export const catalogKey = (cloud, type) => `${cloud}:${String(type || '').toLowerCase().trim()}`
export const getCatalogEntry = (cloud, type) => _cat.get(catalogKey(cloud, type)) || null
export const setCatalogEntry = (cloud, type, entry) => { _cat.set(catalogKey(cloud, type), entry); persist() }
export const allCatalog = () => Object.fromEntries(_cat)
