#!/usr/bin/env bash
#
# setup-mcp.sh — install & build the vendored cloud MCP servers.
#
# Nimbus ships three MCP servers under server/mcp/ (their source is committed, but their
# node_modules / build output are not — like any dependency). Run this once after cloning,
# and again after pulling changes to any of them.
#
#   AWS  (aws-mcp)         → Python, launched via `uvx`. Needs `uv` installed; deps resolve
#                            on first launch, so nothing to build here.
#   cloud-run (cloud-run-mcp) → Node. `npm install`.
#   gcloud (gcloud-mcp)      → Node monorepo. `npm install` + `npm run build` → dist/bundle.js
#
set -euo pipefail
cd "$(dirname "$0")/../server/mcp"
ROOT="$(pwd)"

echo "▸ cloud-run-mcp: npm install"
( cd "$ROOT/cloud-run-mcp" && npm install --no-audit --no-fund )

echo "▸ gcloud-mcp: npm install + build"
( cd "$ROOT/gcloud-mcp" && npm install --no-audit --no-fund && npm run build )

echo "▸ aws-mcp: launched via uvx at runtime (ensure 'uv' is installed: https://docs.astral.sh/uv/)"
if command -v uvx >/dev/null 2>&1; then
  echo "  uvx found: $(command -v uvx)"
else
  echo "  ⚠ uvx not found — install uv so the AWS MCP server can run."
fi

echo "✓ MCP servers ready."
