# Tier 1 — Needed for the first paying clients

> After Tier 0 is safe, these make it a real product you can charge for and operate.

---

## 1.1 — Billing (Stripe)
`server/services/billing.mjs` is a stub today.
- [ ] Create Stripe products/prices (plans: e.g. Nimbus Pro / Plus — match the landing dropdown).
- [ ] `npm i stripe` — checkout session + customer portal endpoints.
- [ ] Webhook (`/api/webhooks/stripe`) → update subscription state in the store.
- [ ] Gate features/quotas by plan; handle trials, upgrades, cancellations, failed payments.

**Acceptance:** a test-mode subscription flows end-to-end and reflects in the app.

---

## 1.2 — Auth hardening
- [ ] **Email verification** on signup (unverified = limited access).
- [ ] **Password reset** (tokened link, expiry).
- [ ] **Session expiry + rotation**; "log out everywhere."
- [ ] **Account lockout / backoff** after repeated failed logins.
- [ ] (Optional) TOTP 2FA.

**Acceptance:** reset + verification flows work; sessions expire; lockout triggers.

---

## 1.3 — Transactional email
- [ ] Pick **Resend** (or Postmark). `npm i resend`.
- [ ] Templates: verify email, reset password, welcome, "PR/incident ready" notifications.
- [ ] Verify sending domain (SPF/DKIM on `trynimbus.dev`).

**Acceptance:** all lifecycle emails deliver to inbox (not spam).

---

## 1.4 — Audit log
Expected for any tool with cloud write access; builds trust.
- [ ] Append-only log of every cloud-mutating action: `{userId, action, target, plan, approvedBy, ts}`.
- [ ] Surface per-project in the UI ("Activity"/"Audit" view).
- [ ] Retain + export (CSV) for client compliance requests.

**Acceptance:** every approved cloud change produces an immutable audit entry.

---

## 1.5 — Legal
- [ ] **Terms of Service** + **Privacy Policy** (you process customers' cloud data — mandatory). Link in footer + signup.
- [ ] **DPA** template for enterprise clients.
- [ ] Data handling doc: what's stored, where, retention, deletion on request.

**Acceptance:** ToS/Privacy live and linked; deletion-on-request path defined.

---

## 1.6 — Deploy the backend properly
Only static landing/docs are deployed today.
- [ ] Dockerfile for the API that bundles Node + `uv`/`npx` + `server/mcp/*` (MCP runtimes).
- [ ] Fly app `nimbus-app`: health check, `NIMBUS_ENC_KEY` + secrets, volume for `nimbus.db` (or LiteFS).
- [ ] Point `app.trynimbus.dev` at it; wire `VITE_API_URL` in the frontend build.
- [ ] Smoke test: signup → connect cloud → agent action, end to end, in prod.

**Acceptance:** the full app works on your domain, not just localhost.

---

### Exit criteria for Tier 1
Billing works, auth is hardened, emails send, audit log records changes, legal is live, backend is deployed on your domain. → **safe to charge money.**
