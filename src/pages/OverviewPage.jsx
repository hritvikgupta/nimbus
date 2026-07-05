import { useNavigate, useOutletContext } from 'react-router-dom'
import { Overview } from '../components/sections/index.jsx'
import { useCloudData } from '../lib/useCloudData.js'

export default function OverviewPage() {
  const navigate = useNavigate()
  const { overview, loading, error } = useCloudData()
  const { project } = useOutletContext() || {}
  // overview.resources is already scoped to the active project server-side.
  return (
    <Overview
      overview={overview}
      project={project}
      loading={loading}
      error={error}
      onRowClick={r => navigate(`/app/resources/${encodeURIComponent(r.name)}`)}
    />
  )
}
