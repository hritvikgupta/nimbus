# Tier 2 — Professional polish & scale

> Once you're safely charging clients, these make operations professional and let you grow.

---

## 2.1 — Observability
- [ ] Structured logging with **Pino** (JSON, request IDs, userId), ship to **BetterStack**/Datadog.
- [ ] Uptime monitoring (health-check pings) via BetterStack/Checkly.
- [ ] Public **status page** (Instatus/BetterStack).
- [ ] Basic dashboards + alerts (error rate, latency, agent failures, cloud-action failures).

**Acceptance:** you're alerted *before* clients report an outage.

---

## 2.2 — Product analytics
- [ ] **PostHog** — track activation funnel (signup → connect cloud → first agent action), feature usage, retention.
- [ ] Respect consent + privacy (no PII leakage).

**Acceptance:** you can see where clients drop off.

---

## 2.3 — CI/CD + tests + staging
- [ ] Automated test suite (unit + a few E2E on the critical paths: auth, connect, agent).
- [ ] **GitHub Actions**: lint + test + build on PR; deploy on merge.
- [ ] A **staging** Fly app mirroring prod for pre-release testing.

**Acceptance:** merges deploy automatically; broken builds are blocked.

---

## 2.4 — Postgres migration (multi-machine scale)
SQLite is single-machine. To run 2+ app instances behind a load balancer:
- [ ] Swap `store.mjs` internals for **Postgres** (Neon/Fly PG). Interface stays sync-compatible or move hot paths async as needed.
- [ ] Move sessions + MCP-connection coordination to shared state (PG/Redis).
- [ ] Set `min_machines_running ≥ 2`, enable autoscaling.

**Acceptance:** app runs on ≥2 machines with no session/data inconsistency.

---

## 2.5 — Agent resilience & cost efficiency
- [ ] Retries + timeouts + circuit breakers around LLM and cloud APIs.
- [ ] Graceful degradation when a provider is down (fallback models already exist — extend).
- [ ] Token/cost telemetry per run; optimize prompts/tools.

**Acceptance:** provider hiccups don't crash user sessions.

---

## 2.6 — Support & lifecycle
- [ ] Support channel (Intercom/Plain/Crisp) + in-app "contact support."
- [ ] Public **changelog** + in-app "what's new."
- [ ] Onboarding checklist / product tour for new clients.

**Acceptance:** clients can get help and see progress without emailing you directly.

---

## 2.7 — Enterprise & compliance (when asked)
- [ ] **SSO/SAML** via **WorkOS**.
- [ ] **SOC 2 Type II** roadmap (Vanta/Drata).
- [ ] **GDPR/CCPA** data-subject request tooling (export/delete).
- [ ] Role-based access control refinements per project.

**Acceptance:** you can answer an enterprise security questionnaire.

---

### Exit criteria for Tier 2
Monitored, analyzed, CI/CD'd, horizontally scalable, supportable, and enterprise-ready on request.
