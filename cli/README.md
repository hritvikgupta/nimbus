# @nimbus/cli

Connect your machine to Nimbus so it can run incident **repairs** on it using your local **Claude
Code**. The CLI **polls** Nimbus for repair tasks (outbound only — works behind any NAT/firewall);
when a fix is dispatched it clones the repo, drives Claude Code to find + fix the issue, and opens a PR.

## Install
```bash
npm install -g @nimbus/cli
```

## Connect
Get a key from Nimbus → **Code tab → Repairs → Connect a machine → Generate key**, then run it as a
background daemon:
```bash
nimbus start <worker-key>     # runs under the hood
nimbus status                 # connected? got a task? is Claude running?
nimbus logs -f                # live activity
nimbus tasks                  # recent repairs
nimbus stop                   # stop it
nimbus connect <worker-key>   # OR run in the foreground (streams logs here)
```
Options: `--url <nimbus-url>` (default `$NIMBUS_URL` or `http://localhost:8788`), `--id <name>` (machine label).

Requires **Claude Code** (installed + logged in), **git**, and **gh** (`gh auth login`) on the machine.

## Local development (this repo, before publishing)
```bash
cd cli
npm install -g .        # or: npm link
nimbus connect <key> --url http://localhost:8788
```

## What it does per task
poll → clone repo → write `.nimbus/incident.md` → `claude -p … --output-format stream-json
--permission-mode acceptEdits` → branch + commit + push → `gh pr create` → report each step + the PR
back to Nimbus (shown live in the Code tab → Repairs).
