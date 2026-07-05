# Conversations & Parallelism — design

How Nimbus stores chats (repair + direct machine chats) and runs many of them at once across machines.
Supersedes the ad-hoc step-mirroring in `repositories/sessions.mjs`.

## Goals

1. **Store the chat, not the bridge log.** Persist only the conversation turns (who said what). The
   verbose live timeline (think / tool / clone / meta steps) is ephemeral — it streams to the open
   view and is then discarded. Never persisted.
2. **Two kinds, one shape.**
   - `repair` — the **Nimbus agent** ↔ Claude on a machine (server-driven, opens a PR).
   - `direct` — a **user** ↔ Claude on a machine (human-driven, from the COMPUTERS rail).
3. **Track which machine** each conversation talks to.
4. **Parallelism.** Many conversations at once: many Nimbus repairs to many machines, many users to
   many machines — including several on the **same** machine simultaneously.
5. **No duplicate runs of the same conversation** (the data-corruption guard).

---

## 1. Data structures

Persisted in `server/.data/conversations.json`, scoped by `userId`.

```
Conversation {
  id                 // conversation id (stable; used for resume + reattach)
  kind: 'repair' | 'direct'
  userId             // owner (who started it)
  projectId, repo
  machineId          // WHICH machine (workerId) this conversation talks to
  speaker: 'nimbus' | 'user'   // who is on the human side of the chat
  claudeSessionId    // Claude Code's session_id  → used for `claude --resume`
  workerDir          // clone dir on the machine   → used for resume (must match cwd)
  model              // model id Claude reported (or the one we requested)
  status: 'running' | 'idle' | 'done' | 'stopped' | 'failed'
  activeTaskId       // the live task currently running this conversation, or null
  title              // first message (for the list)
  createdAt, lastActive
  result             // { prUrl, ... } for repairs; null otherwise
  messages: [ Message ]        // CLEAN chat turns ONLY
}

Message {
  id
  role: 'user' | 'nimbus' | 'claude'   // STRUCTURED — set when recorded, never regex-parsed
  text                                  // full turn text
  at
  workSummary?                          // optional one-liner, e.g. "ran 7 tools" — NOT the raw log
}
```

### Stored vs not stored

| Data | Where it lives | Persisted? |
|------|----------------|------------|
| Conversation metadata (machine, kind, status, sessionId, dir, result) | `conversations.json` | ✅ |
| Chat turns (`user` / `nimbus` / `claude` messages) | `conversation.messages` | ✅ |
| Live timeline: `think` / `tool` / `clone` / `meta` steps | in-memory live task (`_tasks`) only | ❌ ephemeral |

A message is appended at each **turn boundary**:
- a `user` or `nimbus` message when an instruction is sent into the session;
- a `claude` message when Claude's turn reply (final text) comes back.

The `role` field removes the text-regex (`/→ Claude:/`) we currently rely on.

---

## 2. Parallelism

### The bridge already supports it (no change)
Bridge channels are keyed **per taskId**:
```
_control: taskId -> [cmds]     // server → Claude (message / stop / compact / done)
_turns:   taskId -> [replies]  // Claude → server (turn reply)
```
So unlimited concurrent conversations can flow with zero interference. Each repair / direct chat =
its own taskId = its own channels.

### Each task = its own isolated Claude
| Spun up | Claude process | Clone dir | Bridge |
|---------|----------------|-----------|--------|
| Repair 1 on machine A | #1 | dir 1 | taskId-1 |
| Repair 2 on machine A | #2 | dir 2 | taskId-2 |
| User direct-chat on A  | #3 | dir 3 | taskId-3 |

Separate processes, separate clone dirs (no file collisions), separate branches/PRs. Fully isolated.

### The worker is the missing piece (the one real change)
Today the daemon runs **one task at a time** (`await handleTask` in the poll loop) → repair 2 and the
user chat **queue** behind repair 1. Fix: make the worker run tasks concurrently:
- keep **polling while tasks run**;
- **spawn a handler per task** (each its own Claude child + control loop), tracked in a
  `Map<taskId, handler>` instead of a single `currentTask`;
- **cap** at `MAX_CONCURRENT` (e.g. 3) Claude per machine; beyond the cap the task stays `pending`
  (queued) and the UI shows "queued for <machine>";
- `nimbus status` lists all active conversations.

After this: repair 1 + repair 2 + user chat run **at the same time on machine A**, same bridge.

### The guard: one live run per conversation
Parallelism is for **different** conversations. The **same** conversation must never have two live
Claudes (two `--resume` on the same dir/session_id corrupts the transcript). Enforced via
`Conversation.activeTaskId`:

| Situation | Behaviour |
|-----------|-----------|
| Different conversations, same machine | run in parallel (capped) |
| 2nd message to an already-live conversation | route into the existing live Claude (no new process) |
| Resume / refresh of a **running** conversation | **reattach** the UI to `activeTaskId`, no new Claude |
| Resume of an **idle** conversation | new task, `claude --resume`, same `workerDir` |
| Machine at concurrency cap | task queues until a slot frees |

`activeTaskId` is set when a task starts and cleared on done / stopped / idle-timeout.

---

## 3. What to fix and where

1. **`server/repositories/conversations.mjs`** (NEW — replaces `sessions.mjs`)
   - Store above. API: `createConversation`, `appendMessage`, `setConvMeta` (sessionId/dir/status/
     activeTaskId/result), `listConversations({ userId, kind, machineId, projectId })`,
     `getConversation(userId, id)`.
   - Caps: max messages per conversation, max conversations per user (prune oldest).

2. **`server/services/repair.mjs`**
   - At turn boundaries append **clean messages** to the conversation (not raw steps):
     - on a sent instruction (first brief + each control `message`) → `appendMessage(role: speaker)`.
     - on a `turn` reply → `appendMessage(role: 'claude', text: fullReply, workSummary)`.
   - Keep the verbose steps in `_tasks` for the live SSE view only (don't persist).
   - Maintain `activeTaskId` on the conversation: set on dispatch, clear in `setResult`.
   - `listTasks` still excludes `mode:'session'` (repairs list stays clean).

3. **`server/routes/repair.mjs`**
   - Session/resume route: look up the conversation; if `activeTaskId` is live → **reattach**
     (return that taskId) or route the message to it; else spawn (new or `--resume`).
   - Dispatch (repair): create a `repair` conversation, set `machineId` (the picked worker),
     `speaker:'nimbus'`.
   - Read endpoints from conversations: repair list = `kind:'repair'`; machine history =
     `kind:'direct'` filtered by `machineId`. Add `GET /conversations/:id` (full, with messages).

4. **`cli/bin/nimbus.mjs`**
   - Concurrent task handling: poll loop fires `handleTask` without awaiting; track
     `Map<taskId, { child, ... }>`; enforce `MAX_CONCURRENT`; report all in `nimbus status`.
   - (Keep) stable per-conversation clone dir + `--resume` + idle-timeout + session-dir pruning.

5. **UI (`src/pages/CodeChatPage.jsx`, `src/lib/api.js`)**
   - Render transcripts from `messages` by `role` (no regex, no raw-log dump; optional
     "ran N tools" line per Claude turn).
   - On opening a machine/conversation, if it has a live `activeTaskId` → reattach to the live
     stream instead of starting a new run.
   - Repair "Previous fixes" + machine "History" read the conversation lists.

## Migration
Old `machine-sessions.json` (raw steps) is abandoned in place (unused). New conversations start clean.
No meaningful data lost.
