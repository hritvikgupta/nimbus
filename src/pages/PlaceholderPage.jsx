import { Icon } from '../components/common/Icons.jsx'

// Mirrors the old Dashboard "demo shell" empty card for non-live panels.
export default function PlaceholderPage({ title = 'Panel', icon = 'gear' }) {
  return (
    <div className="content fade" style={{ paddingTop: 16 }}>
      <div className="card glow"><div className="empty">
        <Icon name={icon} size={26} /><br/><br/>
        <b style={{ color: 'var(--text)' }}>{title}</b><br/>
        This panel is part of the demo shell. The live area is Overview, AI Agents &amp; Architecture.
      </div></div>
    </div>
  )
}
