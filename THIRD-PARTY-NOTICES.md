# Third-Party Notices

Nimbus is licensed under the [Business Source License 1.1](LICENSE). It bundles and depends on
third-party open-source software, each licensed under its **own** terms. Those components are
provided to you under their respective licenses, **not** under Nimbus's license.

## Vendored components (source included in this repository)

The following third-party MCP servers are vendored under [`server/mcp/`](server/mcp). Their
original `LICENSE` (and `NOTICE`, where present) files are retained in their subdirectories.

| Component | Path | Origin | License |
|---|---|---|---|
| AWS MCP Servers (`aws-api-mcp-server`) | `server/mcp/aws-mcp` | [awslabs/mcp](https://github.com/awslabs/mcp) | Apache-2.0 |
| Cloud Run MCP | `server/mcp/cloud-run-mcp` | [GoogleCloudPlatform/cloud-run-mcp](https://github.com/GoogleCloudPlatform/cloud-run-mcp) | Apache-2.0 |
| gcloud MCP | `server/mcp/gcloud-mcp` | [googleapis/gcloud-mcp](https://github.com/googleapis/gcloud-mcp) | Apache-2.0 |

Each of the above is Copyright its respective authors and is distributed under the Apache
License, Version 2.0. A copy of the Apache 2.0 license text accompanies each component in its
directory (`server/mcp/<component>/LICENSE`). Modifications made within these directories (if any)
are noted in the project's git history.

## npm and Python dependencies

Nimbus also depends on open-source packages installed at build/run time via `npm`
(see `package.json` / `package-lock.json`) and, for the AWS MCP server, via `uv`/PyPI
(see `server/mcp/aws-mcp/src/aws-api-mcp-server/pyproject.toml`). Each such dependency is
licensed under its own terms by its respective authors. Run `npm ls` / inspect the lockfile for
the full resolved dependency tree and versions.

## Attribution

This file is provided to satisfy the attribution requirements of the licenses above. If you
believe a component is missing or misattributed, please open an issue.
