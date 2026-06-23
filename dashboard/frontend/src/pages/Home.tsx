/**
 * Home/Dashboard page component.
 *
 * Landing page showing connection status, sync controls, and quick navigation to main sections:
 * - Team: View all team members (synced from Zoho)
 * - Projects: View all projects (synced from Zoho)
 * - Sprints: View active sprint status (synced from Zoho)
 * - Zoho Connection: Display connection details and token expiry
 *
 * Features:
 * - 3-column card grid for Team, Projects, and Sprints
 * - Each card shows count of synced items and resync button
 * - Clickable cards navigate to respective pages (when data synced)
 * - Independent sync buttons for each section
 * - Zoho connection details card at bottom
 * - Connection status badge in header
 *
 * Data flows:
 * - Status (Zoho connection) fetched on mount
 * - User/project/sprint counts fetched from local SQLite
 * - Sync operations are fire-and-forget (background on server)
 * - Counts update after sync completes
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchStatus, fetchUsers, syncUsers, fetchProjects, syncProjects, fetchSprints, syncSprints, StatusResponse } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';

export function Home() {
  const navigate = useNavigate();

  const [status, setStatus]               = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [userCount, setUserCount]         = useState<number | null>(null);
  const [syncingUsers, setSyncingUsers]   = useState(false);
  const [userSyncError, setUserSyncError] = useState<string | null>(null);

  const [projectCount, setProjectCount]       = useState<number | null>(null);
  const [syncingProjects, setSyncingProjects] = useState(false);
  const [projectSyncError, setProjectSyncError] = useState<string | null>(null);

  const [sprintCount, setSprintCount]       = useState<number | null>(null);
  const [syncingSprints, setSyncingSprints] = useState(false);
  const [sprintSyncError, setSprintSyncError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch((err) => setStatus({ connected: false, error: err.message }))
      .finally(() => setStatusLoading(false));

    fetchUsers().then((d) => setUserCount(d.total)).catch(() => setUserCount(0));
    fetchProjects().then((d) => setProjectCount(d.total)).catch(() => setProjectCount(0));
    fetchSprints().then((d) => setSprintCount(d.total)).catch(() => setSprintCount(0));
  }, []);

  async function handleSyncUsers(e: React.MouseEvent) {
    e.stopPropagation();
    setSyncingUsers(true);
    setUserSyncError(null);
    try {
      const result = await syncUsers();
      setUserCount(result.synced);
    } catch (err) {
      setUserSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncingUsers(false);
    }
  }

  async function handleSyncProjects(e: React.MouseEvent) {
    e.stopPropagation();
    setSyncingProjects(true);
    setProjectSyncError(null);
    try {
      const result = await syncProjects();
      setProjectCount(result.synced);
    } catch (err) {
      setProjectSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncingProjects(false);
    }
  }

  async function handleSyncSprints(e: React.MouseEvent) {
    e.stopPropagation();
    setSyncingSprints(true);
    setSprintSyncError(null);
    try {
      await syncSprints(); // fires sync in background, returns immediately
      setSprintCount(null); // will update when cron/poll refreshes
    } catch (err) {
      setSprintSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncingSprints(false);
    }
  }

  const portal         = status?.portals?.[0];
  const expiresAt      = status?.tokenExpiresAt ? new Date(status.tokenExpiresAt).toLocaleTimeString() : null;
  const usersSynced    = userCount !== null && userCount > 0;
  const projSynced     = projectCount !== null && projectCount > 0;
  const sprintsSynced  = sprintCount !== null && sprintCount > 0;

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div>
          <h1 style={s.title}>Zonaliser</h1>
          <p style={s.subtitle}>Engineering Delivery Intelligence Dashboard</p>
        </div>
        <StatusBadge connected={statusLoading ? null : (status?.connected ?? false)} />
      </header>

      <main style={s.main}>

        {/* ── Primary sync cards — 3-col grid ─────────────────────────── */}
        <div style={s.grid}>

          {/* Team card */}
          <div
            style={{ ...s.card, cursor: usersSynced ? 'pointer' : 'default', borderColor: usersSynced ? '#3b82f644' : '#334155' }}
            onClick={usersSynced ? () => navigate('/users') : undefined}
          >
            <div style={s.cardHeader}>
              <div>
                <h2 style={s.cardTitle}>👥 Team</h2>
                {usersSynced && <p style={s.cardHint}>Click to view all members →</p>}
              </div>
              {usersSynced && (
                <button style={s.resyncBtn} onClick={handleSyncUsers} disabled={syncingUsers}>
                  {syncingUsers ? 'Syncing…' : 'Resync'}
                </button>
              )}
            </div>
            {userCount === null && <p style={s.muted}>Checking local database…</p>}
            {userCount === 0 && !syncingUsers && (
              <>
                <p style={s.syncPrompt}>No team members synced yet.</p>
                <p style={s.muted}>Sync your Zoho Sprints workspace to get started.</p>
                {userSyncError && <p style={s.errorText}>{userSyncError}</p>}
                <button style={s.syncBtn} onClick={handleSyncUsers}>Sync Team</button>
              </>
            )}
            {userCount === 0 && syncingUsers && <p style={s.muted}>Syncing team members from Zoho…</p>}
            {usersSynced && (
              <div style={s.countRow}>
                <span style={s.count}>{userCount}</span>
                <span style={s.countLabel}>members synced</span>
                {userSyncError && <span style={{ ...s.errorText, marginLeft: 12 }}>{userSyncError}</span>}
              </div>
            )}
          </div>

          {/* Projects card */}
          <div
            style={{ ...s.card, cursor: projSynced ? 'pointer' : 'default', borderColor: projSynced ? '#8b5cf644' : '#334155' }}
            onClick={projSynced ? () => navigate('/projects') : undefined}
          >
            <div style={s.cardHeader}>
              <div>
                <h2 style={s.cardTitle}>🗂 Projects</h2>
                {projSynced && <p style={s.cardHint}>Click to view all projects →</p>}
              </div>
              {projSynced && (
                <button style={s.resyncBtn} onClick={handleSyncProjects} disabled={syncingProjects}>
                  {syncingProjects ? 'Syncing…' : 'Resync'}
                </button>
              )}
            </div>
            {projectCount === null && <p style={s.muted}>Checking local database…</p>}
            {projectCount === 0 && !syncingProjects && (
              <>
                <p style={s.syncPrompt}>No projects synced yet.</p>
                <p style={s.muted}>Sync your Zoho Sprints projects to get started.</p>
                {projectSyncError && <p style={s.errorText}>{projectSyncError}</p>}
                <button style={{ ...s.syncBtn, backgroundColor: '#8b5cf6' }} onClick={handleSyncProjects}>
                  Sync Projects
                </button>
              </>
            )}
            {projectCount === 0 && syncingProjects && <p style={s.muted}>Syncing projects from Zoho…</p>}
            {projSynced && (
              <div style={s.countRow}>
                <span style={{ ...s.count, color: '#8b5cf6' }}>{projectCount}</span>
                <span style={s.countLabel}>projects synced</span>
                {projectSyncError && <span style={{ ...s.errorText, marginLeft: 12 }}>{projectSyncError}</span>}
              </div>
            )}
          </div>

          {/* Sprint Health card */}
          <div
            style={{ ...s.card, cursor: sprintsSynced ? 'pointer' : 'default', borderColor: sprintsSynced ? '#22c55e44' : '#334155' }}
            onClick={sprintsSynced ? () => navigate('/sprints') : undefined}
          >
            <div style={s.cardHeader}>
              <div>
                <h2 style={s.cardTitle}>🏃 Sprints</h2>
                {sprintsSynced && <p style={s.cardHint}>Click to view all sprints →</p>}
              </div>
              {sprintsSynced && (
                <button style={s.resyncBtn} onClick={handleSyncSprints} disabled={syncingSprints}>
                  {syncingSprints ? 'Syncing…' : 'Resync'}
                </button>
              )}
            </div>
            {sprintCount === null && <p style={s.muted}>Checking local database…</p>}
            {sprintCount === 0 && !syncingSprints && (
              <>
                <p style={s.syncPrompt}>No sprint data yet.</p>
                <p style={s.muted}>Sync projects first, then set board types.</p>
                {sprintSyncError && <p style={s.errorText}>{sprintSyncError}</p>}
                <button style={{ ...s.syncBtn, backgroundColor: '#22c55e' }} onClick={handleSyncSprints}>
                  Sync Sprints
                </button>
              </>
            )}
            {sprintCount === 0 && syncingSprints && <p style={s.muted}>Fetching sprint data from Zoho…</p>}
            {sprintsSynced && (
              <div style={s.countRow}>
                <span style={{ ...s.count, color: '#22c55e' }}>{sprintCount}</span>
                <span style={s.countLabel}>sprints synced</span>
                {sprintSyncError && <span style={{ ...s.errorText, marginLeft: 12 }}>{sprintSyncError}</span>}
              </div>
            )}
          </div>

        </div>

        {/* ── Zoho connection card (bottom) ────────────────────────────── */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>Zoho Connection</h2>
          {statusLoading && <p style={s.muted}>Checking connection…</p>}
          {!statusLoading && status?.connected && (
            <>
              <div style={s.row}><span style={s.label}>Workspace</span><span style={s.value}>{portal?.name ?? '—'}</span></div>
              <div style={s.row}><span style={s.label}>Organisation</span><span style={s.value}>{portal?.orgName ?? '—'}</span></div>
              <div style={s.row}><span style={s.label}>Team ID</span><span style={s.value}>{status.myTeamId ?? '—'}</span></div>
              <div style={s.row}><span style={s.label}>Token expires</span><span style={s.value}>{expiresAt ?? '—'}</span></div>
            </>
          )}
          {!statusLoading && !status?.connected && (
            <>
              <p style={s.errorText}>{status?.error ?? 'Could not reach the backend.'}</p>
              {status?.zohoStatus && <p style={s.errorText}>Zoho API returned HTTP {status.zohoStatus}</p>}
              <p style={s.muted}>Make sure the backend is running and your Zoho credentials are set in <code style={s.code}>~/.zshrc</code>.</p>
            </>
          )}
        </div>

      </main>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '0 24px 48px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '32px 0 40px',
    borderBottom: '1px solid #1e293b',
    marginBottom: 32,
  },
  title:    { margin: 0, fontSize: 28, fontWeight: 700, color: '#f1f5f9' },
  subtitle: { margin: '4px 0 0', fontSize: 14, color: '#64748b' },
  main: { maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 },
  card: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
    padding: '24px 28px',
  },
  cardHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  cardTitle: { margin: 0, fontSize: 16, fontWeight: 600, color: '#f1f5f9' },
  cardHint:  { margin: '4px 0 0', fontSize: 12, color: '#64748b' },
  countRow:  { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 },
  count:     { fontSize: 32, fontWeight: 700, color: '#3b82f6', lineHeight: 1 },
  countLabel:{ fontSize: 14, color: '#94a3b8' },
  syncPrompt:{ fontSize: 15, color: '#e2e8f0', margin: '0 0 6px' },
  syncBtn: {
    marginTop: 16, padding: '10px 24px',
    backgroundColor: '#3b82f6', color: '#fff',
    border: 'none', borderRadius: 8,
    fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  resyncBtn: {
    padding: '6px 16px', backgroundColor: 'transparent',
    color: '#94a3b8', border: '1px solid #334155',
    borderRadius: 7, fontSize: 13, fontWeight: 500,
    cursor: 'pointer', flexShrink: 0,
  },
  row:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #0f172a' },
  label: { fontSize: 14, color: '#94a3b8' },
  value: { fontSize: 14, color: '#e2e8f0', fontWeight: 500 },
  muted: { color: '#64748b', fontSize: 14, margin: 0 },
  errorText: { color: '#fca5a5', fontSize: 14, margin: '0 0 8px' },
  code: { backgroundColor: '#0f172a', padding: '2px 6px', borderRadius: 4, fontSize: 13, color: '#7dd3fc' },
};
