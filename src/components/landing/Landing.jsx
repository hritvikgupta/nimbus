import { useEffect, useRef, useState } from 'react'
import '../../styles/landing.css'

/* Nimbus cloud mark, the same glyph used next to "Nimbus" on the login/onboarding card. */
const Logo = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={{ display: 'block' }}>
    <path d="M14 34a8 8 0 0 1 .6-16 11 11 0 0 1 21-2A7.5 7.5 0 0 1 35 34H14z" fill="#111111" />
    <circle cx="19" cy="27" r="1.6" fill="#fff" /><circle cx="26" cy="27" r="1.6" fill="#fff" />
  </svg>
)

const NAV = [['How it works', '#how'], ['Quality', '#quality'], ['Integrations', '#integrations'], ['Security', '#security'], ['Pricing', '#pricing']]
const CLOUD_SPOKES = [['Amazon Web Services', 'EC2 · RDS · S3 · Lambda.'], ['Google Cloud', 'GCE · Cloud SQL · GKE.'], ['Microsoft Azure', 'VMs · AKS · Azure SQL.'], ['PostgreSQL', 'Schemas · queries · roles.']]
const ACTION_SPOKES = [['Analyze', 'Map every resource in scope.'], ['Diagnose', 'Baseline metrics, logs & traces.'], ['Plan & apply', 'Readable IaC diff, gated by you.'], ['Verify & learn', 'Before/after proof, runbook updated.']]
const TOPS = [90, 230, 370, 510]
const QUALITY = [['Baseline quality', 'before proof', 'Confirm Nimbus captured the real state before changing anything.'], ['Change quality', 'plan + diff', 'Inspect the plan, IaC diff, and resource changes in one place.'], ['Verification quality', 'after proof', 'Compare metrics, logs, and checks to prove the change worked.'], ['Learning quality', 'runbook updated', 'Measure whether fixes become durable knowledge for future runs.']]
const SECURITY = [['Least-privilege access', 'Scoped, time-bound roles per run. Nimbus only touches what you grant.'], ['Approval gates', 'Nothing applies to production until a human reviews the plan and signs off.'], ['Dry-run plans', 'Every change is previewed as a readable plan before a single resource moves.'], ['Full audit log', 'Every signal, decision, command, and approval is recorded and exportable.'], ['Read-only by default', 'Start in observe mode. Hand over write access cloud-by-cloud as trust grows.'], ['Instant rollback', 'Branch-backed state means any applied change can be reverted in one step.']]

const sub = '#9a9a9a', ink = '#141414', mut = '#555555', line = '#E6E6E6'

export default function Landing({ onEnter }) {
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
    <div className="lp" style={{ fontFamily: "'Hanken Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif", WebkitFontSmoothing: 'antialiased', background: '#fff', color: ink, width: '100%', overflowX: 'hidden' }}>
      <div className="lp-frame">

      {/* NAV */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(255,255,255,0.82)', backdropFilter: 'saturate(180%) blur(14px)', borderBottom: `1px solid ${line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 32px', height: 62, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={26} />
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', color: ink }}>Nimbus</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28, fontSize: 13, color: mut }}>
            {NAV.map(([t, h]) => <a key={t} href={h} className="lp-link" style={{ color: 'inherit' }}>{t}</a>)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <button onClick={onEnter} className="lp-ghost" style={{ height: 34, padding: '0 15px', border: `1px solid #DBDBDB`, borderRadius: 9, fontSize: 13, color: ink, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Log in</button>
            <button onClick={onEnter} className="lp-dark" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 16px', background: '#111', color: '#fff', borderRadius: 9, fontSize: 13, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Book demo <span style={{ fontSize: 14 }}>→</span></button>
          </div>
        </div>
      </div>

      {/* HERO */}
      <div style={{ background: '#fff' }}>
        <div style={{ position: 'relative', width: '100%', minHeight: '74vh', overflow: 'hidden', background: '#1a1a1a' }}>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'url(/hero-clouds.jpg)', backgroundSize: 'cover', backgroundPosition: 'center 45%' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(8,8,8,0.55) 0%, rgba(8,8,8,0.34) 40%, rgba(8,8,8,0.42) 72%, rgba(8,8,8,0.64) 100%)' }} />
          <div style={{ position: 'relative', maxWidth: 1100, margin: '0 auto', padding: '0 32px', minHeight: '74vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
            <div style={{ width: '100%', maxWidth: 760, padding: '56px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <h1 style={{ fontSize: 'clamp(30px,3.6vw,50px)', lineHeight: 1.04, letterSpacing: '-0.035em', fontWeight: 600, margin: '0 0 18px', color: '#fff', maxWidth: '18ch', textShadow: '0 2px 24px rgba(0,0,0,0.4)' }}>Your Cloud engineer, on autopilot</h1>
              <p style={{ fontSize: 'clamp(15px,1.3vw,17px)', lineHeight: 1.55, color: 'rgba(255,255,255,0.92)', margin: '0 0 32px', maxWidth: '58ch', textShadow: '0 1px 12px rgba(0,0,0,0.35)' }}>An army of agents that provision, inspect, diagnose, and operate every cloud and database, chasing every incident and proving every fix, with each action gated and audited by you.</p>

              {/* composer mock */}
              <div style={{ width: '100%', maxWidth: 600, background: '#fff', border: `1px solid ${line}`, borderRadius: 14, boxShadow: '0 16px 40px rgba(0,0,0,0.26)', padding: '15px 14px 12px', textAlign: 'left' }}>
                <div style={{ fontSize: 14, color: sub, padding: '3px 5px 17px', minHeight: 20 }}><Typewriter /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className="lp-soft" style={{ flex: 'none', width: 36, height: 36, border: `1px solid ${line}`, borderRadius: 9, background: '#fff', color: '#444', fontSize: 15, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>+</button>
                  <div style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, height: 36, padding: '0 10px', border: `1px solid ${line}`, borderRadius: 9, background: '#fff', cursor: 'pointer' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a' }}>Design</span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={sub} strokeWidth="2.2"><path d="M6 9l6 6 6-6" /></svg>
                  </div>
                  <span style={{ flex: 1, fontSize: 12.5, color: sub }}>designs, deploys &amp; explains your cloud</span>
                  <button className="lp-dark" onClick={onEnter} style={{ flex: 'none', width: 36, height: 36, border: 'none', borderRadius: 9, background: '#111', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 26, display: 'flex', alignItems: 'center', gap: 22, fontSize: 13, color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 10px rgba(0,0,0,0.35)' }}>
                <span>Plan before apply</span><span style={dot} /><span>Human approval gates</span><span style={dot} /><span>Full audit trail</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* WORKFLOW, HUB & SPOKE */}
      <div id="how" style={{ background: '#fff' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', borderLeft: '1px solid #EDEDED', borderRight: '1px solid #EDEDED' }}>
          <div style={{ padding: '84px 48px 0', textAlign: 'center' }}>
            <h2 style={{ fontSize: 'clamp(26px,3vw,40px)', lineHeight: 1.05, letterSpacing: '-0.03em', fontWeight: 500, margin: '0 0 12px', color: ink }}>From your stack to applied change.</h2>
            <p style={{ fontSize: 15, lineHeight: 1.5, color: sub, margin: '0 auto', maxWidth: '52ch' }}>Nimbus connects to every cloud and database, then runs the same proven loop that ships verified changes.</p>
          </div>
          <div style={{ borderTop: '1px solid #EDEDED', marginTop: 56, padding: '56px 40px 84px', position: 'relative' }}>
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#F5F5F5' }} />
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
                    {[90, 230, 370, 510].map(y => <circle key={'l' + y} cx="380" cy={y} r="3.6" />)}
                    {[90, 230, 370, 510].map(y => <circle key={'r' + y} cx="720" cy={y} r="3.6" />)}
                  </g>
                  <circle cx="550" cy="300" r="42" fill="#fff" stroke="#cfcfcf" strokeWidth="1.4" />
                  <g transform="translate(522,271) scale(1.15)">
                    <path d="M14 34a8 8 0 0 1 .6-16 11 11 0 0 1 21-2A7.5 7.5 0 0 1 35 34H14z" fill="#111111" />
                    <circle cx="19" cy="27" r="1.6" fill="#fff" /><circle cx="26" cy="27" r="1.6" fill="#fff" />
                  </g>
                </svg>
                <div style={{ position: 'absolute', left: 40, top: 16, fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', color: sub, fontFamily: 'monospace' }}>Connected clouds</div>
                <div style={{ position: 'absolute', right: 40, top: 16, fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', color: sub, fontFamily: 'monospace', textAlign: 'right' }}>Autonomous actions</div>
                {CLOUD_SPOKES.map(([t, s], i) => (
                  <div key={t} style={{ position: 'absolute', left: 40, top: TOPS[i], width: 300, transform: 'translateY(-50%)', textAlign: 'left' }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: ink }}>{t}</div>
                    <div style={{ fontSize: 12, lineHeight: 1.45, color: sub, marginTop: 4 }}>{s}</div>
                  </div>
                ))}
                {ACTION_SPOKES.map(([t, s], i) => (
                  <div key={t} style={{ position: 'absolute', right: 40, top: TOPS[i], width: 300, transform: 'translateY(-50%)', textAlign: 'right' }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: ink }}>{t}</div>
                    <div style={{ fontSize: 12, lineHeight: 1.45, color: sub, marginTop: 4 }}>{s}</div>
                  </div>
                ))}
                <div style={{ position: 'absolute', left: '50%', top: 368, transform: 'translateX(-50%)', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>Nimbus</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* HOW IT WORKS, BENTO (dark) */}
      <div style={{ background: '#0b0b0b' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '96px 32px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 13px', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 999, fontSize: 12, color: '#bdbdbd', background: 'rgba(255,255,255,0.04)' }}>Fast &amp; safe</span>
          </div>
          <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px,3vw,36px)', lineHeight: 1.06, letterSpacing: '-0.03em', fontWeight: 500, margin: '0 0 48px', color: '#fff' }}>How it works</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, overflow: 'hidden' }}>
            <BentoCard n="01" title="Connect" desc="Link your clouds, databases, and repo in minutes, Nimbus maps everything read-only first."><ConnectAnim /></BentoCard>
            <BentoCard n="02" title="Design" desc="Describe what you want; Nimbus lays out the architecture on a live canvas, ready to provision."><DesignAnim /></BentoCard>
            <BentoCard n="03" title="Monitor" desc="It watches metrics, logs, and cost across every connected cloud, continuously, in real time."><MonitorAnim /></BentoCard>
            <BentoCard n="04" title="Diagnose" desc="When something breaks, Nimbus finds the root cause from the evidence and proposes the fix."><DiagnoseAnim /></BentoCard>
          </div>

          <div style={{ marginTop: 20, background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: '24px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em', color: '#fff' }}>Put your cloud on autopilot.</div>
            <button onClick={onEnter} className="lp-soft" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 20px', background: '#fff', color: '#111', borderRadius: 11, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Book demo <span style={{ fontSize: 15 }}>→</span></button>
          </div>
        </div>
      </div>

      {/* QUALITY */}
      <div id="quality" style={{ background: '#fff' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '96px 32px' }}>
          <div style={{ fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#111', marginBottom: 16, fontFamily: 'monospace' }}>Cloud quality across runs</div>
          <h2 style={{ fontSize: 'clamp(24px,2.8vw,38px)', lineHeight: 1.05, letterSpacing: '-0.03em', fontWeight: 500, margin: '0 0 18px', maxWidth: '22ch', color: ink }}>Inspect every run and measure whether it actually improved your cloud.</h2>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: mut, margin: '0 0 44px', maxWidth: '76ch' }}>Nimbus brings signals, resource maps, baselines, plans, diffs, checks, approval gates, audit logs, and runbook updates into one quality surface, so you can prove every change.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
            {QUALITY.map(([lbl, big, desc]) => (
              <div key={lbl} style={{ background: '#F7F9FE', border: `1px solid ${line}`, borderRadius: 14, padding: '24px 22px', minHeight: 200, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 12.5, color: sub, marginBottom: 12 }}>{lbl}</div>
                <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', marginBottom: 'auto', color: '#111' }}>{big}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5, color: mut, marginTop: 16 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* INTEGRATIONS */}
      <div id="integrations" style={{ background: 'radial-gradient(130% 120% at 18% 0%, #2a2a2a 0%, #161616 55%, #0b0b0b 100%)', backgroundColor: '#0b0b0b', color: '#fff' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '96px 32px' }}>
          <div style={{ fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#9a9a9a', marginBottom: 16, fontFamily: 'monospace' }}>Runs across your stack</div>
          <h2 style={{ fontSize: 'clamp(24px,2.8vw,38px)', lineHeight: 1.05, letterSpacing: '-0.03em', fontWeight: 500, margin: '0 0 48px', maxWidth: '20ch', color: '#fff' }}>One engineer for every cloud and database you operate.</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24, borderTop: '1px solid rgba(255,255,255,0.16)' }}>
            <div style={{ padding: '32px 24px 32px 0', borderRight: '1px solid rgba(255,255,255,0.16)' }}>
              <div style={{ fontSize: 12, color: '#9a9a9a', marginBottom: 20, fontFamily: 'monospace' }}>// clouds</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 17, fontWeight: 500, letterSpacing: '-0.01em' }}>
                <span>Amazon Web Services</span><span>Google Cloud</span><span>Microsoft Azure</span>
              </div>
            </div>
            <div style={{ padding: '32px 24px', borderRight: '1px solid rgba(255,255,255,0.16)' }}>
              <div style={{ fontSize: 12, color: '#9a9a9a', marginBottom: 20, fontFamily: 'monospace' }}>// resources</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 18px', fontSize: 14, color: '#c8c8c8' }}>
                {['Compute', 'Databases', 'Networking', 'Storage', 'IAM', 'Observability', 'Queues', 'Secrets'].map(x => <span key={x}>{x}</span>)}
              </div>
            </div>
            <div style={{ padding: '32px 0 32px 24px' }}>
              <div style={{ fontSize: 12, color: '#9a9a9a', marginBottom: 20, fontFamily: 'monospace' }}>// infrastructure as code</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14, color: '#c8c8c8' }}>
                {['Terraform', 'Pulumi', 'AWS CDK', 'Kubernetes manifests'].map(x => <span key={x}>{x}</span>)}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 30, fontSize: 13, color: '#9a9a9a' }}>Bring any model by API key, Claude, Codex, local, or your own stack.</div>
        </div>
      </div>

      {/* SECURITY */}
      <div id="security" style={{ background: '#fff' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '96px 32px' }}>
          <div style={{ fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#111', marginBottom: 16, fontFamily: 'monospace' }}>Trust and control</div>
          <h2 style={{ fontSize: 'clamp(24px,2.8vw,38px)', lineHeight: 1.05, letterSpacing: '-0.03em', fontWeight: 500, margin: '0 0 44px', maxWidth: '18ch', color: ink }}>Autonomy with a human hand on every lever.</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', border: `1px solid ${line}`, borderRadius: 16, overflow: 'hidden' }}>
            {SECURITY.map(([t, d], i) => (
              <div key={t} style={{ padding: '30px 28px', borderRight: i % 3 !== 2 ? `1px solid ${line}` : 'none', borderBottom: i < 3 ? `1px solid ${line}` : 'none' }}>
                <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 9, color: ink }}>{t}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.55, color: mut }}>{d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PRICING */}
      <div id="pricing" style={{ background: '#F5F5F5' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '96px 32px' }}>
          <div style={{ fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#111', marginBottom: 16, fontFamily: 'monospace' }}>Pricing</div>
          <h2 style={{ fontSize: 'clamp(24px,2.8vw,38px)', lineHeight: 1.05, letterSpacing: '-0.03em', fontWeight: 500, margin: '0 0 44px', maxWidth: '18ch', color: ink }}>Start small. Hand over more when you trust it.</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, alignItems: 'stretch' }}>
            <PriceCard name="Starter" price="$0" note="One cloud account, read-only." items={['Observe mode across one account', 'Diagnoses & proposed plans', 'Community support']} cta="Get started" onEnter={onEnter} />
            <PriceCard featured name="Team" price="$499" unit="/mo" note="Autonomous runs with approval gates." items={['Apply changes across every cloud', 'Human gates, audit log & rollback', 'Runbook & changelog updates', 'Priority support']} cta="Book demo" onEnter={onEnter} />
            <PriceCard name="Enterprise" price="Custom" note="For regulated, multi-account orgs." items={['SSO & SCIM, on-prem models', 'Audit exports & compliance', 'Dedicated support engineer']} cta="Contact sales" onEnter={onEnter} />
          </div>
        </div>
      </div>

      {/* FOOTER CTA */}
      <div id="book" style={{ background: '#fff' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '110px 32px 90px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(30px,4vw,52px)', lineHeight: 1.02, letterSpacing: '-0.035em', fontWeight: 500, margin: '0 auto 22px', maxWidth: '16ch', color: ink }}>Put your cloud on autopilot.</h2>
          <p style={{ fontSize: 16, color: mut, margin: '0 auto 34px', maxWidth: '50ch' }}>See Nimbus diagnose a real incident, plan the fix, and prove it worked, in a 30-minute demo.</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <button onClick={onEnter} className="lp-dark" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, height: 48, padding: '0 24px', background: '#111', color: '#fff', borderRadius: 12, fontSize: 15, fontWeight: 500, border: 'none', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 10px 24px rgba(37,99,235,0.28)' }}>Book demo <span style={{ fontSize: 16 }}>→</span></button>
            <button onClick={onEnter} className="lp-ghost" style={{ display: 'inline-flex', alignItems: 'center', height: 48, padding: '0 20px', border: '1px solid #DBDBDB', borderRadius: 12, fontSize: 15, color: '#111', fontWeight: 500, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Talk to us</button>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ borderTop: `1px solid ${line}`, background: '#fff' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '50px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 40 }}>
          <div style={{ maxWidth: 280 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
              <Logo size={24} /><span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', color: ink }}>Nimbus</span>
            </div>
            <div style={{ fontSize: 13, color: sub, lineHeight: 1.55 }}>The autonomous engineer that provisions, diagnoses, and operates your cloud.</div>
          </div>
          <div style={{ display: 'flex', gap: 64, fontSize: 13 }}>
            <FooterCol title="Product" links={[['How it works', '#how'], ['Integrations', '#integrations'], ['Pricing', '#pricing']]} />
            <FooterCol title="Company" links={[['About', '#'], ['Careers', '#'], ['Blog', '#']]} />
            <FooterCol title="Resources" links={[['Security', '#security'], ['Docs', '#'], ['Status', '#']]} />
          </div>
        </div>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 32px 36px', fontSize: 12.5, color: sub }}>© 2026 Nimbus. All rights reserved.</div>
      </div>
      </div>
    </div>
  )
}

const dot = { width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.7)' }

/* Typewriter, cycles example prompts inside the hero composer. */
const PROMPTS = [
  'Design me a cloud service on AWS',
  'Why is prod-db CPU at 95%?',
  'Cut my AWS bill by 20%',
  'Deploy a 3-tier app on GCP',
  'Find failing services and open a PR',
]
function Typewriter() {
  const [txt, setTxt] = useState('')
  const [pi, setPi] = useState(0)
  const [del, setDel] = useState(false)
  useEffect(() => {
    const full = PROMPTS[pi]
    let delay = del ? 35 : 58
    if (!del && txt === full) delay = 1600
    else if (del && txt === '') delay = 350
    const t = setTimeout(() => {
      if (!del && txt === full) { setDel(true); return }
      if (del && txt === '') { setDel(false); setPi((pi + 1) % PROMPTS.length); return }
      setTxt(del ? full.slice(0, txt.length - 1) : full.slice(0, txt.length + 1))
    }, delay)
    return () => clearTimeout(t)
  }, [txt, del, pi])
  return (
    <span>{txt}<span style={{ display: 'inline-block', width: 1.5, height: 14, background: '#111', marginLeft: 2, verticalAlign: 'text-bottom', animation: 'nbCaret 1s steps(1) infinite' }} /></span>
  )
}

function BentoCard({ n, title, desc, children }) {
  return (
    <div style={{ background: '#111111', padding: 28, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{children}</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#666', fontFamily: 'monospace', marginBottom: 6 }}>{n}</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: '#9a9a9a', maxWidth: '40ch', margin: '0 auto' }}>{desc}</div>
      </div>
    </div>
  )
}

/* 01, a cursor drifts in and clicks the "Connect your cloud" chip */
function ConnectAnim() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, height: 44, padding: '0 16px', background: '#1c1c1c', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 11, boxShadow: '0 10px 26px rgba(0,0,0,0.5)', fontSize: 14, fontWeight: 500, color: '#fff', animation: 'nbFloat 3.4s ease-in-out infinite' }}>
        <span style={{ width: 16, height: 16, borderRadius: 5, background: 'radial-gradient(120% 120% at 30% 0%, #eaeaea, #8a8a8a)', transform: 'rotate(45deg)', display: 'inline-block' }} /> Connect your cloud
      </div>
      <svg width="42" height="44" viewBox="0 0 46 48" style={{ position: 'absolute', left: '56%', top: '60%', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.55))', animation: 'nbCursor 2.8s ease-in-out infinite' }} aria-hidden="true">
        <path d="M6 4 L34 22 L21 24 L29 40 L23 43 L15 27 L6 33 Z" fill="#fff" stroke="#0a0a0a" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/* 02, a live architecture graph: nodes wired by flowing connections */
function Gnode({ x, y, label }) {
  return (
    <g>
      <rect x={x} y={y} width="58" height="26" rx="7" fill="#1c1c1c" stroke="rgba(255,255,255,0.18)" />
      <circle cx={x + 13} cy={y + 13} r="3.4" fill="#cfcfcf" />
      <text x={x + 23} y={y + 17} fill="#cfcfcf" fontSize="10.5" fontFamily="ui-monospace, monospace">{label}</text>
    </g>
  )
}
function DesignAnim() {
  return (
    <svg width="250" height="150" viewBox="0 0 250 150" fill="none">
      <g stroke="rgba(255,255,255,0.30)" strokeWidth="1.5" strokeDasharray="4 6" strokeLinecap="round" style={{ animation: 'dashflow 0.9s linear infinite' }}>
        <path d="M125,40 V62" />
        <path d="M125,88 V99 H60 V110" />
        <path d="M125,88 V99 H190 V110" />
      </g>
      <Gnode x={96} y={14} label="lb" />
      <Gnode x={96} y={62} label="api" />
      <Gnode x={31} y={110} label="db" />
      <Gnode x={161} y={110} label="cache" />
    </svg>
  )
}

/* 03, live metrics: a timeseries line chart with gridlines + a pulsing current-reading dot */
function MonitorAnim() {
  const line = 'M6,72 L40,60 L74,66 L108,44 L142,33 L176,52 L210,28 L244,40'
  return (
    <div style={{ position: 'relative', width: 260, height: 120, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, right: 2, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9a9a9a', fontFamily: 'monospace', zIndex: 1 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16a34a', animation: 'nbCaret 1.4s steps(1) infinite' }} /> live
      </div>
      <svg width="260" height="110" viewBox="0 0 260 110" fill="none" style={{ position: 'absolute', bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="nbmg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.20" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="rgba(255,255,255,0.07)" strokeWidth="1">
          <line x1="0" y1="28" x2="260" y2="28" /><line x1="0" y1="56" x2="260" y2="56" /><line x1="0" y1="84" x2="260" y2="84" />
        </g>
        <path d={`${line} L244,100 L6,100 Z`} fill="url(#nbmg)" />
        <path d={line} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="244" cy="40" r="4" fill="none" stroke="#fff" opacity="0.6">
          <animate attributeName="r" values="4;13" dur="1.7s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6;0" dur="1.7s" repeatCount="indefinite" />
        </circle>
        <circle cx="244" cy="40" r="3.5" fill="#fff" />
      </svg>
      <div style={{ position: 'absolute', top: 16, bottom: 8, left: 0, width: 2, background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.38), transparent)', animation: 'nbScan 3s ease-in-out infinite' }} />
    </div>
  )
}

/* 04, diagnose: a scan sweeps the logs, status flips anomaly → root cause found */
function Pill({ color, bg, text, anim, dot, check }) {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 12px', borderRadius: 8, background: bg, border: `1px solid ${color}40`, fontSize: 12.5, fontWeight: 600, color, whiteSpace: 'nowrap', animation: `${anim} 3.6s ease-in-out infinite` }}>
      {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />}
      {check && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>}
      {text}
    </div>
  )
}
function DiagnoseAnim() {
  return (
    <div style={{ position: 'relative', width: 260 }}>
      <div style={{ position: 'relative', background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 13px', overflow: 'hidden' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: i === 1 ? '#ef5350' : '#3a3a3a' }} />
            <span style={{ width: i === 1 ? '85%' : '60%', height: 7, borderRadius: 3, background: i === 1 ? 'rgba(239,83,80,0.45)' : 'rgba(255,255,255,0.14)' }} />
          </div>
        ))}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 20, background: 'linear-gradient(180deg, rgba(255,255,255,0.14), transparent)', animation: 'nbScanY 2.8s ease-in-out infinite' }} />
      </div>
      <div style={{ position: 'relative', height: 30, marginTop: 12 }}>
        <Pill color="#ef5350" bg="rgba(239,83,80,0.16)" text="Anomaly detected" anim="nbShowA" dot />
        <Pill color="#22c55e" bg="rgba(34,197,94,0.16)" text="Root cause found · fix proposed" anim="nbShowB" check />
      </div>
    </div>
  )
}

function PriceCard({ name, price, unit, note, items, cta, featured, onEnter }) {
  const f = featured
  return (
    <div style={{ background: f ? 'radial-gradient(130% 130% at 30% 0%, #444 0%, #111 55%, #1B4FD6 100%)' : '#fff', backgroundColor: f ? '#111' : '#fff', color: f ? '#fff' : ink, border: f ? 'none' : `1px solid ${line}`, borderRadius: 16, padding: '30px 26px', display: 'flex', flexDirection: 'column', boxShadow: f ? '0 20px 50px rgba(37,99,235,0.32)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{name}</span>
        {f && <span style={{ fontSize: 11, padding: '4px 10px', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 999, color: '#fff' }}>Most popular</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 34, fontWeight: 500, letterSpacing: '-0.03em' }}>{price}</span>
        {unit && <span style={{ fontSize: 14, color: f ? 'rgba(255,255,255,0.75)' : sub }}>{unit}</span>}
      </div>
      <div style={{ fontSize: 13, color: f ? 'rgba(255,255,255,0.8)' : sub, marginBottom: 24 }}>{note}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, fontSize: 13.5, color: f ? 'rgba(255,255,255,0.92)' : mut, marginBottom: 28 }}>
        {items.map(i => <span key={i}>, {i}</span>)}
      </div>
      <button onClick={onEnter} className={f ? 'lp-soft' : 'lp-ghost'} style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: 11, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', border: f ? 'none' : '1px solid #DBDBDB', background: f ? '#fff' : '#fff', color: '#111' }}>{cta}</button>
    </div>
  )
}

function FooterCol({ title, links }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <span style={{ color: sub, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{title}</span>
      {links.map(([t, h]) => <a key={t} href={h} className="lp-link" style={{ color: mut }}>{t}</a>)}
    </div>
  )
}
