# Backend Deploy Architecture (Fly, multi-user)

> How Nimbus runs on Fly for real clients. This is the plan for **Tier 1.6 (deploy the backend)**.
> **Status:** plan / not yet deployed. Only the static landing + docs are live today.

---

## The pieces

| Piece | What it is | State it holds |
|-------|-----------|----------------|
| **SPA** (frontend) | Vite/React static build (`dist/`) — landing + app | none (static files) |
| **API** (backend) | Express, `server/server.mjs`, port 8788 | **SQLite DB**, sessions, per-user **MCP subprocesses** |
| **Docs** | Next.js static export (`docs-site/out`) | none (static) |
| **Rented machines** | Fly machines the API spins up on demand | ephemeral, created/destroyed by the API |

The **API is the only stateful, always-on piece** — it owns the database and spawns a cloud-tool
subprocess per active user. Everything else is static or ephemeral.

---

## Topology (launch → low-hundreds of users)

```
                        trynimbus.dev
                             │
                    ┌────────▼─────────┐
   docs.trynimbus.dev│                 │  (same origin: SPA + /api)
        ┌────────────┤   nimbus-api    │◄──── clients' browsers
        │            │  (Express)      │      cookies "just work"
 ┌──────▼──────┐     │                 │
 │ nimbus-docs │     │  serves dist/   │
 │  (static)   │     │  + /api/*       │
 │ scale-to-0  │     │                 │
 └─────────────┘     │  ┌───────────┐  │
                     │  │ SQLite on │  │   ← Fly Volume (persistent disk)
                     │  │  a Volume │  │
                     │  └───────────┘  │
                     │  spawns MCP     │
                     │  subprocesses   │──► clients' AWS / GCP
                     │  (uv/node/npx)  │
                     └────────┬────────┘
                              │ Fly API (provision)
                     ┌────────▼────────┐
                     │ rented machines │  ← created/destroyed on demand
                     │  (ephemeral)    │
                     └─────────────────┘
```

### Key decision: the API serves the SPA (same origin)
The frontend calls `/api/...` with **relative paths + cookies**. If the SPA and API share ONE
origin, cookies and auth work with **zero CORS config**. The alternative (SPA on one domain, API on
another) forces cross-site cookies (`SameSite=None`) + CORS — more fragile. So for launch:
**one `nimbus-api` app serves both the SPA and `/api`.** `nimbus-docs` stays separate (static,
scale-to-zero).

---

## Servers you need

**Launch (multi-user, single machine):**
1. **`nimbus-api`** — 1 always-on machine, **`shared-cpu-2x` / 2–4 GB** (bigger than the static
   apps because of the MCP subprocesses), `min_machines_running = 1` (holds the DB → can't
   scale to zero), **a Fly Volume** mounted at `server/.data` for `nimbus.db`.
2. **`nimbus-docs`** — the static app already deployed.
3. Secrets set via `fly secrets` (never in the image).

No Postgres / Redis needed yet — SQLite on the volume serves many users on a single machine.

---

## How it scales to multiple users

- **One machine handles many users now:** each user is isolated by `req.user.id`; SQLite handles
  concurrent writes safely; idle MCP eviction keeps subprocess memory bounded.
- **The ceiling:** SQLite lives on that one machine's disk, and sessions/subprocesses live in that
  one process → you can run exactly **one** API machine. Good for **dozens → low-hundreds** of users.
- **To go past that** (multiple API machines behind the load balancer) = **Tier 2.4**: swap
  SQLite → **Postgres** (Neon/Fly PG) + move sessions to **Redis**, then `min_machines_running ≥ 2`.
  Premature until the users exist — don't do it now.

---

## The hard part: building the API image

The static apps were nginx + files. The API image is heavier because the agent shells out to real
cloud tools:
- Needs **Node** + **`uv`/`uvx`** (AWS MCP) + **`npx`** (Neon/Supabase MCP) + the cloned
  **`server/mcp/*`** servers baked in.
- Needs a **Fly Volume** at `server/.data` so the SQLite DB persists across deploys/restarts.
- Needs egress to AWS/GCP/LLM providers (default on Fly).

So the Dockerfile is a real multi-step build (install uv, node deps, copy MCP dirs), not a
4-line static image.

---

## Secrets to set on Fly (`fly secrets set ...`)
Move these out of `.env`:
- `NIMBUS_ENC_KEY` (credential encryption master key)
- `COMPOSIO_API_KEY` (GitHub connections)
- `DATABRICKS_HOST` / `DATABRICKS_TOKEN` / `DATABRICKS_MODEL` **or** `OPENROUTER_API_KEY` (LLM)
- `FLY_API_TOKEN` (provision rented machines)
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (GCP OAuth)
- `NODE_ENV=production`, `ALLOW_SIGNUP=false`, `APP_URL=https://trynimbus.dev`

---

## Domains / DNS
- `trynimbus.dev` → **nimbus-api** (serves SPA + `/api`)
- `docs.trynimbus.dev` → **nimbus-docs**
(GoDaddy records already planned; A/AAAA at apex, CNAME for `docs`.)

---

## Deploy steps (when we execute)
1. Write the API **Dockerfile** (Node + uv + `server/mcp/*` + `dist/`).
2. Have Express serve the built **SPA** on the main host (same-origin) — alongside `/api` and the
   existing docs-on-`docs.*` handling.
3. Create the Fly app + **Volume** for `server/.data`; write `deploy/api/fly.toml`
   (`min_machines_running = 1`, 2–4 GB, volume mount).
4. `fly secrets set` all of the above.
5. `fly deploy`; point `trynimbus.dev` at it; verify the certs.
6. **Smoke test in prod:** signup(disabled)/login → connect a cloud → one agent action → PR/incident, end to end.
7. Finish the parked Tier 0 items here: **off-box DB backups** (schedule `npm run backup` → S3/R2) and confirm secrets are Fly-managed.

**Acceptance:** the full app works on `trynimbus.dev`, not just localhost, for multiple isolated users.
