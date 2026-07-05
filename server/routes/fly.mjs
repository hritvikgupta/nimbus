/** Fly.io machine catalog + pricing — a READ-ONLY proxy so the "Rent a machine" modal can show LIVE
 * VM sizes AND their rates. Fetches sizes + priceMonth/priceSecond from Fly's GraphQL, then CACHES a
 * snapshot to server/.data/fly-pricing.json (our "database") so we can serve pricing even if Fly is
 * unreachable and so cost math is stable. The provider name (Fly) is never surfaced to end users.
 *
 * Still no provisioning/billing/worker boot — just the catalog + rates. See docs/rented-compute.md. */
import express from 'express'
import { loadJson, saveJson } from '../repositories/store.mjs'
import { withMarkup as priced } from '../services/pricing.mjs'
import { flyToken } from '../services/provisioner.mjs'

const r = express.Router()
const CACHE_FILE = 'fly-pricing.json'
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // refetch when the cached snapshot is older than a day

// Fly's preset catalog with real base rates — last-resort fallback if we've never cached and can't reach Fly.
const FALLBACK_SIZES = [
  { name: 'shared-cpu-1x',    cpus: 1, cpuKind: 'shared',    memoryMb: 256,   priceMonth: 1.94,  priceSecond: 7.5e-7 },
  { name: 'dedicated-cpu-1x', cpus: 1, cpuKind: 'dedicated', memoryMb: 2048,  priceMonth: 31,    priceSecond: 1.196e-5 },
  { name: 'dedicated-cpu-2x', cpus: 2, cpuKind: 'dedicated', memoryMb: 4096,  priceMonth: 62,    priceSecond: 2.392e-5 },
  { name: 'dedicated-cpu-4x', cpus: 4, cpuKind: 'dedicated', memoryMb: 8192,  priceMonth: 124,   priceSecond: 4.784e-5 },
  { name: 'dedicated-cpu-8x', cpus: 8, cpuKind: 'dedicated', memoryMb: 16384, priceMonth: 248,   priceSecond: 9.568e-5 },
]

const QUERY = `query {
  platform {
    vmSizes { name cpuCores memoryMb priceMonth priceSecond }
  }
}`

const kindOf = (name) => (/shared/i.test(name) ? 'shared' : 'dedicated')

async function fetchLive(token) {
  const resp = await fetch('https://api.fly.io/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: QUERY }),
  })
  const json = await resp.json()
  const p = json?.data?.platform
  if (!p?.vmSizes?.length) throw new Error(json?.errors?.[0]?.message || 'no vmSizes in Fly response')
  return p.vmSizes.map((s) => ({
    name: s.name,
    cpus: s.cpuCores,
    cpuKind: kindOf(s.name),
    memoryMb: s.memoryMb,
    priceMonth: s.priceMonth,   // USD / month at the preset's base memory
    priceSecond: s.priceSecond, // USD / second — the unit we bill hourly/daily/weekly rentals on
  }))
}

r.get('/api/fly/machines', async (_req, res) => {
  const cached = loadJson(CACHE_FILE, null) // { fetchedAt, sizes }
  const token = flyToken()

  // Serve a fresh cache without hitting Fly again.
  if (cached?.sizes?.length && Date.now() - (cached.fetchedAt || 0) < MAX_AGE_MS) {
    return res.json({ live: true, sizes: priced(cached.sizes), source: 'cache', cachedAt: cached.fetchedAt })
  }

  if (!token) {
    if (cached?.sizes?.length) return res.json({ live: true, sizes: priced(cached.sizes), source: 'cache', cachedAt: cached.fetchedAt })
    return res.json({ live: false, reason: 'no Fly token (set FLY_API_TOKEN or run `flyctl auth login`)', sizes: priced(FALLBACK_SIZES) })
  }

  try {
    const sizes = await fetchLive(token)
    const snapshot = { fetchedAt: Date.now(), sizes } // cache the RAW provider cost
    saveJson(CACHE_FILE, snapshot)
    res.json({ live: true, sizes: priced(sizes), source: 'fly', cachedAt: snapshot.fetchedAt })
  } catch (e) {
    // Never fail the modal — prefer the last cached snapshot, else the preset catalog.
    if (cached?.sizes?.length) return res.json({ live: true, sizes: priced(cached.sizes), source: 'cache', cachedAt: cached.fetchedAt, reason: String(e?.message || e) })
    res.json({ live: false, reason: String(e?.message || e), sizes: priced(FALLBACK_SIZES) })
  }
})

export default r
