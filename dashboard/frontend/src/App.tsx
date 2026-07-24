/**
 * Main application shell for the Engineering Delivery Intelligence Dashboard.
 *
 * This component sets up the React Router configuration to navigate between
 * all dashboard pages including home, users, projects, sprints, board views,
 * and issue lists. It uses BrowserRouter for client-side routing without page reloads.
 *
 * @see {@link Home} - Dashboard home page with overview widgets
 * @see {@link Users} - User management and team load view
 * @see {@link Projects} - Project list with board type controls
 * @see {@link SprintHealth} - Sprint-level health metrics
 * @see {@link BoardPage} - Kanban/Scrum board view for a project
 * @see {@link IssueListPage} - Detailed issue list for a project
 */
import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { Users } from './pages/Users';
import { Projects } from './pages/Projects';
import { SprintHealth } from './pages/SprintHealth';
import { BoardPage } from './pages/BoardPage';
import { IssueListPage } from './pages/IssueListPage';
import { UserProfilePage } from './pages/UserProfilePage';
import { BacklogPage } from './pages/BacklogPage';
import { ActivityPage } from './pages/ActivityPage';
import { NotesPage } from './pages/NotesPage';
import { DeadlinesPage } from './pages/DeadlinesPage';
import { WatchlistPage } from './pages/WatchlistPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { LastSyncedFooter } from './components/LastSyncedFooter';
import { SyncProgressBar } from './components/SyncProgressBar';
import { SyncProgressProvider, useSyncProgress } from './contexts/SyncProgressContext';
import { fetchSyncStatus } from './api/client';

/**
 * Root application component that renders the navigation structure.
 *
 * Provides the main routing configuration for the dashboard. All routes
 * are defined here, mapping URL paths to their corresponding page components.
 *
 * The component wraps the entire application in two providers:
 * - `SyncProgressProvider` — exposes sync progress state to all descendants
 *   via React context, enabling the `SyncProgressBar` to display real-time
 *   progress indicators regardless of which page the user is on.
 * - `BrowserRouter` — enables client-side routing powered by React Router v6,
 *   allowing navigation between pages without full page reloads.
 *
 * Route summary:
 * - `/` — Home / dashboard overview
 * - `/users` — User management and team workload
 * - `/users/:userId` — Individual user profile
 * - `/projects` — Project listing with board type controls
 * - `/sprints` — Sprint-level health metrics
 * - `/board/:projectId` — Kanban / Scrum board for a specific project
 * - `/board/:projectId/issues` — Detailed issue list for a specific project
 * - `/backlog/:projectId` — Backlog view for a specific project
 *
 * @returns The rendered application shell with routing and progress tracking.
 */
function AppContent() {
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const { syncActive } = useSyncProgress();

  useEffect(() => {
    fetchSyncStatus().then(({ lastSyncedAt: ts }) => setLastSyncedAt(ts)).catch(() => {});
  }, []);

  // Re-fetch the footer timestamp when a background sync completes so the
  // "Last synced" message reflects the manual sync without a page reload.
  const wasSyncActive = useRef(false);
  useEffect(() => {
    if (wasSyncActive.current && !syncActive) {
      fetchSyncStatus().then(({ lastSyncedAt: ts }) => setLastSyncedAt(ts)).catch(() => {});
    }
    wasSyncActive.current = syncActive;
  }, [syncActive]);

  return (
    <>
      <BrowserRouter>
        <SyncProgressBar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/users" element={<Users />} />
          <Route path="/users/:userId" element={<UserProfilePage />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/sprints" element={<SprintHealth />} />
          <Route path="/board/:projectId" element={<BoardPage />} />
          <Route path="/board/:projectId/issues" element={<IssueListPage />} />
          <Route path="/backlog/:projectId" element={<BacklogPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/notes/new" element={<NotesPage />} />
          <Route path="/notes/:noteId" element={<NotesPage />} />
          <Route path="/deadlines" element={<DeadlinesPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
        </Routes>
      </BrowserRouter>
      <LastSyncedFooter lastSyncedAt={lastSyncedAt} />
    </>
  );
}

export default function App() {
  return (
    <SyncProgressProvider>
      <AppContent />
    </SyncProgressProvider>
  );
}
