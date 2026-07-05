/**
 * Webhook receiver — real-time triggers from external alert sources, scoped per-user by an opaque
 * token in the path (/api/webhooks/:provider/:token). Each event is normalized to an incident
 * description and handed to the ops agent (background, read-only triage); findings are stored.
 *
 * Supported: GitHub (PR/push/merge), AWS SNS (CloudWatch Alarms / Budgets / EventBridge → SNS),
 * GCP Pub/Sub push (Monitoring alerts / log sinks / budgets).
 */
import express from 'express'
import { userForToken } from '../repositories/ops.mjs'
import { handleIncident } from '../services/incident.mjs'

const r = express.Router()

/** Turn a raw provider payload into { title, text } — or { confirm } for SNS subscription setup. */
function normalize(provider, headers, body) {
  if (provider === 'github') {
    const event = headers['x-github-event'] || 'event'
    const repo = body?.repository?.full_name || ''
    if (event === 'pull_request') {
      const pr = body.pull_request || {}
      return { title: `PR ${body.action}: #${pr.number} ${pr.title || ''}`.trim(), text: `GitHub pull_request "${body.action}" on ${repo}: #${pr.number} "${pr.title}" by ${pr.user?.login} (${pr.html_url}). Base ${pr.base?.ref} ← head ${pr.head?.ref}.` }
    }
    if (event === 'push') {
      const n = (body.commits || []).length
      return { title: `Push to ${repo} ${body.ref || ''}`.trim(), text: `GitHub push to ${repo} ${body.ref}: ${n} commit(s), head ${body.after?.slice(0, 7)} by ${body.pusher?.name}.` }
    }
    return { title: `GitHub ${event}`, text: `GitHub ${event} on ${repo}.` }
  }
  if (provider === 'aws') {
    // SNS envelope (CloudWatch alarms / Budgets / EventBridge → SNS).
    if (body?.Type === 'SubscriptionConfirmation') return { confirm: body.SubscribeURL }
    if (body?.Type === 'Notification') {
      let msg = body.Message
      try { msg = JSON.parse(body.Message) } catch { /* keep string */ }
      const title = body.Subject || msg?.AlarmName || 'AWS alert'
      const text = typeof msg === 'string' ? msg : `AWS alarm "${msg.AlarmName}" → ${msg.NewStateValue}: ${msg.NewStateReason} (region ${msg.Region}, metric ${msg?.Trigger?.MetricName}).`
      return { title, text }
    }
    return { title: 'AWS event', text: JSON.stringify(body).slice(0, 1500) }
  }
  if (provider === 'gcp') {
    // Pub/Sub push: base64 JSON in message.data.
    let data = {}
    try { data = JSON.parse(Buffer.from(body?.message?.data || '', 'base64').toString('utf8')) } catch { /* */ }
    const title = data?.incident?.summary || data?.policy_name || 'GCP alert'
    return { title, text: `GCP alert: ${title}. ${data?.incident?.documentation?.content || JSON.stringify(data).slice(0, 1200)}` }
  }
  return { title: `${provider} event`, text: JSON.stringify(body).slice(0, 1500) }
}

r.post('/api/webhooks/:provider/:token', async (req, res) => {
  const { provider, token } = req.params
  const userId = userForToken(token)
  if (!userId) return res.status(404).json({ error: 'unknown webhook token' })

  let n
  try { n = normalize(provider, req.headers, req.body || {}) } catch { n = { title: `${provider} event`, text: 'unparsed payload' } }

  // AWS SNS subscription handshake — confirm and return.
  if (n.confirm) { try { await fetch(n.confirm) } catch { /* */ } return res.json({ ok: true, confirmed: true }) }

  // Ack immediately (webhook senders expect a fast 2xx); root-cause + route the fix in the background:
  // → an online worker drives its Claude Code to open a PR, else central fallback records the triage.
  res.status(202).json({ ok: true, accepted: true })
  handleIncident(userId, { title: n.title, text: `[${provider}] ${n.title}\n${n.text}`, service: provider })
    .catch((e) => console.error('[webhook] handleIncident failed', e?.message || e))
})

export default r
