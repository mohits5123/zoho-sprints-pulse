import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Users, FolderKanban, Timer, Bell, CheckCircle, Zap, ArrowRight } from 'lucide-react';
import {
  fetchStatus, fetchUsers, syncUsers, fetchProjects, syncProjects, fetchSprints, syncSprints,
  fetchActivitySummary, StatusResponse, ActivitySummary,
  fetchNotifications, markNotificationRead, fetchIssueById, fetchProject, fetchAppConfig, fetchNote,
  type ActivityNotification,
} from '../api/client';
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

  const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [issueDetails, setIssueDetails]   = useState<Map<string, { itemNo: string; projNo: string }>>(new Map());
  const [noteDetails, setNoteDetails]     = useState<Map<string, string>>(new Map());
  const [readIds, setReadIds]             = useState<Set<string>>(new Set());
  const notificationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showNotifications) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifications]);

  useEffect(() => {
    fetchAppConfig().then(({ workspaceName: wn }) => setWorkspaceName(wn)).catch(() => {});
  }, []);

  useEffect(() => {
    const loadNotifications = async () => {
      try {
        const { notifications: data } = await fetchNotifications();
        setNotifications(data);
      } catch (err) {
        console.error('Failed to load notifications:', err);
      }
    };
    loadNotifications();
    const interval = setInterval(loadNotifications, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (notifications.length === 0) return;
    const fetchDetails = async () => {
      const results = await Promise.all(
        notifications.map(async (notif) => {
          if (notif.type !== 'status_change' || !notif.issueId) return null;
          const issue = await fetchIssueById(notif.issueId);
          const project = notif.boardId ? await fetchProject(notif.boardId).catch(() => null) : null;
          return {
            issueId: notif.issueId,
            itemNo: issue?.itemNo ?? '',
            projNo: project?.project?.projNo ?? '',
          };
        })
      );
      const details = new Map<string, { itemNo: string; projNo: string }>();
      for (const r of results) {
        if (r && r.itemNo) details.set(r.issueId, { itemNo: r.itemNo, projNo: r.projNo });
      }
      setIssueDetails(details);
    };
    fetchDetails();
  }, [notifications]);

  useEffect(() => {
    if (notifications.length === 0) return;
    const noteNotifs = notifications.filter(n => n.noteId && !noteDetails.has(n.noteId));
    if (noteNotifs.length === 0) return;
    const fetchNoteTitles = async () => {
      const results = await Promise.all(
        [...new Set(noteNotifs.map(n => n.noteId!))].map(async (noteId) => {
          try {
            const note = await fetchNote(noteId);
            return { noteId, title: note.title };
          } catch {
            return null;
          }
        })
      );
      setNoteDetails(prev => {
        const next = new Map(prev);
        for (const r of results) {
          if (r) next.set(r.noteId, r.title);
        }
        return next;
      });
    };
    fetchNoteTitles();
  }, [notifications]);

  const handleMarkRead = useCallback(async (notificationId: string) => {
    try {
      await markNotificationRead(notificationId);
      setReadIds(prev => new Set(prev).add(notificationId));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await Promise.all(
        notifications.filter(n => !n.read && !readIds.has(n.id)).map(n => markNotificationRead(n.id))
      );
      setReadIds(prev => {
        const next = new Set(prev);
        notifications.forEach(n => next.add(n.id));
        return next;
      });
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  }, [notifications, readIds]);

  const unreadCount = notifications.filter(n => !n.read && !readIds.has(n.id)).length;

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
          <div ref={notificationRef} style={s.notificationBell}>
            <button style={s.bellButton} onClick={() => setShowNotifications(!showNotifications)}>
              <Bell size={20} strokeWidth={1.5} color={C.inkMuted} />
              {unreadCount > 0 && <span style={s.bellBadge}>{unreadCount}</span>}
            </button>
            {showNotifications && (
              <div style={s.notificationDropdown}>
                <div style={s.notificationHeader}>
                  <span style={s.notificationTitle}>Notifications</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {unreadCount > 0 && (
                      <button style={s.markAllReadBtn} onClick={handleMarkAllRead}>Mark all as read</button>
                    )}
                    {notifications.length > 0 && (
                      <button style={s.viewAllBtn} onClick={() => { setShowNotifications(false); navigate('/notifications'); }}>
                        View All <ArrowRight size={12} strokeWidth={1.5} style={{ marginLeft: 4 }} />
                      </button>
                    )}
                  </div>
                </div>
                <div style={s.notificationList}>
                  {notifications.length === 0 ? (
                    <div style={s.notificationEmpty}>No notifications</div>
                  ) : (
                    notifications.slice(0, 10).map(notif => {
                      const isUnread = !notif.read && !readIds.has(notif.id);
                      const isStatusChange = notif.type === 'status_change' || !notif.type;
                      const isNoteNotif = !!notif.noteId;
                      const issueDetail = isStatusChange && notif.issueId ? issueDetails.get(notif.issueId) : null;
                      const noteTitle = isNoteNotif && notif.noteId ? noteDetails.get(notif.noteId) : null;
                      const zohoUrl = workspaceName && issueDetail?.projNo && issueDetail?.itemNo
                        ? `https://sprints.zoho.in/workspace/${workspaceName}#P${issueDetail.projNo}/itemdetails/I${issueDetail.itemNo}`
                        : null;
                      return (
                        <div
                          key={notif.id}
                          style={{
                            ...s.notificationItem,
                            backgroundColor: isUnread ? `${C.primaryHover}26` : 'transparent',
                          }}
                          onClick={() => {
                            if (isUnread) handleMarkRead(notif.id);
                            if (isNoteNotif && notif.noteId) {
                              navigate(`/notes/${notif.noteId}`);
                            }
                          }}
                        >
                          <div style={s.notificationContent}>
                            <div style={s.notificationText}>
                              {isStatusChange ? (
                                <>
                                  Issue{' '}
                                  {zohoUrl ? (
                                    <a href={zohoUrl} target="_blank" rel="noopener noreferrer" style={s.notificationLink}
                                      onClick={(e) => { e.stopPropagation(); if (isUnread) handleMarkRead(notif.id); }}>
                                      #{issueDetail?.itemNo}
                                    </a>
                                  ) : (
                                    <span style={s.notificationIssueId}>#{issueDetail?.itemNo ?? '—'}</span>
                                  )}
                                  {' '}status changed: <strong>{notif.oldStatus}</strong> → <strong>{notif.newStatus}</strong>
                                </>
                              ) : notif.type === 'deadline_reminder' ? (
                                <>Deadline reminder: <strong>{noteTitle ?? 'Note'}</strong> — deadline is tomorrow</>
                              ) : notif.type === 'deadline_day_of' ? (
                                <>Deadline today: <strong>{noteTitle ?? 'Note'}</strong> — due today</>
                              ) : notif.type === 'issue_deleted' ? (
                                <>{notif.message || 'An issue was soft-deleted.'}</>
                              ) : (
                                <>{notif.message || 'Notification'}</>
                              )}
                            </div>
                            <div style={s.notificationTime}>
                              {new Date(notif.createdAt).toLocaleString('en-US', {
                                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
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
            icon={<Activity size={20} strokeWidth={1.5} color="#f59e0b" />}
            onClick={() => navigate('/activity')}
          >
            {activity === null && <p style={s.muted}>Loading…</p>}
            {activity !== null && (
              <div style={s.countRow}>
                {activity.upcomingDeadlines > 0 ? (
                  <>
                    <span style={{ ...s.count, color: '#f59e0b' }}>{activity.upcomingDeadlines}</span>
                    <span style={s.countLabel}>upcoming deadline{activity.upcomingDeadlines !== 1 ? 's' : ''}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle size={24} strokeWidth={1.5} color={C.success} />
                    <span style={s.countLabel}>no upcoming deadlines</span>
                  </>
                )}
              </div>
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
  row:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.hairline}` },
  label: { fontSize: 14, color: C.inkSubtle, fontFamily: font.text },
  value: { fontSize: 14, color: C.inkMuted, fontWeight: 500, fontFamily: font.text },
  muted: { color: C.inkTertiary, fontSize: 14, margin: 0, fontFamily: font.text },
  errorText: { color: '#ef4444', fontSize: 14, margin: '0 0 8px', fontFamily: font.text },
  code: { backgroundColor: C.surface2, padding: '2px 6px', borderRadius: R.xs, fontSize: 13, color: C.primaryHover, fontFamily: font.mono },
  notificationBell: {
    position: 'relative' as const,
  },
  bellButton: {
    background: 'none',
    border: 'none',
    fontSize: 24,
    cursor: 'pointer',
    position: 'relative' as const,
    padding: 0,
  },
  bellBadge: {
    position: 'absolute' as const,
    top: -4,
    right: -4,
    backgroundColor: C.danger,
    color: C.inkMuted,
    fontSize: 10,
    fontWeight: 700,
    borderRadius: R.pill,
    padding: '2px 6px',
    minWidth: 18,
    textAlign: 'center' as const,
  },
  notificationDropdown: {
    position: 'absolute' as const,
    top: '100%',
    right: 0,
    marginTop: 8,
    width: 360,
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.md,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    zIndex: 100,
  },
  notificationHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: `1px solid ${C.hairline}`,
  },
  notificationTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: C.inkMuted,
    fontFamily: font.text,
  },
  markAllReadBtn: {
    background: 'none',
    border: 'none',
    color: C.primary,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
    fontFamily: font.text,
  },
  notificationList: {
    maxHeight: 400,
    overflowY: 'auto' as const,
  },
  notificationItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 16px',
    borderBottom: `1px solid ${C.hairline}`,
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  notificationContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  notificationText: {
    fontSize: 13,
    color: C.inkMuted,
    lineHeight: 1.4,
    fontFamily: font.text,
  },
  notificationTime: {
    fontSize: 11,
    color: C.inkTertiary,
    fontFamily: font.text,
  },
  notificationLink: {
    color: C.primary,
    textDecoration: 'none',
    fontWeight: 600,
    fontFamily: font.mono,
    fontSize: 12,
  },
  notificationIssueId: {
    color: C.inkSubtle,
    fontFamily: font.mono,
    fontSize: 12,
  },
  notificationEmpty: {
    padding: '24px 16px',
    textAlign: 'center' as const,
    color: C.inkTertiary,
    fontSize: 13,
    fontFamily: font.text,
  },
  viewAllBtn: {
    background: 'none',
    border: 'none',
    color: C.primary,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
    fontFamily: font.text,
    display: 'flex',
    alignItems: 'center',
  },
};
