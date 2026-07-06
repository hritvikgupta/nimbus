/**
 * Nimbus backend entry — thin HTTP layer. Sets up Express, attaches the session user, and mounts
 * the per-resource routers from server/routes/*. All real work lives in:
 *   routes/      → HTTP handlers (one file per resource)
 *   services/    → business logic (cloud, telemetry, logs, spec, billing, code analysis…)
 *   repositories/→ persistence (auth, projects, chats, connections, store)
 *   libs/        → external-service clients (model, MCP, composio, aws, gcp, oauth)
 *   agents/      → the ReAct chat loop + the codebase-analysis agent     tools/ → agent tools
 *
 * User identity comes STRICTLY from the session cookie (middlewares/auth.mjs); req.user.id is the
 * per-user isolation boundary every service + MCP call is scoped to.
 */
import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { attachUser, cloudScope } from './middlewares/auth.mjs'
import helmet from 'helmet'
import cors from 'cors'
import authRoutes from './routes/auth.mjs'
import agentRoutes from './routes/agent.mjs'
import chatRoutes from './routes/chats.mjs'
import connectionRoutes from './routes/connections.mjs'
import projectRoutes from './routes/projects.mjs'
import resourceRoutes from './routes/resources.mjs'
import codeRoutes from './routes/code.mjs'
import codeChatRoutes from './routes/codechat.mjs'
import repairRoutes from './routes/repair.mjs'
import searchRoutes from './routes/search.mjs'
import opsRoutes from './routes/ops.mjs'
import webhookRoutes from './routes/webhooks.mjs'
import flyRoutes from './routes/fly.mjs'
import rentalRoutes from './routes/rentals.mjs'
import { startScheduler } from './services/scheduler.mjs'
import { startRentalLifecycle } from './services/rental-lifecycle.mjs'

const app = express()

// Security headers (helmet). CSP is disabled here — the SPA is served separately as a static
// site with its own policy; this API server just needs the transport/sniffing/frame protections.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }))

// CORS is opt-in: same-origin by default (frontend uses relative /api paths). Set CORS_ORIGINS
// (comma-separated) only if the app is ever served from a different origin than the API.
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
if (corsOrigins.length) {
  app.use(cors({ origin: corsOrigins, credentials: true }))
  console.log(`CORS → restricted to: ${corsOrigins.join(', ')}`)
}

// ── Docs subdomain (docs.nimbus.com) ──────────────────────────────────────────────────────────
// The Nimbus docs are a statically-exported Fumadocs/Unmint site in ../docs-site/out. We serve them
// from THIS server (no separate docs process) whenever the request host is docs.* — so in production
// docs.nimbus.com points at the same box and this middleware answers it. Build with:
//   cd docs-site && npm run build      (regenerates docs-site/out)
// Test locally:  curl -H 'Host: docs.localhost' localhost:8788/docs/
const DOCS_OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs-site/out')
const isDocsHost = (host) => /^docs\./i.test(host || '') || host === process.env.DOCS_HOST
if (existsSync(DOCS_OUT)) {
  const docsStatic = express.static(DOCS_OUT, { extensions: ['html'] })
  app.use((req, res, next) => {
    if (!isDocsHost(req.hostname)) return next()
    docsStatic(req, res, () => res.status(404).sendFile(path.join(DOCS_OUT, '404.html'), (e) => { if (e) res.end() }))
  })
  console.log(`docs site → serving ${DOCS_OUT} for host docs.*`)
} else {
  console.log('docs site → not built yet (run: cd docs-site && npm run build)')
}

app.set('trust proxy', 1) // behind Fly's proxy — needed for correct client IP / HTTPS detection
app.use(express.json({ limit: '4mb' }))
app.use(attachUser)
app.use(cloudScope)

// Each router declares its own full /api/* paths and is mounted at the root.
for (const routes of [authRoutes, agentRoutes, chatRoutes, connectionRoutes, projectRoutes, resourceRoutes, codeRoutes, codeChatRoutes, repairRoutes, searchRoutes, opsRoutes, webhookRoutes, flyRoutes, rentalRoutes]) {
  app.use(routes)
}

// ── Serve the built SPA (single-container / Docker) ────────────────────────────────────────────
// In dev the Vite server hosts the app on :5280 and proxies /api here, so this block is inert
// (no dist/). In production/Docker we `vite build` to ../dist and serve it from THIS server, so one
// process on one port serves both the app and the API (same origin → the session cookie just works).
// Mounted AFTER the API routers so /api/* is never shadowed; the SPA fallback skips /api and docs.
const SPA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (existsSync(SPA_DIR)) {
  const spaStatic = express.static(SPA_DIR)
  app.use((req, res, next) => {
    if (isDocsHost(req.hostname)) return next()          // docs.* handled above
    if (req.path.startsWith('/api/')) return next()      // let API 404s be JSON
    spaStatic(req, res, () => {
      if (req.method !== 'GET') return next()
      res.sendFile(path.join(SPA_DIR, 'index.html'), (e) => { if (e) next() }) // client-side routing
    })
  })
  console.log(`spa → serving ${SPA_DIR}`)
} else {
  console.log('spa → not built (dev mode: Vite serves it on :5280); run `npm run build` for single-container')
}

const PORT = process.env.AGENT_PORT || 8788
app.listen(PORT, () => console.log(`nimbus agent api → http://localhost:${PORT}`))
startScheduler() // baseline trigger (no-op unless OPS_SCAN_MINUTES is set)
startRentalLifecycle() // boot rented machines + tear them down at expiry
