import { useNavigate } from 'react-router-dom'
import Landing from '../components/landing/SplitLanding.jsx'
import { useAuth } from '../context/AuthContext.jsx'

export default function LandingPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  return <Landing onEnter={() => navigate(user ? '/app' : '/login')} />
}
