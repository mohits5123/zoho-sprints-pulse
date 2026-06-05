import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { Users } from './pages/Users';
import { Projects } from './pages/Projects';
import { SprintHealth } from './pages/SprintHealth';
import { BoardPage } from './pages/BoardPage';
import { IssueListPage } from './pages/IssueListPage';
import { UserProfilePage } from './pages/UserProfilePage';

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
