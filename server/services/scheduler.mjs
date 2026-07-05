/**
 * Ops scheduler — the baseline trigger. Every OPS_SCAN_MINUTES it runs the ops agent's read-only
 * proactive scan for each user with a connected cloud, storing any findings as incidents. Disabled
 * unless OPS_SCAN_MINUTES is set (so it never runs LLM scans by surprise in dev).
 *
 * Real-time push (webhooks) is the other trigger (routes/webhooks.mjs); this is the safety net.
 */
import { runScan } from '../agents/ops/run.mjs'
import { handleIncident } from './incident.mjs'
import { connectedUserIds } from '../repositories/connections.mjs'

export function startScheduler() {
  const mins = Number(process.env.OPS_SCAN_MINUTES || 0)
  if (!mins) { console.log('[scheduler] ops scan disabled (set OPS_SCAN_MINUTES to enable)'); return }

  const tick = async () => {
    for (const userId of connectedUserIds()) {
      try {
        const out = await runScan(userId)
        const report = out?.report?.trim()
        if (out?.ok && report && report.toLowerCase() !== 'all clear') {
          // the scan IS the root-cause pass → route the fix (worker if online, else central record)
          await handleIncident(userId, { title: 'Scheduled health scan', hypothesis: report, service: 'scheduled-scan' })
        }
      } catch (e) { console.error('[scheduler] scan failed for', userId, e?.message || e) }
    }
  }

  console.log(`[scheduler] ops scan every ${mins} min`)
  setInterval(tick, mins * 60 * 1000)
}
