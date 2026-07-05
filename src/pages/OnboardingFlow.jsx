import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { getConnections, connectCloud, getProjects, setProjectRepo, getGithubRepos } from '../lib/api.js'

/* One-time injected CSS for focus/hover (inline styles can't do these). */
const CSS = `
@keyframes nbSpin{to{transform:rotate(360deg);}}
.nb-input:focus{outline:none;border-color:#FF9900!important;box-shadow:0 0 0 3px rgba(255,153,0,0.12);}
.nb-input::placeholder{color:#a8a8a8;}
.nb-primary:hover:not(:disabled){background:#E88A00!important;}
.nb-secondary:hover{background:#fff7ec!important;border-color:#FF9900!important;}
.nb-card:hover{border-color:#FF9900!important;}
.nb-link{color:#C77A00;font-weight:600;cursor:pointer;text-decoration:none;}
.nb-link:hover{opacity:.7;}
`

// Cloud providers shown on the connect step. Each card expands to an inline credential form.
const CLOUDS = [
  { key: 'aws', name: 'Amazon Web Services', code: 'aws', detail: 'EC2 · RDS · S3 · Lambda',
    fields: [{ k: 'accessKeyId', p: 'Access key ID (AKIA…)' }, { k: 'secretAccessKey', p: 'Secret access key', type: 'password' }, { k: 'region', p: 'Default region (us-east-1)' }] },
  { key: 'gcp', name: 'Google Cloud', code: 'gcp', detail: 'GCE · Cloud SQL · GKE',
    fields: [{ k: 'serviceAccountKey', p: 'Service Account JSON key', type: 'textarea' }] },
  { key: 'azure', name: 'Microsoft Azure', code: 'az', detail: 'VMs · AKS · Azure SQL',
    fields: [{ k: 'subscriptionId', p: 'Subscription ID' }, { k: 'tenantId', p: 'Tenant ID' }, { k: 'clientId', p: 'Client ID' }, { k: 'clientSecret', p: 'Client secret', type: 'password' }] },
]

const C = { ink: '#0a0a0a', sub: '#6e6e6e', mute: '#a0a0a0', line: '#e2e2e2', line2: '#efefef', bg: '#f4f4f4', soft: '#f5f5f5' }

// Public deploys (Fly) set VITE_ALLOW_SIGNUP=false to hide the "Create an account" CTA —
// login-only, no self-serve registration. Defaults to enabled for local/dev.
const ALLOW_SIGNUP = import.meta.env.VITE_ALLOW_SIGNUP !== 'false'

/* Playful black/white doodle backdrop (tiled SVG pattern) — the card floats above it. */
function DoodleBg() {
  const s = '#d7d7d7'
  return (
    <svg aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0 }}>
      <defs>
        <pattern id="nbdoodles" width="232" height="232" patternUnits="userSpaceOnUse">
          <g fill="none" stroke={s} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path transform="translate(14,18)" d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A3.5 3.5 0 0 1 18 18H7z" />
            <path transform="translate(128,12)" d="M12 3l2.6 5.7 6.1.5-4.7 4 1.5 6L12 20.5 5.5 23l1.5-6-4.7-4 6.1-.5z" />
            <g transform="translate(74,86)">
              <circle cx="12" cy="12" r="9" />
              <path d="M9 10h.01M15 10h.01" />
              <path d="M8.5 14.5a4 4 0 0 0 7 0" />
            </g>
            <path transform="translate(168,104)" d="M13 3L5 14h5l-1 7 8-11h-5l1-7z" />
            <path transform="translate(16,156)" d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.2A4 4 0 0 1 19 11c0 4.7-7 9-7 9z" />
            <g transform="translate(126,162)">
              <rect x="3" y="5" width="18" height="6.2" rx="1.6" />
              <rect x="3" y="14" width="18" height="6.2" rx="1.6" />
              <path d="M7 8.1h.01M7 17.1h.01" />
            </g>
            <g transform="translate(186,30)">
              <rect x="6" y="8" width="12" height="10" rx="3" />
              <path d="M12 4v4M9 12h.01M15 12h.01" />
            </g>
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={C.bg} />
      <rect width="100%" height="100%" fill="url(#nbdoodles)" />
    </svg>
  )
}

/* Nimbus brand mark — a simple cloud glyph. */
function Brand() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 16 }}>
      <svg width="36" height="36" viewBox="0 0 48 48" fill="none" style={{ marginBottom: 7 }}>
        <path d="M14 34a8 8 0 0 1 .6-16 11 11 0 0 1 21-2A7.5 7.5 0 0 1 35 34H14z" fill="#0a0a0a" />
        <circle cx="19" cy="27" r="1.6" fill="#fff" /><circle cx="26" cy="27" r="1.6" fill="#fff" />
      </svg>
      <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.03em', color: C.ink }}>Nimbus</div>
    </div>
  )
}

/* Real provider brand marks (AWS smile · Google Cloud · Azure). */
function ProviderIcon({ k }) {
  if (k === 'aws') return (
    <svg width="29" height="19" viewBox="0 90 256 65" fill="none" aria-hidden="true">
      <path d="M230.993377,120.964238 C203.104636,141.562914 162.58543,152.498013 127.745695,152.498013 C78.9192053,152.498013 34.9245033,134.442384 1.69536424,104.434437 C-0.932450331,102.060927 1.4410596,98.8397351 4.57748344,100.704636 C40.5192053,121.557616 84.8529801,134.188079 130.712583,134.188079 C161.65298,134.188079 195.645033,127.745695 226.924503,114.521854 C231.586755,112.402649 235.570861,117.57351 230.993377,120.964238 Z M242.606623,107.740397 C239.046358,103.162914 219.04106,105.536424 209.970861,106.638411 C207.258278,106.977483 206.834437,104.603974 209.292715,102.823841 C225.229139,91.6344371 251.422517,94.8556291 254.474172,98.5854305 C257.525828,102.4 253.62649,128.593377 238.707285,141.139073 C236.418543,143.088742 234.21457,142.071523 235.231788,139.528477 C238.622517,131.136424 246.166887,112.233113 242.606623,107.740397 Z" fill="#FF9900" />
    </svg>
  )
  if (k === 'gcp') return (
    <svg width="24" height="20" viewBox="0 0 256 206" fill="none" aria-hidden="true">
      <path d="M170.2517,56.8186 L192.5047,34.5656 L193.9877,25.1956 C153.4367,-11.6774 88.9757,-7.4964 52.4207,33.9196 C42.2667,45.4226 34.7337,59.7636 30.7167,74.5726 L38.6867,73.4496 L83.1917,66.1106 L86.6277,62.5966 C106.4247,40.8546 139.8977,37.9296 162.7557,56.4286 L170.2517,56.8186 Z" fill="#EA4335" />
      <path d="M224.2048,73.9182 C219.0898,55.0822 208.5888,38.1492 193.9878,25.1962 L162.7558,56.4282 C175.9438,67.2042 183.4568,83.4382 183.1348,100.4652 L183.1348,106.0092 C198.4858,106.0092 210.9318,118.4542 210.9318,133.8052 C210.9318,149.1572 198.4858,161.2902 183.1348,161.2902 L127.4638,161.2902 L121.9978,167.2242 L121.9978,200.5642 L127.4638,205.7952 L183.1348,205.7952 C223.0648,206.1062 255.6868,174.3012 255.9978,134.3712 C256.1858,110.1682 244.2528,87.4782 224.2048,73.9182" fill="#4285F4" />
      <path d="M71.8704,205.7957 L127.4634,205.7957 L127.4634,161.2897 L71.8704,161.2897 C67.9094,161.2887 64.0734,160.4377 60.4714,158.7917 L52.5844,161.2117 L30.1754,183.4647 L28.2234,191.0387 C40.7904,200.5277 56.1234,205.8637 71.8704,205.7957" fill="#34A853" />
      <path d="M71.8704,61.4255 C31.9394,61.6635 -0.2366,94.2275 0.0014,134.1575 C0.1344,156.4555 10.5484,177.4455 28.2234,191.0385 L60.4714,158.7915 C46.4804,152.4705 40.2634,136.0055 46.5844,122.0155 C52.9044,108.0255 69.3704,101.8085 83.3594,108.1285 C89.5244,110.9135 94.4614,115.8515 97.2464,122.0155 L129.4944,89.7685 C115.7734,71.8315 94.4534,61.3445 71.8704,61.4255" fill="#FBBC05" />
    </svg>
  )
  if (k === 'azure') return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="nbaz" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#0078D4" /><stop offset="1" stopColor="#50E6FF" />
      </linearGradient></defs>
      <path d="M22.379 23.343a1.62 1.62 0 0 0 1.536-2.14L17.35 1.76A1.62 1.62 0 0 0 15.816.657H9.829l6.169 18.336-11.34 2.85h17.721zM7.469 4.16L.083 16.532a1.62 1.62 0 0 0 1.406 2.434h4.5L7.47 4.16z" fill="url(#nbaz)" />
    </svg>
  )
  return null
}

export default function OnboardingFlow() {
  const navigate = useNavigate()
  const { user, loading, login, signup, logout, completeOnboarding } = useAuth()

  // screen: auth | cloud | github
  const [screen, setScreen] = useState('auth')
  const [mode, setMode] = useState('login')           // login | signup
  const [name, setName] = useState('')
  const [org, setOrg] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authErr, setAuthErr] = useState('')

  // github (optional)
  const [composioReady, setComposioReady] = useState(true)
  const [githubOn, setGithubOn] = useState(false)
  const [ghBusy, setGhBusy] = useState(false)
  const [ghRepo, setGhRepo] = useState('')      // default repo for Project 1 (the Code tab's repo)
  const [repoList, setRepoList] = useState([])
  const [repoOpen, setRepoOpen] = useState(false)

  // cloud (required)
  const [connected, setConnected] = useState([])
  const [openCard, setOpenCard] = useState(null)
  const [forms, setForms] = useState({})
  const [cloudBusy, setCloudBusy] = useState(null)
  const [finishing, setFinishing] = useState(false)

  /* ---- routing guards / bootstrap ---- */
  useEffect(() => {
    if (loading) return
    if (user?.onboarded) { navigate('/app', { replace: true }); return }
    if (user && screen === 'auth') setScreen('cloud') // logged in but not onboarded → resume at cloud
  }, [loading, user]) // eslint-disable-line

  // pull existing cloud connections when we reach the cloud step
  useEffect(() => {
    if (screen !== 'cloud') return
    getConnections().then(r => setConnected(r.clouds || [])).catch(() => {})
  }, [screen])

  // probe Composio + existing GitHub connection when we reach the github step
  useEffect(() => {
    if (screen !== 'github') return
    fetch('/api/connections/composio/status?fresh=1', { credentials: 'include' })
      .then(r => r.json()).then(s => {
        setComposioReady(!!s?.configured)
        if (s?.toolkits?.includes('github')) { setGithubOn(true); getGithubRepos().then(r => setRepoList(r?.repos || [])).catch(() => {}) }
      }).catch(() => {})
  }, [screen])

  // once GitHub connects, pull the user's repos so they can pick a default for Project 1
  useEffect(() => { if (githubOn) getGithubRepos().then(r => setRepoList(r?.repos || [])).catch(() => {}) }, [githubOn])

  const submitAuth = async () => {
    if (!email.trim() || !password) { setAuthErr('Enter your email and password.'); return }
    setAuthBusy(true); setAuthErr('')
    try {
      if (mode === 'signup') { await signup(email.trim(), password, `${firstName} ${lastName}`.trim() || 'User', ''); setScreen('cloud') }
      else {
        const u = await login(email.trim(), password)
        if (u?.onboarded) navigate('/app', { replace: true })
        else setScreen('cloud')
      }
    } catch (e) { setAuthErr(e?.message || 'Something went wrong.') }
    finally { setAuthBusy(false) }
  }

  const connectGithub = async () => {
    if (githubOn) return
    setGhBusy(true)
    try {
      const r = await fetch('/api/connections/composio/authorize', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolkit: 'github' }),
      }).then(r => r.json())
      if (!r.redirectUrl) { setGhBusy(false); return }
      window.open(r.redirectUrl, '_blank', 'noopener,width=560,height=720')
      let n = 0
      const t = setInterval(async () => {
        n++
        const s = await fetch('/api/connections/composio/status?fresh=1', { credentials: 'include' }).then(r => r.json()).catch(() => null)
        if (s?.toolkits?.includes('github')) { clearInterval(t); setGithubOn(true); setGhBusy(false) }
        else if (n > 40) { clearInterval(t); setGhBusy(false) }
      }, 3000)
    } catch { setGhBusy(false) }
  }

  const setF = (id, k, v) => setForms(f => ({ ...f, [id]: { ...(f[id] || {}), [k]: v } }))
  const doConnectCloud = async (c) => {
    setCloudBusy(c.key)
    try {
      const body = {}
      for (const f of c.fields) if ((forms[c.key]?.[f.k] || '').trim()) body[f.k] = forms[c.key][f.k].trim()
      const r = await connectCloud(c.key, body)
      setConnected(r.clouds || [])
      setOpenCard(null)
    } catch (e) { setAuthErr(e?.message || '') } finally { setCloudBusy(null) }
  }

  const finish = async () => {
    setFinishing(true)
    try {
      // bind the chosen repo to the default project (Project 1) — what the Code tab will show
      const repo = (ghRepo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '')
      if (repo) {
        try { const r = await getProjects(); const first = (r?.projects || [])[0]; if (first) await setProjectRepo(first.id, repo) } catch { /* ignore */ }
      }
      await completeOnboarding(user?.org)
    } finally { navigate('/app', { replace: true }) }
  }
  const doLogout = async () => { try { await logout() } finally { setScreen('auth'); setEmail(''); setPassword(''); setGithubOn(false); setConnected([]) } }

  if (loading) return <div style={{ minHeight: '100vh', background: C.bg }} />

  /* ───────────── AUTH — two-panel split (dark feature panel + form) ───────────── */
  if (screen === 'auth') {
    const isLogin = mode === 'login'
    return (
      <div style={{ minHeight: '100vh', display: 'flex', background: '#fff', color: C.ink, fontFamily: "'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif", WebkitFontSmoothing: 'antialiased' }}>
        <style>{CSS}</style>

        {/* LEFT — dark feature panel */}
        <div style={{ flex: '0 0 42%', maxWidth: 600, margin: 12, borderRadius: 20, background: 'radial-gradient(120% 90% at 0% 0%, rgba(255,153,0,0.22) 0%, rgba(255,153,0,0.05) 28%, #0a0a0a 60%)', backgroundColor: '#0a0a0a', color: '#fff', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '40px 44px' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="26" height="26" viewBox="0 0 48 48" fill="none">
              <path d="M14 34a8 8 0 0 1 .6-16 11 11 0 0 1 21-2A7.5 7.5 0 0 1 35 34H14z" fill="#fff" />
              <circle cx="19" cy="27" r="1.6" fill="#0a0a0a" /><circle cx="26" cy="27" r="1.6" fill="#0a0a0a" />
            </svg>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>Nimbus</span>
          </div>
          <div style={{ position: 'relative', marginTop: 'auto' }}>
            <h2 style={{ fontSize: 34, lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 800, margin: '0 0 16px', maxWidth: '13ch' }}>Experience everything Nimbus can do</h2>
            <p style={{ fontSize: 15, lineHeight: 1.55, color: 'rgba(255,255,255,0.72)', margin: '0 0 22px', maxWidth: '40ch' }}>An autonomous engineer for your cloud — included from the first connection.</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {['All AI agents — provision, monitor & diagnose', 'Plan → approve → apply, gated by you', 'A live architecture canvas', 'Full audit log & instant rollback'].map(t => (
                <li key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, fontSize: 14.5, color: 'rgba(255,255,255,0.9)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF9900', marginTop: 8, flex: 'none' }} /> {t}
                </li>
              ))}
            </ul>
            <div style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.72)' }}>No credit card required.</div>
          </div>
        </div>

        {/* RIGHT — form */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 32px', overflowY: 'auto' }}>
          <div style={{ width: '100%', maxWidth: 440 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <svg width="40" height="40" viewBox="0 0 48 48" fill="none">
                <path d="M14 34a8 8 0 0 1 .6-16 11 11 0 0 1 21-2A7.5 7.5 0 0 1 35 34H14z" fill="#0a0a0a" />
                <circle cx="19" cy="27" r="1.6" fill="#fff" /><circle cx="26" cy="27" r="1.6" fill="#fff" />
              </svg>
            </div>
            <h1 style={{ textAlign: 'center', fontSize: 30, lineHeight: 1.14, letterSpacing: '-0.025em', fontWeight: 700, margin: '0 0 10px', color: C.ink }}>
              {isLogin ? <>Welcome back.<br />Pick up where you left off.</> : <>Get in. Ship something.<br />Scale when it clicks.</>}
            </h1>
            <p style={{ textAlign: 'center', fontSize: 16, color: C.sub, margin: '0 0 28px' }}>{isLogin ? 'Sign in to your workspace.' : 'Set up your account to join.'}</p>

            {!isLogin && (
              <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <input className="nb-input" placeholder="First name" value={firstName} onChange={e => setFirstName(e.target.value)} style={{ ...input, marginBottom: 0 }} />
                <input className="nb-input" placeholder="Last name" value={lastName} onChange={e => setLastName(e.target.value)} style={{ ...input, marginBottom: 0 }} />
              </div>
            )}
            <input className="nb-input" type="email" placeholder="Work email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitAuth()} style={{ ...input, marginBottom: 14 }} />
            <input className="nb-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitAuth()} style={{ ...input, marginBottom: 18 }} />
            {authErr && <div style={{ fontSize: 13, color: '#b91c1c', margin: '-6px 0 14px' }}>⚠ {authErr}</div>}
            <button className="nb-primary" onClick={submitAuth} disabled={authBusy} style={primaryFull}>
              {authBusy ? 'Please wait…' : isLogin ? 'Log in' : 'Sign up'}
            </button>
            {!isLogin && (
              <p style={{ fontSize: 12.5, color: C.mute, textAlign: 'center', margin: '16px 0 0', lineHeight: 1.5 }}>By clicking “Sign up” you accept the Nimbus Terms of Service &amp; Privacy Policy.</p>
            )}
            {ALLOW_SIGNUP && (
              <div style={{ borderTop: `1px solid ${C.line2}`, margin: '26px 0 0', paddingTop: 18, textAlign: 'center', fontSize: 14.5, color: C.sub }}>
                {isLogin ? 'New to Nimbus?' : 'Already registered?'}
                <div style={{ marginTop: 4 }}><span className="nb-link" onClick={() => { setMode(isLogin ? 'signup' : 'login'); setAuthErr('') }}>{isLogin ? 'Create an account' : 'Log in'}</span></div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // card width adapts: auth is narrow, cloud needs room for provider cards
  const cardMax = screen === 'cloud' ? 480 : 410

  return (
    <div style={{ position: 'relative', minHeight: '100vh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '44px 20px', boxSizing: 'border-box', background: C.bg, color: C.ink, overflowY: 'auto',
      fontFamily: "'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif", WebkitFontSmoothing: 'antialiased' }}>
      <style>{CSS}</style>
      <DoodleBg />

      {user && screen !== 'auth' && (
        <div style={{ position: 'fixed', top: 22, right: 26, zIndex: 2, fontSize: 13, color: C.sub }}>
          {user.email} · <span className="nb-link" onClick={doLogout}>Log out</span>
        </div>
      )}

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: cardMax, background: '#fff', borderRadius: 16,
        boxShadow: '0 24px 64px -28px rgba(0,0,0,0.38), 0 0 0 1px rgba(0,0,0,0.05)', padding: '26px 28px', boxSizing: 'border-box' }}>
        <Brand />

        {/* ───────────── CLOUD (required) ───────────── */}
        {screen === 'cloud' && (
          <>
            <h1 style={{ textAlign: 'center', fontSize: 19, lineHeight: 1.25, letterSpacing: '-0.02em', fontWeight: 700, margin: '0 0 5px', color: C.ink }}>Connect your cloud</h1>
            <p style={{ textAlign: 'center', fontSize: 13, lineHeight: 1.5, color: C.sub, margin: '0 0 18px' }}>Connect at least one provider to continue — Nimbus operates on your real infrastructure.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 16 }}>
              {CLOUDS.map((c) => {
                const on = connected.includes(c.key)
                const open = openCard === c.key
                return (
                  <div key={c.key} className="nb-card" style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10, padding: '11px 13px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 8, background: '#fff', border: `1px solid ${C.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}><ProviderIcon k={c.key} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{c.name}</div>
                        <div style={{ fontSize: 11.5, color: C.mute, marginTop: 1, fontFamily: 'monospace' }}>{c.detail}</div>
                      </div>
                      {on ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', background: C.ink, color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, flex: '0 0 auto' }}>✓ Connected</span>
                      ) : (
                        <button className="nb-secondary" onClick={() => setOpenCard(open ? null : c.key)} style={{ height: 34, padding: '0 16px', background: C.soft, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flex: '0 0 auto' }}>{open ? 'Cancel' : 'Connect'}</button>
                      )}
                    </div>
                    {open && !on && (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line2}`, display: 'flex', flexDirection: 'column', gap: 9 }}>
                        {c.fields.map(f => f.type === 'textarea'
                          ? <textarea key={f.k} className="nb-input" placeholder={f.p} value={forms[c.key]?.[f.k] || ''} onChange={e => setF(c.key, f.k, e.target.value)} style={{ ...input, minHeight: 76, marginBottom: 0, paddingTop: 11, resize: 'vertical' }} />
                          : <input key={f.k} className="nb-input" type={f.type || 'text'} placeholder={f.p} value={forms[c.key]?.[f.k] || ''} onChange={e => setF(c.key, f.k, e.target.value)} style={{ ...input, marginBottom: 0 }} />)}
                        <button className="nb-primary" onClick={() => doConnectCloud(c)} disabled={cloudBusy === c.key} style={{ ...primaryInline, alignSelf: 'flex-start', marginTop: 2 }}>
                          {cloudBusy === c.key ? 'Connecting…' : `Connect ${c.name}`}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <button className="nb-primary" onClick={() => setScreen('github')} disabled={connected.length === 0} style={{ ...primaryFull, opacity: connected.length === 0 ? 0.45 : 1, cursor: connected.length === 0 ? 'default' : 'pointer' }}>
              {connected.length === 0 ? 'Connect a cloud to continue' : 'Continue →'}
            </button>
          </>
        )}

        {/* ───────────── GITHUB (optional) ───────────── */}
        {screen === 'github' && (
          <>
            <h1 style={{ textAlign: 'center', fontSize: 21, lineHeight: 1.25, letterSpacing: '-0.02em', fontWeight: 700, margin: '0 0 6px', color: C.ink }}>Connect GitHub <span style={{ color: C.mute, fontWeight: 500, fontSize: 15 }}>(optional)</span></h1>
            <p style={{ textAlign: 'center', fontSize: 14, lineHeight: 1.5, color: C.sub, margin: '0 0 24px' }}>So the ops agent can open pull requests to fix issues it finds — you review every PR before it merges.</p>

            {githubOn ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, fontSize: 14, color: C.ink, fontWeight: 600, marginBottom: 22 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: C.ink, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>✓</span> GitHub connected
              </div>
            ) : (
              <button className="nb-primary" onClick={connectGithub} disabled={ghBusy || !composioReady} style={{ ...primaryFull, marginBottom: 14 }}>
                {ghBusy ? 'Authorizing…' : composioReady ? 'Authorize GitHub' : 'Unavailable'}
              </button>
            )}

            {/* default repo for Project 1 — the Code tab discusses this repo */}
            <div style={{ textAlign: 'left', marginBottom: 16 }}>
              <label style={lbl}>Default repository for Project 1 <span style={{ color: C.mute }}>(optional)</span></label>
              <div style={{ position: 'relative' }}>
                <input className="nb-input" placeholder="owner/repo" value={ghRepo}
                  onChange={e => { setGhRepo(e.target.value); setRepoOpen(true) }}
                  onFocus={() => setRepoOpen(true)}
                  onBlur={() => setTimeout(() => setRepoOpen(false), 150)}
                  style={{ ...input, marginBottom: 0, paddingRight: 34, fontFamily: 'monospace', fontSize: 13 }} />
                <span onMouseDown={e => { e.preventDefault(); setRepoOpen(o => !o) }}
                  style={{ position: 'absolute', top: 0, right: 0, height: 42, width: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: C.sub, fontSize: 11 }}>▼</span>
                {repoOpen && repoList.length > 0 && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 8, boxShadow: '0 10px 30px -12px rgba(0,0,0,0.25)', maxHeight: 224, overflowY: 'auto', padding: 4 }}>
                    {repoList.filter(r => r.toLowerCase().includes(ghRepo.toLowerCase())).slice(0, 60).map(r => (
                      <div key={r} onMouseDown={e => { e.preventDefault(); setGhRepo(r); setRepoOpen(false) }}
                        style={{ padding: '8px 10px', borderRadius: 6, fontFamily: 'monospace', fontSize: 12.5, color: C.ink, cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.background = C.soft)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{r}</div>
                    ))}
                    {repoList.filter(r => r.toLowerCase().includes(ghRepo.toLowerCase())).length === 0 && (
                      <div style={{ padding: '8px 10px', fontSize: 12.5, color: C.mute }}>No matching repos</div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, color: C.mute, marginTop: 6 }}>
                {githubOn && repoList.length === 0
                  ? 'Loading your repositories…'
                  : '@nimbus reads this repo in the Code tab. Each new project can bind its own repo.'}
              </div>
            </div>

            <button className={githubOn || ghRepo ? 'nb-primary' : 'nb-secondary'} onClick={finish} disabled={finishing} style={{ ...primaryFull, ...(githubOn || ghRepo ? {} : { background: '#fff', color: C.ink, border: `1px solid ${C.line}`, boxShadow: 'none' }) }}>
              {finishing ? 'Finishing…' : (githubOn || ghRepo) ? 'Go to workspace →' : 'Skip for now →'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const lbl = { display: 'block', fontSize: 13, fontWeight: 500, color: C.sub, marginBottom: 7 }
const input = { width: '100%', boxSizing: 'border-box', minHeight: 42, padding: '0 13px', border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 14, background: '#fff', color: C.ink, marginBottom: 12, fontFamily: 'inherit' }
const primaryFull = { width: '100%', height: 44, background: '#FF9900', color: '#16160F', border: 'none', borderRadius: 8, fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const primaryInline = { height: 40, padding: '0 18px', background: C.ink, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8 }
