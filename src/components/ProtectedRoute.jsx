import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function ProtectedRoute({ children, requireOnboarded = true }) {
  const { user, loading } = useAuth()
  if (loading) return null            // still bootstrapping the session
  if (!user) return <Navigate to="/login" replace />
  // New accounts (onboarded === false) go through the setup wizard first.
  if (requireOnboarded && user.onboarded === false) return <Navigate to="/onboarding" replace />
  return children
}
