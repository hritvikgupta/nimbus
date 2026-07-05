/**
 * CanvasPage — a full page for the project's architecture canvas (the same CloudMap that opens as a
 * split-view from the Nimbus chat). Layout: the canvas fills the left, the SAME Nimbus chat from the
 * channels page sits on the right, and clicking any resource opens its detail in a right-side drawer
 * over the canvas. Routed at /app/canvas, scoped to the active project via the outlet context.
 */
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import CloudMap from '../components/layout/CloudMap.jsx'
import { CanvasChat, NodeDetail, cloudShort } from '../components/sections/index.jsx'
import { getGraph } from '../lib/api.js'
import { I } from '../components/workspace/icons.jsx'

export function CanvasPage() {
  const ctx = useOutletContext()
  const { project, overview, graphTick } = ctx
  const [graph, setGraph] = useState(null)
  const [selId, setSelId] = useState(null)
  const [chatId, setChatId] = useState(null)

  useEffect(() => {
    if (!project?.id) return
    getGraph(project.id).then(setGraph).catch(() => setGraph({ nodes: [] }))
  }, [project?.id, graphTick])

  // close the drawer when switching projects
  useEffect(() => { setSelId(null) }, [project?.id])

  const resources = overview?.resources || []
  // Resolve the clicked node id to a unified node — a live resource takes precedence over a design node.
  const real = selId && resources.find(r => r.name === selId || `${r.cloud}:${r.name}` === selId)
  const designNode = selId && (graph?.nodes || []).find(n => n.id === selId || n.name === selId)
  let node = null
  if (real) node = { id: designNode?.id || `${real.cloud}:${real.name}`, name: real.name, type: real.type, cloud: real.cloud, region: real.region, status: 'deployed', spec: designNode?.spec || {} }
  else if (designNode) node = designNode
  const dot = node?.status === 'deployed' ? '#6ab98f' : '#cda94e'

  return (
    <div className="cc-dash canvas-page">
      <header className="cc-top">
        <div className="cc-top-name">{I.layout()}<span>Canvas{project?.name ? ` — ${project.name}` : ''}</span></div>
        <div className="cc-top-spacer" />
        <span className="muted" style={{ fontSize: 12.5 }}>{project?.repo || 'architecture'}</span>
      </header>

      <div className="canvas-split">
        {/* ── canvas + resource drawer ── */}
        <div className="canvas-stage">
          <CloudMap project={project} resources={resources} graphTick={graphTick} onNodeSelect={(n) => setSelId(n.id)} />
          {node && (
            <aside className="canvas-res-drawer">
              <header className="canvas-res-head">
                <div>
                  <div className="rd-name">{node.name}</div>
                  <div className="rd-meta"><span className="cloud-tag">{cloudShort[node.cloud] || node.cloud}</span> {node.type} · {node.region || '—'}
                    <span className="rd-status"><span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, display: 'inline-block' }} /> {node.status || 'planned'}</span>
                  </div>
                </div>
                <button className="canvas-res-x" title="Close" onClick={() => setSelId(null)}>{I.x()}</button>
              </header>
              <div className="canvas-res-body">
                {(real || node.status === 'deployed')
                  ? <NodeDetail node={node} projectId={project?.id} real={!!real} />
                  : (
                    <div className="rd-undeployed">
                      <div className="rd-undeployed-title">Not deployed yet</div>
                      <div className="rd-undeployed-sub">This is a planned node on your canvas. <b>Deploy it</b> to manage its live configuration — switch the chat to <b>Agent</b> mode and say “deploy”.</div>
                    </div>
                  )}
              </div>
            </aside>
          )}
        </div>

        {/* ── the same Nimbus chat as the channels page ── */}
        <aside className="canvas-chat">
          <CanvasChat chatId={chatId} onChatChange={setChatId} />
        </aside>
      </div>
    </div>
  )
}
