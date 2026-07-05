/** Rental lifecycle — the loop that makes rental timing REAL. Every few seconds it:
 *   · provisioning → boot the machine → running
 *   · stopping     → destroy the machine → stopped   (manual "Until I stop it")
 *   · running past expiresAt → destroy the machine → expired   (duration elapsed)
 * On teardown it meters actualCost from elapsed run time. Errors mark the rental failed.
 * See docs/rented-compute.md §5 (lifecycle + metering). */
import { listAllRentals, updateRental } from '../repositories/rentals.mjs'
import { bootRental, destroyRental, meterCost, machineState, readSummary, seedSummary, isReady } from './provisioner.mjs'
import { ensureRentedWorker } from './rented-worker.mjs'
import { getSummary, upsertSummary } from '../repositories/summaries.mjs'

// Pull the machine's final summary into our store before we destroy it (so it can be resumed later).
async function saveSummary(owner, r) {
  try { const content = await readSummary(r); if (content) upsertSummary(owner, { sourceId: r.id, projectId: r.projectId, agent: r.agent || r.model, size: r.size, content }) } catch { /* best-effort */ }
}

let inTick = false

async function tick() {
  if (inTick) return
  inTick = true
  try {
    for (const { owner, rental: r } of listAllRentals()) {
      try {
        if (r.status === 'provisioning') {
          const res = await bootRental(r)
          updateRental(owner, r.id, {
            status: 'booting', machineId: res.machineId, region: res.region,
            bootedAt: Date.now(), apiKey: null, // clear the injected secret once it's on the machine
          })
        } else if (r.status === 'booting') {
          const st = await machineState(r)
          if (!st || st === 'destroyed' || st === 'failed') {
            // machine gone (never came up, or killed externally) → fail the rental so it clears
            updateRental(owner, r.id, { status: 'failed', error: `machine ${st || 'not found'}` })
          } else if (st === 'started' && await isReady(r)) {
            // FULLY bootstrapped (agent installed + repo cloned). Seed resume context, then go green.
            if (r.resumeSummaryId) {
              const s = getSummary(owner, r.resumeSummaryId)
              if (s?.content) { try { await seedSummary(r, s.content) } catch { /* best-effort */ } }
            }
            // Machine is ready → THE TIMER STARTS NOW. expiresAt is measured from here, not from boot.
            const now = Date.now()
            const patch = { status: 'running', runningAt: now }
            if (r.durationHours != null) patch.expiresAt = now + r.durationHours * 3600 * 1000
            updateRental(owner, r.id, patch)
          } else if (r.bootedAt && Date.now() - r.bootedAt > 6 * 60 * 1000) {
            // Boot took too long (hung install/clone) → tear it down so it never hangs indefinitely.
            await destroyRental(r).catch(() => {})
            updateRental(owner, r.id, { status: 'failed', error: 'boot timed out (bootstrap did not finish)' })
          }
          // else: still starting / still bootstrapping → stay 'booting' (not green yet)
        } else if (r.status === 'stopping') {
          await saveSummary(owner, r) // final summary → our store, before the machine is gone
          await destroyRental(r)
          const now = Date.now()
          updateRental(owner, r.id, { status: 'stopped', destroyedAt: now, actualCost: meterCost(r, now) })
        } else if (r.status === 'running') {
          const st = await machineState(r)
          if (!st || st === 'destroyed' || st === 'stopped') {
            // Machine vanished (e.g. killed externally on Fly) → close out the rental so it clears.
            const now = Date.now()
            updateRental(owner, r.id, { status: 'stopped', destroyedAt: now, actualCost: meterCost(r, now), error: 'machine no longer running' })
          } else if (r.expiresAt && Date.now() >= r.expiresAt) {
            await saveSummary(owner, r) // final summary → our store, before the machine is gone
            await destroyRental(r)
            const now = Date.now()
            updateRental(owner, r.id, { status: 'expired', destroyedAt: now, actualCost: meterCost(r, now) })
          } else {
            // (Re)start the in-process worker so this machine acts exactly like a connected computer.
            ensureRentedWorker(owner, r.id)
          }
        }
      } catch (e) {
        console.error('[rental]', r.id, e?.message || e)
        updateRental(owner, r.id, { status: 'failed', error: String(e?.message || e) })
      }
    }
  } finally { inTick = false }
}

export function startRentalLifecycle() {
  setInterval(tick, 5000)
  console.log('rental lifecycle → REAL Fly provisioning · watching every 5s')
}
