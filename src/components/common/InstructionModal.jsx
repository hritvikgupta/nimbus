import { useState } from 'react'

const NimbusMark = (p) => (
  <svg width="20" height="20" viewBox="0 0 48 48" fill="none" {...p}>
    <path d="M14 34a8 8 0 0 1 .6-16 11 11 0 0 1 21-2A7.5 7.5 0 0 1 35 34H14z" fill="#111" />
    <circle cx="19" cy="27" r="1.7" fill="#fff" /><circle cx="26" cy="27" r="1.7" fill="#fff" />
  </svg>
)

const SECTIONS = [
  {
    id: 'overview',
    title: 'What is Nimbus',
    body: (
      <>
        <p><strong>Nimbus</strong> is an AI-powered cloud control plane. Instead of switching between cloud consoles, terminals, CI dashboards, and IaC files, you work in one place with an agent that can <strong>read your code, understand your architecture, act on real cloud credentials, and fix your repos</strong> — all through plain conversation.</p>
        <p>It is built around three ideas:</p>
        <ul>
          <li><strong>Intent-driven operations</strong> — describe the outcome you want; Nimbus produces a plan, you approve it, it executes.</li>
          <li><strong>One shared workspace per project</strong> — channels, cloud connections, machines, repairs and the architecture canvas are all shared with your teammates. Only your private chat with Nimbus stays personal.</li>
          <li><strong>Real execution, with evidence</strong> — every claim is grounded in something the agent actually read or ran (a file, a log, a live resource), and every change is auditable.</li>
        </ul>
        <p className="cc-help-tip">Think of Nimbus as a senior platform engineer that lives inside your team chat — one that can design infrastructure, deploy it, watch it, and repair the code behind it.</p>
      </>
    ),
  },
  {
    id: 'getting-started',
    title: 'Getting started',
    body: (
      <>
        <p>Five steps take you from an empty workspace to a team that can design, deploy and repair together:</p>
        <ol>
          <li><strong>Connect a repository.</strong> In the sidebar, pick a project and connect a GitHub repo. This is the code @nimbus reads, the Files tab browses, and repairs operate on.</li>
          <li><strong>Connect your clouds.</strong> Open <strong>Connections</strong> (plug icon) and link AWS and/or GCP. Once connected, Overview, Resources and Cost show live data and the agent can act on them.</li>
          <li><strong>Chat with Nimbus.</strong> Open the Chat (the Nimbus home), and ask it to design or explain. Toggle the <strong>Canvas</strong> to see the architecture render live.</li>
          <li><strong>Connect a machine.</strong> In <strong>Repairs</strong> (wrench) or the Computers list, generate a key and run one command on a laptop or CI runner. That machine can now run real repairs with Claude Code.</li>
          <li><strong>Invite your team.</strong> Open <strong>Members</strong> (people icon), invite teammates by email, and choose what each can access. Everyone shares the same project.</li>
        </ol>
      </>
    ),
  },
  {
    id: 'chat',
    title: 'Chat with Nimbus',
    body: (
      <>
        <p>The <strong>Chat</strong> is your direct line to the Nimbus agent. It keeps a history of sessions (the <em>New chat</em> + chats dropdown) and runs in two modes:</p>
        <ul>
          <li><strong>Design mode</strong> — Nimbus sketches architecture on the canvas without touching any real cloud. Ask <em>"Design a cheap, production-ready API on AWS"</em> and watch nodes appear (load balancer → app → database → cache).</li>
          <li><strong>Agent mode</strong> — Nimbus operates the real clouds: inspect inventory, read logs and telemetry, estimate cost, deploy the design, and open PRs. It defaults to Agent mode once a design exists.</li>
        </ul>
        <p>Click <strong>Canvas</strong> (top-right) to open the architecture split-view; the sidebar tucks away to give it room. The chat can also <strong>spin a real repair</strong>: ask it to fix or build something in your repo and it will ask which machine + model, then dispatch it.</p>
        <p className="cc-help-tip">Your chat history here is the one thing that stays private to you — everything else in the project is shared.</p>
      </>
    ),
  },
  {
    id: 'channels',
    title: 'Channels & machines',
    body: (
      <>
        <p>The <strong>Channels</strong> view is a team workspace where Nimbus is a member:</p>
        <ul>
          <li><strong>Channels</strong> — Slack-style rooms (e.g. <code>#general</code>, <code>#code-debug</code>). Talk to teammates normally; <strong>@mention nimbus</strong> to bring the agent in. It reads your code, PRs and cloud before answering.</li>
          <li><strong>Computers</strong> — every machine connected to the project. Click one to <strong>talk to its Claude Code directly</strong> (no Nimbus agent in between) — a live coding session you can resume later.</li>
          <li><strong>Activity tab</strong> — a clickable feed of what's happening in the project: resources the agent manages and repairs it has run (with PR links).</li>
        </ul>
      </>
    ),
  },
  {
    id: 'repairs',
    title: 'Repairs (shared compute)',
    body: (
      <>
        <p>The <strong>Repair</strong> tab turns Nimbus into a hands-on engineer that fixes your code on a real machine:</p>
        <ol>
          <li>Connect a machine (your laptop or a CI runner) — it needs <strong>Claude Code</strong>, <code>git</code> and <code>gh</code> installed. Generate a key and run <code>nimbus start &lt;key&gt;</code>.</li>
          <li>Describe the fix or feature, pick the machine and the model (Opus / Sonnet / Haiku).</li>
          <li>Nimbus dispatches the task; the machine clones the repo and runs Claude Code headless.</li>
          <li><strong>Nimbus drives it turn-by-turn</strong> — steps stream live, you can send steering messages, compact the context, or stop.</li>
          <li>When done, it pushes a branch and <strong>opens a PR</strong> with the change.</li>
        </ol>
        <p>Because machines are pooled per project, any member can run a repair on any connected machine. Every conversation, step and result is persisted for audit.</p>
      </>
    ),
  },
  {
    id: 'cloud',
    title: 'Cloud, Resources & Cost',
    body: (
      <>
        <p>Once a cloud is connected, the dashboard sections show live, project-scoped data:</p>
        <ul>
          <li><strong>Overview</strong> — resources managed, what needs attention, clouds connected, plus live logs and telemetry panels.</li>
          <li><strong>Resources</strong> — the real inventory across AWS/GCP for this project; click any resource to inspect or edit its live config.</li>
          <li><strong>Cost</strong> — actual spend pulled from AWS Cost Explorer / GCP billing export.</li>
          <li><strong>Connections</strong> — link AWS (keys or IAM role), GCP (service-account JSON or "Connect with Google"), GitHub, Supabase, Neon.</li>
        </ul>
        <p>In a shared project these clouds are <strong>shared</strong> — connect once and the whole team operates on them. If a section is empty, it usually means nothing is provisioned in the connected account yet.</p>
      </>
    ),
  },
  {
    id: 'members',
    title: 'Shared projects & members',
    body: (
      <>
        <p>A project is a <strong>shared workspace</strong>. Open <strong>Members</strong> (people icon) to manage who's in it and what they can do:</p>
        <ul>
          <li><strong>Invite by email.</strong> If they have a Nimbus account they join instantly; otherwise it's a pending invite that activates when they sign up with that email.</li>
          <li><strong>Roles.</strong> The <em>owner</em> can invite/remove members, set permissions, and delete the project. <em>Members</em> use everything they're granted.</li>
          <li><strong>Per-member permissions.</strong> Toggle <strong>Channels</strong>, <strong>Machines &amp; repairs</strong>, and <strong>Cloud &amp; resources</strong> individually, and see exactly which channels, machines and resources each person can reach.</li>
        </ul>
        <p>Everything in the project is shared — channels, AWS/GCP, machines, repairs, the canvas — <strong>except each person's private Nimbus chat history.</strong></p>
      </>
    ),
  },
  {
    id: 'security',
    title: 'Security & privacy',
    body: (
      <>
        <p>Nimbus is designed for production-grade safety:</p>
        <ul>
          <li><strong>Plan-then-act</strong> — the agent never creates, scales, modifies or deletes a billable resource without showing a plan and getting explicit confirmation. Reads are autonomous; writes are confirmed.</li>
          <li><strong>No secret leakage</strong> — credentials, keys, tokens and connection strings are never printed in chat, logged, or returned in API responses.</li>
          <li><strong>Scoped execution</strong> — cloud MCPs run with only the project's credentials; short-lived AWS STS / GCP tokens refresh transparently.</li>
          <li><strong>Membership-enforced access</strong> — every project-scoped action checks membership and per-member permissions on the server, not just the UI.</li>
          <li><strong>Audit trail</strong> — repairs, deployments and chat sessions are persisted server-side.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'tips',
    title: 'Tips & shortcuts',
    body: (
      <>
        <ul>
          <li>Type <strong>@nimbus</strong> in any channel to invoke the agent.</li>
          <li>Use <strong>Design mode</strong> to sketch before you build; switch to <strong>Agent mode</strong> to deploy.</li>
          <li>Ask the chat to <em>"fix X in the repo and open a PR"</em> — it will run a real repair on a connected machine.</li>
          <li>Switch projects from the dropdown; each project has its own repo, channels, clouds and members.</li>
          <li>Repairs need a machine with Claude Code, <code>git</code> and <code>gh</code> installed and signed in.</li>
        </ul>
      </>
    ),
  },
]

export default function InstructionModal({ onClose, onReplayTour }) {
  const [active, setActive] = useState(SECTIONS[0].id)

  return (
    <div className="cc-help-modal-scrim" onClick={onClose}>
      <div className="cc-help-modal" onClick={e => e.stopPropagation()}>
        <header className="cc-help-header">
          <div className="cc-help-brand">
            <span className="cc-help-mark"><NimbusMark /></span>
            <div>
              <div className="cc-help-title">About Nimbus</div>
              <div className="cc-help-sub">Your AI-powered cloud control plane — design, deploy, monitor &amp; repair</div>
            </div>
          </div>
          <button className="cc-help-close" onClick={onClose}>✕</button>
        </header>

        <div className="cc-help-body">
          <nav className="cc-help-nav">
            {SECTIONS.map(s => (
              <button key={s.id} className={'cc-help-nav-item' + (active === s.id ? ' on' : '')} onClick={() => setActive(s.id)}>
                <span>{s.title}</span>
              </button>
            ))}
          </nav>
          <div className="cc-help-content" key={active}>
            <h2 className="cc-help-h2">{SECTIONS.find(s => s.id === active)?.title}</h2>
            {SECTIONS.find(s => s.id === active)?.body}
          </div>
        </div>

        <footer className="cc-help-footer">
          Need more help? Ask <strong>@nimbus</strong> in any channel, or see <code>cli/README.md</code> for the worker setup.
          {onReplayTour && (
            <> · <button className="cc-help-replay" onClick={onReplayTour}>Replay walkthrough</button></>
          )}
        </footer>
      </div>
    </div>
  )
}
