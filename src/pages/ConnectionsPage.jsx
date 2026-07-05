import { useEffect, useState } from 'react'
import { getConnections, connectCloud, disconnectCloud } from '../lib/api.js'
import { useCloudData } from '../lib/useCloudData.js'
import { Icon } from '../components/common/Icons.jsx'

// AWS supports two connection methods. Access keys = simplest (paste from the CSV you
// downloaded). IAM role = the production cross-account path (Nimbus assumes it via STS).
const AWS_METHODS = {
  keys: {
    label: 'Access keys',
    hint: 'Paste the Access key ID + Secret from the CSV you downloaded in IAM. Stored for this user only.',
    fields: [
      { key: 'accessKeyId', placeholder: 'Access key ID (AKIA…)', required: true },
      { key: 'secretAccessKey', placeholder: 'Secret access key', required: true, type: 'password' },
      { key: 'region', placeholder: 'Region (default us-east-1)' },
    ],
  },
  role: {
    label: 'IAM role',
    hint: 'Create an IAM role in your AWS account that trusts Nimbus, then paste its Role ARN. Nimbus assumes it via STS — no keys stored.',
    fields: [
      { key: 'roleArn', placeholder: 'IAM Role ARN — arn:aws:iam::123456789012:role/Nimbus', required: true },
      { key: 'externalId', placeholder: 'External ID (recommended)' },
      { key: 'region', placeholder: 'Region (default us-east-1)' },
    ],
  },
}

const CLOUDS = [
  { id: 'aws', name: 'Amazon Web Services', sub: 'AWS CLI / aws-api MCP', available: true, awsMethods: true },
  {
    id: 'gcp', name: 'Google Cloud', sub: 'Service account · gcloud-mcp', available: true,
    hint: 'Paste your Service Account JSON key — that is all any user needs (the project is auto-detected from it). Or enter just a project ID to use this machine\'s gcloud login.',
    fields: [
      { key: 'serviceAccountKey', placeholder: 'Service account JSON key', type: 'textarea' },
      { key: 'projectId', placeholder: 'GCP project ID (auto-detected from the key)' },
    ],
  },
  {
    id: 'supabase', name: 'Supabase', sub: 'Postgres · supabase-mcp', available: true,
    hint: 'Paste a Supabase personal access token (sbp_…) from Account → Access Tokens. Full read/write management. Stored for this user only.',
    fields: [
      { key: 'accessToken', placeholder: 'Supabase access token (sbp_…)', required: true, type: 'password' },
    ],
  },
  {
    id: 'neon', name: 'Neon', sub: 'Serverless Postgres · hosted MCP', available: true,
    hint: 'Paste a Neon API key from Account settings → API keys. Connects to Neon’s hosted MCP. Stored for this user only.',
    fields: [
      { key: 'apiKey', placeholder: 'Neon API key (napi_…)', required: true, type: 'password' },
    ],
  },
  {
    id: 'github', name: 'GitHub', sub: 'Repos · via Composio', available: true, composio: 'github',
    hint: 'Connect GitHub through Composio (OAuth) — the agent can then read your repos, files, issues and PRs, and analyze a repo to design the infra it needs.',
  },
  {
    id: 'azure', name: 'Microsoft Azure', sub: 'Service principal', available: false,
    hint: 'Connector coming soon — needs an Azure connector + service principal.',
  },
]

export default function ConnectionsPage() {
  const { refresh: refreshCloudData, overview } = useCloudData()
  // Seed from the already-loaded cloud-data context so the correct connected/disconnected
  // state renders on first paint — no blue "Connect" flash before getConnections() resolves.
  const [connected, setConnected] = useState(() => overview?.connections || [])
  const [loading, setLoading] = useState(() => !overview)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [forms, setForms] = useState({})       // { [cloud]: { [field]: value } }
  const [awsMode, setAwsMode] = useState('keys')
  const [composio, setComposio] = useState({ configured: false, toolkits: [] }) // Composio (GitHub …) state

  const refreshComposio = () =>
    fetch('/api/connections/composio/status', { credentials: 'include' })
      .then(r => r.json()).then(s => setComposio(s || { configured: false, toolkits: [] })).catch(() => {})

  // Start a Composio OAuth connect in a popup, then poll until the toolkit is active.
  const connectComposio = async (toolkit) => {
    setError(''); setBusy(toolkit)
    try {
      const r = await fetch('/api/connections/composio/authorize', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toolkit }),
      }).then(r => r.json())
      if (!r.redirectUrl) { setError(r.error || 'Could not start Composio connect.'); setBusy(null); return }
      window.open(r.redirectUrl, '_blank', 'noopener,width=560,height=720')
      let n = 0
      const t = setInterval(async () => {
        n++
        const s = await fetch('/api/connections/composio/status', { credentials: 'include' }).then(r => r.json()).catch(() => null)
        if (s) setComposio(s)
        if (s?.toolkits?.includes(toolkit) || n > 40) { clearInterval(t); setBusy(null) }
      }, 3000)
    } catch (e) { setError(e?.message || 'Composio connect failed.'); setBusy(null) }
  }

  const refresh = () => getConnections()
    .then(r => setConnected(r.clouds || []))
    .catch(e => setError(e?.message || 'Failed to load connections.'))
    .finally(() => setLoading(false))

  useEffect(() => {
    refresh()
    refreshComposio()
    // returning from Google OAuth → reflect the result
    const q = new URLSearchParams(window.location.search).get('gcp')
    if (q === 'connected') { refreshCloudData?.(); window.history.replaceState({}, '', '/app/connections') }
    else if (q && q !== 'connected') { setError(`Google sign-in ${q}. Please try again.`); window.history.replaceState({}, '', '/app/connections') }
  }, [])

  const connectWithGoogle = () => { window.location.href = '/api/connections/gcp/oauth/start' }

  const setField = (cloud, key, val) =>
    setForms(f => ({ ...f, [cloud]: { ...(f[cloud] || {}), [key]: val } }))

  const fieldsFor = (c) => c.awsMethods ? AWS_METHODS[awsMode].fields : (c.fields || [])
  const hintFor = (c) => c.awsMethods ? AWS_METHODS[awsMode].hint : c.hint

  const toggle = async (c, isOn) => {
    setError('')
    setBusy(c.id)
    try {
      let r
      if (isOn) {
        r = await disconnectCloud(c.id)
      } else {
        const form = forms[c.id] || {}
        const fields = fieldsFor(c)
        for (const f of fields.filter(f => f.required)) {
          if (!(form[f.key] || '').trim()) {
            setError(`Enter ${f.placeholder.split(' —')[0].split(' (')[0]} to connect ${c.name}.`)
            setBusy(null); return
          }
        }
        // GCP: need either a Service Account JSON key (any user) or a project ID (host login).
        if (c.id === 'gcp' && !(form.serviceAccountKey || '').trim() && !(form.projectId || '').trim()) {
          setError('Paste a Service Account JSON key (or enter a project ID) to connect Google Cloud.')
          setBusy(null); return
        }
        const body = {}
        for (const f of fields) if ((form[f.key] || '').trim()) body[f.key] = form[f.key].trim()
        r = await connectCloud(c.id, body)
      }
      setConnected(r.clouds || [])
      await refreshCloudData() // keep Overview / Resources / Cost in sync
    } catch (e) {
      setError(e?.message || 'Action failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="content fade">
      <div className="cost-head">
        <div><h2 style={{ margin: 0 }}>Connections</h2><div className="muted" style={{ fontSize: 'var(--fs-label)' }}>Connect your clouds, GitHub & data stores</div></div>
      </div>
      <div className="card glow">
        <div className="section-head">
          <span className="muted">{loading ? 'loading…' : `${connected.length} connected`}</span>
        </div>

        {error && <div style={{ fontSize: 12.5, color: '#cf7470', marginTop: 10 }}>⚠️ {error}</div>}

        {loading ? (
          <div className="empty" style={{ marginTop: 14 }}>Loading your connections…</div>
        ) : (
        <div className="grid conn-grid" style={{ marginTop: 14 }}>
          {CLOUDS.map(c => {
            const isOn = c.composio ? (composio.toolkits || []).includes(c.composio) : connected.includes(c.id)
            const isBusy = busy === c.id || busy === c.composio
            const form = forms[c.id] || {}
            const fields = c.composio ? [] : fieldsFor(c)
            return (
              <div className="card cloud-card" key={c.id}>
                <div className="head">
                  <div className="cloud-badge">{c.id.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <div className="nm">{c.name}</div>
                    <span className={`status ${isOn ? 'connected' : 'syncing'}`}>
                      <span className="dot" />{isOn ? 'connected' : 'not connected'}
                    </span>
                  </div>
                </div>
                <div className="cloud-sub">{c.sub}</div>

                {c.awsMethods && !isOn && (
                  <div className="conn-tabs">
                    {Object.entries(AWS_METHODS).map(([k, m]) => (
                      <button key={k}
                        className={'conn-tab' + (awsMode === k ? ' on' : '')}
                        onClick={() => setAwsMode(k)}>{m.label}</button>
                    ))}
                  </div>
                )}

                {c.id === 'gcp' && !isOn && (
                  <button className="btn" style={{ width: '100%', justifyContent: 'center', marginBottom: 2 }}
                          onClick={connectWithGoogle}>
                    <span style={{ fontWeight: 700 }}>G</span>&nbsp; Connect with Google
                  </button>
                )}
                {c.id === 'gcp' && !isOn && <div className="conn-or">or use a credential</div>}

                {!isOn && hintFor(c) && <div className="cloud-needs">{hintFor(c)}</div>}

                {/* Composio-backed app (e.g. GitHub): OAuth connect, not a pasted credential */}
                {c.composio && (
                  <div className="cloud-foot">
                    <button
                      className={'btn' + (isOn ? ' ghost' : '')}
                      disabled={isBusy || (isOn ? false : !composio.configured)}
                      onClick={() => !isOn && connectComposio(c.composio)}
                      style={{ width: '100%', justifyContent: 'center' }}>
                      {isBusy ? 'Connecting…' : isOn ? 'Connected ✓' : !composio.configured ? 'Composio not configured' : <span><Icon name="plug" size={13} /> Connect with Composio</span>}
                    </button>
                  </div>
                )}

                {!c.composio && <div className="cloud-foot">
                  {c.available && !isOn && fields.map(f => (
                    f.type === 'textarea' ? (
                      <textarea
                        key={f.key}
                        className="conn-input conn-textarea"
                        name={`nimbus-${c.id}-${f.key}`}
                        placeholder={f.placeholder}
                        spellCheck="false"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        rows={3}
                        value={form[f.key] || ''}
                        onChange={e => setField(c.id, f.key, e.target.value)} />
                    ) : (
                      <input
                        key={f.key}
                        className="conn-input"
                        type={f.type || 'text'}
                        name={`nimbus-${c.id}-${f.key}`}
                        placeholder={f.placeholder}
                        autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck="false"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-form-type="other"
                        value={form[f.key] || ''}
                        onChange={e => setField(c.id, f.key, e.target.value)} />
                    )
                  ))}
                  {!c.available && !isOn ? (
                    <button className="btn ghost" disabled style={{ width: '100%', justifyContent: 'center', opacity: .55, cursor: 'not-allowed' }}>
                      Coming soon
                    </button>
                  ) : (
                    <button
                      className={'btn' + (isOn ? ' ghost' : '')}
                      disabled={isBusy}
                      onClick={() => toggle(c, isOn)}
                      style={{ width: '100%', justifyContent: 'center' }}>
                      {isBusy ? 'Working…' : isOn ? 'Disconnect' : <span><Icon name="plug" size={13} /> Connect</span>}
                    </button>
                  )}
                </div>}
              </div>
            )
          })}
        </div>
        )}
      </div>
    </div>
  )
}
