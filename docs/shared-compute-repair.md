# Repair with Shared Compute

A distributed model for the Nimbus ops/repair agent: when a service goes down, the **fix** doesn't
have to run on Nimbus's servers — it can run on a **team member's own machine**, driving the Claude
Code they already have installed. Nimbus stays the brain (detect → root-cause → decide); the member's
machine is the hands (clone → fix → open PR).

## Principles
1. **Nimbus is the brain; the worker is the hands.** The control plane decides *what's wrong and what
   to do*; the worker only *executes* via the already-installed Claude Code.
2. **Workers dial out, the server pushes.** Never depend on reaching a laptop by IP (NAT/firewall/
   dynamic IP). The worker holds an outbound connection (SSE in v1) and the server pushes tasks down it.
3. **Zero standing secrets on workers.** Every credential is per-task, scoped, and short-lived.
4. **The gate never moves.** The agent proposes a PR; humans merge; prod is never auto-mutated.
5. **Always have a fallback.** No worker online → run on Nimbus's own compute (current behavior).

## Components
- **Control Plane (Nimbus server)** — gains: *incident detector* (exists: scheduler + webhook + log
  reading), *ops orchestrator* (classify → map to project/repo → root-cause hypothesis), *dispatcher*
  (pick a worker, mint creds, push task, track), *context MCP endpoint* (read-only get_logs/
  list_resources/get_telemetry the executor pulls from, scoped per task).
- **Nimbus Worker** — a small daemon a member installs once. Registers + holds an outbound connection,
  receives a task, sandboxes, **drives the installed Claude Code headless**, streams results back. No
  agent logic of its own.
- **Executor** — the user's already-installed, already-logged-in **Claude Code** (headless), in a sandbox.

## Connection model
- Worker authenticates and opens a **persistent outbound stream** to the control plane (v1: SSE
  `GET /api/repair/worker/stream`; later WebSocket/gRPC). Heartbeats + auto-reconnect.
- Control plane keeps an **online roster**: `{ workerId, userId/teamId, projects[], hasClaudeCode, os,
  version, status, lastSeen }`.
- Dispatch = **push a task down the held-open stream**. (Special case: a static/in-VPC worker can also
  accept a direct webhook.)

## Nimbus ↔ Claude conversation (the driver model)
Nimbus does not fire a one-shot prompt at Claude and walk away, and it does not poll on a fixed timer.
For each repair, Nimbus holds a **real, continuous conversation** with the Claude running on the worker —
the SAME Nimbus ReAct agent (given a "pair with Claude" skill carrying the repo + chat/incident context),
running **async** so the user's live Nimbus chat on the frontend never blocks. The steps:

1. A request arrives — the user types it in Repairs, or an incident auto-fires from CloudWatch/GCP.
   Everything below runs **async server-side**; the user's frontend Nimbus chat is never blocked.
2. Nimbus (the same ReAct agent + a pairing skill, with repo + request context) starts a **dedicated
   conversation instance** for this repair.
3. Nimbus opens the conversation with Claude on the worker (over the bridge) — the first instruction,
   grounded in the actual repo and the request.
4. Claude works a turn and replies; the worker reports **Claude's reply** back to Nimbus.
5. Nimbus reads Claude's reply like a human pair and **responds** — continue, correct it, point it at a
   file, tell it to run the tests, etc. (decided by the agent from the repo + the reply, never hardcoded).
6. This repeats **turn by turn** (Nimbus driving Claude) until Nimbus judges the issue resolved — or
   decides to stop.
7. When resolved, Nimbus tells the worker to **finalize** → commit, push, open the PR.
8. Every turn streams to the Repairs panel; the user can also Stop or message Claude. Nothing blocks
   the frontend.

Implementation: the bridge carries `message` / `stop` / `done` down to the worker and `turn` reports up.
The conversation driver (`services/conversation.mjs`) maintains the running message history and calls the
real agent each turn (`runAgentChat` in `agents/chat/run.mjs`) — so it's a maintained conversation, not a
one-shot LLM call, on the same agent.

## Repair lifecycle
1. **Detect** — scheduler/webhook → orchestrator confirms incident, finds project→repo, pulls logs,
   forms a root-cause hypothesis, marks "needs code fix".
2. **Select** — dispatcher picks an online worker for that team/project that can serve the repo (else →
   central compute fallback).
3. **Mint** — short-lived GitHub token (PR scope, that repo only) + short-lived MCP context token
   (read-only cloud, this incident only).
4. **Push** — task envelope sent down the worker's open stream.
5. **Prep** — worker acks → spins a sandbox → clones repo → writes `.nimbus/incident.md` (+ `CLAUDE.md`).
6. **Run** — worker runs Claude Code headless: `plan` (read-only triage) → `acceptEdits` (apply), with
   `--mcp-config` pointing at Nimbus context; streams every step back up the stream.
7. **Fix** — executor: read/grep, pull live logs via MCP, edit, run tests, produce a diff.
8. **PR** — branch + `gh pr create` (short-lived token) with the root-cause writeup.
9. **Report** — final result + PR link streamed to the control plane → shown in the Code/Incident view;
   tokens revoked; sandbox destroyed.
10. **Human** — review + merge; the team's CI/CD deploys.

## Data shapes
- **Worker registration**: `{ workerId, userId, projects[], hasClaudeCode, os, version, status, lastSeen }`
- **Task envelope** (server → worker): `{ taskId, projectId, repo, ref, incident{ service, severity,
  logExcerpts[], hypothesis }, constraints{ prOnly, noSecrets, allowedTools[], permissionMode },
  mcp{ url, token, ttl }, github{ token, ttl }, timeoutSec }`
- **Result** (worker → server): `{ taskId, status, steps[], diff, prUrl, rootCause, costTokens, error? }`

## Security model
- **Per-task, short-lived creds** minted by the control plane; revoked on completion/timeout. GitHub =
  PR scope on the one repo; MCP = read-only, this incident only.
- **No cross-member leakage** — member A's machine never holds member B's secrets; nothing standing on disk.
- **Sandbox** — clone + agent run in a container/throwaway dir so a repair can't touch the volunteer's
  machine and runs are reproducible.
- **Gating preserved** — PR only; system prompt enforces "propose a PR, never merge/mutate prod, never
  print secrets," plus output redaction.
- **Privacy** — code is cloned only onto a teammate's machine (same org) and destroyed after; a policy
  decides which members may serve which repos.
- **BYO-Claude tradeoff** — repairs consume the worker's personal Claude quota (or Nimbus funds a key).

## Dispatch policy
- **Eligible** = online + can access the repo + opted-in + free capacity.
- **Preference** = idle/healthy; cap concurrent tasks/worker; queue per team.
- **Fallback chain** = preferred worker → any eligible worker → central Nimbus compute.
- **Resilience** = idempotent `taskId`; reassign on disconnect/timeout; if unfixable, still report the
  root cause + findings (no PR).

## Build order (vertical slices)
- **Phase 0 — done:** central ops agent → PR on Nimbus compute (the fallback + reference behavior).
- **Phase 1 — worker on your own machine (THIS slice):** the bridge (login via session token, outbound
  SSE, registration), sandbox + clone, drive Claude Code headless, stream results, open a PR. **Manual
  trigger** from the Code tab ("Run repair on a worker"). Proves the riskiest unknown: Nimbus driving
  headless Claude Code and getting a PR back.
- **Phase 2 — dispatch + safety:** roster + auto-select + central fallback; short-lived token minting;
  revoke-on-done; container sandbox.
- **Phase 3 — the pool:** multiple members, opt-in policy, load-balancing, OSS-agent option
  (OpenHands/Aider/goose) for members without Claude Code.

## Open decisions
1. BYO-Claude (member's quota) vs Nimbus-funded model cost.
2. Who may run whose repo (whole team vs only collaborators).
3. Sandbox tech — Docker required, or temp dir for v1?
4. Trigger — fully auto on incident, or human-approved dispatch for v1?

## Phase 1 — concrete implementation (in this repo)
- **Transport: SSE** (no new deps). Worker holds `GET /api/repair/worker/stream` open; server pushes
  tasks. Worker reports back via `POST /api/repair/worker/tasks/:id/event` and `.../result`. UI watches
  `GET /api/repair/tasks/:id/stream`.
- **Auth (v1):** the worker uses the member's **Nimbus session token** (`NIMBUS_TOKEN`) as the cookie,
  so everything is scoped to `req.user.id` — same isolation boundary as the rest of Nimbus. (Phase 2
  swaps this for a dedicated worker token + minted per-task creds.)
- **Executor:** `claude -p "<task>" --output-format stream-json --permission-mode acceptEdits
  --allowedTools "Read,Edit,Bash(git:*),Bash(gh:*),Bash(npm:*)"` run in the cloned repo dir. The worker
  parses the stream-json and forwards each step.
- **PR:** the worker does the git plumbing (`git checkout -b nimbus/fix-… && commit && push`) and
  `gh pr create`, using the machine's `gh` auth (v1) — later a minted token.
- **Files:** server `services/repair.mjs` + `routes/repair.mjs`; worker `worker/nimbus-worker.mjs`
  (run with `npm run worker`); UI repair panel in the Code tab.
