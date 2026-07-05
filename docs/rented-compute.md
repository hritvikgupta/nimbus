# Rented Compute + Validation + Memory — hosted machines for Nimbus

> **Status:** plan / not yet built.
> **One-liner:** when no teammate machine is online (or as a paid perk), Nimbus boots its own
> cloud machine, clones the repo, fixes the bug / does the task, **validates it**, opens a PR, and
> tears the machine down — while **persisting memory** so the next session (on a fresh machine)
> knows what was fixed and where. To the rest of the system a rented machine is *just another worker*.

---

## 1. Why

Today Nimbus runs every repair/session on **pooled real machines** — a teammate runs `nimbus start`
and their installed Claude Code does the work. That is the product's differentiator (distributed team
compute, real creds, zero infra). Two gaps:

1. **No machine online → nothing can run.** The user is blocked until someone connects a machine.
2. **Ephemeral machines have no memory.** A torn-down VM forgets everything it learned about the repo.

This plan closes both **without changing the core bet**: pooled real machines stay the default;
rented cloud is the *fallback / paid convenience*; memory lives **outside** the machine so it survives
teardown and is **shared across the project team**.

Same pattern as **Amika Cloud** (managed micro-VMs) — implemented through Nimbus's pooled-worker
model rather than being the headline.

---

## 2. The end-to-end flow (what a rented run does)

```
user / incident asks for a fix
  → no machine online? subscribed? → PROVISION a rented machine
  → SessionStart: restore project MEMORY onto the machine
  → clone the project's connected repo (e.g. hritvikgupta/stax)
  → Claude Code does the task (fix bug / add feature / refactor)
  → COMMIT on a branch
  → VALIDATION LOOP: run tests / typecheck / lint
        fail → feed failures back to Claude → fix → re-run   (capped)
        pass ↓
  → push branch, OPEN PR
  → update repo CLAUDE.md + server repair ledger
  → SessionEnd: sync MEMORY back to the canonical store
  → card lands in "Waiting for review" (genuinely green)
  → DESTROY the machine
```

Everything except provisioning + memory-sync already exists in the worker bridge.

---

## 3. Where it runs

A rented machine is just a worker we provision instead of a human running `nimbus start`. It
registers in the **machine roster** like `ibi-verma-004`, labeled **"Nimbus Cloud (rented)"**, and
`dispatch_repair`, the **Sessions board**, the **direct-session chat**, and the validation loop all
work against it **unchanged**.

| Option | Fit | Verdict |
| --- | --- | --- |
| **Fly Machines** | Firecracker micro-VMs, REST API to boot/destroy, ~seconds to start, per-second billing. We **already run on Fly**. Rented machine = a Fly Machine running our worker image. | **Primary** ✅ |
| E2B / Daytona | Purpose-built agent sandboxes — but a second vendor doing what Fly already does for us. | Alt |
| Modal | Great for bursty jobs, more function-shaped than a long-lived interactive box. | Niche |
| AWS (EC2 + Bedrock) | Most control + enterprise story, most plumbing, slowest to ship. See §7. | Enterprise tier |

**Decision:** Fly Machines as the default rented backend (fast per-task boot, cheap idle teardown,
we know the platform); **AWS as the enterprise tier** (§7).

```
┌────────────────────────────┐
│  Nimbus API (Fly)          │
│  dispatch repair  ─────────┼──── no machine online + subscribed ──┐
│  worker bridge (poll/SSE)  │                                      ▼
│        ▲ same protocol     │                       ┌───────────────────────────┐
│        │                   │                       │ Provisioner               │
└────────┼───────────────────┘                       │  • boot Fly Machine        │
         │ rented machine connects back like         │    (worker image baked in) │
         │ any worker, runs the flow in §2           │  • inject worker key+creds  │
         └───────────────────────────────────────────┤  • restore project memory   │
                                                      │  • idle/SessionEnd → destroy│
                                                      └───────────────────────────┘
```

---

## 4. Trigger logic ("if offline, rent one") + subscription

On dispatch, check the roster:

- **A machine is online** → use it (free, real teammate compute — the default).
- **None online**:
  - **Subscribed** → offer / auto-run on a **Nimbus Cloud machine**.
  - **Not subscribed** → the current "Connect a machine" prompt.

Per-project **policy**: `prefer-mine` (default — use my machines, fall back to rented), `always-rented`
(don't depend on anyone being online), `never-rented` (today's behavior).

| Tier | Compute |
| --- | --- |
| **Free / BYO** | Pool your own + teammates' machines. No rented compute. |
| **Pro (subscribed)** | Rented Nimbus Cloud machines when none online, N parallel, priority. |
| **Enterprise** | Dedicated/warm pool, AWS backend (§7), more parallelism. |

Meter by **machine-minutes** (closest to true cost) with a generous included monthly allotment. Hard
idle timeouts + per-tier minute caps + per-task ceilings so a runaway loop can't burn money.

---

## 5. Validation loops (only surface passing work)

Inspired by Amika's validation loops; rides entirely on the existing turn-by-turn worker drive.

**What changes:** a PR / "Waiting for review" only happens **after the agent's change passes your
checks.** While looping, the card stays in **Running** with a sub-status ("Fixing failing tests 2/4").

```
Claude makes change → COMMIT → run validation suite
   fail → feed failures back to the same Claude session → fix → re-run (loop, capped)
   pass → push → open PR → "Waiting for review"
```

**Where checks come from (pick per project):**
1. **Auto-detected** from `package.json` etc. — `npm test`, `npm run lint`, `npm run typecheck`,
   `npm run build`. (Reuses the repo-overview/manifest logic.)
2. **Project-configured** — an explicit list of commands stored next to the connected repo.
3. **None** — opt out; behaves like today.

Default = **auto-detect with an override**.

**Guardrails:** loop cap (3–4 attempts); per-command timeout; stop conditions →
- pass all → **Done / PR ready**
- hit cap → **"Needs attention"** (new outcome, distinct from Done/Failed) with the last failing
  output — a human decides; do NOT silently mark Done.
- steerable mid-loop (you can already message a running repair: "skip e2e, just unit").

**UI (existing surfaces):** Sessions board card shows check chips ("✓ lint ✓ types ✗ tests — 2/4");
a new **"Needs attention"** state; the repair detail timeline gains `validate` phase entries; the PR
body notes "All N checks passing" — the trust signal that makes "Waiting for review" mean something.

---

## 6. Memory & continuity (how a fresh machine knows what it fixed and where)

The hard part of ephemeral machines: a torn-down VM loses `~/.claude`, the clone, and all local
memory. So **memory must live outside the machine** and be **shared per project** (consistent with
"everything in a shared project is shared except the private Nimbus chat").

### Two layers of memory

**Layer 1 — Project knowledge (durable):**
- **Repo `CLAUDE.md`** — the agent maintains a `CLAUDE.md` (or `.nimbus/memory.md`) in the repo:
  what changed, which files, why, conventions, gotchas. Claude Code **reads it natively** on start,
  and because it's committed it rides every clone on any machine for free. Stored in **GitHub** — no
  extra infra.
- **Server-side repair ledger** — each completed task records summary, files touched, PR link, root
  cause (extends the existing `conversations.mjs`). Used to compose a **context brief injected into a
  new session's opening prompt** ("Prior work: removed CSS animations from public/landing.html, PR #12…").

**Layer 2 — Session memory engine (rich history):**
- Use **[claude-mem](https://github.com/thedotmack/claude-mem)** (Apache 2.0, 46K★) baked into the
  worker image. It hooks Claude Code lifecycle events (SessionStart / UserPromptSubmit / PostToolUse /
  Stop / SessionEnd), captures observations + AI-compressed summaries, and injects relevant context
  into future sessions via a search skill with progressive disclosure.
- Markdown alternative if we want repo-committable memory:
  [kuitos/opencode-claude-memory](https://github.com/kuitos/opencode-claude-memory) (plain Markdown,
  simpler, less capable).

### Scope: per PROJECT, with per-user attribution

| Memory | Scope | Why |
| --- | --- | --- |
| claude-mem (codebase knowledge, repair history) | **Per project** (shared) | It's about the shared repo — everyone benefits |
| Repo `CLAUDE.md` | **Per project** (shared) | Lives in the repo, rides every clone |
| Server repair ledger | **Per project** (shared) | Team history of what was fixed |
| **Private Nimbus chat history** | **Per user** | The one thing that stays personal — unchanged |

Memory entries record **who** dispatched the work ("aayush's session added these observations") so the
shared store is still legible per-person.

### Where it's stored when the VM is deleted after every run

The VM only ever holds a **borrowed copy**. Canonical memory lives in durable storage:

```
VM (ephemeral)                 Nimbus canonical store (durable, yours)
~/.claude-mem/*.sqlite   ⇄     MemoryStore interface
 (always SQLite,               ├─ SQLite   (now)      ← single file, zero ops
  borrowed per run)            └─ Postgres (future)   ← same schema, same code
```

Per-run lifecycle:
```
boot VM
  → SessionStart hook: DOWNLOAD memory/<projectId> → ~/.claude-mem/   (restore)
  → run + validate (claude-mem updates local SQLite)
  → SessionEnd hook:   UPLOAD/MERGE ~/.claude-mem/ → canonical store  (persist)
destroy VM            (local copy dies; canonical copy already updated)
```

**Canonical backend:** **Fly Tigris** (Fly's S3-compatible object storage) or any S3/R2 bucket, keyed
`memory/<projectId>/…`; for v1 it can simply live on the **Nimbus API's persistent disk** next to the
existing JSON stores.

**Two stores, only one migrates:**
- claude-mem's own SQLite stays SQLite — it's the disposable on-machine working copy.
- **Our canonical store is built SQLite-now → Postgres-future**, behind a **`MemoryStore` repository
  interface** (same way `conversations.mjs` abstracts its file today). Use a builder/ORM that targets
  both (Drizzle/Knex/Prisma) and keep SQL standard. The future Postgres move is a driver swap, not a
  rewrite.

**Concurrency (must-handle):** memory is shared per project and we run multiple sessions at once, so
**do not blind-overwrite the blob** (last-write-wins loses data). Store **observations/ledger entries
as append-only rows/deltas** merged server-side — this both fixes the clobber problem and makes
SQLite→Postgres a non-event and gives per-user attribution for free. (Alternative: a short per-project
write-lock on upload.)

---

## 7. Enterprise tier — AWS reference architecture

For customers who want it in their own AWS account / on Bedrock. This is the EC2 pattern (request a
temporary per-user dev machine), which maps onto Phase 4.

```
User → Frontend → Backend provisioning API (Lambda / Fargate)
   → launch EC2 from Launch Template / AMI (Ubuntu, Git, Docker, Claude Code preinstalled)
   → per-user EC2 instance
   → User Data bootstrap: clone repo, install deps, start services
   → IAM Role / Instance Profile grants Bedrock access
   → Claude Code talks to Claude via Amazon Bedrock
   → EventBridge Scheduler stops/terminates at expiry
   → CloudWatch logs/metrics
```

**The idea worth stealing regardless of backend — credentials via IAM + Bedrock.** Instead of
injecting an Anthropic API key into a fresh VM, the machine's **IAM instance role** grants **Bedrock**
access and Claude Code talks to Claude *through Bedrock* — no key to mount, rotate, or leak. The
machine's identity *is* its permission. (Still need a **GitHub token** injected from the project's
connected GitHub; Bedrock only solves model auth, and it ties model access to Bedrock availability/
pricing rather than the Anthropic API.)

Why AWS/EC2 is the **enterprise** tier and not the default: EC2 cold boot is ~1–3 min (vs Fly's
seconds), heavier/costlier per machine, and the "rent for X hours" framing is a worse fit than
Nimbus's **per-task** dispatch. Fly stays primary; AWS is for customers who require their own
account/Bedrock.

---

## 8. What we actually need to build

1. **Provisioner service** — boots a Fly Machine from a prebuilt **worker image** (Claude Code + git +
   gh + the `nimbus` worker CLI + **claude-mem** baked in), hands it a scoped worker key, points it at
   the API, idle/SessionEnd teardown. Optional small **warm pool** to kill cold start.
2. **Credential handling** — fresh VM has no human's Claude login. Needs an **Anthropic key** (ours,
   metered; or user's pushed key) **or Bedrock-via-IAM** (enterprise), plus a **GitHub token** from the
   project's connected GitHub. Store encrypted, inject at boot, never persist on the destroyed VM.
3. **Validation runner** (worker-side) — run the project's checks after the agent's commit, feed
   failures back, loop to cap, emit `validate` steps + the new "Needs attention" outcome.
4. **MemoryStore** — `load/append/merge` interface, SQLite now / Postgres later, append-only deltas;
   the SessionStart/SessionEnd sync of `~/.claude-mem/` keyed per project; the repo `CLAUDE.md` updater.
5. **Lifecycle + metering + subscription gating** — boot on demand, idle timeout, meter machine-minutes,
   per-tier caps, per-project policy.
6. **Roster integration** — rented machines register/deregister as virtual workers so all current UI
   "just works".

The agent logic, board, routing, and chat are **unchanged** — the new work is the **provisioner +
credentials + validation runner + memory sync + billing**, not the agent.

---

## 9. Phasing

- **Phase 1** — Provisioner boots one Fly Machine on demand, injects creds, restores/syncs project
  memory (claude-mem, SQLite), clones repo, runs a repair end-to-end, opens a PR, destroys on
  completion. Manual "Run on Nimbus Cloud" button when no machine is online.
- **Phase 2** — Validation loops (auto-detect + override) + the "Needs attention" board state.
- **Phase 3** — Subscription gating + metering + per-project policy; warm pool for low latency;
  N-parallel rented machines with safe concurrent memory merge.
- **Phase 4** — Enterprise: AWS/EC2 backend + Bedrock-via-IAM credentials, dedicated/warm pools.

---

## 10. Open decisions

- **Credentials model:** managed Anthropic key (metered, friction-free) vs bring-your-own (cheaper for
  us) vs Bedrock-via-IAM (enterprise). Likely **offer all three by tier**.
- **Validation default:** auto-detect from manifests vs require explicit declaration. Lean
  **auto-detect with override**.
- **Memory backend for v1:** Nimbus API disk (simplest) vs Fly Tigris/S3 from day one. Lean **API disk
  now**, object store when multi-region/scale demands it.
