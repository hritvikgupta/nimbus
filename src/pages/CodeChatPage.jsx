/* Barrel — the workspace was split into AppShell + ChannelsPage + MembersPage and the reusable
   widgets in ../components/workspace/. This keeps the original import path stable for the router. */
export { default, DashPanel } from './AppShell.jsx'
export { ChannelsPage, FilesPage, RepairPage } from './ChannelsPage.jsx'
export { MembersPage } from './MembersPage.jsx'
export { SessionsPage } from './SessionsPage.jsx'
export { CanvasPage } from './CanvasPage.jsx'
