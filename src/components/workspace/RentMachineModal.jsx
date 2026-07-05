/**
 * RentMachineModal — the "Rent a machine" flow for the rented-compute idea (docs/rented-compute.md).
 * Frontend-only for now: pick a LIVE machine size, the coding agent (Claude / Codex / OpenCode / …),
 * and paste your own API key. Provisioning isn't wired yet — this is for brainstorming the UX. The
 * hosted provider (Fly) is NOT surfaced to the user. Sizes come from GET /api/fly/machines (falls
 * back to a preset catalog when no token is available).
 */
import { useEffect, useState } from 'react'
import { I } from './icons.jsx'
import { getFlyMachines, createRental, getSummaries, getAgentModels, startAgentOAuth, exchangeAgentOAuth } from '../../lib/api.js'

const AGENTS = [
  // Claude Code authenticates against a Claude SUBSCRIPTION via OAuth (no API key) — the user clicks
  // Connect, signs in on claude.ai, and pastes back the one-time code.
  { id: 'claude',   name: 'Claude Code', sub: 'Anthropic subscription · sign in', oauth: true },
  { id: 'opencode', name: 'OpenCode',    sub: 'DeepSeek · GLM · Kimi',        keyLabel: 'OPENROUTER_API_KEY', ph: 'sk-or-…' },
]


// Rental duration presets — the value that drives the billing/lifecycle schema (expiry + auto-teardown).
// `hours` is the canonical unit stored server-side; `open` = run until manually stopped (metered live).
const DURATIONS = [
  { id: '1h',   label: '1 hour',   sub: 'quick task',      hours: 1 },
  { id: '6h',   label: '6 hours',  sub: 'half day',        hours: 6 },
  { id: '1d',   label: '1 day',    sub: '24 hours',        hours: 24 },
  { id: '3d',   label: '3 days',   sub: 'short project',   hours: 72 },
  { id: '1w',   label: '1 week',   sub: '7 days',          hours: 168 },
  { id: 'open', label: 'Until I stop it', sub: 'metered hourly', hours: null },
]

const fmtMem = (mb) => (mb >= 1024 ? `${Number((mb / 1024).toFixed(mb % 1024 ? 1 : 0))} GB` : `${mb} MB`)
// Money: small amounts (cheap shared machines) need more precision than $0.00.
const usd = (n) => (n == null ? '—' : n < 0.1 ? `$${n.toFixed(4)}` : n < 10 ? `$${n.toFixed(2)}` : `$${n.toFixed(0)}`)
const hourly = (s) => (s?.priceSecond != null ? s.priceSecond * 3600 : null) // USD / hour

export function RentMachineModal({ projectId, onClose, onCreated }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sizeIdx, setSizeIdx] = useState(0)
  const [duration, setDuration] = useState('6h')
  const [agent, setAgent] = useState('claude')
  const [modelId, setModelId] = useState('')  // the model, chosen up front and stored in the config
  const [models, setModels] = useState([])    // real model catalog for the chosen agent (from models.dev)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [apiKey, setApiKey] = useState('')        // the credential we inject (API key, or the OAuth token)
  const [summaries, setSummaries] = useState([]) // saved past sessions you can resume
  const [resumeId, setResumeId] = useState('')   // '' = start fresh
  // OAuth (subscription login) state for agents like Claude that don't use an API key.
  const [oauthId, setOauthId] = useState('')
  const [oauthCode, setOauthCode] = useState('')
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthErr, setOauthErr] = useState('')
  const connected = !!apiKey.trim()

  useEffect(() => {
    getFlyMachines()
      .then((d) => setData(d))
      .catch((e) => setErr(String(e?.message || e)))
    getSummaries(projectId).then((r) => setSummaries(r?.summaries || [])).catch(() => {})
  }, [projectId])

  // Fetch the REAL model catalog whenever the agent changes; reset any entered credential.
  useEffect(() => {
    setModelsLoading(true); setModelId('')
    setApiKey(''); setOauthId(''); setOauthCode(''); setOauthErr('')
    getAgentModels(agent)
      .then((r) => setModels(r?.models || []))
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false))
  }, [agent])

  // Subscription login (Claude): open the sign-in page, then exchange the pasted code for a token.
  const connect = async () => {
    setOauthBusy(true); setOauthErr('')
    try {
      const r = await startAgentOAuth(agent)
      if (!r?.ok) throw new Error(r?.error || 'could not start sign-in')
      setOauthId(r.oauthId)
      window.open(r.authUrl, '_blank', 'noopener,noreferrer')
    } catch (e) { setOauthErr(String(e?.message || e)) }
    finally { setOauthBusy(false) }
  }
  const verify = async () => {
    setOauthBusy(true); setOauthErr('')
    try {
      const r = await exchangeAgentOAuth(oauthId, oauthCode.trim())
      if (!r?.ok || !r.token) throw new Error(r?.error || 'could not verify the code')
      setApiKey(r.token) // becomes the credential injected on the machine (CLAUDE_CODE_OAUTH_TOKEN)
    } catch (e) { setOauthErr(String(e?.message || e)) }
    finally { setOauthBusy(false) }
  }

  // Drop machines under 512 MB — the agent CLIs OOM on 256 MB (we floor to 1 GB at boot anyway),
  // so offering the tiny shared-cpu-1x/256 is misleading.
  const sizes = (data?.sizes || []).filter((s) => (s.memoryMb || 0) >= 512)
  const agent_ = AGENTS.find((m) => m.id === agent) || AGENTS[0]
  const dur_ = DURATIONS.find((d) => d.id === duration) || DURATIONS[0]
  const size = sizes[sizeIdx]

  // Cost math: rate × time. Open-ended rentals are billed by the hour (no fixed total).
  const rate = hourly(size)                                   // $/hr for the chosen size
  const total = rate != null && dur_.hours != null ? rate * dur_.hours : null // $ for the whole rental

  const rent = async () => {
    if (!size || !projectId || busy) return
    setBusy(true); setErr('')
    try {
      const res = await createRental(projectId, { size: size.name, agent, model: modelId, durationHours: dur_.hours, apiKey: apiKey.trim(), resumeSummaryId: resumeId || undefined })
      if (!res?.ok) { setErr('Could not start the rental.'); setBusy(false); return }
      onCreated?.(res.rental)
      onClose?.()
    } catch (e) {
      setErr(e?.message || 'Could not start the rental.'); setBusy(false)
    }
  }

  return (
    <div className="cc-modal-scrim" onMouseDown={onClose}>
      <div className="cc-modal rent-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cc-modal-title">{I.cpu({ width: 18, height: 18 })} Rent a machine</div>
        <div className="cc-modal-sub">
          Spin up a hosted <b>Nimbus Cloud</b> machine on demand when no teammate machine is online. Pick a size, the coding agent, and bring your own key.
          {data && (data.live
            ? <span className="rent-live on"> · live catalog</span>
            : <span className="rent-live"> · preview catalog</span>)}
        </div>

        {/* ── machine size (live from the hosted provider) ── */}
        <div className="rent-label">Machine size <span>live sizes</span></div>
        <div className="rent-sizes">
          {!data && <div className="cc-modal-empty">Loading sizes…</div>}
          {sizes.map((s, i) => (
            <button key={s.name + s.memoryMb + i} className={'rent-size' + (i === sizeIdx ? ' on' : '')} onClick={() => setSizeIdx(i)}>
              <span className="rent-size-name">{s.name}</span>
              <span className={'rent-kind ' + s.cpuKind}>{s.cpuKind}</span>
              <span className="rent-size-spec">{s.cpus} vCPU · {fmtMem(s.memoryMb)} RAM</span>
              {hourly(s) != null && <span className="rent-size-rate">{usd(hourly(s))}/hr</span>}
            </button>
          ))}
        </div>

        {/* ── everything else in two columns so the modal fits without scrolling ── */}
        <div className="rent-cols">
          {/* left column */}
          <div className="rent-col">
            {/* rental duration (drives billing + auto-teardown) */}
            <div className="rent-label">Rental duration <span>auto-stops at expiry</span></div>
            <div className="rent-durs">
              {DURATIONS.map((d) => (
                <button key={d.id} className={'rent-dur' + (d.id === duration ? ' on' : '')} onClick={() => setDuration(d.id)}>
                  <span className="rent-dur-label">{d.label}</span>
                  <span className="rent-dur-sub">{d.sub}</span>
                </button>
              ))}
            </div>

            {/* model (real catalog from models.dev) */}
            <div className="rent-label">Model <span>{modelsLoading ? 'fetching…' : `${models.length} available`}</span></div>
            <div className="rent-row">
              <label className="rent-field">
                <select value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={modelsLoading}>
                  <option value="">{agent === 'claude' ? 'Default · Sonnet' : `${agent_.name} default`}</option>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
            </div>

            {/* resume a past session (seed its saved summary as context) */}
            {summaries.length > 0 && (
              <>
                <div className="rent-label">Resume a session <span>saved summaries</span></div>
                <div className="rent-row">
                  <label className="rent-field">
                    <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                      <option value="">Start fresh — no prior context</option>
                      {summaries.map((s) => <option key={s.id} value={s.id}>{s.title}{s.agent ? ` · ${s.agent}` : ''}</option>)}
                    </select>
                  </label>
                </div>
              </>
            )}
          </div>

          {/* right column */}
          <div className="rent-col">
            {/* coding agent (CLI) */}
            <div className="rent-label">Coding agent</div>
            <div className="rent-models one-col">
              {AGENTS.map((m) => (
                <button key={m.id} className={'rent-model' + (m.id === agent ? ' on' : '')} onClick={() => { setAgent(m.id); setModelId('') }}>
                  <span className="rent-model-name">{m.name}</span>
                  <span className="rent-model-sub">{m.sub}</span>
                </button>
              ))}
            </div>

            {/* credential: OAuth subscription login (Claude) OR bring-your-own key (Codex / OpenCode) */}
            {agent_.oauth ? (
              <>
                <div className="rent-label">Sign in <span>{agent_.name} subscription</span></div>
                {connected ? (
                  <div className="rent-oauth-ok">✓ Signed in — {agent_.name} is connected.
                    <button className="rent-oauth-reset" onClick={() => { setApiKey(''); setOauthId(''); setOauthCode('') }}>change</button>
                  </div>
                ) : !oauthId ? (
                  <>
                    <button className="cc-modal-btn primary rent-oauth-btn" disabled={oauthBusy} onClick={connect}>
                      {oauthBusy ? 'Opening…' : `Sign in to ${agent_.name} ↗`}
                    </button>
                    <div className="rent-key-hint">Opens {agent_.name}’s sign-in in a new tab. Uses your subscription — no API key, no per-token charge.</div>
                  </>
                ) : (
                  <>
                    <div className="rent-key-hint">Approve access in the tab that opened, then paste the code it shows you here.</div>
                    <input className="rent-key" type="text" value={oauthCode} placeholder="paste the code from the sign-in page"
                      autoComplete="off" onChange={(e) => setOauthCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') verify() }} />
                    <div className="rent-oauth-row">
                      <button className="cc-modal-btn primary" disabled={oauthBusy || !oauthCode.trim()} onClick={verify}>{oauthBusy ? 'Verifying…' : 'Verify code'}</button>
                      <button className="cc-modal-btn ghost sm" disabled={oauthBusy} onClick={connect}>Reopen sign-in</button>
                    </div>
                  </>
                )}
                {oauthErr && <div className="cc-modal-err" style={{ marginTop: 6 }}>{oauthErr}</div>}
              </>
            ) : (
              <>
                <div className="rent-label">Your API key <span>{agent_.keyLabel}</span></div>
                <input className="rent-key" type="password" value={apiKey} placeholder={agent_.ph}
                  autoComplete="off" onChange={(e) => setApiKey(e.target.value)} />
                <div className="rent-key-hint">Injected into the machine only to run your agent — not stored after the machine boots.</div>
              </>
            )}
          </div>
        </div>

        {/* ── estimated cost (rate × duration, from cached Fly pricing) ── */}
        {size && rate != null && (
          <div className="rent-cost">
            <div className="rent-cost-main">
              {dur_.hours != null
                ? <>≈ <b>{usd(total)}</b> <span className="rent-cost-for">for {dur_.label}</span></>
                : <><b>{usd(rate)}</b>/hr <span className="rent-cost-for">· billed hourly until you stop it</span></>}
            </div>
            <div className="rent-cost-rate">{usd(rate)}/hr · {usd(size.priceMonth)}/mo base · est. on {size.name}</div>
          </div>
        )}

        {err && <div className="cc-modal-err">{err}</div>}

        <div className="cc-modal-foot">
          <span className="rent-summary">
            {size ? <>{size.name} · {size.cpus} vCPU · {fmtMem(size.memoryMb)} · {dur_.label} · {agent_.name}{modelId ? ` (${modelId})` : ''}</> : '—'}
          </span>
          <div style={{ flex: 1 }} />
          <button className="cc-modal-btn ghost" onClick={onClose}>Cancel</button>
          <button className="cc-modal-btn primary" disabled={!size || !apiKey.trim() || busy} onClick={rent}>
            {busy ? 'Renting…' : 'Rent machine'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default RentMachineModal
