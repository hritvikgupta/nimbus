#!/usr/bin/env node
/**
 * nimbus — the Nimbus worker CLI. Runs on a team member's machine and connects it to Nimbus so
 * incident repairs run here via the local Claude Code. Works as a BACKGROUND DAEMON you can query.
 *
 *   npm install -g @nimbus/cli
 *   nimbus start <key>        # run in the background (under the hood)
 *   nimbus status             # is it connected? got a task? is Claude running?
 *   nimbus logs [-f]          # what it's doing
 *   nimbus tasks              # recent repairs it handled
 *   nimbus stop               # stop the daemon
 *   nimbus connect <key>      # run in the FOREGROUND instead (streams logs here)
 *
 * It POLLS Nimbus (outbound only — works behind any NAT). On a task it clones the repo, drives
 * Claude Code headless to find + fix the issue, opens a PR, and reports each step back. State lives in
 * ~/.nimbus so the query commands can read it. Needs Claude Code (logged in), git, and gh.
 */
import { spawn, execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, openSync, appendFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = path.join(os.homedir(), '.nimbus')
const F = { pid: path.join(HOME, 'daemon.pid'), state: path.join(HOME, 'state.json'), log: path.join(HOME, 'worker.log'), tasks: path.join(HOME, 'tasks.json'), config: path.join(HOME, 'config.json') }
mkdirSync(HOME, { recursive: true })

const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d }
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return d } }
const writeJson = (p, o) => { try { writeFileSync(p, JSON.stringify(o, null, 2)) } catch { /* ignore */ } }
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const ago = (t) => { if (!t) return 'never'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago` }
// Default model for this machine's Claude: `nimbus start --model <id>` (saved to config), else Claude's own default.
const DEFAULT_MODEL = flag('model') || readJson(F.config, {}).model || ''

/* ───────────────────── query commands (talk to the daemon via its state files) ───────────────────── */
function daemonPid() { const p = readJson(F.pid, null); return p && alive(p.pid) ? p.pid : null }

function status() {
  const pid = daemonPid()
  const st = readJson(F.state, {})
  const cfg = readJson(F.config, {})
  console.log('Nimbus worker')
  console.log(`  daemon:    ${pid ? `running (pid ${pid})` : 'not running'}`)
  console.log(`  server:    ${st.url || cfg.url || '—'}`)
  console.log(`  machine:   ${st.workerId || cfg.workerId || os.hostname()}`)
  if (pid) {
    const fresh = st.lastPollAt && Date.now() - st.lastPollAt < 40000
    console.log(`  connected: ${fresh ? `yes (last poll ${ago(st.lastPollAt)})` : `stale (last poll ${ago(st.lastPollAt)})`}`)
    const running = st.currentTasks || (st.currentTask ? [st.currentTask] : [])
    if (!running.length) console.log('  current:   idle')
    else { console.log(`  current:   ${running.length} active`); for (const t of running) console.log(`    • ${t.repo} — ${t.phase || '…'}`) }
    console.log(`  claude:    ${st.claudeRunning ? 'running' : 'idle'}`)
  }
  const tasks = readJson(F.tasks, []).slice(0, 5)
  if (tasks.length) {
    console.log('\nRecent repairs:')
    for (const t of tasks) console.log(`  ${t.status === 'done' ? '✓' : t.status === 'failed' ? '✗' : '•'} ${t.repo}  ${t.status}${t.prUrl ? `  ${t.prUrl}` : ''}  (${ago(t.at)})`)
  }
  if (!pid) console.log('\nStart it with:  nimbus start <key>')
}
function showTasks() {
  const tasks = readJson(F.tasks, [])
  if (!tasks.length) return console.log('No repairs handled yet.')
  for (const t of tasks) console.log(`${t.status === 'done' ? '✓' : t.status === 'failed' ? '✗' : '•'} ${t.repo}  ${t.status}${t.prUrl ? `  ${t.prUrl}` : ''}  (${ago(t.at)})`)
}
function showLogs() {
  if (!existsSync(F.log)) return console.log('No logs yet.')
  const follow = argv.includes('-f') || argv.includes('--follow')
  const child = spawn('tail', [...(follow ? ['-f'] : []), '-n', '120', F.log], { stdio: 'inherit' })
  child.on('error', () => { try { process.stdout.write(readFileSync(F.log, 'utf8').split('\n').slice(-120).join('\n') + '\n') } catch { /* */ } })
}
function stop() {
  const pid = daemonPid()
  if (!pid) { console.log('Not running.'); return }
  try { process.kill(pid) } catch { /* */ }
  try { rmSync(F.pid) } catch { /* */ }
  writeJson(F.state, { ...readJson(F.state, {}), stoppedAt: Date.now(), currentTask: null, claudeRunning: false })
  console.log(`Stopped (pid ${pid}).`)
}

/* ───────────────────── daemon control ───────────────────── */
function start() {
  if (daemonPid()) { console.log('Already running. `nimbus status` to check, `nimbus stop` to stop.'); return }
  const key = argv[1]
  if (!key || key.startsWith('--')) { console.log('Usage: nimbus start <worker-key> [--url <nimbus-url>] [--id <name>]'); process.exit(1) }
  const url = (flag('url') || process.env.NIMBUS_URL || 'http://localhost:8788').replace(/\/$/, '')
  const id = flag('id') || os.hostname()
  const model = flag('model') || '' // optional default model for this machine
  writeJson(F.config, { key, url, workerId: id, model })
  const logFd = openSync(F.log, 'a')
  const runArgs = [path.join(path.dirname(new URL(import.meta.url).pathname), 'nimbus.mjs'), '__run', key, '--url', url, '--id', id]
  if (model) runArgs.push('--model', model)
  const child = spawn(process.execPath, runArgs, { detached: true, stdio: ['ignore', logFd, logFd] })
  writeJson(F.pid, { pid: child.pid, startedAt: Date.now() })
  child.unref()
  console.log(`Nimbus worker started in the background (pid ${child.pid}).`)
  console.log('  nimbus status   → connection + current task + claude state')
  console.log('  nimbus logs -f  → live activity\n  nimbus stop     → stop')
}

/* ───────────────────── the run loop (foreground `connect` + daemon `__run`) ───────────────────── */
const sh = (bin, args, opts = {}) => new Promise((resolve) => {
  execFile(bin, args, { maxBuffer: 1 << 26, ...opts }, (err, stdout, stderr) =>
    resolve({ ok: !err, out: (stdout || '').trim(), err: (stderr || String(err?.message || '')).trim() }))
})
const has = async (bin) => (await sh(process.platform === 'win32' ? 'where' : 'which', [bin])).ok

function setState(patch) { writeJson(F.state, { ...readJson(F.state, {}), ...patch }) }
function recordTask(t) { const arr = readJson(F.tasks, []); arr.unshift(t); writeJson(F.tasks, arr.slice(0, 30)) }
// Keep the most-recent session clone dirs; delete the rest so disk doesn't grow unbounded.
function pruneOldSessionDirs(keep = 20) {
  try {
    const base = path.join(HOME, 'sessions'); if (!existsSync(base)) return
    const dirs = readdirSync(base).map((n) => path.join(base, n)).filter((p) => { try { return statSync(p).isDirectory() } catch { return false } })
      .map((p) => ({ p, m: (() => { try { return statSync(p).mtimeMs } catch { return 0 } })() }))
      .sort((a, b) => b.m - a.m)
    for (const { p } of dirs.slice(keep)) { try { rmSync(p, { recursive: true, force: true }) } catch { /* */ } }
  } catch { /* */ }
}

const MAX_CONCURRENT = 3 // simultaneous Claude sessions on this machine

async function runLoop(key, url, workerId) {
  url = url.replace(/\/$/, '')
  const authHeaders = { Authorization: `Bearer ${key}` }
  const active = new Map() // taskId -> { id, repo, phase } — concurrent conversations on this machine
  const refreshState = () => setState({ currentTasks: [...active.values()], claudeRunning: active.size > 0, currentTask: [...active.values()][0] || null })
  const log = (...a) => { const line = `[nimbus] ${a.join(' ')}`; console.log(line); try { appendFileSync(F.log, '') } catch { /* foreground */ } }
  const post = async (p, body) => { try { const r = await fetch(`${url}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify(body) }); return r.ok ? await r.json().catch(() => ({})) : null } catch (e) { log('request failed', p, e?.message); return null } }
  const emit = (taskId, phase, text, extra = {}) => { log(phase, '-', text); const e = active.get(taskId); if (e) { e.phase = phase; refreshState() } return post(`/api/repair/worker/tasks/${taskId}/event`, { phase, text, ...extra }) }
  const finishTask = (taskId, result) => post(`/api/repair/worker/tasks/${taskId}/result`, result)

  async function handleTask(task) {
    const { taskId, repo, incident = {}, constraints = {}, mode = 'repair' } = task
    log(`${mode === 'session' ? 'direct session' : 'repair task'} for ${repo}`)
    if (!(await has('claude'))) {
      await emit(taskId, 'error', 'Claude Code (`claude`) is not installed / not on PATH.')
      recordTask({ id: taskId, repo, status: 'failed', at: Date.now() })
      return finishTask(taskId, { status: 'failed', error: 'claude not installed' })
    }
    // Direct sessions live in a STABLE per-thread dir (kept for resume); repairs use a throwaway temp dir.
    const isSession = mode === 'session'
    const resume = constraints.resume // { sessionId, dir } when resuming a stored session
    let dir, resuming = false
    if (isSession && resume?.dir && existsSync(resume.dir)) {
      dir = resume.dir; resuming = true
    } else if (isSession) {
      dir = path.join(HOME, 'sessions', taskId); mkdirSync(dir, { recursive: true })
    } else {
      dir = mkdtempSync(path.join(os.tmpdir(), `nimbus-repair-${taskId.slice(0, 8)}-`))
    }
    try {
      if (!resuming) {
        await emit(taskId, 'clone', `Cloning ${repo}…`)
        const clone = await sh('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, dir])
        if (!clone.ok) { await emit(taskId, 'error', `Clone failed: ${clone.err.slice(0, 200)}`); recordTask({ id: taskId, repo, status: 'failed', at: Date.now() }); return finishTask(taskId, { status: 'failed', error: 'clone failed' }) }
      } else {
        await emit(taskId, 'clone', `Resuming previous session in ${dir}…`)
      }
      // tell the server where this session lives, so it can be resumed later
      if (isSession) emit(taskId, 'meta', `session dir`, { dir })
      // The task brief was already FRAMED by Nimbus (the user's agent, with repo + cloud knowledge).
      // The worker just hands it to Claude verbatim — no framing, no use-case assumptions here.
      const brief = (incident.brief || incident.summary || '').trim() || 'See .nimbus/incident.md for the task.'
      const incidentMd = ['# Nimbus task brief', '', `Repo: ${repo}`, '', brief, '',
        (incident.logExcerpts?.length ? `## Logs\n\`\`\`\n${incident.logExcerpts.join('\n')}\n\`\`\`` : '')].join('\n')
      mkdirSync(path.join(dir, '.nimbus'), { recursive: true }); writeFileSync(path.join(dir, '.nimbus', 'incident.md'), incidentMd)
      const policy = mode === 'session'
        ? "You are in a freshly cloned git repository on the user's machine, talking to them directly through Nimbus. Do what they ask in this repo, conversationally. You may run tests and, if they ask, commit/push and open a PR yourself with git/gh. Never touch the main branch without being asked, and never print secrets."
        : "You are in a freshly cloned git repository on a teammate's machine, invoked by the Nimbus worker. Carry out the task brief exactly as given, in this repo. Run the project's tests if present. Do not touch the main branch and never print secrets. Nimbus may send you further messages or stop you mid-run. When you're done, give a short summary of what you changed."
      await emit(taskId, 'analyze', mode === 'session' ? 'Claude is ready on this machine…' : 'Running Claude Code on the repo…')
      const { text: rootCause, stopped } = await runClaude(taskId, dir, brief, constraints, policy, emit, mode === 'session')
      // Direct session: the human owned the whole conversation; no auto commit/push/PR.
      if (mode === 'session') {
        await emit(taskId, stopped ? 'stopped' : 'done', stopped ? 'Session ended.' : 'Session ended.')
        recordTask({ id: taskId, repo, status: stopped ? 'stopped' : 'done', at: Date.now() })
        return finishTask(taskId, { status: stopped ? 'stopped' : 'done', rootCause })
      }
      if (stopped) { await emit(taskId, 'stopped', 'Claude was stopped by Nimbus.'); recordTask({ id: taskId, repo, status: 'stopped', at: Date.now() }); return finishTask(taskId, { status: 'stopped', rootCause, error: 'stopped by Nimbus' }) }
      const st = await sh('git', ['-C', dir, 'status', '--porcelain'])
      if (!st.out) { await emit(taskId, 'done', 'No code changes were needed.'); recordTask({ id: taskId, repo, status: 'done', at: Date.now() }); return finishTask(taskId, { status: 'done', rootCause, prUrl: null }) }
      const branch = `nimbus/fix-${taskId.slice(0, 8)}`
      await sh('git', ['-C', dir, 'checkout', '-b', branch]); await sh('git', ['-C', dir, 'add', '-A']); await sh('git', ['-C', dir, 'commit', '-m', `fix: ${incident.service || 'service'} — Nimbus auto-repair`])
      await emit(taskId, 'push', `Pushing branch ${branch}…`)
      const push = await sh('git', ['-C', dir, 'push', '-u', 'origin', branch])
      if (!push.ok) { await emit(taskId, 'error', `Push failed: ${push.err.slice(0, 200)}`); recordTask({ id: taskId, repo, status: 'failed', at: Date.now() }); return finishTask(taskId, { status: 'failed', rootCause, error: 'push failed' }) }
      let prUrl = null
      if (await has('gh')) {
        const pr = await sh('gh', ['pr', 'create', '--title', `fix: ${incident.service || 'service'} (Nimbus repair)`, '--body', `Automated fix by Nimbus shared-compute repair.\n\n## Root cause\n${rootCause || '(see commits)'}\n\n_Review before merging._`, '--head', branch], { cwd: dir })
        prUrl = (pr.out.match(/https?:\/\/\S+/) || [])[0] || null
      }
      await emit(taskId, 'done', prUrl ? `Opened PR: ${prUrl}` : `Pushed ${branch}.`, { prUrl })
      recordTask({ id: taskId, repo, status: 'done', prUrl, at: Date.now() })
      return finishTask(taskId, { status: 'done', rootCause, prUrl, branch })
    } catch (e) {
      await emit(taskId, 'error', String(e?.message || e)); recordTask({ id: taskId, repo, status: 'failed', at: Date.now() })
      return finishTask(taskId, { status: 'failed', error: String(e?.message || e) })
    } finally {
      // Keep direct-session dirs (needed to resume); only clean up throwaway repair dirs.
      if (!isSession) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* */ } }
      else pruneOldSessionDirs()
    }
  }

  // Run Claude as a LIVE streaming session (stream-json in/out) in its own process group, so the
  // Nimbus server agent can TALK to it (inject messages) or STOP it (kill the whole group) mid-run.
  function runClaude(taskId, dir, brief, constraints, policy, emit, sessionMode = false) {
    return new Promise((resolve) => {
      const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        '--permission-mode', constraints.permissionMode || 'acceptEdits', '--append-system-prompt', policy]
      if (constraints.allowedTools?.length) args.push('--allowedTools', constraints.allowedTools.join(' '))
      // model: per-session pick from the UI, else the daemon default (--model at `nimbus start`), else Claude's own default
      const chosenModel = constraints.model || DEFAULT_MODEL
      if (chosenModel) args.push('--model', chosenModel)
      if (constraints.resume?.sessionId) args.push('--resume', constraints.resume.sessionId) // continue prior Claude context
      const child = spawn('claude', args, { cwd: dir, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let buf = '', finalText = '', stopped = false, done = false, finished = false
      let model = ''
      // Idle handling: a direct session keeps Claude open for fast follow-ups, but if it's abandoned
      // (e.g. the browser was refreshed/closed) we must free the worker — otherwise it can't take new
      // tasks. So after a turn finishes, close the session if no new message arrives within IDLE_MS.
      const IDLE_MS = 120000
      let working = true, lastTurnAt = Date.now()
      const sendUser = (text) => { working = true; try { child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n') } catch { /* */ } }
      const killGroup = () => { try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch { /* */ } } }
      sendUser(brief) // the task brief framed by Nimbus
      // control loop — the server agent can stop or steer this running Claude
      ;(async () => {
        while (!finished) {
          const out = await post(`/api/repair/worker/tasks/${taskId}/control-poll`, { workerId })
          const cmd = out?.cmd
          if (!cmd) { // no command — close an idle/abandoned session so the worker is free for new tasks
            if (sessionMode && !working && Date.now() - lastTurnAt > IDLE_MS) {
              done = true; emit(taskId, 'control', 'Session idle — closing (resume it anytime).'); try { child.stdin.end() } catch { /* */ }; setTimeout(killGroup, 5000); break
            }
            continue
          }
          if (cmd.type === 'stop') { stopped = true; emit(taskId, 'control', 'Stop received from Nimbus — ending Claude.'); killGroup(); break }
          if (cmd.type === 'done') { done = true; emit(taskId, 'control', 'Nimbus marked the task done — finalizing.'); try { child.stdin.end() } catch { /* */ }; setTimeout(killGroup, 8000); break }
          if (cmd.type === 'compact') { log('compact - /compact'); sendUser('/compact') } // server already logged the step
          else if (cmd.type === 'message' && cmd.text) { log('message ->', cmd.text); sendUser(cmd.text) } // server already recorded this
        }
      })()
      child.stdout.on('data', (d) => {
        buf += d.toString(); let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue
          let ev; try { ev = JSON.parse(line) } catch { continue }
          if (ev.type === 'system' && ev.subtype === 'init') {
            // Claude emits an init at the START OF EACH TURN (same session). Only surface the model
            // line when it actually changes (first turn, or a model switch) — not once per turn.
            if (ev.model && ev.model !== model) {
              model = ev.model
              emit(taskId, 'meta', `model ${model}`, { model, sessionId: ev.session_id || undefined }) // session_id → resume linkage
            }
          } else if (ev.type === 'assistant' && ev.message?.content) {
            if (ev.message?.model && ev.message.model !== model) { model = ev.message.model; emit(taskId, 'meta', `model ${model}`, { model }) }
            for (const c of ev.message.content) {
              if (c.type === 'text' && c.text?.trim()) { finalText = c.text; emit(taskId, 'think', c.text.slice(0, 240)) }
              else if (c.type === 'tool_use') emit(taskId, 'tool', `${c.name} ${JSON.stringify(c.input || {}).slice(0, 120)}`)
            }
          } else if (ev.type === 'result') {
            working = false; lastTurnAt = Date.now() // turn done → Claude is idle, idle-timer starts
            if (ev.result) finalText = ev.result
            // Raw token usage straight from Claude's result event — no computed percentage.
            const u = ev.usage || {}
            const inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
            emit(taskId, 'meta', `${(inTok / 1000).toFixed(1)}k in · ${u.output_tokens || 0} out`, {
              model, inputTokens: inTok, outputTokens: u.output_tokens || 0,
              cacheReadTokens: u.cache_read_input_tokens || 0, costUsd: ev.total_cost_usd ?? null,
            })
            post(`/api/repair/worker/tasks/${taskId}/turn`, { reply: finalText }) /* report Claude's turn */
          }
        }
      })
      child.on('error', (e) => { emit(taskId, 'error', `claude failed to start: ${e.message}`); finished = true; resolve({ text: '', stopped }) })
      child.on('close', () => { finished = true; resolve({ text: finalText, stopped, done }) })
    })
  }

  const claude = await has('claude')
  setState({ startedAt: Date.now(), url, workerId, claudeRunning: false, currentTask: null, currentTasks: [], stoppedAt: null })
  log(`connecting to ${url} as "${workerId}"${claude ? '' : '  (warning: claude not on PATH)'}`)
  // RESILIENCE: a server restart / blip rejects in-flight requests. Never let that crash the worker —
  // log and keep polling so it auto-reconnects the moment the server is back.
  process.on('unhandledRejection', (e) => log('recovered from error (continuing):', e?.message || e))
  process.on('uncaughtException', (e) => log('recovered from error (continuing):', e?.message || e))
  log(`connected. polling for tasks (up to ${MAX_CONCURRENT} at once)…  (Ctrl-C / \`nimbus stop\` to stop)`)
  for (;;) {
    if (active.size >= MAX_CONCURRENT) { await new Promise((r) => setTimeout(r, 1500)); continue } // at cap — let running tasks finish
    const out = await post('/api/repair/worker/poll', { workerId, host: os.hostname(), os: process.platform, claude })
    setState({ lastPollAt: Date.now() })
    if (out === null) { await new Promise((r) => setTimeout(r, 4000)); continue }
    if (out.task) {
      const t = out.task
      active.set(t.taskId, { id: t.taskId, repo: t.repo, phase: 'starting' }); refreshState()
      // run concurrently — do NOT await, so we keep polling for more tasks (up to the cap)
      handleTask(t).catch(() => {}).finally(() => { active.delete(t.taskId); refreshState() })
    }
  }
}

/* ───────────────────── dispatch ───────────────────── */
if (cmd === 'status') status()
else if (cmd === 'tasks') showTasks()
else if (cmd === 'logs') showLogs()
else if (cmd === 'stop') stop()
else if (cmd === 'start') start()
else if (cmd === 'connect' || cmd === '__run') {
  const key = argv[1]
  if (!key || key.startsWith('--')) { console.log('Usage: nimbus connect <worker-key> [--url <nimbus-url>] [--id <name>]'); process.exit(1) }
  const url = flag('url') || process.env.NIMBUS_URL || 'http://localhost:8788'
  const id = flag('id') || os.hostname()
  if (cmd === 'connect') writeJson(F.config, { key, url: url.replace(/\/$/, ''), workerId: id })
  runLoop(key, url, id)
} else {
  console.log(`nimbus — connect this machine to Nimbus for shared-compute repairs

  nimbus start <key>        run in the background (recommended)
  nimbus status             connection + current task + claude state
  nimbus logs [-f]          what it's doing
  nimbus tasks              recent repairs it handled
  nimbus stop               stop the background worker
  nimbus connect <key>      run in the FOREGROUND (streams logs here)

Options: --url <nimbus-url> (default $NIMBUS_URL or http://localhost:8788), --id <name>
Get a key: Nimbus → Code tab → Repairs → Connect a machine. Needs Claude Code + git + gh.`)
}
