import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { NodeDetail, cloudShort } from '../components/sections/index.jsx'
import { useCloudData } from '../lib/useCloudData.js'
import { getGraph } from '../lib/api.js'

// One detail view for BOTH a live resource and a planned canvas node. Opened from the canvas
// (click a node) or the Resources table. Renders a service-specific, editable config form.
export default function ResourceDetailPage() {
  const { id } = useParams()
  const { overview, activeProjectId, loading } = useCloudData()
  const [graph, setGraph] = useState(null)

  useEffect(() => {
    if (!activeProjectId) return
    getGraph(activeProjectId).then(setGraph).catch(() => setGraph({ nodes: [] }))
  }, [activeProjectId])

  const resources = overview?.resources || []
  const real = resources.find(r => r.name === id || `${r.cloud}:${r.name}` === id)
  const designNode = (graph?.nodes || []).find(n => n.id === id || n.name === id)

  if ((loading && !overview) || (activeProjectId && graph === null)) {
    return <div className="content fade"><div className="card glow"><div className="empty">Loading…</div></div></div>
  }

  // Unified node: a real resource takes precedence (and reuses any saved spec from its design node).
  let node = null
  if (real) node = { id: designNode?.id || `${real.cloud}:${real.name}`, name: real.name, type: real.type, cloud: real.cloud, region: real.region, status: 'deployed', spec: designNode?.spec || {} }
  else if (designNode) node = designNode

  if (!node) {
    return (
      <div className="content fade">
        <div className="card glow"><div className="empty">
          <b style={{ color: 'var(--text)' }}>Resource not found</b><br /><br />
          <Link to="/app/resources" style={{ color: 'var(--accent)' }}>← Back to resources</Link>
        </div></div>
      </div>
    )
  }

  const dot = node.status === 'deployed' ? '#6ab98f' : '#cda94e'
  // Rendered INLINE in the scrolling panel (no outer card) so the stat/cost boxes don't look
  // like nested cards and the whole thing scrolls to the Save button.
  return (
    <div className="content fade rd-page">
      <Link to="/app/resources" style={{ color: 'var(--muted)', fontSize: 13, textDecoration: 'none' }}>← Back to resources</Link>
      <div className="rd-head">
        <div>
          <div className="rd-name">{node.name}</div>
          <div className="rd-meta"><span className="cloud-tag">{cloudShort[node.cloud] || node.cloud}</span> {node.type} · {node.region || '—'}
            <span className="rd-status"><span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, display: 'inline-block' }} /> {node.status || 'planned'}</span>
          </div>
        </div>
      </div>
      {(real || node.status === 'deployed') ? (
        <NodeDetail node={node} projectId={activeProjectId} real={!!real} />
      ) : (
        <div className="rd-undeployed">
          <div className="rd-undeployed-title">Not deployed yet</div>
          <div className="rd-undeployed-sub">This is a planned node on your canvas. <b>Deploy it</b> to see and manage its live configuration here — switch the chat to <b>Agent</b> mode and say “deploy”.</div>
        </div>
      )}
    </div>
  )
}
