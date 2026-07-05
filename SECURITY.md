# Security Policy

Nimbus operates on real cloud credentials and drives real infrastructure, so we take security
seriously. Thank you for helping keep it and its users safe.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report it privately:

- Use GitHub's [**Report a vulnerability**](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  (Security → Advisories) on this repository, **or**
- Email the maintainers at **security@yourdomain** *(replace with your real contact before publishing)*.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (proof-of-concept if possible).
- Affected version / commit.

We aim to acknowledge reports within **72 hours** and to provide a remediation timeline after
triage. Please give us a reasonable window to fix the issue before any public disclosure.

## Scope

Of particular interest:

- Leakage of credentials, keys, tokens, or connection strings (in chat, logs, or API responses).
- Bypass of per-user / per-project isolation (`req.user.id` scoping).
- Bypass of the plan-then-confirm gate on billable cloud actions.
- Bypass of membership-enforced access controls.
- Weaknesses in credential-at-rest encryption (AES-256-GCM via `NIMBUS_ENC_KEY`).

## Handling secrets in your own deployment

- Set a strong, unique `NIMBUS_ENC_KEY` (base64 32 bytes) and keep it only in the environment.
- Never commit a real `.env` — it is gitignored; `.env.example` is the template.
- Restrict `CORS_ORIGINS`, set `ALLOW_SIGNUP=false` on public deploys, and run behind HTTPS.
- Rotate provider tokens (Databricks / OpenRouter / Composio / Fly) if they may have been exposed.

Thank you for practicing responsible disclosure.
