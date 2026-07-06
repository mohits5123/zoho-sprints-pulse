import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, FolderKanban, Timer, Bell, CheckCircle, Zap } from 'lucide-react';
import { fetchStatus, fetchUsers, syncUsers, fetchProjects, syncProjects, fetchSprints, syncSprints, fetchActivitySummary, StatusResponse, ActivitySummary } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { SyncButton } from '../components/SyncButton';
import { DashboardCard } from '../components/DashboardCard';
import { useSyncProgress } from '../contexts/SyncProgressContext';
import { C, R, font } from '../theme';

export function Home() {
  const navigate = useNavigate();
  const { syncActive, setSyncActive } = useSyncProgress();

  const [status, setStatus]               = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [userCount, setUserCount]         = useState<number | null>(null);
  const [projectCount, setProjectCount]   = useState<number | null>(null);
  const [sprintCount, setSprintCount]     = useState<number | null>(null);
  const [activity, setActivity]           = useState<ActivitySummary | null>(null);
  const [syncError, setSyncError]         = useState<string | null>(null);

  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch((err) => setStatus({ connected: false, error: err.message }))
      .finally(() => setStatusLoading(false));

    fetchUsers().then((d) => setUserCount(d.total)).catch(() => setUserCount(0));
    fetchProjects().then((d) => setProjectCount(d.total)).catch(() => setProjectCount(0));
    fetchSprints().then((d) => setSprintCount(d.total)).catch(() => setSprintCount(0));
    fetchActivitySummary().then(setActivity).catch(() => {});
  }, []);

  const wasSyncActive = useRef(false);
  useEffect(() => {
    if (wasSyncActive.current && !syncActive) {
      fetchUsers().then((d) => setUserCount(d.total)).catch(() => {});
      fetchProjects().then((d) => setProjectCount(d.total)).catch(() => {});
      fetchSprints().then((d) => setSprintCount(d.total)).catch(() => {});
      fetchActivitySummary().then(setActivity).catch(() => {});
    }
    wasSyncActive.current = syncActive;
  }, [syncActive]);

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
        <div style={s.grid}>
          <DashboardCard
            title="Team"
            subtitle={usersSynced ? 'Click to view all members' : undefined}
            count={usersSynced ? userCount : undefined}
            countLabel={usersSynced ? 'members synced' : undefined}
            countColor={C.primary}
            accentColor={usersSynced ? C.primary : undefined}
            icon={<Users size={20} strokeWidth={1.5} color={C.primary} />}
            onClick={usersSynced ? () => navigate('/users') : undefined}
          >
            {userCount === null && <p style={s.muted}>Checking local database…</p>}
            {userCount === 0 && (
              <>
                <p style={s.syncPrompt}>No team members synced yet.</p>
                <p style={s.muted}>Use the Sync All button above to get started.</p>
              </>
            )}
          </DashboardCard>

          <DashboardCard
            title="Projects"
            subtitle={projSynced ? 'Click to view all projects' : undefined}
            count={projSynced ? projectCount : undefined}
            countLabel={projSynced ? 'projects synced' : undefined}
            countColor="#a855f7"
            accentColor={projSynced ? '#a855f7' : undefined}
            icon={<FolderKanban size={20} strokeWidth={1.5} color="#a855f7" />}
            onClick={projSynced ? () => navigate('/projects') : undefined}
          >
            {projectCount === null && <p style={s.muted}>Checking local database…</p>}
            {projectCount === 0 && (
              <>
                <p style={s.syncPrompt}>No projects synced yet.</p>
                <p style={s.muted}>Use the Sync All button above to get started.</p>
              </>
            )}
          </DashboardCard>

          <DashboardCard
            title="Sprints"
            subtitle={sprintsSynced ? 'Click to view all sprints' : undefined}
            count={sprintsSynced ? sprintCount : undefined}
            countLabel={sprintsSynced ? 'sprints synced' : undefined}
            countColor={C.success}
            accentColor={sprintsSynced ? C.success : undefined}
            icon={<Timer size={20} strokeWidth={1.5} color={C.success} />}
            onClick={sprintsSynced ? () => navigate('/sprints') : undefined}
          >
            {sprintCount === null && <p style={s.muted}>Checking local database…</p>}
            {sprintCount === 0 && (
              <>
                <p style={s.syncPrompt}>No sprint data yet.</p>
                <p style={s.muted}>Sync projects first, then set board types.</p>
              </>
            )}
          </DashboardCard>

          <DashboardCard
            title="Activity"
            subtitle="Watchlist, notes & deadlines"
            accentColor="#f59e0b"
            icon={<Bell size={20} strokeWidth={1.5} color="#f59e0b" />}
            onClick={() => navigate('/activity')}
          >
            {activity === null && <p style={s.muted}>Loading…</p>}
            {activity !== null && (
              <div style={s.countRow}>
                {activity.unreadNotifications > 0 ? (
                  <>
                    <span style={{ ...s.count, color: '#f59e0b' }}>{activity.unreadNotifications}</span>
                    <span style={s.countLabel}>unread notification{activity.unreadNotifications !== 1 ? 's' : ''}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle size={24} strokeWidth={1.5} color={C.success} />
                    <span style={s.countLabel}>all caught up</span>
                  </>
                )}
              </div>
            )}
            {activity !== null && activity.upcomingDeadlines > 0 && (
              <p style={s.deadlineHint}>
                {activity.upcomingDeadlines} upcoming deadline{activity.upcomingDeadlines !== 1 ? 's' : ''}
              </p>
            )}
          </DashboardCard>
        </div>

        <div style={s.card}>
          <h2 style={s.cardTitle}>
            <Zap size={16} strokeWidth={1.5} color={C.primary} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Zoho Connection
          </h2>
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
    backgroundColor: C.canvas,
    color: C.inkMuted,
    fontFamily: font.text,
    padding: '0 24px 48px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '32px 0 40px',
    borderBottom: `1px solid ${C.hairline}`,
    marginBottom: 32,
  },
  headerRight: { display: 'flex', alignItems: 'center', gap: 16 },
  title:    { margin: 0, fontSize: 28, fontWeight: 600, color: C.inkMuted, fontFamily: font.display, letterSpacing: '-0.6px' },
  subtitle: { margin: '4px 0 0', fontSize: 14, color: C.inkTertiary, fontFamily: font.text },
  main: { maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 },
  card: {
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
    padding: '24px 28px',
  },
  cardTitle: { margin: 0, fontSize: 16, fontWeight: 600, color: C.inkMuted, fontFamily: font.display },
  countRow:  { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 },
  count:     { fontSize: 32, fontWeight: 700, lineHeight: 1, fontFamily: font.display, letterSpacing: '-0.6px' },
  countLabel:{ fontSize: 14, color: C.inkSubtle, fontFamily: font.text },
  syncPrompt:{ fontSize: 15, color: C.inkMuted, margin: '0 0 6px', fontFamily: font.text },
  deadlineHint: { fontSize: 13, color: '#f59e0b', margin: '8px 0 0', fontFamily: font.text },
  row:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.hairline}` },
  label: { fontSize: 14, color: C.inkSubtle, fontFamily: font.text },
  value: { fontSize: 14, color: C.inkMuted, fontWeight: 500, fontFamily: font.text },
  muted: { color: C.inkTertiary, fontSize: 14, margin: 0, fontFamily: font.text },
  errorText: { color: '#ef4444', fontSize: 14, margin: '0 0 8px', fontFamily: font.text },
  code: { backgroundColor: C.surface2, padding: '2px 6px', borderRadius: R.xs, fontSize: 13, color: C.primaryHover, fontFamily: font.mono },
};
