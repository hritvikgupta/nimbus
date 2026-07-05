import { useNavigate } from 'react-router-dom'
import { Resources } from '../components/sections/index.jsx'
import { useCloudData } from '../lib/useCloudData.js'

export default function ResourcesPage() {
  const navigate = useNavigate()
  const { overview, loading, error } = useCloudData()
  // overview.resources is already scoped to the active project server-side.
  return (
    <Resources
      resources={overview ? overview.resources : undefined}
      connected={(overview?.connections?.length || 0) > 0}
      loading={loading}
      error={error}
      onRowClick={r => navigate(`/app/resources/${encodeURIComponent(r.name)}`)}
    />
  )
}
