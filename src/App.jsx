import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import LandingPage from './pages/LandingPage.jsx'
import OverviewPage from './pages/OverviewPage.jsx'
import ResourcesPage from './pages/ResourcesPage.jsx'
import ResourceDetailPage from './pages/ResourceDetailPage.jsx'
import CostPage from './pages/CostPage.jsx'
import ConnectionsPage from './pages/ConnectionsPage.jsx'
import OnboardingFlow from './pages/OnboardingFlow.jsx'
import AppShell, { ChannelsPage, FilesPage, RepairPage, MembersPage, SessionsPage, CanvasPage, DashPanel } from './pages/CodeChatPage.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      {/* Single flow: auth → connect GitHub → analyze → map → connect cloud → done. Self-guards on user/onboarded. */}
      <Route path="/login" element={<OnboardingFlow />} />
      <Route path="/onboarding" element={<OnboardingFlow />} />

      {/* One unified workspace — a far-left icon rail switches between routed sections. */}
      <Route path="/app" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
        <Route index element={<Navigate to="/app/chat" replace />} />
        <Route path="chat" element={<ChannelsPage />} />
        <Route path="chat/:chatId" element={<ChannelsPage />} />
        <Route path="channels" element={<Navigate to="/app/chat" replace />} />
        <Route path="channels/:channelId" element={<ChannelsPage />} />
        <Route path="machine/:workerId" element={<ChannelsPage />} />
        <Route path="files" element={<FilesPage />} />
        <Route path="repair" element={<RepairPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="canvas" element={<CanvasPage />} />
        <Route path="overview" element={<DashPanel><OverviewPage /></DashPanel>} />
        <Route path="resources" element={<DashPanel><ResourcesPage /></DashPanel>} />
        <Route path="resources/:id" element={<DashPanel><ResourceDetailPage /></DashPanel>} />
        <Route path="cost" element={<DashPanel><CostPage /></DashPanel>} />
        <Route path="connections" element={<DashPanel><ConnectionsPage /></DashPanel>} />
        <Route path="members" element={<MembersPage />} />
      </Route>

      {/* Legacy paths → the unified workspace. */}
      <Route path="/code" element={<Navigate to="/app/chat" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
