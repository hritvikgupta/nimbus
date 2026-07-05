import { useState, useRef, useEffect, useMemo } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { Icon } from '../common/Icons.jsx'
import CloudMap from '../layout/CloudMap.jsx'
import * as D from '../../lib/data.js'
import { useConversation, AgentThread } from '../chat/AgentThread.jsx'
import { seedSpec } from '../../lib/serviceSpec.js'
import { updateNode, deleteNode, getSpec, getLiveConfig, getCost, getTelemetry, getLogs, getGraph } from '../../lib/api.js'
import { listChats, createChat, getChat, saveChat, deleteChat } from '../../lib/api.js'

export const cloudShort = { aws: 'AWS', gcp: 'GCP', azure: 'AZ', do: 'DO' }

function CloudTag({ c }) {
  return <span className="cloud-tag">{cloudShort[c]}</span>
}

/* Build a real cloud-console deep-link for a resource (opens the provider's console). */
export function consoleUrl(r) {
  const region = r.region && r.region !== '—' && r.region !== 'global' ? r.region : 'us-east-1'
  if (r.cloud === 'aws') {
    const t = (r.type || '').toLowerCase()
    if (t.includes('ec2')) return `https://${region}.console.aws.amazon.com/ec2/home?region=${region}#Instances:search=${encodeURIComponent(r.name)}`
    if (t.includes('s3')) return `https://s3.console.aws.amazon.com/s3/buckets/${encodeURIComponent(r.name)}`
    if (t.includes('rds')) return `https://${region}.console.aws.amazon.com/rds/home?region=${region}#databases:`
    if (t.includes('lambda')) return `https://${region}.console.aws.amazon.com/lambda/home?region=${region}#/functions/${encodeURIComponent(r.name)}`
    return `https://${region}.console.aws.amazon.com/console/home?region=${region}`
  }
  if (r.cloud === 'gcp') {
    const t = (r.type || '').toLowerCase()
    if (t.includes('run')) return 'https://console.cloud.google.com/run'
    if (t.includes('compute')) return 'https://console.cloud.google.com/compute/instances'
    if (t.includes('sql')) return 'https://console.cloud.google.com/sql/instances'
    if (t.includes('storage')) return 'https://console.cloud.google.com/storage/browser'
    return 'https://console.cloud.google.com/home/dashboard'
  }
  return 'https://console.cloud.google.com'
}

/* Header action buttons for a resource — wired to the chat agent + the live console. */
export function RdActions({ r }) {
  const navigate = useNavigate()
  const ask = (q) => {
    try { sessionStorage.setItem('nimbus.chatDraft', q) } catch { /* ignore */ }
    navigate('/app/chat')
  }
  return (
    <div className="rd-actions">
      <button className="btn" onClick={() => ask(`Tell me about my ${r.type} "${r.name}" in ${r.region} (${(r.cloud || '').toUpperCase()}) — its configuration, health, and what it costs.`)}>✦ Ask an agent</button>
      <button className="btn ghost" onClick={() => ask(`I want to modify my ${r.type} "${r.name}" (${(r.cloud || '').toUpperCase()}, ${r.region}). Show me what's editable and a safe plan before changing anything.`)}>Edit</button>
      <button className="btn ghost" onClick={() => window.open(consoleUrl(r), '_blank', 'noopener')}>Console ↗</button>
    </div>
  )
}

/* ---------- Overview ---------- */
const CLOUD_NAMES = { aws: 'AWS', gcp: 'GCP', azure: 'Azure', do: 'DO' }

/* ---------- Left-anchored full panel (modal) — opens from a home card ---------- */
function LeftPanel({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h)
  }, [onClose])
  const now = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div className="lp-overlay" onMouseDown={onClose}>
      <div className="lp" onMouseDown={e => e.stopPropagation()}>
        <div className="lp-head">
          <div className="lp-titles">
            <div className="lp-title">{title}</div>
            {subtitle && <div className="lp-sub">{subtitle}</div>}
          </div>
          <div className="lp-head-right">
            <span className="lp-time">{now}</span>
            <button className="lp-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="lp-body">{children}</div>
      </div>
    </div>
  )
}

/* ---------- Live logs panel content (real tail, auto-refresh, project-scoped) ---------- */
function LiveLogs({ resources = [] }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(false)
  const [mins, setMins] = useState(60)
  const names = (resources || []).map(r => r.name).join(',') // scope the tail to this project

  const load = (m = mins) => getLogs({ mins: m, names }).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  useEffect(() => { setLoading(true); load(mins) /* eslint-disable-next-line */ }, [mins, names])
  useEffect(() => {
    if (paused) return
    const t = setInterval(() => load(), 5000)
    return () => clearInterval(t)
  }, [paused, mins, names]) // eslint-disable-line react-hooks/exhaustive-deps

  const events = data?.events || []
  const fmtTime = t => new Date(t).toLocaleTimeString()
  return (
    <div className="logs">
      <div className="logs-bar">
        <div className="logs-ranges">
          {[{ l: '15m', m: 15 }, { l: '1h', m: 60 }, { l: '6h', m: 360 }, { l: '24h', m: 1440 }].map(r => (
            <button key={r.l} className={'tm-range' + (mins === r.m ? ' on' : '')} onClick={() => setMins(r.m)}>{r.l}</button>
          ))}
        </div>
        <div className="logs-tools">
          <span className="logs-live"><span className={'logs-dot' + (paused ? ' off' : '')} />{paused ? 'paused' : 'live'}</span>
          <button className="tm-range" onClick={() => setPaused(p => !p)}>{paused ? 'Resume' : 'Pause'}</button>
          <button className="tm-refresh" onClick={() => load()} title="Refresh">↻</button>
        </div>
      </div>
      {(data?.notes || []).map((n, i) => <div className="logs-note" key={i}>{n}</div>)}
      {loading && !data ? (
        <div className="rd-empty">Tailing logs…</div>
      ) : !events.length ? (
        <div className="rd-empty">No log events in this window.</div>
      ) : (
        <div className="logs-stream">
          {events.map((e, i) => (
            <div className="logline" key={i}>
              <span className="ll-time">{fmtTime(e.t)}</span>
              <span className={'ll-cloud ' + e.cloud}>{(e.cloud || '').toUpperCase()}</span>
              <span className="ll-src" title={e.src}>{e.src}</span>
              {e.sev && <span className={'ll-sev ' + String(e.sev).toLowerCase()}>{e.sev}</span>}
              <span className="ll-msg">{e.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Overview "Live activity" — real telemetry (CloudWatch / Cloud Monitoring) for the managed
// resources, so the dashboard shows live signal even before billing data lands. No mock data:
// renders nothing if there are no running resources.
function FleetActivity({ resources }) {
  const live = useMemo(() => (resources || []).filter(r => r.status === 'healthy').slice(0, 8), [resources])
  const sig = live.map(r => `${r.cloud}:${r.name}`).join(',')
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!live.length) { setRows([]); setLoading(false); return }
    let alive = true; setLoading(true)
    Promise.all(live.map(r =>
      getTelemetry({ cloud: r.cloud, type: r.type, name: r.name, region: r.region, hours: 24 })
        .then(t => ({ r, t })).catch(() => ({ r, t: null }))))
      .then(res => { if (alive) { setRows(res); setLoading(false) } })
    return () => { alive = false }
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!live.length) return null
  return (
    <div className="card glow">
      <div className="section-head"><h2>Live activity</h2><span className="muted">last 24h · live metrics</span></div>
      {loading ? (
        <div className="empty">Loading metrics…</div>
      ) : (
        <div className="fa-grid">
          {rows.map(({ r, t }) => {
            const metrics = t?.metrics || []
            const prim = metrics.find(m => /cpu|utilization/i.test(m.key)) || metrics.find(m => /request/i.test(m.key)) || metrics[0]
            const net = metrics.find(m => /network|net|request|received|sent/i.test(m.key))
            return (
              <div className="fa-card" key={`${r.cloud}:${r.name}`}>
                <div className="fa-top">
                  <span className="fa-nm" title={r.name}>{r.name}</span>
                  <span className="cloud-tag">{cloudShort[r.cloud] || r.cloud}</span>
                </div>
                <div className="fa-sub">{r.type} · {r.region}</div>
                {prim && prim.points?.length ? (
                  <>
                    <div className="fa-row">
                      <span>{prim.label}</span><b>{fmtVal(prim)}</b>
                    </div>
                    <TmSpark points={prim.points} color={/cpu/.test(prim.key) ? '#d99a2c' : '#5b8def'} />
                    {net && net.key !== prim.key && net.points?.length ? (
                      <div className="fa-row sub"><span>{net.label}</span><b>{fmtVal(net)}</b></div>
                    ) : null}
                  </>
                ) : (
                  <div className="fa-none">{t?.note || 'No metrics in this window'}</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function Overview({ overview, loading, error, onRowClick }) {
  const [panel, setPanel] = useState(null) // which home panel modal is open: 'logs' | 'telemetry'
  const octx = useOutletContext?.() || {}
  const projectName = octx.project?.name || 'this project'
  if (loading && !overview) {
    return <div className="content fade"><div className="card glow"><div className="empty">Loading your cloud data…</div></div></div>
  }
  if (error && !overview) {
    return <div className="content fade"><div className="card glow"><div className="empty">{error}</div></div></div>
  }

  const connections = overview?.connections || []
  const clouds = overview?.clouds || {}
  const kpis = overview?.kpis || { resources: 0, clouds: 0, degraded: 0 }
  const resources = overview?.resources || []
  const healthy = resources.filter(r => r.status === 'healthy')

  const KPIS = [
    { label: 'Resources managed', value: kpis.resources, icon: 'cube' },
    { label: 'Needs attention',   value: kpis.degraded,  icon: 'shield' },
    { label: 'Monthly spend',     value: '—',            icon: 'dollar' },
    { label: 'Clouds connected',  value: kpis.clouds,    icon: 'cloud' },
  ]

  return (
    <div className="content fade">
      <div className="cost-head">
        <div><h2 style={{ margin: 0 }}>Overview</h2><div className="muted" style={{ fontSize: 'var(--fs-label)' }}>Your cloud at a glance · {projectName}</div></div>
      </div>
      <div className="grid kpis">
        {KPIS.map(k => (
          <div className="card kpi glow" key={k.label}>
            <div className="kpi-top">
              <div className="ico-box"><Icon name={k.icon} size={19} /></div>
            </div>
            <div className="label">{k.label}</div>
            <div className="value">{k.value}</div>
          </div>
        ))}
      </div>

      {kpis.degraded > 0 && (
        <Link to="/app/chat" className="attn-bar" onClick={() => {
          const bad = resources.filter(r => r.status !== 'healthy').map(r => `${r.name} (${r.type}, ${r.cloud.toUpperCase()})`).join('; ')
          try {
            sessionStorage.setItem('nimbus.chatDraft',
              `${kpis.degraded} resource(s) are unhealthy: ${bad}. For each, run the diagnosis workflow — pull telemetry, classify the problem, read the logs for the real error — and tell me the root cause + recommended fix. Don't change anything without showing me a plan first.`)
          } catch { /* ignore */ }
        }}>
          <span className="attn-dot" />
          <b>{kpis.degraded} resource{kpis.degraded > 1 ? 's' : ''} need attention</b>
          <span className="attn-cta">Diagnose with agent →</span>
        </Link>
      )}

      <div className="grid panels">
        <button className="card panel-card glow" onClick={() => setPanel('logs')}>
          <div className="pc-eyebrow">MONITORING</div>
          <div className="pc-title">Live logs</div>
          <div className="pc-sub">Tail CloudWatch / Cloud Logging across your clouds in real time</div>
          <span className="pc-cta">Open panel →</span>
        </button>
        <button className="card panel-card glow" onClick={() => setPanel('telemetry')}>
          <div className="pc-eyebrow">MONITORING</div>
          <div className="pc-title">Live telemetry</div>
          <div className="pc-sub">CPU, traffic, latency & errors across your running resources</div>
          <span className="pc-cta">Open panel →</span>
        </button>
      </div>

      <div>
        <div className="section-head">
          <h2>Connected clouds</h2>
          <span className="muted">{connections.length ? `${connections.length} connected` : 'none connected'}</span>
        </div>
        {connections.length ? (
          <div className="grid clouds" style={{ marginTop: 12 }}>
            {connections.map(id => {
              const c = clouds[id] || { resources: 0, status: 'connected' }
              const short = CLOUD_NAMES[id] || id.toUpperCase()
              return (
                <div className="card cloud-card" key={id}>
                  <div className="head">
                    <div className="nm">{short}</div>
                  </div>
                  <div className="meta">
                    <div><b>{c.resources || 0}</b>resources</div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="card cloud-card" style={{ marginTop: 12 }}>
            <div className="empty">
              <b style={{ color: 'var(--text)' }}>No clouds connected yet</b><br /><br />
              <Link to="/app/connections" style={{ color: 'var(--accent)' }}>Connect a cloud →</Link>
            </div>
          </div>
        )}
      </div>

      <FleetActivity resources={resources} />

      <div className="card glow">
        <div className="section-head"><h2>Spend trend</h2><span className="muted">no billing data</span></div>
        <div className="empty">Spend data appears once a billing-enabled cloud is connected.</div>
      </div>

      {panel === 'logs' && (
        <LeftPanel title="Live logs" subtitle={`Real-time tail · scoped to ${projectName}`} onClose={() => setPanel(null)}>
          <LiveLogs resources={resources} />
        </LeftPanel>
      )}
      {panel === 'telemetry' && (
        <LeftPanel title="Live telemetry" subtitle={`Live metrics · scoped to ${projectName}`} onClose={() => setPanel(null)}>
          {healthy.length ? healthy.map(r => (
            <div className="lp-res" key={`${r.cloud}:${r.name}`}>
              <div className="lp-res-h"><b>{r.name}</b> <span className="muted">{r.type} · {r.region} · {cloudShort[r.cloud] || r.cloud}</span></div>
              <Telemetry node={r} region={r.region} />
            </div>
          )) : <div className="rd-empty">No running resources to show metrics for.</div>}
        </LeftPanel>
      )}
    </div>
  )
}

/* ---------- shared helpers ---------- */
const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h }
function series(seed, n = 14) {
  let h = hash(seed); const out = []
  for (let i = 0; i < n; i++) { h = (h * 1103515245 + 12345) >>> 0; out.push(40 + (h % 60)) }
  return out
}
function Spark({ seed, color = '#9ce4f1' }) {
  const d = series(seed), W = 220, H = 46, max = Math.max(...d), min = Math.min(...d)
  const pts = d.map((v, i) => `${(i / (d.length - 1)) * W},${H - ((v - min) / (max - min || 1)) * (H - 6) - 3}`)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  )
}
const CONFIG = {
  'Load Balancer': [['Scheme', 'internet-facing'], ['Listeners', 'HTTPS:443'], ['Targets', '2 healthy']],
  'Auto Scaling': [['Min / Desired / Max', '2 / 2 / 6'], ['Instance type', 't3.medium'], ['Health check', 'ELB']],
  'RDS Postgres': [['Engine', 'PostgreSQL 15.4'], ['Class', 'db.t4g.medium'], ['Multi-AZ', 'yes'], ['Storage', '100 GB gp3']],
  'Cloud Run': [['CPU / Memory', '1 vCPU / 512 MiB'], ['Concurrency', '80'], ['Min / Max', '1 / 10']],
  'Cloud SQL': [['Engine', 'PostgreSQL 15'], ['Tier', 'db-custom-2-7680'], ['HA', 'regional']],
  'VM Scale Set': [['Size', 'Standard_D2s_v5'], ['Instances', '3'], ['Zones', '1,2,3']],
  'S3 Bucket': [['Versioning', 'enabled'], ['Encryption', 'SSE-S3'], ['Public access', 'blocked']],
  'CloudFront': [['Price class', 'All'], ['Origin', 'user-uploads'], ['TLS', 'TLSv1.2']],
}
function insightsFor(r) {
  const cost = parseInt(String(r.cost ?? '').replace(/\D/g, '')) || 0
  const out = []
  if (cost >= 200) out.push({ agent: 'CostGuard', color: '#6ab98f', text: `Over-provisioned — rightsize to save ~$${Math.round(cost * 0.25)}/mo.`, action: 'Apply rightsizing' })
  if (r.status === 'degraded') out.push({ agent: 'Sentinel', color: '#cf7470', text: 'Health check failing intermittently in the last hour.', action: 'Investigate' })
  if (/upload|bucket|s3/i.test(r.name + r.type)) out.push({ agent: 'Sentinel', color: '#cda94e', text: 'Public-access block is on, but no bucket policy review in 90d.', action: 'Review policy' })
  out.push({ agent: 'Architect', color: '#9ce4f1', text: `Part of the ${r.project?.replace('-', ' ') || 'shared'} stack; depends on the VPC + IAM role.`, action: 'View in graph' })
  return out
}

/* ---------- Resource detail body (shared by drawer + full page) ---------- */
export function ResourceDetail({ r, siblings = [] }) {
  const deps = siblings.filter(x => x.cloud === r.cloud && x.name !== r.name).slice(0, 6)
  const dot = r.status === 'healthy' ? '#6ab98f' : r.status === 'degraded' ? '#cda94e' : '#cf7470'
  return (
    <div className="rd-body">
      <div className="rd-stats">
        <div className="rd-stat"><span>Status</span><b style={{ color: dot }}>{r.status}</b></div>
        <div className="rd-stat"><span>Monthly cost</span><b>{r.cost}</b></div>
        <div className="rd-stat"><span>Region</span><b>{r.region}</b></div>
        <div className="rd-stat"><span>Cloud</span><b>{cloudShort[r.cloud] || (r.cloud || '').toUpperCase()}</b></div>
      </div>

      <div className="rd-sec">Configuration</div>
      <div className="rd-config">
        {[['Name', r.name], ['Type', r.type], ['Region', r.region], ['Cloud', cloudShort[r.cloud] || (r.cloud || '').toUpperCase()], ['Status', r.status]].map(([k, v]) => (
          <div className="rd-kv" key={k}><span>{k}</span><b>{v}</b></div>
        ))}
      </div>

      <div className="rd-sec">Dependencies</div>
      <div className="rd-deps">
        {deps.length ? deps.map(d => (
          <div className="rd-dep" key={d.name}><span className="cloud-tag">{cloudShort[d.cloud]}</span>{d.name}<span className="rd-deptype">{d.type}</span></div>
        )) : <div className="rd-empty">No linked resources in this project.</div>}
      </div>
    </div>
  )
}

/* ---------- Service-specific, editable node detail ----------
   Renders the right config form for the node's service type (EC2/RDS/S3/…). For a PLANNED
   design node the specs persist to the canvas and the agent uses them at deploy time. For a
   LIVE resource, "Apply" routes the change through the agent (plan → confirm → mutate). */
const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }))

/* ---------- Live telemetry (CloudWatch / Cloud Monitoring) ---------- */
const RANGES = [{ label: '1h', hours: 1 }, { label: '24h', hours: 24 }, { label: '7d', hours: 168 }]

// Units come from the cloud as strings (CloudWatch: Percent/Bytes/Seconds/Count; GCP: By/s/percent).
function fmtVal(m) {
  if (m.latest == null) return '—'
  const v = Number(m.latest)
  const u = String(m.unit || '').toLowerCase()
  if (u.includes('percent')) return `${v.toFixed(1)}%`
  if (u.includes('byte') || u === 'by') return v > 1e9 ? `${(v / 1e9).toFixed(1)} GB` : v > 1e6 ? `${(v / 1e6).toFixed(1)} MB` : v > 1e3 ? `${(v / 1e3).toFixed(1)} KB` : `${Math.round(v)} B`
  if (u === 'seconds' || u === 's') return `${(v * 1000).toFixed(0)} ms`
  if (u.includes('millisecond') || u === 'ms') return `${v.toFixed(0)} ms`
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

// Tiny inline sparkline — no chart lib. Scales the series into a fixed viewbox.
function TmSpark({ points, color = '#5b8def' }) {
  if (!points || points.length < 2) return <div className="tm-spark empty" />
  const xs = points.map(p => p.t), ys = points.map(p => p.v)
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const y0 = Math.min(...ys), y1 = Math.max(...ys)
  const W = 200, H = 36, pad = 2
  const sx = t => x1 === x0 ? pad : pad + (t - x0) / (x1 - x0) * (W - 2 * pad)
  const sy = v => y1 === y0 ? H / 2 : H - pad - (v - y0) / (y1 - y0) * (H - 2 * pad)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ')
  const area = `${d} L${sx(x1).toFixed(1)},${H} L${sx(x0).toFixed(1)},${H} Z`
  return (
    <svg className="tm-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path d={area} fill={color} opacity="0.10" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

function Telemetry({ node, region }) {
  const [hours, setHours] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = (h = hours) => {
    setLoading(true); setErr('')
    getTelemetry({ cloud: node.cloud, type: node.type, name: node.name, region: region || node.region, hours: h })
      .then(setData)
      .catch(e => setErr(e?.message || 'Could not load telemetry.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load(hours) /* eslint-disable-next-line */ }, [node.id, hours])

  const colorFor = (k) => /cpu/i.test(k) ? '#d99a2c' : /err|fail|throttle|5xx/i.test(k) ? '#cf7470' : /lat/i.test(k) ? '#8b5cf6' : '#5b8def'

  return (
    <div className="tm">
      <div className="tm-head">
        <div className="rd-sec" style={{ margin: 0, border: 0 }}>Live telemetry</div>
        <div className="tm-tools">
          <div className="tm-ranges">
            {RANGES.map(r => (
              <button key={r.label} className={'tm-range' + (hours === r.hours ? ' on' : '')} onClick={() => setHours(r.hours)}>{r.label}</button>
            ))}
          </div>
          <button className="tm-refresh" onClick={() => load()} disabled={loading} title="Refresh">↻</button>
        </div>
      </div>
      {loading ? (
        <div className="rd-empty">Loading metrics…</div>
      ) : err ? (
        <div className="rd-empty">{err}</div>
      ) : !data?.supported ? (
        <div className="rd-empty">{data?.note || 'Telemetry not available for this resource.'}</div>
      ) : !data?.found ? (
        <div className="rd-empty">{data?.note || 'No datapoints in this window — the resource may be brand-new or idle.'}</div>
      ) : (
        <>
          <div className="tm-grid">
            {data.metrics.map(m => (
              <div className="tm-card" key={m.key}>
                <div className="tm-card-top">
                  <span className="tm-label">{m.label}</span>
                  <span className="tm-value">{fmtVal(m)}</span>
                </div>
                <TmSpark points={m.points} color={colorFor(m.key)} />
              </div>
            ))}
          </div>
          <div className="tm-foot">{data.target} · last {hours >= 24 ? `${hours / 24}d` : `${hours}h`} · source: {node.cloud === 'gcp' ? 'Cloud Monitoring' : 'CloudWatch'}</div>
        </>
      )}
    </div>
  )
}

export function NodeDetail({ node, projectId, real }) {
  const navigate = useNavigate()
  const out = useOutletContext?.() || {}
  const [deleting, setDeleting] = useState(false)
  const [schema, setSchema] = useState(null)   // { title, fields } — generated by the model
  const [spec, setSpec] = useState(node.spec || {})
  const [region, setRegion] = useState(node.region || '')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const dot = node.status === 'deployed' ? '#6ab98f' : '#cda94e'

  const humanizeKey = (k) => String(k).split('.').pop().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const fieldsFromSpec = (spec) => Object.entries(spec || {}).map(([k, v]) => ({
    key: k, label: humanizeKey(k), type: typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'number' : 'text', options: [],
  }))

  // PLANNED → fields from the agent's chosen config (node.spec). DEPLOYED → live config read
  // from the cloud via the MCP. No Terraform.
  useEffect(() => {
    let alive = true
    setLoading(true); setErr('')
    if (real) {
      getLiveConfig({ cloud: node.cloud, type: node.type, name: node.name, region: node.region })
        .then(r => {
          if (!alive) return
          if (!r.found || !r.fields?.length) { setErr('Could not read this resource’s live config from the cloud.'); return }
          setSchema({ title: `${node.type} — live`, fields: r.fields.map(f => ({ ...f, options: f.options || [] })) })
          setSpec(Object.fromEntries(r.fields.map(f => [f.key, f.value])))
        })
        .catch(e => { if (alive) setErr(e?.message || 'Could not read live config.') })
        .finally(() => { if (alive) setLoading(false) })
    } else {
      const fields = fieldsFromSpec(node.spec)
      setSchema({ title: `${node.type} — configuration`, fields })
      setSpec(node.spec || {})
      setLoading(false)
    }
    return () => { alive = false }
  }, [node.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => { setSpec(s => ({ ...s, [k]: v })); setSaved(false) }
  const hasRegionField = (schema?.fields || []).some(f => /^(region|location|zone|availability_zone)$/i.test(f.key))

  const save = async () => {
    if (real) {
      const changes = (schema?.fields || []).map(f => `${f.label}: ${spec[f.key]}${f.unit ? ' ' + f.unit : ''}`).join(', ')
      try {
        sessionStorage.setItem('nimbus.chatDraft',
          `Apply these changes to my ${node.type} "${node.name}" (${(node.cloud || '').toUpperCase()}, ${region || node.region}): ${changes}. Show me the plan + cost impact and wait for my go before changing anything.`)
      } catch { /* ignore */ }
      navigate('/app/chat')
      return
    }
    setSaving(true)
    try { await updateNode(projectId, node.id, { region, spec }); setSaved(true) }
    catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const del = async () => {
    if (real) {
      // live resource → terminate through the agent (plan + confirm + execute on the cloud)
      try {
        sessionStorage.setItem('nimbus.chatDraft',
          `Delete/terminate my ${node.type} "${node.name}" (${(node.cloud || '').toUpperCase()}, ${region || node.region}). Show me the plan + impact and wait for my go before deleting anything.`)
      } catch { /* ignore */ }
      navigate('/app/chat')
      return
    }
    setDeleting(true)
    try { await deleteNode(projectId, node.id); out.bumpGraph?.(); out.refresh?.(); navigate('/app/resources') }
    catch { setDeleting(false) }
  }

  // Hand the resource to the agent's diagnosis WORKFLOW (telemetry → classify → read logs →
  // root cause). We don't pre-decide anything here — the agent investigates and reports.
  const diagnose = () => {
    try {
      sessionStorage.setItem('nimbus.chatDraft',
        `Diagnose my ${node.type} "${node.name}" (${(node.cloud || '').toUpperCase()}, ${region || node.region}). Run the full diagnosis workflow: pull its live telemetry, classify the problem, read its logs for the real error, and tell me the root cause with evidence + a recommended fix. Don't change anything without showing me a plan first.`)
    } catch { /* ignore */ }
    navigate('/app/chat')
  }

  return (
    <div className="rd-body">
      <div className="rd-stats">
        <div className="rd-stat"><span>Status</span><b style={{ color: dot }}>{node.status || 'planned'}</b></div>
        <div className="rd-stat"><span>Service</span><b>{node.type}</b></div>
        <div className="rd-stat"><span>Region</span><b>{region || '—'}</b></div>
        <div className="rd-stat"><span>Cloud</span><b>{cloudShort[node.cloud] || (node.cloud || '').toUpperCase()}</b></div>
      </div>

      {real && <Telemetry node={node} region={region} />}

      <div className="rd-sec">{schema?.title || node.type} — configuration</div>
      {loading ? (
        <div className="rd-empty">Loading configuration…</div>
      ) : err ? (
        <div className="rd-empty">{err}</div>
      ) : (
        <div className="nd-form">
          {schema.fields.map(f => (
            <div className="nd-field" key={f.key}>
              <label>{f.label}{f.unit && !f.label.toLowerCase().includes(String(f.unit).toLowerCase()) ? ` (${f.unit})` : ''}</label>
              {f.type === 'select' ? (
                <select value={spec[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}>
                  {(f.options || []).map(o => <option key={String(o)} value={o}>{String(o)}</option>)}
                </select>
              ) : f.type === 'bool' ? (
                <button type="button" className={'nd-toggle' + (spec[f.key] ? ' on' : '')} onClick={() => set(f.key, !spec[f.key])}>
                  {spec[f.key] ? 'Enabled' : 'Disabled'}
                </button>
              ) : f.type === 'number' ? (
                <input type="number" value={spec[f.key] ?? ''}
                  onChange={e => set(f.key, e.target.value === '' ? '' : Number(e.target.value))} />
              ) : (
                <input type="text" value={spec[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} />
              )}
            </div>
          ))}
          {!hasRegionField && (
            <div className="nd-field">
              <label>Region</label>
              <input type="text" value={region} onChange={e => { setRegion(e.target.value); setSaved(false) }} />
            </div>
          )}
        </div>
      )}

      <div className="nd-actions">
        <button className="btn" disabled={saving || loading} onClick={save}>
          {real ? 'Apply via agent ↗' : saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save configuration'}
        </button>
        {real && <button className="btn ghost" onClick={diagnose} title="Investigate this resource with the agent">Diagnose ↗</button>}
        <button className="btn ghost nd-del" disabled={deleting} onClick={del}>
          {real ? 'Delete via agent ↗' : deleting ? 'Removing…' : 'Delete'}
        </button>
      </div>
      <div className="nd-hint">
        {real
          ? 'Changes to a live resource go through the agent — it shows a plan + cost and waits for your go.'
          : 'Specs + cost are estimated by the model and saved on the design. Switch the chat to Agent mode and say “deploy” to build it with exactly these settings.'}
      </div>
    </div>
  )
}

/* ---------- Resource detail drawer ---------- */
export function ResourceDrawer({ r, onClose }) {
  if (!r) return null
  const dot = r.status === 'healthy' ? '#6ab98f' : r.status === 'degraded' ? '#cda94e' : '#cf7470'
  return (
    <>
      <div className="rd-scrim" onClick={onClose} />
      <div className="rd-drawer">
        <div className="rd-head">
          <div>
            <div className="rd-name">{r.name}</div>
            <div className="rd-meta"><span className="cloud-tag">{cloudShort[r.cloud]}</span> {r.type} · {r.region}
              <span className="rd-status"><span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, display: 'inline-block' }} /> {r.status}</span>
            </div>
          </div>
          <button className="rd-x" onClick={onClose}>✕</button>
        </div>
        <RdActions r={r} />
        <ResourceDetail r={r} />
      </div>
    </>
  )
}

/* ---------- Resources table ---------- */
export function ResourcesTable({ compact, resources = [], onRowClick, connected = false }) {
  const all = resources
  const list = compact ? all.slice(0, 6) : all
  const clouds = new Set(all.map(r => r.cloud)).size
  if (!all.length) {
    return (
      <div className="card glow">
        <div className="section-head">{compact && <h2>Resources</h2>}<span className="muted">0 resources</span></div>
        <div className="empty">
          {connected ? (
            <>
              <b style={{ color: 'var(--text)' }}>No resources in this project yet</b><br /><br />
              Ask the agent in Chat to create one — it'll appear here and on the canvas.<br /><br />
              <Link to="/app/chat" style={{ color: 'var(--accent)' }}>Open Chat →</Link>
            </>
          ) : (
            <>
              <b style={{ color: 'var(--text)' }}>No resources yet</b><br /><br />
              Connect a cloud to see your inventory.<br /><br />
              <Link to="/app/connections" style={{ color: 'var(--accent)' }}>Connect a cloud →</Link>
            </>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="card glow">
      <div className="section-head">{compact && <h2>Resources</h2>}<span className="muted">{all.length} across {clouds} cloud{clouds!==1?'s':''}</span></div>
      <table className="res-table" style={{ marginTop: 10 }}>
        <thead><tr><th>Name</th><th>Type</th><th>Cloud</th><th>Region</th><th>Status</th></tr></thead>
        <tbody>
          {list.map(r => (
            <tr key={r.name} onClick={() => onRowClick && onRowClick(r)} style={{ cursor: 'pointer' }}>
              <td style={{ fontWeight: 600 }}>{r.name}</td>
              <td className="muted">{r.type}</td>
              <td><CloudTag c={r.cloud} /></td>
              <td className="muted">{r.region}</td>
              <td><span className="dotpill"><span style={{ width:7,height:7,borderRadius:'50%',
                background: r.status==='healthy'?'#6ab98f':r.status==='degraded'?'#cda94e':'#cf7470' }} />{r.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export function Resources({ resources, loading, error, onRowClick, connected }) {
  if (loading && !resources) {
    return <div className="content fade"><div className="card glow"><div className="empty">Loading your resources…</div></div></div>
  }
  if (error && !resources) {
    return <div className="content fade"><div className="card glow"><div className="empty">{error}</div></div></div>
  }
  return (
    <div className="content fade">
      <div className="cost-head">
        <div><h2 style={{ margin: 0 }}>Resources</h2><div className="muted" style={{ fontSize: 'var(--fs-label)' }}>Everything running across your connected clouds</div></div>
      </div>
      <ResourcesTable resources={resources || []} onRowClick={onRowClick} connected={connected} />
    </div>
  )
}

/* ---------- AI Agents view ---------- */
// inline icons for the composer (match company-brain Home.tsx)
const IcoPlus = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
const IcoLayout = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M14 3v18M14 9h7"/></svg>
const IcoUp = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
const IcoBrain = ({ on }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={on ? 'var(--green)' : 'currentColor'} strokeWidth="1.8"><circle cx="12" cy="12" r="3.6"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/></svg>

const TRY = [
  { tag: 'resources', q: 'What resources do I have on AWS?', icon: 'cube' },
  { tag: 'cost', q: 'Estimate cost for a 3-tier app on AWS', icon: 'dollar' },
  { tag: 'health', q: 'Which of my resources are degraded?', icon: 'shield' },
  { tag: 'design', q: 'Design a cheap, production-ready API on AWS', icon: 'arch' },
]

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function AgentPicker({ active, setActive }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className="agent-pick" ref={ref}>
      <button className="agent-pick-btn" onClick={() => setOpen(o => !o)}>
        <IcoBrain on />{active.name}
        <span style={{ color: 'var(--muted-2)' }}><ChevronDownSm /></span>
      </button>
      {open && (
        <div className="agent-pick-menu">
          <div className="agent-pick-lbl">MODE</div>
          {D.agents.map(a => (
            <div key={a.id} className={'agent-pick-row' + (a.id === active.id ? ' on' : '')}
                 onClick={() => { setActive(a); setOpen(false) }}>
              <span className="pavatar">{a.name[0]}</span>
              <span style={{ flex: 1 }}><span className="pl">{a.name}</span><span className="ps">{a.role}</span></span>
              {a.id === active.id && <span style={{ color: 'var(--accent)' }}>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
const ChevronDownSm = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 9l6 6 6-6"/></svg>

function Composer({ active, setActive, draft, setDraft, send, streaming, placeholder, big }) {
  const taRef = useRef(null)
  const grow = (el) => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 150) + 'px' }
  return (
    <div className={'composer' + (big ? ' big' : '')}>
      <textarea ref={taRef} rows={1} placeholder={placeholder} value={draft}
        onChange={e => { setDraft(e.target.value); grow(e.target) }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); if (taRef.current) taRef.current.style.height = 'auto' } }} />
      <div className="composer-row">
        <button className="composer-icon" title="New chat" onClick={() => setDraft('')}><IcoPlus /></button>
        <AgentPicker active={active} setActive={setActive} />
        <span className="composer-hint">{streaming ? 'working…' : 'designs, deploys & explains your cloud'}</span>
        <button className="composer-send" onClick={() => send(draft)} disabled={streaming}><IcoUp /></button>
      </div>
    </div>
  )
}

// Derive a short session title from the first user message.
function deriveTitle(m) {
  const text = (m?.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join(' ').trim()
  if (!text) return null
  return text.length > 42 ? text.slice(0, 42).trim() + '…' : text
}

// Chat session switcher — new session + switch back to an old one.
function SessionMenu({ chats, chatId, onOpen, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const cur = chats.find((c) => c.id === chatId)
  return (
    <div className="sess-menu" ref={ref}>
      <button className="sess-btn" onClick={() => setOpen((o) => !o)}>
        <span className="sess-title">{cur?.title || 'Chat'}</span><ChevronDownSm />
      </button>
      {open && (
        <div className="sess-pop">
          <div className="sess-lbl">CHATS</div>
          {chats.length ? chats.map((c) => (
            <div key={c.id} className={'sess-row' + (c.id === chatId ? ' on' : '')} onClick={() => { onOpen(c.id); setOpen(false) }}>
              <span className="sess-row-title">{c.title || 'New chat'}</span>
              <button className="sess-del" onClick={(e) => { e.stopPropagation(); onDelete(c.id) }} title="Delete chat">✕</button>
            </div>
          )) : <div className="sess-empty">No chats yet</div>}
        </div>
      )}
    </div>
  )
}

export function Agents({ onCanvasChange, chatId, onChatChange }) {
  const [active, setActive] = useState(D.agents[0])
  const ctx = useOutletContext?.() || {}
  // Default mode = Agent if the canvas already has a design (graph nodes or live resources),
  // otherwise Design. Stops overriding once the user picks a mode themselves.
  const pickedMode = useRef(false)
  const chooseMode = (a) => { pickedMode.current = true; setActive(a) }
  useEffect(() => {
    if (!ctx.project?.id) return
    let alive = true
    getGraph(ctx.project.id).then(g => {
      if (!alive || pickedMode.current) return
      const hasDesign = (g?.nodes?.length || 0) > 0 || (ctx.overview?.resources?.length || 0) > 0
      setActive(hasDesign ? D.agents[1] : D.agents[0])
    }).catch(() => {})
    return () => { alive = false }
  }, [ctx.project?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Tell the backend which MODE (design vs deploy) and which project the canvas belongs to.
  const { messages, send, draft, setDraft, streaming, setMessages, error } =
    useConversation({ mode: active.mode, projectId: ctx.project?.id, focus: active.name })
  const scrollRef = useRef(null)
  const [canvasOpen, setCanvasOpen] = useState(false) // slide-in architecture canvas (split-view)
  useEffect(() => { onCanvasChange?.(canvasOpen) }, [canvasOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── chat sessions (URL-driven: chatId comes from /app/chat/:chatId) ──
  const [chats, setChats] = useState([])
  const chatIdRef = useRef(null); chatIdRef.current = chatId
  const messagesRef = useRef(messages); messagesRef.current = messages
  const openChat = (id) => onChatChange?.(id) // navigate; the effect below loads it

  const newChat = async () => {
    try { const c = await createChat(); setChats((cs) => [c, ...cs]); onChatChange?.(c.id) } catch { /* ignore */ }
  }
  const removeChat = async (id) => {
    deleteChat(id).catch(() => {})
    const next = chats.filter((c) => c.id !== id); setChats(next)
    if (id === chatId) onChatChange?.(next[0]?.id || null) // null → the effect creates a fresh one
  }
  // Keep the session list fresh.
  useEffect(() => { listChats().then((r) => setChats(r?.chats || [])).catch(() => setChats([])) }, [])
  // Open whatever the URL points to; if none, jump to the most recent (or create one).
  const openedRef = useRef(null)
  useEffect(() => {
    if (chatId) {
      if (openedRef.current !== chatId) { openedRef.current = chatId; getChat(chatId).then((c) => setMessages(c?.messages || [])).catch(() => setMessages([])) }
      return
    }
    openedRef.current = null
    ;(async () => {
      const r = await listChats().catch(() => null); const list = r?.chats || []
      if (list[0]) onChatChange?.(list[0].id)
      else { const c = await createChat().catch(() => null); if (c) { setChats((cs) => [c, ...cs]); onChatChange?.(c.id) } }
    })()
  }, [chatId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pick up a question handed off from a resource's "Ask an agent" / "Edit" buttons.
  useEffect(() => {
    try {
      const d = sessionStorage.getItem('nimbus.chatDraft')
      if (d) { setDraft(d); sessionStorage.removeItem('nimbus.chatDraft') }
    } catch { /* ignore */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // When an agent turn finishes (streaming true → false): refresh canvas, and SAVE the session
  // (messages + auto-title) so it can be reopened later.
  const wasStreaming = useRef(false)
  useEffect(() => {
    if (wasStreaming.current && !streaming) {
      ctx.refresh?.(); ctx.bumpGraph?.()
      const id = chatIdRef.current, msgs = messagesRef.current
      if (id && msgs.length) {
        const title = deriveTitle(msgs.find((m) => m.role === 'user'))
        saveChat(id, { messages: msgs, ...(title ? { title } : {}) }).then((saved) => {
          if (saved?.id) setChats((cs) => cs.map((c) => (c.id === id ? { ...c, title: saved.title, updatedAt: saved.updatedAt } : c)))
        }).catch(() => {})
      }
    }
    wasStreaming.current = streaming
  }, [streaming]) // eslint-disable-line react-hooks/exhaustive-deps
  // While the agent is working, poll the canvas so nodes appear LIVE as it draws/deploys them
  // (each create_node/connect_nodes persists immediately server-side).
  useEffect(() => {
    if (!streaming) return
    const t = setInterval(() => ctx.bumpGraph?.(), 1000)
    return () => clearInterval(t)
  }, [streaming]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [messages, streaming])
  const activeConvo = messages.length > 0
  const composerProps = { active, setActive: chooseMode, draft, setDraft, send, streaming }

  const canvas = canvasOpen && (
    <aside className="chat-canvas">
      <header className="chat-canvas-top">
        <span className="chat-canvas-tab on">Architecture</span>
        <div style={{ flex: 1 }} />
        <button className="chat-canvas-x" title="Close canvas" onClick={() => setCanvasOpen(false)}>✕</button>
      </header>
      <div className="chat-canvas-body">
        <CloudMap project={ctx.project} resources={ctx.overview?.resources || []} graphTick={ctx.graphTick} />
      </div>
    </aside>
  )
  const CanvasBtn = (
    <button className={'chat-tb-btn' + (canvasOpen ? ' on' : '')} onClick={() => setCanvasOpen(o => !o)} title="Open canvas">
      <IcoLayout /> Canvas
    </button>
  )

  // ── active conversation ──
  if (activeConvo) {
    return (
      <div className="chat-shell">
      <div className="chatpage fade">
        <div className="chat-topbar">
          <div style={{ flex: 1 }} />
          {CanvasBtn}
          <SessionMenu chats={chats} chatId={chatId} onOpen={openChat} onDelete={removeChat} />
          <button className="chat-tb-btn" onClick={newChat}><IcoPlus /> New chat</button>
        </div>
        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-thread">
            <AgentThread messages={messages} streaming={streaming} error={error} />
          </div>
        </div>
        <div className="chat-foot"><div className="chat-foot-in">
          <Composer {...composerProps} placeholder="ask a follow-up, or give it a task…" />
        </div></div>
      </div>
      {canvas}
      </div>
    )
  }

  // ── landing (empty) ──
  return (
    <div className="chat-shell">
    <div className="chat-landing fade">
      <div className="chat-topbar">
        <div style={{ flex: 1 }} />
        {CanvasBtn}
        {chats.length > 0 && <SessionMenu chats={chats} chatId={chatId} onOpen={openChat} onDelete={removeChat} />}
        <button className="chat-tb-btn" onClick={newChat}><IcoPlus /> New chat</button>
      </div>
      <div className="chat-land-center">
        <div className="chat-land">
          <h1 className="chat-h1">{greeting()}, Hritvik.</h1>
          <p className="chat-subp">Your agents have read across every connected cloud. Ask what's running, what it costs, or tell one to design and provision it for you.</p>

          <Composer {...composerProps} placeholder="ask your cloud anything, or give it a task…" big />

          <div className="chat-sep"><span>Try asking</span><div className="line" /></div>
          <div className="try-grid">
            {TRY.map((a, i) => (
              <div className="try-card" key={i} onClick={() => send(a.q)}>
                <div className="try-ico"><Icon name={a.icon} size={15} /></div>
                <div><div className="try-tag">{a.tag}</div><div className="try-q">{a.q}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    {canvas}
    </div>
  )
}

/* ---------- CanvasChat — a standalone Nimbus chat sidebar for the Canvas page ----------
   Same backend (useConversation → /api/agent streaming), same Composer / AgentThread / sessions as
   Agents, but WITHOUT the canvas split-view: the top bar is just the session dropdown + New chat. */
export function CanvasChat({ chatId, onChatChange }) {
  const [active, setActive] = useState(D.agents[0])
  const ctx = useOutletContext?.() || {}
  const pickedMode = useRef(false)
  const chooseMode = (a) => { pickedMode.current = true; setActive(a) }
  useEffect(() => {
    if (!ctx.project?.id) return
    let alive = true
    getGraph(ctx.project.id).then(g => {
      if (!alive || pickedMode.current) return
      const hasDesign = (g?.nodes?.length || 0) > 0 || (ctx.overview?.resources?.length || 0) > 0
      setActive(hasDesign ? D.agents[1] : D.agents[0])
    }).catch(() => {})
    return () => { alive = false }
  }, [ctx.project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const { messages, send, draft, setDraft, streaming, setMessages, error } =
    useConversation({ mode: active.mode, projectId: ctx.project?.id, focus: active.name })
  const scrollRef = useRef(null)

  // ── chat sessions ──
  const [chats, setChats] = useState([])
  const chatIdRef = useRef(null); chatIdRef.current = chatId
  const messagesRef = useRef(messages); messagesRef.current = messages
  const openChat = (id) => onChatChange?.(id)
  const newChat = async () => {
    try { const c = await createChat(); setChats((cs) => [c, ...cs]); onChatChange?.(c.id) } catch { /* ignore */ }
  }
  const removeChat = async (id) => {
    deleteChat(id).catch(() => {})
    const next = chats.filter((c) => c.id !== id); setChats(next)
    if (id === chatId) onChatChange?.(next[0]?.id || null)
  }
  useEffect(() => { listChats().then((r) => setChats(r?.chats || [])).catch(() => setChats([])) }, [])
  const openedRef = useRef(null)
  useEffect(() => {
    if (chatId) {
      if (openedRef.current !== chatId) { openedRef.current = chatId; getChat(chatId).then((c) => setMessages(c?.messages || [])).catch(() => setMessages([])) }
      return
    }
    openedRef.current = null
    ;(async () => {
      const r = await listChats().catch(() => null); const list = r?.chats || []
      if (list[0]) onChatChange?.(list[0].id)
      else { const c = await createChat().catch(() => null); if (c) { setChats((cs) => [c, ...cs]); onChatChange?.(c.id) } }
    })()
  }, [chatId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save the session + refresh the canvas live as the agent designs/deploys.
  const wasStreaming = useRef(false)
  useEffect(() => {
    if (wasStreaming.current && !streaming) {
      ctx.refresh?.(); ctx.bumpGraph?.()
      const id = chatIdRef.current, msgs = messagesRef.current
      if (id && msgs.length) {
        const title = deriveTitle(msgs.find((m) => m.role === 'user'))
        saveChat(id, { messages: msgs, ...(title ? { title } : {}) }).then((saved) => {
          if (saved?.id) setChats((cs) => cs.map((c) => (c.id === id ? { ...c, title: saved.title, updatedAt: saved.updatedAt } : c)))
        }).catch(() => {})
      }
    }
    wasStreaming.current = streaming
  }, [streaming]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!streaming) return
    const t = setInterval(() => ctx.bumpGraph?.(), 1000)
    return () => clearInterval(t)
  }, [streaming]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [messages, streaming])

  const activeConvo = messages.length > 0
  const composerProps = { active, setActive: chooseMode, draft, setDraft, send, streaming }
  const TopBar = (
    <div className="chat-topbar">
      <div style={{ flex: 1 }} />
      {chats.length > 0 && <SessionMenu chats={chats} chatId={chatId} onOpen={openChat} onDelete={removeChat} />}
      <button className="chat-tb-btn" onClick={newChat}><IcoPlus /> New chat</button>
    </div>
  )

  // Always the bottom-composer layout — even when empty (no center greeting / try-asking block).
  return (
    <div className="chat-shell">
      <div className="chatpage fade">
        {TopBar}
        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-thread"><AgentThread messages={messages} streaming={streaming} error={error} /></div>
        </div>
        <div className="chat-foot"><div className="chat-foot-in">
          <Composer {...composerProps} placeholder={activeConvo ? 'ask a follow-up, or give it a task…' : 'ask your cloud anything, or give it a task…'} />
        </div></div>
      </div>
    </div>
  )
}

/* ---------- Cost (ACTUAL spend from the cloud billing APIs) ---------- */
// Per-cloud setup steps shown in the (i) modal — what the user grants so we can fetch real spend.
const COST_SETUP = {
  aws: {
    name: 'Amazon Web Services',
    via: 'AWS Cost Explorer',
    steps: [
      'AWS Console → Billing & Cost Management → Cost Explorer → Enable Cost Explorer (one-time, account owner).',
      'Attach an IAM policy to the user whose keys you connected, allowing ce:GetCostAndUsage (and ce:GetCostForecast, ce:GetDimensionValues).',
      'AWS takes up to ~24h to populate cost data. Then hit Refresh.',
    ],
  },
  gcp: {
    name: 'Google Cloud',
    via: 'BigQuery billing export',
    steps: [
      'Google Cloud Console → Billing → Billing export → BigQuery export → Enable, and pick a dataset.',
      'Enable the BigQuery API, and grant the connected account BigQuery Data Viewer + Job User on that project/dataset.',
      'Cost data flows into BigQuery within a few hours. Then hit Refresh.',
    ],
  },
}

function CloudCostCard({ id, data, onInfo }) {
  const name = COST_SETUP[id]?.name || id.toUpperCase()
  const ready = data?.status === 'ready'
  return (
    <div className="card glow">
      <div className="section-head">
        <h2>{name}</h2>
        {ready ? <span className="muted">{COST_SETUP[id].via}</span>
          : <button className="cost-info-btn" onClick={() => onInfo(id)} title="How to enable">ⓘ how to enable</button>}
      </div>
      {ready ? (
        <>
          <div className="cost-total">{money(data.total)}<span className="cost-total-mo"> this month</span></div>
          <div className="cost-rows">
            {data.byService.length ? data.byService.slice(0, 12).map((s) => (
              <div className="cost-row" key={s.service}><span>{s.service}</span><b>{money(s.usd)}</b></div>
            )) : <div className="rd-empty">No charges yet this month.</div>}
          </div>
        </>
      ) : data?.status === 'pending' ? (
        <div className="empty"><b style={{ color: 'var(--text)' }}>Billing export enabled ✓</b><br /><br />Waiting for the first daily export to land (a few hours). Hit Refresh later.</div>
      ) : data?.status === 'error' ? (
        <div className="empty">Couldn’t read billing: {data.message}</div>
      ) : (
        <div className="empty">
          <b style={{ color: 'var(--text)' }}>Billing access not set up</b><br /><br />
          Enable {COST_SETUP[id]?.via} so we can fetch your real spend.<br /><br />
          <button className="cost-info-btn" onClick={() => onInfo(id)}>ⓘ See how to enable →</button>
        </div>
      )}
    </div>
  )
}

export function Cost() {
  const [cost, setCost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState(null) // cloud id for the instructions modal

  const load = () => { setLoading(true); getCost().then(setCost).catch((e) => setErr(e?.message || 'Failed to load cost.')).finally(() => setLoading(false)) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const clouds = cost ? Object.keys(cost).filter((k) => k !== 'period') : []

  return (
    <div className="content fade">
      <div className="cost-head">
        <div><h2 style={{ margin: 0 }}>Cost</h2><div className="muted" style={{ fontSize: 'var(--fs-label)' }}>Actual spend on your connected clouds{cost?.period ? ` · ${cost.period.start} → ${cost.period.end}` : ''}</div></div>
        <button className="chat-tb-btn" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh'}</button>
      </div>

      {loading && !cost ? <div className="card glow"><div className="empty">Reading billing from your clouds…</div></div>
        : err ? <div className="card glow"><div className="empty">{err}</div></div>
        : !clouds.length ? (
          <div className="card glow"><div className="empty">
            <b style={{ color: 'var(--text)' }}>No clouds connected</b><br /><br />
            <Link to="/app/connections" style={{ color: 'var(--accent)' }}>Connect a cloud →</Link>
          </div></div>
        ) : clouds.map((id) => <CloudCostCard key={id} id={id} data={cost[id]} onInfo={setInfo} />)}

      {/* (i) instructions modal — anchored on the LEFT */}
      {info && (
        <div className="cost-modal-scrim" onClick={() => setInfo(null)}>
          <div className="cost-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cost-modal-head">
              <div className="cost-modal-title">Enable {COST_SETUP[info]?.via}</div>
              <button className="rd-x" onClick={() => setInfo(null)}>✕</button>
            </div>
            <div className="cost-modal-sub">{COST_SETUP[info]?.name} — grant these so Nimbus can read your real spend:</div>
            <ol className="cost-steps">
              {COST_SETUP[info]?.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setInfo(null); load() }}>I’ve done this — Refresh</button>
          </div>
        </div>
      )}
    </div>
  )
}
