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
import { useSyncProgress } from '../contexts/SyncProgressContext';

export function Home() {
  const navigate = useNavigate();
  const { setSyncActive } = useSyncProgress();

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

  // On mount: fetch Zoho connection status and current counts for users, projects, and sprints
  // from the local SQLite database. These are fire-and-forget reads — failures default to 0.
  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch((err) => setStatus({ connected: false, error: err.message }))
      .finally(() => setStatusLoading(false));

    fetchUsers().then((d) => setUserCount(d.total)).catch(() => setUserCount(0));
    fetchProjects().then((d) => setProjectCount(d.total)).catch(() => setProjectCount(0));
    fetchSprints().then((d) => setSprintCount(d.total)).catch(() => setSprintCount(0));
  }, []);

  /**
   * Trigger a synchronous user/team sync with Zoho.
   *
   * The backend executes the sync synchronously (no async polling), so
   * `setSyncActive` is deactivated immediately after the response resolves.
   * The new count is taken from `result.synced` in the response.
   *
   * @param e - The click event (prevents propagation to avoid card navigation).
   */
  async function handleSyncUsers(e: React.MouseEvent) {
    e.stopPropagation();
    setSyncingUsers(true);
    setUserSyncError(null);
    setSyncActive(true);
    try {
      const result = await syncUsers();
      setUserCount(result.synced);
    } catch (err) {
      setUserSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncingUsers(false);
      // Users sync is synchronous on the backend (no startSync/completeSync),
      // so deactivate immediately after the response.
      setSyncActive(false);
    }
  }

  /**
   * Trigger a background project sync with Zoho.
   *
   * Unlike user sync, the backend starts the project sync asynchronously
   * (`setImmediate → runFullSync → startSync`) and returns `{ synced: 0 }`
   * immediately. The count is NOT updated here — it will be refreshed when
   * the user navigates to /projects or on the next page visit.
   *
   * A 10-second safety timeout in `SyncProgressBar` stops polling if
   * `startSync` never fires. Completion is otherwise detected when
   * `setSyncActive(false)` is called by the page that owns the sync.
   *
   * @param e - The click event (prevents propagation to avoid card navigation).
   */
  async function handleSyncProjects(e: React.MouseEvent) {
    e.stopPropagation();
    setSyncingProjects(true);
    setProjectSyncError(null);
    setSyncActive(true);
    try {
      await syncProjects();
      // The response returns { synced: 0 } immediately before the background
      // sync runs. Don't overwrite projectCount — keep existing value.
    } catch (err) {
      setProjectSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncingProjects(false);
      // Projects sync runs in background via setImmediate → runFullSync → startSync.
      // The 10s safety timeout in SyncProgressBar will stop polling if startSync
      // never fires. Otherwise the background sync completion will be detected
      // when setSyncActive(false) is called by the page that owns the sync.
    }
  }

  /**
   * Trigger a background sprint sync with Zoho.
   *
   * Like project sync, this fires the backend asynchronously and returns
   * immediately. The client does NOT clear `sprintCount` — it retains the
   * existing value until the background sync completes and the page re-fetches.
   *
   * A 10-second safety timeout in `SyncProgressBar` stops polling if
   * `startSync` never fires.
   *
   * @param e - The click event (prevents propagation to avoid card navigation).
   */
  async function handleSyncSprints(e: React.MouseEvent) {
    e.stopPropagation();
    setSyncingSprints(true);
    setSprintSyncError(null);
    setSyncActive(true);
    try {
      await syncSprints(); // fires sync in background, returns immediately
      // Don't clear sprintCount — keep existing value until the background
      // sync completes and the page re-fetches.
    } catch (err) {
      setSprintSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncingSprints(false);
      // Sprints sync runs in background via setImmediate → runFullSync → startSync.
      // The 10s safety timeout in SyncProgressBar will stop polling if startSync
      // never fires.
    }
  }

  // Derived values used to determine card interactivity and display state.
  // `portal` is the first (and likely only) Zoho workspace the user is connected to.
  // `expiresAt` is the formatted token expiry time, shown in the connection card.
  // The `*Synced` booleans gate navigation: cards are only clickable once data has been synced.
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

// ── Inline styles ────────────────────────────────────────────────────────────
// All styles are defined as a plain object for consistency with the component's
// minimal, zero-dependency styling approach (no CSS modules, no styled-components).
const s: Record<string, React.CSSProperties> = {
  // Full-page background with dark slate theme
  page: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '0 24px 48px',
  },
  // Header row: title on the left, connection status badge on the right
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
  // Main content container: centered, 960px max-width, vertical stacking with gaps
  main: { maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  // Responsive 3-column grid that collapses to fewer columns on narrow screens
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 },
  // Base card style: dark background, subtle border, rounded corners
  card: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
    padding: '24px 28px',
  },
  // Card header: title on the left, resync button on the right
  cardHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  cardTitle: { margin: 0, fontSize: 16, fontWeight: 600, color: '#f1f5f9' },
  cardHint:  { margin: '4px 0 0', fontSize: 12, color: '#64748b' },
  // Row showing the synced count with its label
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
  // Secondary (outline) button used for the in-card "Resync" action
  resyncBtn: {
    padding: '6px 16px', backgroundColor: 'transparent',
    color: '#94a3b8', border: '1px solid #334155',
    borderRadius: 7, fontSize: 13, fontWeight: 500,
    cursor: 'pointer', flexShrink: 0,
  },
  // Key-value row inside the Zoho connection card
  row:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #0f172a' },
  label: { fontSize: 14, color: '#94a3b8' },
  value: { fontSize: 14, color: '#e2e8f0', fontWeight: 500 },
  muted: { color: '#64748b', fontSize: 14, margin: 0 },
  errorText: { color: '#fca5a5', fontSize: 14, margin: '0 0 8px' },
  code: { backgroundColor: '#0f172a', padding: '2px 6px', borderRadius: 4, fontSize: 13, color: '#7dd3fc' },
};
