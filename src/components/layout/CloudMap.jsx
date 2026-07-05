import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactFlow, {
  Controls, ReactFlowProvider, Handle, Position,
  useNodesState, useEdgesState, addEdge, MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { getGraph, saveGraph } from '../../lib/api.js'

// Category colors (sampled from the reference).
const C = {
  green: '#3aa55d', orange: '#d99a2c', red: '#d9694a',
  blue: '#5b8def', purple: '#8b5cf6', teal: '#40ae9b', slate: '#829caf',
}
function dotFor(r) {
  const t = `${r.type || ''} ${r.name || ''}`.toLowerCase()
  if (/comput|instance|vm|ec2|run|lambda|function|fargate|ecs|app/.test(t)) return C.blue
  if (/stor|bucket|s3|disk|volume|blob/.test(t)) return C.green
  if (/data|sql|postgres|rds|mysql|mongo|redis|cache|db/.test(t)) return C.orange
  if (/network|vpc|subnet|lb|balanc|dns|cdn|cloudfront|gateway/.test(t)) return C.teal
  if (/iam|security|role|policy|secret|kms/.test(t)) return C.purple
  return C.slate
}
const rkey = (r) => `${r.cloud}:${r.name}`
// Clouds whose live state we read from inventory (for the anti-ghost "deployed must match a real
// resource" check). Managed-DB providers like neon/supabase aren't inventoried, so a deployed
// node on them is Live by status alone.
const INVENTORIED = new Set(['aws', 'gcp', 'azure'])

// Category → a clean line glyph (no external icon assets). Mirrors dotFor's buckets.
function kindFor(type, name) {
  const t = `${type || ''} ${name || ''}`.toLowerCase()
  if (/comput|instance|vm|ec2|run|lambda|function|fargate|ecs|app/.test(t)) return 'compute'
  if (/stor|bucket|s3|disk|volume|blob/.test(t)) return 'storage'
  if (/data|sql|postgres|rds|mysql|mongo|db/.test(t)) return 'database'
  if (/cache|redis|memcache|elasticache/.test(t)) return 'cache'
  if (/network|vpc|subnet|lb|balanc|dns|cdn|cloudfront|gateway/.test(t)) return 'network'
  if (/iam|security|role|policy|secret|kms|shield/.test(t)) return 'security'
  return 'box'
}
const ICON_PATHS = {
  compute: <><rect x="3.5" y="3.5" width="13" height="5" rx="1.2" /><rect x="3.5" y="11.5" width="13" height="5" rx="1.2" /><circle cx="6" cy="6" r=".7" fill="currentColor" stroke="none" /><circle cx="6" cy="14" r=".7" fill="currentColor" stroke="none" /></>,
  storage: <><path d="M4 5h12l-1.1 10.8a1 1 0 0 1-1 .9H6.1a1 1 0 0 1-1-.9L4 5z" /><path d="M3.4 5h13.2" /></>,
  database: <><ellipse cx="10" cy="5.4" rx="6" ry="2.3" /><path d="M4 5.4v9.2c0 1.27 2.69 2.3 6 2.3s6-1.03 6-2.3V5.4" /><path d="M4 10c0 1.27 2.69 2.3 6 2.3s6-1.03 6-2.3" /></>,
  cache: <path d="M11 2.5 4.5 11H9l-1 6.5L15.5 9H11l1-6.5z" strokeLinejoin="round" />,
  network: <><circle cx="10" cy="4" r="2" /><circle cx="4.5" cy="15.5" r="2" /><circle cx="15.5" cy="15.5" r="2" /><path d="M10 6v3M10 9l-4.6 4.6M10 9l4.6 4.6" /></>,
  security: <path d="M10 2.6 4 5v4.6c0 4 2.6 6.3 6 7.4 3.4-1.1 6-3.4 6-7.4V5l-6-2.4z" strokeLinejoin="round" />,
  box: <rect x="4" y="4" width="12" height="12" rx="2.2" />,
}
function NodeIcon({ kind }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      {ICON_PATHS[kind] || ICON_PATHS.box}
    </svg>
  )
}
// light tint of a hex color for the icon tile background
function tintOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return 'rgba(130,156,175,.12)'
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, .13)`
}

// The config the agent chose, shown verbatim as key: value chips. No inference / formatting —
// whatever the agent stored on the node is what we display.
function specChips(spec) {
  if (!spec || typeof spec !== 'object') return []
  return Object.entries(spec)
    .filter(([, v]) => v != null && v !== '')
    .slice(0, 6)
    .map(([k, v]) => ({ k, value: (v && typeof v === 'object') ? JSON.stringify(v) : String(v) }))
}

/* ---- a professional, connectable service node (icon tile · name · meta · status · spec) ---- */
function ResourceNode({ data }) {
  const kind = kindFor(data.type, data.label)
  const chips = specChips(data.spec)
  return (
    <div className={'cm-node' + (data.planned ? ' planned' : '') + (data.stopped ? ' stopped' : '')}>
      <Handle type="target" position={Position.Left} className="cm-h" />
      <div className="cm-node-head">
        <div className="cm-node-ico" style={{ color: data.color, background: tintOf(data.color) }}>
          <NodeIcon kind={kind} />
        </div>
        <div className="cm-node-name">{data.label}</div>
        <span className={'cm-node-status ' + (data.planned ? 'planned' : data.stopped ? 'stopped' : 'live')}>
          <span className="cm-st-dot" />{data.planned ? 'Planned' : data.stopped ? 'Stopped' : 'Live'}
        </span>
      </div>
      <div className="cm-node-sub">{(data.cloud || '').toUpperCase()} · {data.type}{data.region && data.region !== '—' ? ` · ${data.region}` : ''}</div>
      {chips.length > 0 && (
        <div className="cm-node-spec">
          {chips.map((c) => (
            <span className="cm-chip" key={c.k} title={`${c.k}: ${c.value}`}>
              <span className="cm-chip-k">{c.k}</span><span className="cm-chip-v">{c.value}</span>
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="cm-h" />
    </div>
  )
}
const nodeTypes = { resource: ResourceNode }

const edgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#a8a294' },
  style: { stroke: '#b9b3a4', strokeWidth: 1.5 },
}

/* Dependency-layered auto-layout: columns by longest path from a root (no incoming edge),
   rows centered within each column — so it reads left→right (lb → apps → data tier). Used
   for any node the user hasn't manually placed. */
const COL_W = 380, ROW_H = 270
function layeredPositions(items, edgeList) {
  const ids = new Set(items.map((it) => it.id))
  const adj = new Map(items.map((it) => [it.id, []]))
  const indeg = new Map(items.map((it) => [it.id, 0]))
  for (const e of edgeList || []) {
    if (ids.has(e.source) && ids.has(e.target)) { adj.get(e.source).push(e.target); indeg.set(e.target, indeg.get(e.target) + 1) }
  }
  const layer = new Map(items.map((it) => [it.id, 0]))
  const work = new Map(indeg)
  const queue = items.filter((it) => work.get(it.id) === 0).map((it) => it.id)
  let guard = 0
  while (queue.length && guard++ < 1000) {
    const u = queue.shift()
    for (const v of adj.get(u)) {
      layer.set(v, Math.max(layer.get(v), layer.get(u) + 1))
      work.set(v, work.get(v) - 1)
      if (work.get(v) === 0) queue.push(v)
    }
  }
  const byLayer = new Map()
  for (const it of items) { const l = layer.get(it.id) || 0; (byLayer.get(l) || byLayer.set(l, []).get(l)).push(it.id) }
  const maxRows = Math.max(1, ...[...byLayer.values()].map((a) => a.length))
  const pos = {}
  for (const [l, idsAtLayer] of byLayer) {
    const offset = (maxRows - idsAtLayer.length) * ROW_H / 2
    idsAtLayer.forEach((id, r) => { pos[id] = { x: l * COL_W, y: offset + r * ROW_H } })
  }
  return pos
}

function CloudMapInner({ project, resources, graphTick, onNodeSelect }) {
  const navigate = useNavigate()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const projectId = project?.id

  const posRef = useRef({})     // node id -> {x,y} (pinned + last auto-computed)
  const pinnedRef = useRef(new Set()) // ids the user has manually placed (won't auto-layout)
  const designRef = useRef([])  // agent-designed (planned/deployed) nodes from the graph
  const edgeDataRef = useRef([]) // raw [{source,target}] for layout
  const nodesRef = useRef([])
  const edgesRef = useRef([])
  const ready = useRef(false)
  const saveT = useRef(null)
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { edgesRef.current = edges }, [edges])

  // Build the canvas from the agent's designed nodes (the PERMANENT backbone) + any live
  // resources created outside the canvas. A design node's id NEVER changes across
  // planned → deployed → terminated, so the edges drawn between nodes stay attached the whole
  // time. We just overlay live state onto each node:
  //   · planned node                         → faded "planned" badge
  //   · deployed node with a live inventory   → solid, shows the real type/region/health
  //   · deployed node whose resource is gone  → falls back to "planned" (no ghost; this is
  //     what makes a terminated node stay on the canvas instead of vanishing)
  // Live resources that DON'T correspond to any design node (made directly in the cloud) are
  // appended as their own standalone nodes so inventory is still complete.
  const rebuild = useCallback((list) => {
    const reals = list || []
    const realByKey = new Map(reals.map((r) => [rkey(r), r]))
    const matchedKeys = new Set()
    const designByRealKey = new Set()
    const items = designRef.current.map((n) => {
      const liveKey = `${n.cloud}:${n.realName || n.name}`
      designByRealKey.add(liveKey)
      const real = n.status === 'deployed' ? realByKey.get(liveKey) : null
      if (real) matchedKeys.add(liveKey)
      // Providers we don't inventory (neon, supabase, …) can't be matched to AWS/GCP live state,
      // so a deployed node on those is Live by its own status (no anti-ghost inventory check).
      const offInventoryLive = n.status === 'deployed' && !INVENTORIED.has(n.cloud)
      return {
        id: n.id, cloud: n.cloud,
        type: real?.type || n.type,
        name: n.name,
        region: real?.region || n.region,
        spec: n.spec, // the config the agent chose (instance size, storage, engine…) — shown on the node
        planned: !(real || offInventoryLive), // deployed+live → solid; planned/terminated → faded
        stopped: real ? (!!real.status && real.status !== 'healthy') : false, // live but not running (e.g. stopped VM)
      }
    })
    for (const r of reals) {
      const key = rkey(r)
      if (matchedKeys.has(key) || designByRealKey.has(key)) continue // already shown as a design node
      items.push({ id: key, cloud: r.cloud, type: r.type, name: r.name, region: r.region, planned: false, stopped: !!r.status && r.status !== 'healthy' })
    }
    const auto = layeredPositions(items, edgeDataRef.current)
    const next = items.map((it) => {
      const pos = (pinnedRef.current.has(it.id) && posRef.current[it.id]) || auto[it.id] || { x: 0, y: 0 }
      posRef.current[it.id] = pos
      return { id: it.id, type: 'resource', position: pos, data: { label: it.name, type: it.type, cloud: it.cloud, region: it.region, color: dotFor(it), planned: it.planned, stopped: it.stopped, spec: it.spec } }
    })
    setNodes(next)
    const ids = new Set(next.map((n) => n.id))
    setEdges((es) => es.filter((e) => ids.has(e.source) && ids.has(e.target)))
  }, [setNodes, setEdges])

  // Load the saved graph whenever the project changes.
  useEffect(() => {
    if (!projectId) return
    ready.current = false
    getGraph(projectId)
      .then((g) => {
        posRef.current = g?.positions || {}
        pinnedRef.current = new Set(Object.keys(g?.positions || {})) // saved positions = user-placed
        designRef.current = g?.nodes || []
        edgeDataRef.current = g?.edges || []
        setEdges((g?.edges || []).map((e) => ({ ...e, ...edgeOptions })))
      })
      .catch(() => { posRef.current = {}; pinnedRef.current = new Set(); designRef.current = []; edgeDataRef.current = []; setEdges([]) })
      .finally(() => { ready.current = true; rebuild(resources) })
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // After / during an agent turn, reload the design nodes + edges (it just drew/deployed them).
  useEffect(() => {
    if (!projectId || !ready.current || !graphTick) return
    getGraph(projectId).then((g) => {
      designRef.current = g?.nodes || []
      edgeDataRef.current = g?.edges || []
      setEdges((prev) => {
        const have = new Set(prev.map((e) => e.id))
        const add = (g?.edges || []).filter((e) => !have.has(e.id)).map((e) => ({ ...e, ...edgeOptions }))
        return [...prev, ...add]
      })
      rebuild(resources)
    }).catch(() => {})
  }, [graphTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reconcile nodes when the resource list changes (agent created/removed something).
  useEffect(() => { if (ready.current) rebuild(resources) }, [resources, rebuild])

  const persist = useCallback(() => {
    if (!projectId || !ready.current) return
    clearTimeout(saveT.current)
    saveT.current = setTimeout(() => {
      // Persist ONLY user-pinned positions; auto-laid-out nodes recompute deterministically.
      const positions = {}
      nodesRef.current.forEach((n) => { if (pinnedRef.current.has(n.id)) positions[n.id] = n.position })
      saveGraph(projectId, { positions, edges: edgesRef.current.map((e) => ({ id: e.id, source: e.source, target: e.target })) }).catch(() => {})
    }, 500)
  }, [projectId])

  const onConnect = useCallback((c) => {
    setEdges((es) => addEdge({ ...c, ...edgeOptions }, es))
    edgeDataRef.current = [...edgeDataRef.current, { source: c.source, target: c.target }]
    setTimeout(persist, 0)
  }, [setEdges, persist])
  const onNodeDragStop = useCallback((_e, node) => { if (node?.id) { pinnedRef.current.add(node.id); posRef.current[node.id] = node.position } persist() }, [persist])
  const onEdgesDelete = useCallback(() => setTimeout(persist, 0), [persist])
  // Click a node → open its detail in the right Resources tab (service-specific, editable).
  const onNodeClick = useCallback((_e, node) => {
    if (onNodeSelect) onNodeSelect(node)               // canvas page: open the right drawer in place
    else navigate(`/app/resources/${encodeURIComponent(node.id)}`)
  }, [navigate, onNodeSelect])

  const empty = !nodes.length

  return (
    <div className="cm-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onEdgesDelete={onEdgesDelete}
        defaultEdgeOptions={edgeOptions}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
      >
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      {empty && <div className="cm-empty-hint">No services yet — switch the chat to <b>Design</b> mode and tell the agent what to build; it'll draw the architecture here. Then switch to <b>Agent</b> mode to deploy it.</div>}
    </div>
  )
}

export default function CloudMap(props) {
  return (
    <ReactFlowProvider>
      <CloudMapInner {...props} />
    </ReactFlowProvider>
  )
}
