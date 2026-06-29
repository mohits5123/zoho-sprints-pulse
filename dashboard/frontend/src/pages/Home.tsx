/**
 * Home/Dashboard page component.
 *
 * Landing page showing connection status, a unified sync control, and quick
 * navigation to main sections:
 * - Team: View all team members (synced from Zoho)
 * - Projects: View all projects (synced from Zoho)
 * - Sprints: View active sprint status (synced from Zoho)
 * - Zoho Connection: Display connection details and token expiry
 *
 * Features:
 * - Single "Sync All" button in the header that syncs team, projects, and sprints
 * - 3-column card grid for Team, Projects, and Sprints (counts only, no per-card sync)
 * - Clickable cards navigate to respective pages (when data synced)
 * - Zoho connection details card at bottom
 * - Connection status badge in header
 *
 * Data flows:
 * - Status (Zoho connection) fetched on mount
 * - User/project/sprint counts fetched from local SQLite
 * - Sync operations are fire-and-forget (background on server)
 * - Counts refresh automatically when syncActive transitions false (sync done)
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchStatus, fetchUsers, syncUsers, fetchProjects, syncProjects, fetchSprints, syncSprints, StatusResponse } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { SyncButton } from '../components/SyncButton';
import { useSyncProgress } from '../contexts/SyncProgressContext';

export function Home() {
  const navigate = useNavigate();
  const { syncActive, setSyncActive } = useSyncProgress();

  const [status, setStatus]               = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [userCount, setUserCount]         = useState<number | null>(null);
  const [projectCount, setProjectCount]   = useState<number | null>(null);
  const [sprintCount, setSprintCount]     = useState<number | null>(null);
  const [syncError, setSyncError]         = useState<string | null>(null);

  // On mount: fetch Zoho connection status and current counts from local SQLite.
  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch((err) => setStatus({ connected: false, error: err.message }))
      .finally(() => setStatusLoading(false));

    fetchUsers().then((d) => setUserCount(d.total)).catch(() => setUserCount(0));
    fetchProjects().then((d) => setProjectCount(d.total)).catch(() => setProjectCount(0));
    fetchSprints().then((d) => setSprintCount(d.total)).catch(() => setSprintCount(0));
  }, []);

  // Refresh counts when a sync cycle completes (syncActive transitions true → false).
  const wasSyncActive = useRef(false);
  useEffect(() => {
    if (wasSyncActive.current && !syncActive) {
      fetchUsers().then((d) => setUserCount(d.total)).catch(() => {});
      fetchProjects().then((d) => setProjectCount(d.total)).catch(() => {});
      fetchSprints().then((d) => setSprintCount(d.total)).catch(() => {});
    }
    wasSyncActive.current = syncActive;
  }, [syncActive]);

  /**
   * Trigger a full sync of all data (users, projects, sprints) from Zoho.
   *
   * All three sync calls are fired in parallel:
   * - Users sync is synchronous on the backend; the user count is updated from
   *   the response immediately.
   * - Projects and sprints syncs run asynchronously on the backend; their counts
   *   are refreshed when syncActive transitions back to false (detected in the
   *   useEffect above).
   *
   * `setSyncActive(false)` is called automatically by SyncProgressBar when the
   * backend reports inProgress=false after a background sync. The 10-second safety
   * timeout in SyncProgressBar handles the case where neither projects nor sprints
   * ever call `startSync` on the backend.
   */
  async function handleSyncAll() {
    setSyncError(null);
    setSyncActive(true);
    const [usersResult, , ] = await Promise.allSettled([
      syncUsers(),
      syncProjects(),
      syncSprints(),
    ]);
    if (usersResult.status === 'fulfilled') {
      setUserCount(usersResult.value.synced);
    }
    const errors = ([usersResult] as PromiseSettledResult<unknown>[]).filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (errors.length > 0) {
      setSyncError(errors.map((r) => r.reason?.message ?? 'Sync failed').join(' · '));
    }
    // Note: setSyncActive(false) is handled by SyncProgressBar on background-sync
    // completion. For the users-only case the 10s safety timeout takes over.
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
        <div style={s.headerRight}>
          <SyncButton onClick={handleSyncAll} label="Sync All" />
          <StatusBadge connected={statusLoading ? null : (status?.connected ?? false)} />
        </div>
      </header>

      {syncError && <p style={s.errorText}>{syncError}</p>}

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
                <h2 style={s.cardTitle}>Team</h2>
                {usersSynced && <p style={s.cardHint}>Click to view all members</p>}
              </div>
            </div>
            {userCount === null && <p style={s.muted}>Checking local database…</p>}
            {userCount === 0 && (
              <>
                <p style={s.syncPrompt}>No team members synced yet.</p>
                <p style={s.muted}>Use the Sync All button above to get started.</p>
              </>
            )}
            {usersSynced && (
              <div style={s.countRow}>
                <span style={s.count}>{userCount}</span>
                <span style={s.countLabel}>members synced</span>
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
                <h2 style={s.cardTitle}>Projects</h2>
                {projSynced && <p style={s.cardHint}>Click to view all projects</p>}
              </div>
            </div>
            {projectCount === null && <p style={s.muted}>Checking local database…</p>}
            {projectCount === 0 && (
              <>
                <p style={s.syncPrompt}>No projects synced yet.</p>
                <p style={s.muted}>Use the Sync All button above to get started.</p>
              </>
            )}
            {projSynced && (
              <div style={s.countRow}>
                <span style={{ ...s.count, color: '#8b5cf6' }}>{projectCount}</span>
                <span style={s.countLabel}>projects synced</span>
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
                <h2 style={s.cardTitle}>Sprints</h2>
                {sprintsSynced && <p style={s.cardHint}>Click to view all sprints</p>}
              </div>
            </div>
            {sprintCount === null && <p style={s.muted}>Checking local database…</p>}
            {sprintCount === 0 && (
              <>
                <p style={s.syncPrompt}>No sprint data yet.</p>
                <p style={s.muted}>Sync projects first, then set board types.</p>
              </>
            )}
            {sprintsSynced && (
              <div style={s.countRow}>
                <span style={{ ...s.count, color: '#22c55e' }}>{sprintCount}</span>
                <span style={s.countLabel}>sprints synced</span>
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

// ── Inline styles ────────────────────────────────────────────────────────────
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
  headerRight: { display: 'flex', alignItems: 'center', gap: 16 },
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
  row:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #0f172a' },
  label: { fontSize: 14, color: '#94a3b8' },
  value: { fontSize: 14, color: '#e2e8f0', fontWeight: 500 },
  muted: { color: '#64748b', fontSize: 14, margin: 0 },
  errorText: { color: '#fca5a5', fontSize: 14, margin: '0 0 8px' },
  code: { backgroundColor: '#0f172a', padding: '2px 6px', borderRadius: 4, fontSize: 13, color: '#7dd3fc' },
};
