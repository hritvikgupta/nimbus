import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import '../../styles/landing.css'

/* Nimbus split-view landing, a sticky left hero + a right column of full-height panels that the
   left nav tracks as you scroll. Layout is adapted from the reference; theme is OUR flat
   black/white scrape-leads look (Hanken Grotesk + JetBrains Mono), not the navy/orange reference. */

const SANS = "'Hanken Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif"
const MONO = "'JetBrains Mono','SFMono-Regular',Menlo,monospace"
const PIXEL = "'Pixelify Sans','JetBrains Mono',monospace" // pixel/retro accent for the highlighted hero words
const ink = '#141414', mut = '#555555', faint = '#9a9a9a', line = '#E6E6E6', line2 = '#DBDBDB'
const bg = '#ffffff', bg2 = '#FAFAF8'
// AWS-inspired accent palette
const aws = '#FF9900', awsInk = '#16160F', awsSoft = 'rgba(255,153,0,0.12)'

const Logo = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={{ display: 'block' }}>
    <path d="M14 34a8 8 0 0 1 .6-16 11 11 0 0 1 21-2A7.5 7.5 0 0 1 35 34H14z" fill="#111111" />
    <circle cx="19" cy="27" r="1.6" fill="#fff" /><circle cx="26" cy="27" r="1.6" fill="#fff" />
  </svg>
)

// Nimbus documentation site (deployed separately on Fly). Override with VITE_DOCS_URL at build time.
const DOCS_URL = import.meta.env.VITE_DOCS_URL || 'https://nimbus-docs.fly.dev'

// Cal.com booking link — "username/event". Replace with your real Cal.com link (e.g. 'nimbus/demo').
// Uses Cal.com's embed iframe so we keep our own themed modal chrome around their scheduler.
const CAL_LINK = 'hritvik-gupta-zjkgnc/30min'

// Themed "Book a demo" modal — Cal.com scheduler embedded in an in-app dialog.
function BookDemoModal({ open, onClose }) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!open) return
    setLoaded(false)
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])
  if (!open) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(20,20,20,0.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(940px,100%)', height: 'min(680px,90vh)', background: bg, border: `1px solid ${line2}`, borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.45)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${line}`, flex: '0 0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={22} />
            <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-0.02em', color: ink }}>Book a demo</span>
            <span style={{ fontSize: 12, color: faint, fontFamily: MONO }}>· 30 min with the Nimbus team</span>
          </div>
          <button onClick={onClose} className="spl-btn" style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${line2}`, background: bg2, color: mut, cursor: 'pointer', fontSize: 15, display: 'grid', placeItems: 'center' }}>✕</button>
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          {!loaded && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: bg }}>
              <span className="spl-spin" />
              <span style={{ fontSize: 12.5, color: faint, fontFamily: MONO, letterSpacing: '0.02em' }}>loading available times…</span>
            </div>
          )}
          <iframe title="Book a demo" onLoad={() => setLoaded(true)}
            src={`https://cal.com/${CAL_LINK}?embed=true&theme=light`}
            style={{ width: '100%', height: '100%', border: 'none', opacity: loaded ? 1 : 0, transition: 'opacity .25s ease' }} />
        </div>
      </div>
    </div>
  )
}

const NAV = [
  ['01', 'Any cloud'], ['02', 'Connect a machine'], ['03', 'Isolated sandboxes'],
  ['04', 'Design on a canvas'], ['05', 'Cost & savings'], ['06', 'Reusable workflows'],
  ['07', 'Sessions board'], ['08', 'Live agent session'],
]
const BULLETS = [
  'Designs, fixes, and operates your cloud across AWS, GCP & Azure',
  'Runs every task in an isolated, throwaway sandbox',
  'Talks to you in a native Claude or Codex session',
  'Scoped, time-boxed credentials, nothing touches prod uninvited',
]
const TERMINAL = [
  { k: 'you', t: 'fix the 502s on api-gateway' },
  { k: 'agent', t: 'connected my-mac · claude session · 14 files' },
  { k: 'agent', t: 'sandbox sbx-7f3a up · scoped aws/prod-readonly' },
  { k: 'agent', t: 'reproduced, ALB health check timing out on /healthz' },
  { k: 'fix', t: 'raise target-group timeout 5s → 30s' },
  { k: 'ok', t: 'applied in sandbox · 200 OK on 50/50 probes' },
  { k: 'you', t: 'save this as a workflow' },
  { k: 'ok', t: 'workflow heal-502 · trigger alarm:5xx-spike' },
]
const RUNTIMES = [
  { tag: 'byo', glyph: '⌘', title: 'Your machine', body: 'Connect over an existing Claude or Codex native session. Your context, files, credentials.', cmd: 'claude · codex native session' },
  { tag: 'shared', glyph: '⇄', title: "Someone else's", body: 'Pair on a shared runtime. Grant a teammate scoped, revocable access without handing over keys.', cmd: 'scoped · revocable access' },
  { tag: 'managed', glyph: '☁', title: 'Rent a machine', body: 'Spin up an ephemeral managed runtime, billed by the second. Torn down when the task ends.', cmd: 'ephemeral · billed per second' },
]
const SPECS = [
  ['Filesystem', 'ephemeral overlay, wiped on exit'],
  ['Credentials', 'scoped IAM, time-boxed tokens'],
  ['Network', 'egress allowlist per task'],
  ['Teardown', 'automatic on session close'],
  ['Audit', 'full command + diff log'],
]
const CAPS = [
  { glyph: '▣', title: 'Design infrastructure', body: 'Draft and review IaC, networks, clusters, pipelines, grounded in your existing setup.' },
  { glyph: '✕', title: 'Fix cloud bugs', body: 'Reproduce the failure in a sandbox, propose a fix, prove it passes before you apply.' },
  { glyph: '▶', title: 'Run tasks', body: "Migrations, backfills, cleanups, the chores you'd rather not babysit, run end to end." },
  { glyph: '∞', title: 'Operate continuously', body: 'Wire fixes to triggers so recurring incidents heal themselves and report back.' },
]
const TRIGGERS = ['cron', 'webhook', 'cloud alarm', 'manual', 'git push']
const CLOUDS = ['aws', 'gcp', 'azure', 'fly.io', 'cloudflare', 'kubernetes']
// hub & spoke diagram (ported from our original landing), connected clouds → Nimbus → actions
const CLOUD_SPOKES = [['Amazon Web Services', 'EC2 · RDS · S3 · Lambda.', '/brand/amazonwebservices.svg'], ['Google Cloud', 'GCE · Cloud SQL · GKE.', '/brand/googlecloud.svg'], ['Microsoft Azure', 'VMs · AKS · Azure SQL.', '/brand/microsoftazure.svg'], ['PostgreSQL', 'Schemas · queries · roles.', '/brand/postgresql.svg']]
const ACTION_SPOKES = [['Analyze', 'Map every resource in scope.'], ['Diagnose', 'Baseline metrics, logs & traces.'], ['Plan & apply', 'Readable IaC diff, gated by you.'], ['Verify & learn', 'Before/after proof, runbook updated.']]
const svgP = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: '#141414', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }
const ACT_ICONS = [
  <svg key="a" {...svgP}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>,            // analyze, magnifier
  <svg key="d" {...svgP}><path d="M3 12h4l2 6 4-14 2 8h6" /></svg>,                                   // diagnose, pulse
  <svg key="p" {...svgP}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M8.5 12l2 2 4-4" /></svg>, // plan & apply, clipboard check
  <svg key="v" {...svgP}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>,             // verify & learn, refresh-check
]
const TOPS = [90, 230, 370, 510]
const WORKFLOW = [
  [['name', ink], [': heal-502', mut]],
  [['trigger', ink], [':', faint]],
  [['  on', ink], [': ', faint], ['alarm:5xx-spike', mut]],
  [['runtime', ink], [': ', faint], ['rent:small', mut]],
  [['sandbox', ink], [': ', faint], ['true', ink]],
  [['steps', ink], [':', faint]],
  [['  - reproduce', mut]],
  [['  - propose_fix', mut]],
  [['  - apply_if: ', mut], ['probes_pass', ink]],
  [['approval', ink], [': ', faint], ['auto', ink]],
]

const META = { you: { txt: 'you', col: ink }, agent: { txt: 'agent', col: mut }, fix: { txt: 'fix', col: ink }, ok: { txt: 'ok', col: '#1a7f4b' } }

function Terminal() {
  const [done, setDone] = useState(0)
  const [partial, setPartial] = useState('')
  const tRef = useRef()
  useEffect(() => {
    let d = 0, p = ''
    const tick = () => {
      if (d >= TERMINAL.length) return
      const cur = TERMINAL[d]
      if (cur.k === 'you') {
        if (p.length < cur.t.length) { p = cur.t.slice(0, p.length + 1); setPartial(p); tRef.current = setTimeout(tick, 26) }
        else { d += 1; p = ''; setDone(d); setPartial(''); tRef.current = setTimeout(tick, 480) }
      } else { d += 1; setDone(d); tRef.current = setTimeout(tick, 400) }
    }
    tRef.current = setTimeout(tick, 500)
    return () => clearTimeout(tRef.current)
  }, [])
  const Row = ({ k, body, cursor }) => (
    <div style={{ display: 'flex', gap: 12, marginBottom: 4, alignItems: 'baseline' }}>
      <span style={{ flex: '0 0 auto', width: 42, color: META[k].col, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', paddingTop: 1 }}>{META[k].txt}</span>
      <span style={{ flex: 1, color: k === 'you' ? ink : META[k].col }}>{body}{cursor && <span className="spl-cursor" />}</span>
    </div>
  )
  const rows = []
  for (let i = 0; i < done; i++) rows.push(<Row key={i} k={TERMINAL[i].k} body={TERMINAL[i].t} />)
  if (done < TERMINAL.length) { if (TERMINAL[done].k === 'you') rows.push(<Row key="live" k="you" body={partial} cursor />) }
  else rows.push(<Row key="end" k="you" body="" cursor />)
  return <div>{rows}</div>
}

// Hub-and-spoke flow diagram, scaled to fit its column (from our original landing).
function HubSpoke() {
  const wrapRef = useRef(null), innerRef = useRef(null)
  useEffect(() => {
    const fit = () => {
      const w = wrapRef.current, i = innerRef.current
      if (!w || !i) return
      const s = Math.min(1, w.clientWidth / 1100)
      i.style.transform = `scale(${s})`
      w.style.height = (600 * s) + 'px'
    }
    fit(); requestAnimationFrame(fit)
    window.addEventListener('resize', fit)
    let ro
    if (window.ResizeObserver && wrapRef.current) { ro = new ResizeObserver(fit); ro.observe(wrapRef.current) }
    return () => { window.removeEventListener('resize', fit); ro?.disconnect() }
  }, [])
  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
      <div ref={innerRef} style={{ position: 'relative', width: 1100, height: 600, transformOrigin: 'top left' }}>
        <svg viewBox="0 0 1100 600" width="1100" height="600" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }} aria-hidden="true">
          <g fill="none" stroke="#7d7d7d" strokeWidth="1.7" strokeDasharray="5 7" strokeLinecap="round" style={{ animation: 'dashflow 0.9s linear infinite' }}>
            <path d="M380,90 L430,90" /><path d="M380,230 L430,230" /><path d="M380,370 L430,370" /><path d="M380,510 L430,510" />
            <path d="M430,90 L430,510" /><path d="M430,300 L500,300" />
            <path d="M670,90 L720,90" /><path d="M670,230 L720,230" /><path d="M670,370 L720,370" /><path d="M670,510 L720,510" />
            <path d="M670,90 L670,510" /><path d="M600,300 L670,300" />
          </g>
          <g fill="#5f5f5f">
            {TOPS.map(y => <circle key={'l' + y} cx="380" cy={y} r="3.6" />)}
            {TOPS.map(y => <circle key={'r' + y} cx="720" cy={y} r="3.6" />)}
          </g>
          <circle cx="550" cy="300" r="42" fill="#fff" stroke="#cfcfcf" strokeWidth="1.4" />
          <g transform="translate(522,271) scale(1.15)">
            <path d="M14 34a8 8 0 0 1 .6-16 11 11 0 0 1 21-2A7.5 7.5 0 0 1 35 34H14z" fill="#111111" />
            <circle cx="19" cy="27" r="1.6" fill="#fff" /><circle cx="26" cy="27" r="1.6" fill="#fff" />
          </g>
        </svg>
        <div style={{ position: 'absolute', left: 0, top: 16, fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', color: faint, fontFamily: MONO }}>Connected clouds</div>
        <div style={{ position: 'absolute', right: 0, top: 16, fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', color: faint, fontFamily: MONO, textAlign: 'right' }}>Autonomous actions</div>
        {CLOUD_SPOKES.map(([t, s], i) => (
          <div key={t} style={{ position: 'absolute', left: 150, top: TOPS[i], width: 230, transform: 'translateY(-50%)', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src={CLOUD_SPOKES[i][2]} width={21} height={21} alt="" style={{ flex: '0 0 auto', display: 'block' }} />
              <span style={{ fontSize: 17, fontWeight: 600, color: ink, letterSpacing: '-0.01em' }}>{t}</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.45, color: mut, marginTop: 5 }}>{s}</div>
          </div>
        ))}
        {ACTION_SPOKES.map(([t, s], i) => (
          <div key={t} style={{ position: 'absolute', right: 150, top: TOPS[i], width: 230, transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
              <span style={{ fontSize: 17, fontWeight: 600, color: ink, letterSpacing: '-0.01em' }}>{t}</span>
              <span style={{ flex: '0 0 auto', display: 'flex' }}>{ACT_ICONS[i]}</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.45, color: mut, marginTop: 5 }}>{s}</div>
          </div>
        ))}
        <div style={{ position: 'absolute', left: '50%', top: 366, transform: 'translateX(-50%)', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>Nimbus</div>
        </div>
      </div>
    </div>
  )
}

// Sandbox isolation diagram, repo → isolated sandbox (ephemeral fs / scoped creds / egress
// allowlist) → approval gate → prod. Themed flat black/white with the dashed-flow animation.
function SandboxDiagram() {
  const box = { background: bg, border: `1px solid ${line2}`, borderRadius: 8, padding: '12px 14px', textAlign: 'center' }
  const tag = { fontSize: 10, letterSpacing: '0.06em', color: faint, fontFamily: MONO }
  const chip = { fontSize: 11.5, color: mut, border: `1px solid ${line}`, borderRadius: 6, padding: '6px 10px', background: bg }
  return (
    <div style={{ border: `1px solid ${line}`, borderRadius: 10, background: bg2, padding: 24, display: 'flex', alignItems: 'stretch', gap: 16 }}>
      {/* repo */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, flex: '0 0 auto', width: 96 }}>
        <div style={box}><div style={tag}>Your code</div><div style={{ fontSize: 12, color: ink, marginTop: 4, fontFamily: MONO }}>stax</div></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', color: faint }}><span className="spl-flow" /></div>

      {/* sandbox, dashed isolation boundary */}
      <div style={{ flex: 1, minWidth: 0, border: `1.5px dashed ${faint}`, borderRadius: 10, padding: '16px 16px 14px', position: 'relative', background: 'repeating-linear-gradient(135deg, transparent, transparent 9px, rgba(0,0,0,0.012) 9px, rgba(0,0,0,0.012) 18px)' }}>
        <div style={{ position: 'absolute', top: -9, left: 14, background: bg2, padding: '0 7px', fontSize: 11, color: ink, fontWeight: 600 }}>A private, throwaway computer</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ ...box, padding: '8px 12px', fontSize: 12, color: ink }}>Nimbus does the work here</span>
          <span style={{ color: faint, fontSize: 13 }}>→</span>
          <span style={{ ...chip, color: faint }}>deleted when done</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'center' }}>
          <span style={chip}>A copy of your code, not the real thing</span>
          <span style={chip}>Temporary keys that expire</span>
          <span style={chip}>Can only reach what you allow</span>
          <span style={chip}>Every step recorded</span>
        </div>
      </div>

      {/* approval gate → prod */}
      <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'column', justifyContent: 'center', gap: 4, flex: '0 0 auto', width: 72 }}>
        <span style={{ fontSize: 10.5, color: ink, fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>you<br />approve</span>
        <span style={{ fontSize: 16, color: ink }}>→</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: '0 0 auto', width: 92 }}>
        <div style={{ ...box, borderColor: ink }}><div style={tag}>Live cloud</div><div style={{ fontSize: 12, color: ink, marginTop: 4 }}>your real apps</div></div>
      </div>
    </div>
  )
}

// Design canvas, faithful to our in-app React-Flow canvas: nodes with a cloud badge + service
// type, a name, and a region, wired with animated flow edges. Scaled to fit the column.
const CANVAS_NODES = [
  { x: 8, y: 128, cloud: 'AWS', type: 'ALB', name: 'web-lb', region: 'us-east-1' },
  { x: 196, y: 48, cloud: 'AWS', type: 'EC2', name: 'api', region: 'us-east-1' },
  { x: 196, y: 188, cloud: 'AWS', type: 'EC2', name: 'worker', region: 'us-east-1' },
  { x: 388, y: 128, cloud: 'AWS', type: 'RDS', name: 'postgres', region: 'us-east-1' },
  { x: 566, y: 48, cloud: 'AWS', type: 'ElastiCache', name: 'redis', region: 'us-east-1' },
  { x: 566, y: 188, cloud: 'AWS', type: 'S3', name: 'assets', region: 'global' },
]
const CW = 720, CH = 300, NODEW = 146
function DesignCanvas() {
  const wrapRef = useRef(null), innerRef = useRef(null)
  useEffect(() => {
    const fit = () => {
      const w = wrapRef.current, i = innerRef.current; if (!w || !i) return
      const s = Math.min(1, w.clientWidth / CW)
      i.style.transform = `scale(${s})`; w.style.height = (CH * s) + 'px'
    }
    fit(); requestAnimationFrame(fit)
    window.addEventListener('resize', fit)
    let ro; if (window.ResizeObserver && wrapRef.current) { ro = new ResizeObserver(fit); ro.observe(wrapRef.current) }
    return () => { window.removeEventListener('resize', fit); ro?.disconnect() }
  }, [])
  const cy = (n) => n.y + 28
  const edges = [
    [156, cy(CANVAS_NODES[0]), 196, cy(CANVAS_NODES[1])],
    [156, cy(CANVAS_NODES[0]), 196, cy(CANVAS_NODES[2])],
    [342, cy(CANVAS_NODES[1]), 388, cy(CANVAS_NODES[3])],
    [342, cy(CANVAS_NODES[2]), 388, cy(CANVAS_NODES[3])],
    [534, cy(CANVAS_NODES[3]), 566, cy(CANVAS_NODES[4])],
    [534, cy(CANVAS_NODES[3]), 566, cy(CANVAS_NODES[5])],
  ]
  return (
    <div style={{ border: `1px solid ${line}`, borderRadius: 12, background: '#fff', backgroundImage: 'radial-gradient(#e6e6e2 1px, transparent 1px)', backgroundSize: '20px 20px', padding: 16, position: 'relative', overflow: 'hidden' }}>
      <span style={{ position: 'absolute', top: 12, left: 16, fontSize: 10.5, color: faint, fontFamily: MONO, letterSpacing: '0.06em', zIndex: 2 }}>canvas · drag to rewire</span>
      <span style={{ position: 'absolute', top: 11, right: 14, fontSize: 11, color: ink, fontWeight: 600, background: bg2, border: `1px solid ${line}`, borderRadius: 999, padding: '3px 11px', zIndex: 2 }}>+ Add resource</span>
      <div ref={wrapRef} style={{ position: 'relative', width: '100%', overflow: 'hidden', marginTop: 8 }}>
        <div ref={innerRef} style={{ position: 'relative', width: CW, height: CH, transformOrigin: 'top left' }}>
          <svg width={CW} height={CH} style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
            <g fill="none" stroke="#b3b3b3" strokeWidth="1.6" strokeDasharray="5 6" strokeLinecap="round" style={{ animation: 'dashflow .9s linear infinite' }}>
              {edges.map((e, i) => <path key={i} d={`M${e[0]},${e[1]} C${(e[0] + e[2]) / 2},${e[1]} ${(e[0] + e[2]) / 2},${e[3]} ${e[2]},${e[3]}`} />)}
            </g>
          </svg>
          {CANVAS_NODES.map((n, i) => (
            <div key={i} style={{ position: 'absolute', left: n.x, top: n.y, width: NODEW, background: '#fff', border: `1px solid ${line2}`, borderRadius: 12, padding: '11px 13px', boxShadow: '0 8px 22px rgba(0,0,0,0.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 9, letterSpacing: '0.5px', fontWeight: 700, color: mut, background: bg2, borderRadius: 5, padding: '1px 6px', fontFamily: MONO }}>{n.cloud}</span>
                <span style={{ fontSize: 10, color: faint, fontFamily: MONO }}>{n.type}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: ink }}>{n.name}</div>
              <div style={{ fontSize: 10.5, color: faint, marginTop: 2, fontFamily: MONO }}>{n.region}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Cost section, mirrors our in-app Cost view: KPI stats, a per-service breakdown with bars, and a
// CostGuard savings tip.
const COST_ROWS = [['Postgres · RDS', 52, '$52'], ['App · EC2 ×2', 46, '$46'], ['Load balancer', 18, '$18'], ['Redis cache', 14, '$14'], ['Storage · S3', 3, '$3']]
const COST_KPIS = [['Monthly spend', '$133'], ['Projected (30d)', '$141'], ['Savings found', '$22']]
function CostSection() {
  const max = Math.max(...COST_ROWS.map(r => r[1]))
  return (
    <div style={{ border: `1px solid ${line}`, borderRadius: 12, background: bg, overflow: 'hidden' }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', borderBottom: `1px solid ${line}` }}>
        {COST_KPIS.map(([k, v], i) => (
          <div key={k} style={{ padding: '16px 18px', borderRight: i < 2 ? `1px solid ${line}` : 'none' }}>
            <div style={{ fontSize: 11.5, color: faint, marginBottom: 6 }}>{k}</div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: i === 2 ? '#1a7f4b' : ink }}>{v}</div>
          </div>
        ))}
      </div>
      {/* breakdown with bars */}
      <div style={{ padding: '14px 18px 6px' }}>
        <div style={{ fontSize: 11.5, color: faint, marginBottom: 12, fontFamily: MONO, letterSpacing: '0.04em' }}>BY SERVICE · /mo</div>
        {COST_ROWS.map(([k, v, label]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, color: mut, width: 130, flex: '0 0 auto' }}>{k}</span>
            <span style={{ flex: 1, height: 7, background: bg2, borderRadius: 999, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${(v / max) * 100}%`, background: '#141414', borderRadius: 999 }} />
            </span>
            <span style={{ fontSize: 12.5, color: ink, fontFamily: MONO, width: 44, textAlign: 'right', flex: '0 0 auto' }}>{label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', background: bg2, borderTop: `1px solid ${line}` }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1a7f4b', flex: '0 0 auto' }} />
        <span style={{ fontSize: 12, color: mut }}><b style={{ color: ink, fontWeight: 600 }}>CostGuard</b>, the app tier is over-provisioned. Rightsize to save about <b style={{ color: ink, fontWeight: 600 }}>$22/mo</b>.</span>
      </div>
    </div>
  )
}

// Sessions board, mirrors our in-app Sessions view: every agent task across machines, grouped into
// Running / Waiting for review / Done, each card showing its machine and PR/stop status.
const SESSIONS_RUNNING = [
  ['my-mac', 'Fix the 502s on api-gateway', 'claude', 4],
  ['ibi-verma-004', 'Migrate the users table to Neon', 'opencode', 2],
]
const SESSIONS_REVIEW = [
  ['ibi-verma-004', 'Add GSAP animations to the Stax landing page'],
  ['ibi-verma-004', 'Remove all GSAP animations from the landing page'],
  ['ibi-verma-004', 'Check if we can add GSAP in the landing page'],
]
const SESSIONS_DONE = [
  ['ibi-verma-004', 'Add the GSAP animation in the landing page'],
  ['ibi-verma-004', 'Add GSAP animation, then open the pull request'],
]
function SessionsBoard() {
  const green = '#1a7f4b'
  const Card = ({ machine, title, footer }) => (
    <div className="spl-card" style={{ background: bg, border: `1px solid ${line}`, borderRadius: 10, padding: 15, marginBottom: 12 }}>
      <div style={{ fontSize: 10.5, color: faint, fontFamily: MONO, marginBottom: 8 }}>{machine}</div>
      <div style={{ fontSize: 12.5, color: ink, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.35, marginBottom: 13 }}>{title}</div>
      {footer}
    </div>
  )
  const Col = ({ title, count, children }) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 13 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: ink, letterSpacing: '-0.01em' }}>{title}</span>
        <span style={{ fontSize: 11.5, color: faint, fontFamily: MONO }}>{count}</span>
      </div>
      {children}
    </div>
  )
  return (
    <div style={{ border: `1px solid ${line2}`, borderRadius: 12, background: bg2, overflow: 'hidden', boxShadow: '0 22px 50px -28px rgba(0,0,0,0.22)' }}>
      {/* tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '12px 18px', borderBottom: `1px solid ${line}`, background: bg, fontSize: 12.5, fontFamily: SANS }}>
        <span style={{ color: ink, fontWeight: 600 }}>All</span>
        <span style={{ color: faint }}>Running</span>
        <span style={{ color: faint }}>Waiting for review</span>
        <span style={{ color: faint }}>Done</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: mut, border: `1px solid ${line2}`, borderRadius: 999, padding: '4px 11px' }}>
          <span className="spl-live-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: green }} /> 1 online
        </span>
      </div>
      {/* board */}
      <div style={{ display: 'flex', gap: 18, padding: 18, alignItems: 'flex-start' }}>
        <Col title="Running" count="2">
          {SESSIONS_RUNNING.map(([m, t, agent, tools], i) => (
            <div key={i} className="spl-card" style={{ background: bg, border: `1px solid ${line}`, borderRadius: 10, padding: 15, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 10.5, color: faint, fontFamily: MONO }}>{m}</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: green, fontFamily: MONO, letterSpacing: '0.06em' }}>
                  <span className="spl-live-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: green }} /> LIVE
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: ink, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.35, marginBottom: 12 }}>{t}</div>
              <div className="spl-prog" style={{ marginBottom: 10 }} />
              <span style={{ fontSize: 11, color: mut, fontFamily: MONO }}>{agent} · {tools} tools</span>
            </div>
          ))}
        </Col>
        <Col title="Waiting for review" count="3">
          {SESSIONS_REVIEW.map(([m, t], i) => (
            <Card key={i} machine={m} title={t} footer={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: mut }}><span style={{ color: green }}>☁</span> PR is ready</span>
            } />
          ))}
        </Col>
        <Col title="Done" count="2">
          {SESSIONS_DONE.map(([m, t], i) => (
            <Card key={i} machine={m} title={t} footer={<span style={{ fontSize: 11.5, color: faint }}>▪ Stopped</span>} />
          ))}
        </Col>
      </div>
    </div>
  )
}

// Example prompts under the hero box (like RunInfra's "Example workloads").
const HERO_EXAMPLES = [
  ['Diagnose an incident', 'Why is api-gateway throwing 502s?'],
  ['Design a stack', 'Design a 3-tier web app with Postgres'],
  ['Cut cloud cost', 'Rightsize my over-provisioned EC2 fleet'],
  ['Ship a fix', 'Fix the login bug and open a PR'],
]

// A small non-bold dropdown chip (opens a menu upward on click).
function Dropdown({ options, value, onChange, interactive }) {
  const [open, setOpen] = useState(false)
  const sel = value ?? options[0]
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" tabIndex={interactive ? 0 : -1} onClick={() => interactive && setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: ink, border: `1px solid ${line2}`, borderRadius: 8, padding: '6px 11px', fontFamily: SANS, fontWeight: 500, letterSpacing: '-0.01em', background: bg, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        {sel} <span style={{ color: faint, fontSize: 9, marginTop: 1 }}>▾</span>
      </button>
      {open && interactive && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 70 }} />
          <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 71, background: bg, border: `1px solid ${line2}`, borderRadius: 10, boxShadow: '0 14px 34px -12px rgba(0,0,0,0.28)', overflow: 'hidden', minWidth: 150 }}>
            {options.map((o) => (
              <button key={o} type="button" onClick={() => { onChange?.(o); setOpen(false) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 12, color: o === sel ? ink : mut, fontWeight: o === sel ? 600 : 500, letterSpacing: '-0.01em', padding: '8px 13px', border: 'none', background: o === sel ? bg2 : bg, cursor: 'pointer', fontFamily: SANS, whiteSpace: 'nowrap' }}>{o}</button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Queries the placeholder types out, one after another, when the box is empty and unfocused.
const PROMPT_QUERIES = [
  'Why is my api-gateway throwing 502s?',
  'Design a 3-tier web app with Postgres',
  'Rightsize my over-provisioned EC2 fleet',
  'Fix the login bug and open a PR',
  'What am I spending this month?',
]
const PROMPT_STATIC = 'Describe what you want to build, deploy, or fix in your cloud…'

// The hero prompt box, the shared element that travels from the center hero into the left sidebar
// on scroll. Rendered three times: an invisible ghost in the hero + one in the sidebar (each reserves
// layout space at its own width), and one real position:fixed copy that interpolates between them.
function PromptBox({ onSubmit, interactive = true }) {
  const [val, setVal] = useState('')
  const [plan, setPlan] = useState('Nimbus Pro')
  const [mode, setMode] = useState('Agent')
  const [focused, setFocused] = useState(false)
  const [typed, setTyped] = useState('') // the animated placeholder text
  const submit = () => onSubmit?.(val)

  // Typewriter placeholder — types each query, holds, deletes, moves to the next. Pauses when the
  // user focuses or has typed something. Only the interactive (real) box animates.
  useEffect(() => {
    if (!interactive || focused) return
    let qi = 0, ci = 0, deleting = false, timer
    const tick = () => {
      const q = PROMPT_QUERIES[qi]
      if (!deleting) {
        ci++; setTyped(q.slice(0, ci))
        if (ci >= q.length) { deleting = true; timer = setTimeout(tick, 1900) } else timer = setTimeout(tick, 42)
      } else {
        ci--; setTyped(q.slice(0, ci))
        if (ci <= 0) { deleting = false; qi = (qi + 1) % PROMPT_QUERIES.length; timer = setTimeout(tick, 350) } else timer = setTimeout(tick, 22)
      }
    }
    timer = setTimeout(tick, 500)
    return () => clearTimeout(timer)
  }, [interactive, focused])

  const placeholder = (!interactive || focused) ? PROMPT_STATIC : typed + '▌'
  return (
    <div style={{ background: bg2, border: `1px solid ${line2}`, borderRadius: 14, padding: 14, boxShadow: '0 18px 46px -26px rgba(0,0,0,0.22)' }}>
      <textarea
        rows={2} value={val} tabIndex={interactive ? 0 : -1}
        onChange={(e) => setVal(e.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
        placeholder={placeholder}
        style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', background: 'transparent', color: ink, fontFamily: SANS, fontSize: 14.5, lineHeight: 1.5, letterSpacing: '-0.01em', minHeight: 44, display: 'block' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8 }}>
        <Dropdown options={['Nimbus Pro', 'Nimbus Plus']} value={plan} onChange={setPlan} interactive={interactive} />
        <Dropdown options={['Agent', 'Design']} value={mode} onChange={setMode} interactive={interactive} />
        <button onClick={submit} className="spl-btn spl-btn-dark" style={{ marginLeft: 'auto', width: 32, height: 32, borderRadius: 8, border: 'none', background: aws, color: awsInk, cursor: 'pointer', fontSize: 15, fontWeight: 700, display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>↑</button>
      </div>
    </div>
  )
}

const eyebrow = (n, label) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14, fontFamily: SANS }}>
    <span style={{ fontSize: 16, letterSpacing: '-0.01em', color: aws, fontWeight: 700 }}>{n}</span>
    <span style={{ fontSize: 16, letterSpacing: '-0.02em', color: ink, fontWeight: 700 }}>{label}</span>
  </div>
)
const h2 = (txt) => <h2 style={{ fontSize: 'clamp(22px,2.4vw,32px)', fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.08, margin: '0 0 14px', color: ink }}>{txt}</h2>
const lead = (txt) => <p style={{ fontSize: 13.5, lineHeight: 1.6, letterSpacing: '-0.01em', color: mut, margin: '0 0 28px', fontWeight: 400, maxWidth: 560 }}>{txt}</p>
const panelStyle = (alt) => ({ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '72px 56px', borderBottom: `1px solid ${line}`, background: alt ? bg2 : bg })

export default function SplitLanding({ onEnter }) {
  const [active, setActive] = useState(0)
  const [demoOpen, setDemoOpen] = useState(false)
  const bookDemo = () => setDemoOpen(true)
  const mainRef = useRef(null)
  const heroSlotRef = useRef(null) // invisible box in the hero (start anchor)
  const dockSlotRef = useRef(null) // invisible box in the sidebar (end anchor)
  const boxRef = useRef(null)      // the real position:fixed box that travels between them

  // Scroll-linked: interpolate the fixed prompt box from the hero-center anchor to the sidebar-dock
  // anchor, so it "follows a path to the left" as you scroll, then settles above the CTA buttons.
  // Also drives the active step highlight. useLayoutEffect places it before first paint (no flash).
  useLayoutEffect(() => {
    let ticking = false
    const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
    const update = () => {
      const hero = heroSlotRef.current, dock = dockSlotRef.current, box = boxRef.current
      const vh = window.innerHeight || 800
      if (hero && dock && box) {
        const h = hero.getBoundingClientRect(), d = dock.getBoundingClientRect()
        const p = Math.max(0, Math.min(1, window.scrollY / (vh * 0.9)))
        const e = easeInOut(p)
        box.style.left = `${h.left + (d.left - h.left) * e}px`
        box.style.top = `${h.top + (d.top - h.top) * e}px`
        box.style.width = `${h.width + (d.width - h.width) * e}px`
        box.style.visibility = 'visible'
      }
      const panels = mainRef.current?.querySelectorAll('[data-panel]')
      if (panels?.length) { let idx = 0; panels.forEach((el) => { if (el.getBoundingClientRect().top <= vh * 0.42) idx = +el.getAttribute('data-panel') }); setActive(idx) }
    }
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { update(); ticking = false }) } }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    update()
    const t1 = setTimeout(update, 300), t2 = setTimeout(update, 800) // re-settle after fonts/layout
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); clearTimeout(t1); clearTimeout(t2) }
  }, [])

  const scrollTo = (i) => {
    const p = mainRef.current?.querySelector(`[data-panel="${i}"]`)
    if (p) window.scrollTo({ top: p.getBoundingClientRect().top + window.scrollY, behavior: 'smooth' })
  }

  return (
    <div style={{ fontFamily: SANS, WebkitFontSmoothing: 'antialiased', background: bg, color: ink, width: '100%' }}>

      {/* ══ ADVANCED HERO (full screen) ══ */}
      <section style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: bg, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Logo size={30} /><span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: ink }}>Nimbus</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="spl-btn spl-btn-ghost" style={{ fontSize: 12.5, border: `1px solid ${line2}`, color: mut, padding: '9px 16px', letterSpacing: '-0.01em', background: bg, borderRadius: 8, cursor: 'pointer', fontFamily: SANS, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Docs</a>
            <button onClick={bookDemo} className="spl-btn spl-btn-dark" style={{ fontSize: 12.5, background: aws, color: awsInk, fontWeight: 600, padding: '9px 16px', letterSpacing: '-0.01em', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: SANS }}>book a demo →</button>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '10px 24px 56px', maxWidth: 1000, margin: '0 auto', width: '100%' }}>
          <div style={{ fontSize: 14, color: mut, marginBottom: 18, fontFamily: SANS }}>The cloud engineer agent for <b style={{ color: ink }}>AWS</b> &amp; <b style={{ color: ink }}>GCP</b></div>
          <h1 style={{ fontSize: 'clamp(34px,5vw,64px)', fontWeight: 500, letterSpacing: '-0.05em', lineHeight: 1.05, margin: '0 0 20px', color: ink, maxWidth: 900 }}>
            Connect your agent to{' '}
            <span style={{ color: aws, fontFamily: PIXEL, fontWeight: 600, letterSpacing: '0.01em', fontSize: '0.9em', whiteSpace: 'nowrap' }}>
              <img src="/brand/amazonwebservices.svg" alt="" style={{ height: '0.72em', width: 'auto', verticalAlign: '-0.02em', marginRight: '0.18em' }} />AWS{' '}&amp;{' '}<img src="/brand/googlecloud-color.svg" alt="" style={{ height: '0.66em', width: 'auto', verticalAlign: '0.02em', marginLeft: '0.16em', marginRight: '0.18em' }} />GCP.
            </span>
          </h1>
          <p style={{ fontSize: 'clamp(15px,1.6vw,18px)', color: mut, lineHeight: 1.5, letterSpacing: '-0.01em', maxWidth: 600, margin: '0 0 38px' }}>
            Connect your cloud and just talk to it. Nimbus designs infrastructure, diagnoses incidents, tracks spend, and ships code, all with your approval.
          </p>
          {/* hero anchor (invisible, reserves the box's space; the fixed box overlays it) */}
          <div ref={heroSlotRef} style={{ width: 'min(680px,100%)', visibility: 'hidden' }}><PromptBox interactive={false} /></div>
          {/* example prompts */}
          <div style={{ width: 'min(680px,100%)', marginTop: 22 }}>
            <div style={{ fontSize: 11, color: faint, textAlign: 'left', marginBottom: 10, fontFamily: MONO, letterSpacing: '0.1em' }}>TRY ASKING</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {HERO_EXAMPLES.map(([t, s], i) => (
                <div key={i} onClick={onEnter} className="spl-card" style={{ textAlign: 'left', border: `1px solid ${line}`, borderRadius: 10, padding: '12px 14px', background: bg2, cursor: 'pointer' }}>
                  <div style={{ fontSize: 10.5, color: faint, fontFamily: MONO, marginBottom: 4, letterSpacing: '0.04em' }}>{t}</div>
                  <div style={{ fontSize: 12.5, color: ink, letterSpacing: '-0.01em' }}>{s}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ SPLIT SCROLL (unchanged) ══ */}
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>

      {/* ── LEFT, sticky hero ── */}
      <aside className="spl-aside" style={{ position: 'sticky', top: 0, flex: '0 0 44%', maxWidth: 600, height: '100vh', padding: '20px 44px', borderRight: `1px solid ${line}`, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden', backgroundImage: `linear-gradient(180deg, ${awsSoft} 0%, rgba(255,153,0,0.04) 22%, transparent 46%)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
          <Logo size={30} />
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em', color: ink }}>Nimbus</span>
        </div>

        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: 16.5, letterSpacing: '-0.02em', color: ink, fontWeight: 700, marginBottom: 12, fontFamily: SANS }}>Introducing Nimbus</div>
          <h1 style={{ fontSize: 'clamp(23px,2.5vw,33px)', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.04em', margin: '0 0 13px', color: ink }}>
            The cloud engineer<br />that works while you sleep.
          </h1>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {BULLETS.slice(0, 3).map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12, lineHeight: 1.35, letterSpacing: '-0.01em', color: mut }}>
                <span style={{ color: ink, flex: '0 0 auto' }}>◆</span><span>{b}</span>
              </div>
            ))}
          </div>
          {/* dock anchor (invisible; the fixed box settles here above the buttons on scroll) */}
          <div ref={dockSlotRef} style={{ width: '100%', visibility: 'hidden', marginBottom: 12 }}><PromptBox interactive={false} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={onEnter} className="spl-btn spl-btn-dark" style={{ fontSize: 12.5, background: aws, color: awsInk, fontWeight: 600, padding: '9px 16px', letterSpacing: '-0.01em', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: SANS }}>connect a machine →</button>
            <button onClick={bookDemo} className="spl-btn spl-btn-ghost" style={{ fontSize: 12.5, border: `1px solid ${line2}`, color: mut, padding: '9px 16px', letterSpacing: '-0.01em', background: bg, borderRadius: 8, cursor: 'pointer', fontFamily: SANS }}>book a demo</button>
          </div>
        </div>

        <div style={{ flex: '0 0 auto', marginTop: 6, minHeight: 0 }}>
          <div style={{ fontSize: 10.5, letterSpacing: '0.14em', color: faint, textTransform: 'uppercase', marginBottom: 3, fontFamily: MONO }}>What Nimbus handles for you</div>
          <div>
            {NAV.map(([n, label], i) => {
              const on = i === active
              return (
                <div key={n} className="spl-navrow" onClick={() => scrollTo(i)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 14px', borderTop: `1px solid ${line}`, background: on ? awsSoft : 'transparent', color: on ? ink : mut, borderLeftColor: on ? aws : 'transparent' }}>
                  <span style={{ fontSize: 12.5, letterSpacing: '-0.015em' }}>{label}</span>
                  <span style={{ fontSize: 10.5, letterSpacing: '0.08em', color: on ? aws : faint, fontFamily: MONO }}>{n}</span>
                </div>
              )
            })}
          </div>
        </div>
      </aside>

      {/* ── RIGHT, scrolling panels ── */}
      <main ref={mainRef} style={{ flex: '1 1 0', minWidth: 0 }}>

        {/* 01 any cloud, hub & spoke diagram leads */}
        <section data-panel="0" style={panelStyle(false)}>
          <div style={{ maxWidth: 860 }}>
            {eyebrow('01', 'Works with any cloud')}
            {h2('Wherever you ship, Nimbus connects.')}
            {lead('AWS, GCP, Azure, and the rest, through scoped, revocable credentials. No agent to install. Every connected cloud flows through Nimbus into analyzed, gated, verified action.')}
            <div style={{ margin: '8px 0 0' }}>
              <HubSpoke />
            </div>
          </div>
        </section>

        {/* 02 connect a machine */}
        <section data-panel="1" style={panelStyle(true)}>
          <div style={{ maxWidth: 760 }}>
            {eyebrow('02', 'Connect a machine')}
            {h2('Run agents on any machine you can reach.')}
            {lead("Bring your own box, pair on a teammate's, or rent an ephemeral one, each attaches over a native Claude or Codex session.")}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
              {RUNTIMES.map((r) => (
                <div key={r.tag} className="spl-card" style={{ background: bg, border: `1px solid ${line}`, borderRadius: 8, padding: 22 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <span style={{ fontSize: 10.5, letterSpacing: '0.14em', color: faint, textTransform: 'uppercase', fontFamily: MONO }}>{r.tag}</span>
                    <span style={{ width: 26, height: 26, border: `1px solid ${line2}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: ink }}>{r.glyph}</span>
                  </div>
                  <h3 style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 9px', color: ink }}>{r.title}</h3>
                  <p style={{ fontSize: 12, lineHeight: 1.55, letterSpacing: '-0.01em', color: mut, margin: '0 0 16px' }}>{r.body}</p>
                  <div style={{ borderTop: `1px solid ${line}`, paddingTop: 12, fontSize: 11, color: ink, letterSpacing: '-0.01em', fontFamily: MONO }}>{r.cmd}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 03 sandboxes */}
        <section data-panel="2" style={panelStyle(false)}>
          <div style={{ maxWidth: 680 }}>
            {eyebrow('03', 'Safe, isolated sandboxes')}
            {h2('Every task runs in its own sandbox. Nothing touches prod until you say so.')}
            {lead('Ephemeral filesystem, scoped and time-boxed credentials, an egress allowlist. Review the diff, then approve to apply.')}
            <div style={{ marginBottom: 18 }}><SandboxDiagram /></div>
            <div style={{ border: `1px solid ${line}`, borderRadius: 8, background: bg2 }}>
              {SPECS.map(([k, v], i) => (
                <div key={k} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 20, padding: '15px 22px', borderBottom: i < SPECS.length - 1 ? `1px solid ${line}` : 'none' }}>
                  <span style={{ fontSize: 12, letterSpacing: '0.04em', color: ink, minWidth: 120, fontFamily: MONO }}>{k}</span>
                  <span style={{ fontSize: 12.5, color: mut, textAlign: 'right', letterSpacing: '-0.01em' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 04 design on a canvas */}
        <section data-panel="3" style={panelStyle(true)}>
          <div style={{ maxWidth: 820 }}>
            {eyebrow('04', 'Design on a canvas')}
            {h2('Describe what you want. Nimbus draws the architecture.')}
            {lead('It lays out every tier as connected nodes on a live canvas, load balancer, app, database, cache, storage, that you can drag, rewire, and edit before a single resource is provisioned.')}
            <DesignCanvas />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 1, background: line, border: `1px solid ${line}`, marginTop: 22 }}>
              {CAPS.slice(0, 2).map((c) => (
                <div key={c.title} className="spl-card" style={{ background: bg, padding: 22 }}>
                  <div style={{ fontSize: 13, color: ink, marginBottom: 10, fontFamily: MONO }}>{c.glyph}</div>
                  <h3 style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 8px', color: ink }}>{c.title}</h3>
                  <p style={{ fontSize: 12, lineHeight: 1.55, letterSpacing: '-0.01em', color: mut, margin: 0 }}>{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 05 cost & savings */}
        <section data-panel="4" style={panelStyle(false)}>
          <div style={{ maxWidth: 720 }}>
            {eyebrow('05', 'Cost & savings')}
            {h2('See what it costs, before and after you build.')}
            {lead('Every design and every running stack comes with a live cost breakdown by service. Nimbus flags over-provisioned resources and proposes rightsizing you can apply with one approval.')}
            <CostSection />
          </div>
        </section>

        {/* 06 reusable workflows */}
        <section data-panel="5" style={panelStyle(true)}>
          <div style={{ maxWidth: 680 }}>
            {eyebrow('06', 'Reusable workflows')}
            {h2('Promote a one-off fix into a workflow that runs itself.')}
            {lead('Save any session as a reusable workflow with a trigger, cron, webhook, or a cloud alarm. Nimbus re-runs it in a fresh sandbox and reports back.')}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
              {TRIGGERS.map((t) => (
                <span key={t} style={{ fontSize: 11, color: mut, border: `1px solid ${line2}`, padding: '5px 11px', borderRadius: 4, letterSpacing: '-0.01em', fontFamily: MONO }}>{t}</span>
              ))}
            </div>
            <div style={{ border: `1px solid ${line2}`, borderRadius: 8, background: bg2, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${line}`, background: bg, fontFamily: MONO }}>
                <span style={{ fontSize: 11, color: faint }}>heal-502.workflow.yaml</span>
                <span style={{ fontSize: 10, color: ink, letterSpacing: '0.1em' }}>SAVED</span>
              </div>
              <pre style={{ margin: 0, padding: '18px 20px', fontFamily: MONO, fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                {WORKFLOW.map((ln, i) => (
                  <div key={i}>{ln.map(([txt, col], j) => <span key={j} style={{ color: col }}>{txt}</span>)}</div>
                ))}
              </pre>
            </div>
          </div>
        </section>

        {/* 07 sessions board */}
        <section data-panel="6" style={panelStyle(false)}>
          <div style={{ maxWidth: 900 }}>
            {eyebrow('07', 'Sessions board')}
            {h2('Every session, on one board, from running to reviewed.')}
            {lead('Each task an agent runs becomes a session. Track them all in one place, what is running, what is waiting for review with a ready PR, and what is done, across every connected machine.')}
            <SessionsBoard />
          </div>
        </section>

        {/* 08 live agent session + CTA */}
        <section data-panel="7" style={{ ...panelStyle(true), borderBottom: 'none' }}>
          <div style={{ maxWidth: 680 }}>
            {eyebrow('08', 'Live agent session')}
            {h2('Hand it a problem in plain language. Watch it work.')}
            {lead('No commands to memorize. You talk to the agent in a native Claude or Codex session; it reproduces, fixes, and reports back, every step visible.')}
            <div style={{ border: `1px solid ${line2}`, borderRadius: 8, background: bg2, boxShadow: '0 22px 50px -28px rgba(0,0,0,0.25)', overflow: 'hidden', marginBottom: 40 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: `1px solid ${line}`, background: bg, fontFamily: MONO }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: line2 }} />
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: line2 }} />
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: line2 }} />
                <span style={{ marginLeft: 8, fontSize: 11, color: faint }}>session, sandbox sbx-7f3a</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#1a7f4b', letterSpacing: '0.1em' }}>● live</span>
              </div>
              <div style={{ padding: 18, fontSize: 12.5, lineHeight: 1.85, minHeight: 268, fontFamily: MONO }}><Terminal /></div>
            </div>
            <div style={{ borderTop: `1px solid ${line}`, paddingTop: 34 }}>
              <h3 style={{ fontSize: 'clamp(20px,2.4vw,28px)', fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.1, margin: '0 0 22px', color: ink }}>Point Nimbus at your cloud and watch it work.</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={onEnter} className="spl-btn spl-btn-dark" style={{ fontSize: 13, background: aws, color: awsInk, fontWeight: 600, padding: '11px 22px', letterSpacing: '-0.01em', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: SANS }}>connect a machine →</button>
                <button onClick={bookDemo} className="spl-btn spl-btn-ghost" style={{ fontSize: 13, border: `1px solid ${line2}`, color: mut, padding: '11px 22px', letterSpacing: '-0.01em', background: bg, borderRadius: 8, cursor: 'pointer', fontFamily: SANS }}>book a demo</button>
              </div>
              <div style={{ marginTop: 40, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: faint, letterSpacing: '0.02em', fontFamily: MONO }}>
                <span>© 2026 Nimbus Systems</span>
                <span>soc2 · scoped access</span>
              </div>
            </div>
          </div>
        </section>

      </main>
      </div>

      {/* ══ the shared prompt box that travels hero-center → sidebar-dock on scroll ══ */}
      <div ref={boxRef} style={{ position: 'fixed', zIndex: 60, visibility: 'hidden', willChange: 'left, top, width' }}>
        <PromptBox onSubmit={() => onEnter?.()} />
      </div>

      <BookDemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  )
}
