# Tier 0 — Blockers

> Nothing external connects until every box here is checked. These protect clients' real cloud
> accounts and your bill.

---

## 0.1 — Encrypt cloud credentials at rest 🔴 (highest priority)
**Problem:** `connections.mjs` stores AWS/GCP keys in plaintext in the DB.
**Fix:** encrypt on write, decrypt on read, using AES-256-GCM with a master key from an env secret.

Steps:
- [x] Add `server/libs/crypto.mjs` — `encryptJson` / `decryptJson` using `node:crypto` AES-256-GCM, key = `NIMBUS_ENC_KEY` (32-byte, base64) from env (dev auto-generates + caches `.enckey`).
- [x] In `connections.mjs`: encrypt on `persist()`, decrypt on load. Call sites (`getConnections`/`setConnection`/`mcpEnvFor`) unchanged.
- [x] One-time migration: legacy plaintext detected on boot → re-encrypted automatically (`[connections] migrated plaintext credentials → encrypted at rest`).
- [x] Add `NIMBUS_ENC_KEY` to `.env`; `api` script loads it via `--env-file-if-exists`. _(TODO for prod: set as a Fly secret; document rotation.)_
- [x] Tested: DB row is ciphertext, no plaintext secret markers, all 9 users' creds still decrypt.

**Acceptance:** ✅ no plaintext `secretAccessKey` anywhere in the DB (verified by scanning the raw blob).

---

## 0.2 — Rate limiting  ❌ REMOVED (per user request)
Was built and working, then removed on request. `ratelimit.mjs` deleted, wiring removed.
If ever wanted back: `express-rate-limit` on `/api/auth/*` (per IP) + expensive endpoints (per user).

---

## 0.3 — Per-user cost quotas  ❌ REMOVED (per user request)
Was built and working, then removed on request. `quota.mjs` + `/api/usage` deleted, `quota.json` cleared.
If ever wanted back: per-user daily counter capping the expensive LLM/cloud endpoints.

---

## 0.4 — Security headers, CORS lockdown, secure cookies
- [x] `helmet` applied (CSP off — SPA served separately; keeps HSTS, nosniff, frameguard, referrer-policy).
- [x] CORS is opt-in via `CORS_ORIGINS` (same-origin by default — frontend uses relative `/api` paths, so no wildcard exposure).
- [x] Session cookie: `httpOnly`, `sameSite=lax`, `secure` in production, 30-day `maxAge`.
- [x] `app.set('trust proxy', 1)` for HTTPS/IP behind Fly.

**Acceptance:** ✅ security headers verified present (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy).

---

## 0.5 — Secrets management
- [x] `.env` gitignored (created `.gitignore` covering `.env*`, `server/.data/`, build output).
- [ ] Move prod secrets to **Fly secrets** (`fly secrets set ...`) — pending backend deploy (Tier 1.6).
- [x] Documented all required env vars in `.env.example`.

**Acceptance:** 🟡 secrets no longer committable; Fly-secrets step happens with the backend deploy.

---

## 0.6 — Error monitoring (Sentry)
- [ ] Create Sentry project (2 DSNs: frontend + backend).
- [ ] Backend: `@sentry/node` — capture unhandled errors + request context (userId, route).
- [ ] Frontend: `@sentry/react` — error boundary + source maps upload on build.
- [ ] Scrub PII/secrets from events (no creds in breadcrumbs).

**Acceptance:** a thrown test error appears in the Sentry dashboard, secrets redacted.

---

## 0.7 — Database backups
**Problem:** losing `server/.data/nimbus.db` = losing all clients.
- [x] `npm run backup` — consistent online snapshot (`server/scripts/backup-db.mjs`), timestamped, keeps newest `BACKUP_KEEP` (24).
- [x] Restore procedure documented (stop API → replace `nimbus.db`, remove `-wal`/`-shm` → start). Backup verified valid & restorable (25 collections, 21 users).
- [ ] Prod: schedule it (cron/Fly machine) + ship off-box to S3/R2 or use LiteFS — with backend deploy (Tier 1.6).

**Acceptance:** ✅ a documented, tested local backup+restore exists; off-box scheduling lands with the deploy.

---

## 0.8 — Lock the signup API server-side
Frontend already hides signup on the public build; close the API too.
- [x] `POST /api/auth/signup` gated behind `ALLOW_SIGNUP` env → `403 {"error":"Registration is closed."}` when `=false`.
- [ ] (Optional) invite-code path for controlled onboarding — later.

**Acceptance:** ✅ with `ALLOW_SIGNUP=false`, signup API returns 403; login still reachable.

---

### Exit criteria for Tier 0
All boxes checked + a short manual pen-test pass (no plaintext creds, limits enforced, errors captured, restore tested). → **safe to onboard a first trusted client.**
