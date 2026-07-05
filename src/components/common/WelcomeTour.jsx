/**
 * WelcomeTour — the guided Nimbus walkthrough (Lovart-style carousel).
 *
 * This is BOTH the first-run onboarding (auto-opens once per user) AND the "About Nimbus"
 * reference — the sidebar cloud icon opens it on demand. Each step shows a product-preview
 * panel + the full section copy, with a "N / total" counter and Previous / Next controls.
 * "Seen" is remembered per-user in localStorage so first-run never nags twice.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const seenKey = (uid) => `nimbus.welcome.seen.${uid || 'anon'}`

export function hasSeenWelcome(uid) {
  try { return localStorage.getItem(seenKey(uid)) === '1' } catch { return true }
}
export function markWelcomeSeen(uid) {
  try { localStorage.setItem(seenKey(uid), '1') } catch { /* private mode — ignore */ }
}

/* ── Per-step product previews (crafted mockups, not stock images) ──────────────── */

function PreviewChat() {
  return (
    <div className="wt-mock wt-mock-chat">
      <div className="wt-bubble user">Design a cheap, production-ready API on AWS</div>
      <div className="wt-bubble nimbus">
        <span className="wt-dot" /> Nimbus · planning
        <div className="wt-plan">
          <span>◱ Load balancer → App → RDS → Cache</span>
          <span>◱ Reads live inventory, cost &amp; logs</span>
        </div>
      </div>
      <div className="wt-composer"><span>Ask Nimbus anything…</span><b>↵</b></div>
    </div>
  )
}

function PreviewSteps() {
  const items = ['Connect a repository', 'Connect your clouds', 'Chat with Nimbus', 'Connect a machine', 'Invite your team']
  return (
    <div className="wt-mock wt-mock-steps">
      {items.map((t, i) => (
        <div key={i} className="wt-num-row">
          <span className="wt-num">{i + 1}</span>
          <span className="wt-num-t">{t}</span>
        </div>
      ))}
    </div>
  )
}

function PreviewCanvas() {
  return (
    <div className="wt-mock wt-mock-canvas">
      <svg viewBox="0 0 320 150" className="wt-wires" preserveAspectRatio="none">
        <path d="M60 40 L160 40" /><path d="M160 40 L160 110" /><path d="M160 110 L260 110" />
        <path d="M160 40 L260 40" />
      </svg>
      <span className="wt-node" style={{ left: 18, top: 26 }}>ALB</span>
      <span className="wt-node hot" style={{ left: 128, top: 26 }}>App ×3</span>
      <span className="wt-node" style={{ left: 228, top: 26 }}>Cache</span>
      <span className="wt-node" style={{ left: 228, top: 96 }}>RDS</span>
      <div className="wt-canvas-tag">Design mode · live canvas</div>
    </div>
  )
}

function PreviewChannels() {
  return (
    <div className="wt-mock wt-mock-channels">
      <div className="wt-chan"># general</div>
      <div className="wt-chan on"># code-debug</div>
      <div className="wt-chan-msg"><b>@nimbus</b> why is the checkout 502-ing?</div>
      <div className="wt-chan-msg nimbus"><span className="wt-dot" /> reading PRs, cloud &amp; logs…</div>
      <div className="wt-chan sub">Computers · 2 online</div>
    </div>
  )
}

function PreviewConnect() {
  const rows = [
    { k: 'AWS', s: 'us-east-1 · IAM role', on: true },
    { k: 'GCP', s: 'service-account.json', on: true },
    { k: 'GitHub', s: 'acme/payments-api', on: true },
    { k: 'Supabase', s: 'not connected', on: false },
  ]
  return (
    <div className="wt-mock wt-mock-conn">
      {rows.map((r) => (
        <div key={r.k} className={'wt-conn-row' + (r.on ? ' on' : '')}>
          <span className="wt-conn-k">{r.k}</span>
          <span className="wt-conn-s">{r.s}</span>
          <span className="wt-conn-badge">{r.on ? '● connected' : 'connect'}</span>
        </div>
      ))}
    </div>
  )
}

function PreviewRepair() {
  const steps = [
    { t: 'Clone acme/payments-api', d: 'done' },
    { t: 'Read ALB target health · logs', d: 'done' },
    { t: 'Patch /health timeout on RDS', d: 'run' },
    { t: 'Open pull request', d: 'wait' },
  ]
  return (
    <div className="wt-mock wt-mock-repair">
      {steps.map((s, i) => (
        <div key={i} className={'wt-step ' + s.d}>
          <span className="wt-step-dot" />
          <span className="wt-step-t">{s.t}</span>
          <span className="wt-step-b">{s.d === 'done' ? '✓' : s.d === 'run' ? 'running' : 'queued'}</span>
        </div>
      ))}
      <div className="wt-pr">→ PR #482 opened on a connected machine</div>
    </div>
  )
}

function PreviewCloud() {
  const cards = [
    { n: '48', l: 'resources' }, { n: '3', l: 'need attention' },
    { n: '$3,580', l: 'monthly spend' }, { n: '2', l: 'clouds' },
  ]
  return (
    <div className="wt-mock wt-mock-cloud">
      {cards.map((c) => (
        <div key={c.l} className="wt-kpi"><span className="wt-kpi-n">{c.n}</span><span className="wt-kpi-l">{c.l}</span></div>
      ))}
    </div>
  )
}

function PreviewTeam() {
  const people = [
    { n: 'Maya R.', r: 'Owner', i: 'MR' },
    { n: 'Dev K.', r: 'Channels · Cloud', i: 'DK' },
    { n: 'Sam P.', r: 'Machines · Repairs', i: 'SP' },
  ]
  return (
    <div className="wt-mock wt-mock-team">
      {people.map((p) => (
        <div key={p.n} className="wt-member">
          <span className="wt-av">{p.i}</span>
          <span className="wt-m-n">{p.n}</span>
          <span className="wt-m-r">{p.r}</span>
        </div>
      ))}
      <div className="wt-invite"><span>invite@teammate.com</span><b>Invite</b></div>
    </div>
  )
}

function PreviewSecurity() {
  const rows = ['Plan → approve → act on billable resources', 'Secrets never printed or logged', 'Scoped, short-lived cloud tokens', 'Every action checks membership']
  return (
    <div className="wt-mock wt-mock-sec">
      <div className="wt-shield">🛡</div>
      {rows.map((r, i) => <div key={i} className="wt-sec-row"><span className="wt-sec-check">✓</span>{r}</div>)}
    </div>
  )
}

function PreviewTips() {
  const chips = ['@nimbus', '⌘K search', 'Design → Agent', '“fix X, open a PR”', 'Switch project']
  return (
    <div className="wt-mock wt-mock-tips">
      {chips.map((c) => <span key={c} className="wt-chip">{c}</span>)}
    </div>
  )
}

/* ── Steps — the full walkthrough content (mirrors the old About sections) ───────── */

const STEPS = [
  {
    title: 'Welcome to Nimbus',
    preview: <PreviewChat />,
    body: (
      <>
        <p><strong>Nimbus</strong> is an AI-powered cloud control plane. Instead of switching between cloud consoles, terminals, CI dashboards and IaC files, you work in one place with an agent that can <strong>read your code, understand your architecture, act on real cloud credentials, and fix your repos</strong> — all through plain conversation.</p>
        <ul>
          <li><strong>Intent-driven operations</strong> — describe the outcome; Nimbus produces a plan, you approve it, it executes.</li>
          <li><strong>One shared workspace per project</strong> — channels, connections, machines, repairs and the canvas are shared; only your private chat stays personal.</li>
          <li><strong>Real execution, with evidence</strong> — every claim is grounded in something the agent read or ran, and every change is auditable.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Getting started',
    preview: <PreviewSteps />,
    body: (
      <>
        <p>Five steps take you from an empty workspace to a team that can design, deploy and repair together:</p>
        <ol>
          <li><strong>Connect a repository.</strong> Pick a project and connect a GitHub repo — the code @nimbus reads and repairs operate on.</li>
          <li><strong>Connect your clouds.</strong> Open <strong>Connections</strong> and link AWS and/or GCP. Overview, Resources and Cost then show live data.</li>
          <li><strong>Chat with Nimbus.</strong> Ask it to design or explain; toggle the <strong>Canvas</strong> to see the architecture render live.</li>
          <li><strong>Connect a machine.</strong> In <strong>Repairs</strong>, generate a key and run one command on a laptop or CI runner.</li>
          <li><strong>Invite your team.</strong> Open <strong>Members</strong>, invite by email, and choose what each can access.</li>
        </ol>
      </>
    ),
  },
  {
    title: 'Chat with Nimbus',
    preview: <PreviewCanvas />,
    body: (
      <>
        <p>The <strong>Chat</strong> is your direct line to the agent, with session history and two modes:</p>
        <ul>
          <li><strong>Design mode</strong> — Nimbus sketches architecture on the canvas without touching any real cloud. Ask <em>“Design a cheap, production-ready API on AWS”</em> and watch nodes appear.</li>
          <li><strong>Agent mode</strong> — Nimbus operates the real clouds: inspect inventory, read logs, estimate cost, deploy the design and open PRs.</li>
        </ul>
        <p className="wt-tip">Your chat history is the one thing that stays private to you — everything else in the project is shared.</p>
      </>
    ),
  },
  {
    title: 'Channels & machines',
    preview: <PreviewChannels />,
    body: (
      <>
        <p>The <strong>Channels</strong> view is a team workspace where Nimbus is a member:</p>
        <ul>
          <li><strong>Channels</strong> — Slack-style rooms. Talk to teammates normally; <strong>@mention nimbus</strong> to bring the agent in — it reads your code, PRs and cloud before answering.</li>
          <li><strong>Computers</strong> — every machine connected to the project. Click one to <strong>talk to its Claude Code directly</strong>.</li>
          <li><strong>Activity</strong> — a clickable feed of resources managed and repairs run (with PR links).</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Connect your code & clouds',
    preview: <PreviewConnect />,
    body: (
      <>
        <p>Open <strong>Connections</strong> (plug icon) to link everything Nimbus acts on:</p>
        <ul>
          <li><strong>AWS</strong> — access keys or an IAM role, with short-lived STS tokens.</li>
          <li><strong>GCP</strong> — service-account JSON or “Connect with Google”.</li>
          <li><strong>GitHub, Supabase, Neon</strong> — repos and databases the agent can read and operate.</li>
        </ul>
        <p>In a shared project these connections are <strong>shared</strong> — connect once and the whole team operates on them.</p>
      </>
    ),
  },
  {
    title: 'Repairs (shared compute)',
    preview: <PreviewRepair />,
    body: (
      <>
        <p>The <strong>Repair</strong> tab turns Nimbus into a hands-on engineer that fixes your code on a real machine:</p>
        <ol>
          <li>Connect a machine with <strong>Claude Code</strong>, <code>git</code> and <code>gh</code> installed — generate a key and run <code>nimbus start &lt;key&gt;</code>.</li>
          <li>Describe the fix, pick the machine and the model (Opus / Sonnet / Haiku).</li>
          <li>Nimbus <strong>drives it turn-by-turn</strong> — steps stream live; steer, compact or stop.</li>
          <li>When done it pushes a branch and <strong>opens a PR</strong>.</li>
        </ol>
        <p>Machines are pooled per project, so any member can run a repair on any connected machine.</p>
      </>
    ),
  },
  {
    title: 'Cloud, Resources & Cost',
    preview: <PreviewCloud />,
    body: (
      <>
        <p>Once a cloud is connected, the dashboard shows live, project-scoped data:</p>
        <ul>
          <li><strong>Overview</strong> — resources managed, what needs attention, clouds connected, plus live logs and telemetry.</li>
          <li><strong>Resources</strong> — the real AWS/GCP inventory; click any resource to inspect or edit its live config.</li>
          <li><strong>Cost</strong> — actual spend from AWS Cost Explorer / GCP billing export.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Shared projects & members',
    preview: <PreviewTeam />,
    body: (
      <>
        <p>A project is a <strong>shared workspace</strong>. Open <strong>Members</strong> (people icon) to manage access:</p>
        <ul>
          <li><strong>Invite by email</strong> — existing accounts join instantly; others get a pending invite.</li>
          <li><strong>Roles</strong> — the owner can invite/remove, set permissions and delete the project.</li>
          <li><strong>Per-member permissions</strong> — toggle Channels, Machines &amp; repairs, and Cloud &amp; resources individually.</li>
        </ul>
        <p>Everything is shared <strong>except each person's private Nimbus chat history.</strong></p>
      </>
    ),
  },
  {
    title: 'Security & privacy',
    preview: <PreviewSecurity />,
    body: (
      <>
        <p>Nimbus is designed for production-grade safety:</p>
        <ul>
          <li><strong>Plan-then-act</strong> — never creates, scales or deletes a billable resource without a plan and explicit confirmation.</li>
          <li><strong>No secret leakage</strong> — credentials, keys and tokens are never printed, logged or returned.</li>
          <li><strong>Scoped execution</strong> — cloud MCPs run with only the project's credentials; tokens are short-lived.</li>
          <li><strong>Membership-enforced access</strong> and a server-side <strong>audit trail</strong> for every action.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Tips & shortcuts',
    preview: <PreviewTips />,
    body: (
      <>
        <ul>
          <li>Type <strong>@nimbus</strong> in any channel to invoke the agent.</li>
          <li>Use <strong>⌘K</strong> to search across channels, chats and machines.</li>
          <li><strong>Design mode</strong> to sketch, <strong>Agent mode</strong> to deploy.</li>
          <li>Ask the chat to <em>“fix X in the repo and open a PR”</em> — it runs a real repair.</li>
          <li>Switch projects from the dropdown; each has its own repo, channels, clouds and members.</li>
        </ul>
        <p className="wt-tip">Need more? Ask <strong>@nimbus</strong> in any channel, or see <code>cli/README.md</code> for worker setup.</p>
      </>
    ),
  },
]

export default function WelcomeTour({ userId, onClose }) {
  const [i, setI] = useState(0)
  const bodyRef = useRef(null)
  const last = i === STEPS.length - 1
  const step = STEPS[i]

  // Reset scroll to top on each step change.
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0 }, [i])

  // Esc dismisses; ←/→ navigate.
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight' && !last) setI((n) => Math.min(n + 1, STEPS.length - 1))
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last])

  const close = () => { markWelcomeSeen(userId); onClose?.() }

  return createPortal(
    <div className="wt-scrim" onClick={close}>
      <div className="wt-card" onClick={(e) => e.stopPropagation()}>
        <div className="wt-preview" key={i}>
          {step.preview}
          <button className="wt-x" onClick={close} aria-label="Close">✕</button>
        </div>

        <div className="wt-body">
          <div className="wt-dots">
            {STEPS.map((_, n) => (
              <button key={n} className={'wt-pip' + (n === i ? ' on' : '')} onClick={() => setI(n)} aria-label={`Step ${n + 1}`} />
            ))}
          </div>
          <h2 className="wt-title" key={'t' + i}>{step.title}</h2>
          <div className="wt-copy" ref={bodyRef} key={'c' + i}>{step.body}</div>

          <div className="wt-foot">
            <span className="wt-count">{i + 1} / {STEPS.length}</span>
            <div className="wt-btns">
              {i > 0 && <button className="wt-btn ghost" onClick={() => setI(i - 1)}>Previous</button>}
              <button className="wt-btn primary" onClick={() => (last ? close() : setI(i + 1))}>
                {last ? 'Get started' : 'Next →'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
