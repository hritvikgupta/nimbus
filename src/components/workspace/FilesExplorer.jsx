import { useEffect, useRef, useState } from 'react'
import { pullRepo, getRepoFile, getGithubRepos, composioStatus, composioAuthorize } from '../../lib/api.js'
import { I } from './icons.jsx'

/* ── file-tree helpers (build a nested tree from listFiles' flat path list) ── */
function buildTree(files) {
  const root = {}
  for (const raw of files || []) {
    const isDir = raw.endsWith('/')
    const parts = raw.replace(/\/$/, '').split('/')
    let node = root
    parts.forEach((p, i) => {
      const last = i === parts.length - 1
      const path = parts.slice(0, i + 1).join('/')
      node[p] = node[p] || { dir: !last || isDir, path, children: {} }
      if (last && !isDir) node[p].dir = false
      node = node[p].children
    })
  }
  return root
}
function sortEntries(children) {
  return Object.entries(children).sort(([an, a], [bn, b]) =>
    (a.dir === b.dir ? an.localeCompare(bn) : a.dir ? -1 : 1))
}

function TreeNode({ name, node, depth, onOpen, active }) {
  const [open, setOpen] = useState(depth === 0)
  const pad = { paddingLeft: 8 + depth * 13 }
  if (node.dir) {
    return (
      <>
        <button className="cc-tree-row" style={pad} onClick={() => setOpen(o => !o)}>
          <span className={'cc-tree-caret' + (open ? ' open' : '')}>{I.caret()}</span>
          <span className="cc-tree-ico">{I.folder()}</span>
          <span className="cc-tree-nm">{name}</span>
        </button>
        {open && sortEntries(node.children).map(([n, c]) =>
          <TreeNode key={c.path} name={n} node={c} depth={depth + 1} onOpen={onOpen} active={active} />)}
      </>
    )
  }
  return (
    <button className={'cc-tree-row file' + (active === node.path ? ' on' : '')} style={pad} onClick={() => onOpen(node.path)}>
      <span className="cc-tree-caret" />
      <span className="cc-tree-ico"><span className="cc-file-dot" /></span>
      <span className="cc-tree-nm">{name}</span>
    </button>
  )
}

// Code-editor view: file tree (left) + the selected file's contents with line numbers (right).
export function FilesExplorer({ repo, projectId, onConnect, navigate }) {
  const [tree, setTree] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [count, setCount] = useState(0)
  const [sel, setSel] = useState(null)
  const [file, setFile] = useState(null)
  const [fileLoading, setFileLoading] = useState(false)

  const pull = (force = false) => {
    if (!repo) return
    setLoading(true); setErr('')
    pullRepo(projectId, force).then(r => {
      if (!r.ok) { setErr(r.error || 'Could not pull the repository.'); setTree(null) }
      else { setTree(buildTree(r.files)); setCount(r.fileCount || (r.files || []).length) }
    }).catch(() => setErr('Could not pull the repository.')).finally(() => setLoading(false))
  }
  // Re-pull whenever the project (and thus its repo) changes; reset the open file.
  useEffect(() => { setSel(null); setFile(null); setTree(null); if (repo) pull(false) /* eslint-disable-next-line */ }, [repo, projectId])

  const open = (path) => {
    setSel(path); setFileLoading(true)
    getRepoFile(projectId, path).then(setFile).catch(() => setFile({ ok: false, error: 'Could not read file.' })).finally(() => setFileLoading(false))
  }
  const lines = file?.ok ? file.content.split('\n') : []

  return (
    <>
      <aside className="cc-side cc-files-side">
        <div className="cc-files-head">
          <span className="cc-files-ico">{I.github()}</span>
          <span className="cc-files-repo">{repo || 'No repo'}</span>
          <button className="cc-files-refresh" title="Re-pull" onClick={() => pull(true)} disabled={loading || !repo}>{I.refresh()}</button>
        </div>
        <div className="cc-files-meta">{repo ? (loading ? 'Pulling…' : `${count} files`) : ''}</div>
        <div className="cc-tree">
          {!repo ? (
            <div className="cc-tree-empty">No repository connected.<button className="cc-gh-btn sm" onClick={onConnect}>{I.github()} Connect a repo</button></div>
          ) : loading && !tree ? <div className="cc-tree-empty">Cloning {repo}…</div>
            : err ? <div className="cc-tree-empty">{err}</div>
            : tree ? sortEntries(tree).map(([n, c]) => <TreeNode key={c.path} name={n} node={c} depth={0} onOpen={open} active={sel} />)
            : null}
        </div>
      </aside>

      <main className="cc-main">
        <header className="cc-top">
          <div className="cc-top-name">{sel ? <><span className="cc-side-ico">{I.file()}</span><span className="cc-code-path">{sel}</span></> : <><span className="cc-side-ico">{I.folder()}</span>Files</>}</div>
          {file?.truncated && <span className="cc-code-trunc">truncated to 64KB</span>}
          <div className="cc-top-spacer" />
        </header>
        <div className="cc-scroll">
          {!sel ? (
            <div className="cc-empty">
              <div className="cc-empty-mark">{I.folder({ width: 28, height: 28 })}</div>
              <div className="cc-empty-h">{repo ? 'Browse the code' : 'Connect a repo to browse'}</div>
              <div className="cc-empty-p">{repo ? 'Select a file on the left to read it. This is the same clone @nimbus reads from.' : 'Connect a repository and its full source appears here.'}</div>
            </div>
          ) : fileLoading ? <div className="cc-empty"><div className="cc-empty-p">Opening {sel}…</div></div>
            : !file?.ok ? <div className="cc-empty"><div className="cc-empty-p">{file?.error || 'Could not read this file.'}</div></div>
            : (
              <div className="cc-code">
                <div className="cc-code-scroll">
                  <div className="cc-gutter">{lines.map((_, i) => <div key={i}>{i + 1}</div>)}</div>
                  <pre className="cc-code-pre">{file.content}</pre>
                </div>
              </div>
            )}
        </div>
      </main>
    </>
  )
}

/* Pick a repo to connect to the workspace (lists the user's GitHub repos, or paste owner/repo). */
export function RepoModal({ current, onClose, onSave }) {
  const [repos, setRepos] = useState(null)
  const [ghConnected, setGhConnected] = useState(null) // null=unknown, true/false
  const [connecting, setConnecting] = useState(false)
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const pollRef = useRef(null)
  const loadRepos = () => getGithubRepos().then(r => setRepos(r?.repos || [])).catch(() => setRepos([]))
  useEffect(() => {
    composioStatus().then(s => setGhConnected((s?.toolkits || []).includes('github'))).catch(() => setGhConnected(false))
    loadRepos()
    return () => clearInterval(pollRef.current)
  }, [])

  // Start GitHub OAuth in a new tab, then poll until Composio reports it connected → reload repos.
  const connectGithub = async () => {
    setErr(''); setConnecting(true)
    try {
      const { redirectUrl } = await composioAuthorize('github')
      if (redirectUrl) window.open(redirectUrl, '_blank', 'noopener')
      clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        try {
          const s = await composioStatus()
          if ((s?.toolkits || []).includes('github')) {
            clearInterval(pollRef.current); setGhConnected(true); setConnecting(false); loadRepos()
          }
        } catch { /* keep polling */ }
      }, 2500)
    } catch (e) { setErr('Could not start GitHub connect.'); setConnecting(false) }
  }
  const save = async (repo) => {
    const v = (repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '')
    if (!/^[\w.-]+\/[\w.-]+$/.test(v)) { setErr('Enter a repo as owner/repo (e.g. vercel/next.js).'); return }
    setSaving(true); setErr('')
    try { await onSave(v) } catch { setErr('Could not connect that repo.') } finally { setSaving(false) }
  }
  const list = (repos || []).filter(r => r.toLowerCase().includes(q.toLowerCase()))
  const canSave = /\S+\/\S+/.test(q.trim())
  return (
    <div className="cc-modal-scrim" onMouseDown={onClose}>
      <div className="cc-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="cc-modal-title">Connect a repository</div>
        <div className="cc-modal-sub">@nimbus reads this repo — its code, commits and PRs — when you ask in a channel.</div>
        <div className="cc-modal-search">{I.search()}
          <input autoFocus placeholder="Search your repos, or paste owner/repo" value={q}
            onChange={e => { setQ(e.target.value); setErr('') }}
            onKeyDown={e => { if (e.key === 'Enter' && canSave) save(q) }} />
        </div>
        <div className="cc-modal-list">
          {repos === null ? <div className="cc-modal-empty">Loading your repos…</div>
            : list.length ? list.slice(0, 40).map(r => (
              <button key={r} className={'cc-repo-row' + (r === current ? ' on' : '')} onClick={() => save(r)} disabled={saving}>
                {I.github()}<span>{r}</span>{r === current && <span className="cc-repo-ck">connected</span>}
              </button>
            )) : (
              <div className="cc-modal-empty">
                {ghConnected
                  ? <>No repos match. Paste any <b>owner/repo</b> above and hit Connect.</>
                  : <>GitHub isn’t connected yet — connect it to list your repos, or paste any public <b>owner/repo</b> above and hit Connect.</>}
                {!ghConnected && (
                  <button className="cc-gh-btn" onClick={connectGithub} disabled={connecting}>
                    {I.github()}{connecting ? 'Waiting for GitHub…' : 'Connect GitHub'}
                  </button>
                )}
              </div>
            )}
        </div>
        {err && <div className="cc-modal-err">{err}</div>}
        <div className="cc-modal-foot">
          {current && <span className="cc-modal-current">Now: <b>{current}</b></span>}
          <div className="cc-composer-spacer" />
          <button className="cc-modal-btn ghost" onClick={onClose}>Cancel</button>
          <button className="cc-modal-btn primary" disabled={!canSave || saving} onClick={() => save(q)}>
            {saving ? 'Connecting…' : 'Connect repo'}
          </button>
        </div>
      </div>
    </div>
  )
}
