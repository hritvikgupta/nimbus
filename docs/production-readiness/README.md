# Nimbus — Production Readiness

> **Goal:** take Nimbus from "working demo" to "safe to hand to paying clients."
> **Context that raises the bar:** Nimbus holds clients' **real AWS/GCP credentials** and runs an
> **AI agent that can change their cloud**. So security & cost-control items are hard blockers, not
> polish.

This folder breaks the work into three tiers. Do them in order.

| Tier | Meaning | File |
|------|---------|------|
| **Tier 0** | Blockers — nothing external connects until these are done | [tier-0-blockers.md](./tier-0-blockers.md) |
| **Tier 1** | Needed for the first *paying* clients | [tier-1-paying-clients.md](./tier-1-paying-clients.md) |
| **Tier 2** | Professional polish & scale | [tier-2-polish-scale.md](./tier-2-polish-scale.md) |
| **Deploy** | Backend deploy architecture on Fly (multi-user) — for Tier 1.6 | [backend-deploy-arch.md](./backend-deploy-arch.md) |

## Already done ✅
- **SQLite storage** (`server/repositories/store.mjs`) — concurrency-safe, replaces flat JSON files. Tested: 20 parallel signups, restart-persistence, migration integrity.
- **Idle MCP eviction** (`server/libs/mcp.mjs`) — bounds subprocess memory under many users.
- **Signup gating** — `VITE_ALLOW_SIGNUP=false` hides registration on the public build.
- **Landing + docs deployed** on Fly (static, scale-to-zero).

## Known issues found in code (drive Tier 0)
1. **Cloud credentials stored in plaintext** — `server/repositories/connections.mjs` `setConnection()` writes `accessKeyId`/`secretAccessKey` unencrypted. → Tier 0, step 1.
2. **No rate limiting / security headers / CORS lockdown** in the app server. → Tier 0.
3. **No cost quotas** on agent runs (LLM + cloud spend). → Tier 0.
4. **billing.mjs is a stub** (no Stripe). → Tier 1.

## Status board
Update the checkboxes in each tier file as we go. High-level:

- 🟢 **Tier 0 — 5 done, 1 pending, 2 removed:**
  - [x] 0.1 Encrypt cloud creds · ❌ 0.2 Rate limiting (removed) · ❌ 0.3 Cost quotas (removed) · [x] 0.4 Headers/cookies
  - [x] 0.5 Secrets (`.gitignore` + `.env.example`; Fly secrets pending deploy) · [ ] 0.6 Sentry (needs DSN)
  - [x] 0.7 Backups (local; off-box pending deploy) · [x] 0.8 Signup API locked
- [ ] Tier 1 complete → safe to charge money
- [ ] Tier 2 complete → scales + professional operations

**New files this pass:** `server/libs/crypto.mjs`, `server/middlewares/ratelimit.mjs`,
`server/repositories/quota.mjs`, `server/scripts/backup-db.mjs`, `.gitignore`, `.env.example`.

## Tooling picks (what pro apps use)
Errors **Sentry** · Billing **Stripe** · Email **Resend** · Analytics **PostHog** ·
Logs/uptime **BetterStack** · Secrets **Doppler / Fly secrets** · WAF/CDN **Cloudflare** ·
Enterprise SSO **WorkOS**.
