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
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { Users } from './pages/Users';
import { Projects } from './pages/Projects';
import { SprintHealth } from './pages/SprintHealth';
import { BoardPage } from './pages/BoardPage';
import { IssueListPage } from './pages/IssueListPage';
import { UserProfilePage } from './pages/UserProfilePage';

/**
 * Root application component that renders the navigation structure.
 *
 * Provides the main routing configuration for the dashboard. All routes
 * are defined here, mapping URL paths to their corresponding page components.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/users" element={<Users />} />
        <Route path="/users/:userId" element={<UserProfilePage />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/sprints" element={<SprintHealth />} />
        <Route path="/board/:projectId" element={<BoardPage />} />
        <Route path="/board/:projectId/issues" element={<IssueListPage />} />
      </Routes>
    </BrowserRouter>
  );
}
