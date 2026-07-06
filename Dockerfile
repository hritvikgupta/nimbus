# syntax=docker/dockerfile:1
#
# Nimbus — single-image build. One container runs the API + serves the built SPA on one port,
# and bundles everything the cloud MCP servers shell out to:
#   • git         — the agent clones repos for code analysis
#   • uv / uvx    — launches the AWS MCP server (aws-api-mcp-server, Python)
#   • gcloud CLI  — the gcloud MCP server executes real `gcloud` commands
#   • node        — the Cloud Run + gcloud MCP servers
#
# The user supplies only their own .env (LLM key + NIMBUS_ENC_KEY + optional integrations).

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — builder: install deps, build the SPA, install + build the MCP servers
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm AS builder
WORKDIR /app

# Build toolchain for better-sqlite3 (native) and the gcloud-mcp TypeScript build.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# App dependencies (cached on package manifests).
COPY package*.json ./
RUN npm ci

# App source + build the SPA → /app/dist
COPY . .
RUN npm run build

# Install + build the vendored cloud MCP servers (node deps + gcloud-mcp bundle).
RUN npm run setup:mcp

# Drop dev-only dependencies now that the SPA + MCP bundles are built — keeps the runtime lean.
RUN npm prune --omit=dev \
    && (cd server/mcp/cloud-run-mcp && npm prune --omit=dev || true) \
    && (cd server/mcp/gcloud-mcp && npm prune --omit=dev || true) \
    && npm cache clean --force

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — runtime: slim image + the CLIs the MCP servers need at run time
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    AGENT_PORT=8788

# Runtime tools: git (repo clone), python3 + uv (AWS MCP), gcloud CLI (GCP MCP), bash/curl.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl gnupg bash python3 \
    && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh \
    && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
       > /etc/apt/sources.list.d/google-cloud-sdk.list \
    && curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
       | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && apt-get update && apt-get install -y --no-install-recommends google-cloud-cli \
    && rm -rf /var/lib/apt/lists/*

# Copy the built app (source, node_modules, dist, seed, and the built MCP servers) from builder.
COPY --from=builder /app ./

# Persisted data (SQLite DB + encrypted connections) lives here — mount a volume in production.
VOLUME ["/app/server/.data"]

EXPOSE 8788

# Serves the SPA + API on AGENT_PORT. `--env-file-if-exists` lets a mounted /app/.env work too,
# but env passed via `docker run -e` / compose `env_file` takes effect regardless.
CMD ["node", "--env-file-if-exists=.env", "server/server.mjs"]
