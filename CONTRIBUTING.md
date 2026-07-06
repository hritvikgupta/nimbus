# Contributing to Nimbus

Thanks for your interest in improving Nimbus! This guide covers the dev setup, conventions, and
how to get a change merged.

## Development setup

**Prerequisites:** Node.js ≥ 20, npm, and an LLM provider (a Databricks endpoint or an OpenRouter key).

```bash
git clone https://github.com/hritvikgupta/nimbus.git
cd nimbus
npm install
cp .env.example .env          # fill in NIMBUS_ENC_KEY + one LLM provider
```

Run the two processes in separate terminals:

```bash
npm run api     # backend  → http://localhost:8788
npm run dev     # frontend → http://localhost:5280
```

The Vite dev server proxies `/api` to the backend, so you only browse `:5280`.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (frontend, HMR). |
| `npm run api` | Express API server (loads `.env`). |
| `npm run build` | Production build of the SPA → `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run backup` | Snapshot the SQLite database. |

## Project layout

See [README → Project structure](README.md#project-structure). In short:

- **`src/`** — the React SPA.
- **`server/`** — Express API, split into `routes/` (HTTP), `services/` (logic),
  `repositories/` (SQLite), `agents/` + `tools/` (the AI loop), `libs/` and `mcp/` (integrations).
- **`cli/`** — the connected-machine repair worker.
- **`docs-site/`** — the documentation site.

## Conventions

- **ES modules** everywhere (`"type": "module"`). Backend files use the `.mjs` extension.
- **Keep the layers honest.** Routes stay thin; business logic lives in `services/`; persistence
  lives in `repositories/`. Don't reach across layers.
- **Per-user isolation is non-negotiable.** Identity comes from the session cookie only
  (`req.user.id`). Every service and MCP call must be scoped to it.
- **Match the surrounding code** — naming, comment density, and idioms. Read a neighbouring file
  before adding a new one.
- **Validate inputs** with Zod where a payload crosses a trust boundary.

## Security &amp; secrets

- **Never** print, log, or return credentials, keys, tokens, or connection strings.
- **Never** commit a real `.env`. Add new config to `.env.example` with a safe placeholder and
  document it in the README's Configuration table.
- Anything that creates, scales, modifies, or deletes a billable cloud resource must stay behind
  the plan-then-confirm flow.

## Submitting a change

1. **Fork** and create a branch: `git checkout -b feat/short-description`.
2. Make your change; keep commits focused and messages descriptive.
3. Run `npm run build` and exercise the affected flow locally.
4. Open a **pull request** describing *what* changed and *why*. Link any related issue.
5. Be ready to iterate on review feedback.

## Reporting bugs &amp; requesting features

Open a GitHub issue with clear reproduction steps (for bugs) or the problem you're trying to solve
(for features). For security issues, follow [SECURITY.md](SECURITY.md) instead — do **not** open a
public issue.

## Sign your commits (DCO)

This project uses the [Developer Certificate of Origin](DCO). Certify that you wrote (or have the
right to submit) your contribution by adding a `Signed-off-by` line to each commit:

```bash
git commit -s -m "your message"
# → Signed-off-by: Your Name <you@example.com>
```

## Contribution licensing

Nimbus is distributed under the [Business Source License 1.1](LICENSE). **By submitting a
contribution, you agree that your contribution is provided under that same license, and you grant
the Licensor (Hritvik Gupta) a perpetual, worldwide, non-exclusive, royalty-free license — with the
right to sublicense and relicense — to use, reproduce, modify, distribute, and commercialize your
contribution as part of Nimbus, including under the Change License and any commercial license.** You
represent that you have the right to grant this. You retain copyright to your contribution.
