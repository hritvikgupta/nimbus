import { useState, useCallback } from 'react'
import ReactFlow, {
  Background, Controls, Handle, Position,
  useNodesState, useEdgesState, addEdge,
} from 'reactflow'
import 'reactflow/dist/style.css'
import '../../styles/architecture.css'

/* ---- custom resource node (dark, cloud-tagged) ---- */
function ResourceNode({ data, selected }) {
  return (
    <div className={'rf-node' + (selected ? ' sel' : '')}>
      <Handle type="target" position={Position.Left} className="rf-handle" />
      <div className="rf-node-top">
        <span className="rf-cloud">{(data.cloud || '').toUpperCase()}</span>
        <span className="rf-type">{data.type}</span>
      </div>
      <div className="rf-node-label">{data.label}</div>
      {data.region && <div className="rf-node-region">{data.region}</div>}
      <Handle type="source" position={Position.Right} className="rf-handle" />
    </div>
  )
}
const nodeTypes = { resource: ResourceNode }

const N = (id, x, y, label, type, cloud, region) =>
  ({ id, type: 'resource', position: { x, y }, data: { label, type, cloud, region } })

const INIT_NODES = [
  N('cf',  40,  40,  'CloudFront',    'CDN',           'aws', 'global'),
  N('alb', 300, 40,  'ALB',           'Load Balancer', 'aws', 'eu-west-1'),
  N('ecs', 560, 40,  'ECS Fargate',   'Compute',       'aws', 'eu-west-1'),
  N('rds', 560, 200, 'RDS Postgres',  'Database',      'aws', 'eu-west-1'),
  N('s3',  40,  200, 'S3 assets',     'Storage',       'aws', 'global'),
  N('run', 300, 320, 'Cloud Run',     'Compute',       'gcp', 'us-central1'),
  N('sql', 560, 320, 'Cloud SQL',     'Database',      'gcp', 'us-central1'),
]
const E = (s, t) => ({ id: `${s}-${t}`, source: s, target: t, animated: true })
const INIT_EDGES = [E('cf','alb'), E('alb','ecs'), E('ecs','rds'), E('cf','s3'), E('run','sql')]

export function Architecture() {
  const [nodes, setNodes, onNodesChange] = useNodesState(INIT_NODES)
  const [edges, setEdges, onEdgesChange] = useEdgesState(INIT_EDGES)
  const [pop, setPop] = useState(null) // { id, x, y }
  const sel = pop && nodes.find(n => n.id === pop.id)

  const onConnect = useCallback((p) => setEdges(eds => addEdge({ ...p, animated: true }, eds)), [setEdges])
  const onNodeClick = useCallback((e, node) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.min(r.right + 10, window.innerWidth - 268)
    setPop({ id: node.id, x, y: Math.max(70, r.top) })
  }, [])

  const patch = (field, val) =>
    setNodes(ns => ns.map(n => n.id === pop.id ? { ...n, data: { ...n.data, [field]: val } } : n))
  const del = () => {
    setNodes(ns => ns.filter(n => n.id !== pop.id))
    setEdges(es => es.filter(e => e.source !== pop.id && e.target !== pop.id))
    setPop(null)
  }
  const addNode = () => {
    const id = 'n' + Date.now()
    setNodes(ns => [...ns, N(id, 160, 160, 'New resource', 'Service', 'aws', 'eu-west-1')])
  }

  return (
    <div className="arch-wrap">
      <div className="arch-stage">
        <div className="arch-canvas">
          <div className="arch-hint">drag to move · drag from a handle to connect · click a node to edit</div>
          <button className="arch-add" onClick={addNode}>+ Add node</button>
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={() => setPop(null)}
            fitView fitViewOptions={{ padding: 0.28, maxZoom: 1 }} minZoom={0.3} maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ animated: true, style: { stroke: '#3a3a3a' } }}
          >
            <Background color="#2c2c30" gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>

      {sel && (
        <div className="arch-pop" style={{ left: pop.x, top: pop.y }}>
          <div className="arch-pop-head">
            <span>Edit node</span>
            <button onClick={() => setPop(null)} aria-label="Close">✕</button>
          </div>
          <label>Name
            <input value={sel.data.label} onChange={e => patch('label', e.target.value)} />
          </label>
          <label>Type
            <input value={sel.data.type} onChange={e => patch('type', e.target.value)} />
          </label>
          <label>Cloud
            <select value={sel.data.cloud} onChange={e => patch('cloud', e.target.value)}>
              <option value="aws">AWS</option>
              <option value="gcp">GCP</option>
              <option value="azure">Azure</option>
            </select>
          </label>
          <label>Region
            <input value={sel.data.region || ''} onChange={e => patch('region', e.target.value)} />
          </label>
          <button className="arch-del" onClick={del}>Delete node</button>
        </div>
      )}
    </div>
  )
}
