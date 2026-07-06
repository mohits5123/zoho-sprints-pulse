import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import {
  fetchNotifications, markNotificationRead, fetchIssueById, fetchProject, fetchAppConfig,
  type ActivityNotification,
} from '../api/client';
import { BackButton } from '../components/BackButton';
import { C, R, font } from '../theme';

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceName, setWorkspaceName] = useState('');
  const [issueDetails, setIssueDetails] = useState<Map<string, { itemNo: string; projNo: string }>>(new Map());
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchAppConfig().then(({ workspaceName: wn }) => setWorkspaceName(wn)).catch(() => {});
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const { notifications: data } = await fetchNotifications();
      setNotifications(data);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60 * 1000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  useEffect(() => {
    if (notifications.length === 0) return;
    const fetchDetails = async () => {
      const results = await Promise.all(
        notifications.map(async (notif) => {
          if (notif.type !== 'status_change' || !notif.issueId) return null;
          const issue = await fetchIssueById(notif.issueId);
          const project = await fetchProject(notif.boardId).catch(() => null);
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

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerTop}>
          <div style={s.headerLeft}>
            <BackButton />
            <h1 style={s.title}>
              <Bell size={24} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 8 }} />
              Notifications
            </h1>
          </div>
          {unreadCount > 0 && (
            <button style={s.markAllReadBtn} onClick={handleMarkAllRead}>Mark all as read</button>
          )}
        </div>
      </header>

      <div style={s.content}>
        <div style={s.card}>
          {loading ? (
            <p style={s.placeholder}>Loading notifications...</p>
          ) : notifications.length === 0 ? (
            <p style={s.placeholder}>No notifications</p>
          ) : (
            <div style={s.list}>
              {notifications.map(notif => {
                const isUnread = !notif.read && !readIds.has(notif.id);
                const isStatusChange = notif.type === 'status_change' || !notif.type;
                const issueDetail = isStatusChange ? issueDetails.get(notif.issueId) : null;
                const zohoUrl = workspaceName && issueDetail?.projNo && issueDetail?.itemNo
                  ? `https://sprints.zoho.in/workspace/${workspaceName}#P${issueDetail.projNo}/itemdetails/I${issueDetail.itemNo}`
                  : null;
                return (
                  <div
                    key={notif.id}
                    style={{
                      ...s.item,
                      backgroundColor: isUnread ? `${C.primaryHover}26` : 'transparent',
                    }}
                    onClick={() => isUnread && handleMarkRead(notif.id)}
                  >
                    <div style={s.itemContent}>
                      <div style={s.itemText}>
                        {isStatusChange ? (
                          <>
                            Issue{' '}
                            {zohoUrl ? (
                              <a href={zohoUrl} target="_blank" rel="noopener noreferrer" style={s.link}
                                onClick={(e) => { e.stopPropagation(); if (isUnread) handleMarkRead(notif.id); }}>
                                #{issueDetail?.itemNo}
                              </a>
                            ) : (
                              <span style={s.issueId}>#{issueDetail?.itemNo ?? '—'}</span>
                            )}
                            {' '}status changed: <strong>{notif.oldStatus}</strong> → <strong>{notif.newStatus}</strong>
                          </>
                        ) : notif.type === 'deadline_reminder' ? (
                          <>Deadline reminder: note deadline is tomorrow</>
                        ) : notif.type === 'deadline_day_of' ? (
                          <>Deadline today: note deadline is due today</>
                        ) : (
                          <>Notification</>
                        )}
                      </div>
                      <div style={s.itemTime}>
                        {new Date(notif.createdAt).toLocaleString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                          hour: 'numeric', minute: '2-digit', hour12: true,
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: C.canvas,
    color: C.inkMuted,
    padding: '0 24px 48px',
    fontFamily: font.text,
  },
  header: {
    padding: '32px 0 24px',
    borderBottom: `1px solid ${C.hairline}`,
    marginBottom: 24,
  },
  headerTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: C.inkMuted,
    fontFamily: font.display,
    letterSpacing: '-0.6px',
    display: 'flex',
    alignItems: 'center',
  },
  markAllReadBtn: {
    background: 'none',
    border: 'none',
    color: C.primary,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
    fontFamily: font.text,
  },
  content: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 24,
  },
  card: {
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  placeholder: {
    color: C.inkTertiary,
    fontSize: 14,
    textAlign: 'center' as const,
    padding: '48px 0',
    fontFamily: font.text,
  },
  list: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '16px 20px',
    borderBottom: `1px solid ${C.hairline}`,
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  itemContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  itemText: {
    fontSize: 14,
    color: C.inkMuted,
    lineHeight: 1.4,
    fontFamily: font.text,
  },
  itemTime: {
    fontSize: 12,
    color: C.inkTertiary,
    fontFamily: font.text,
  },
  link: {
    color: C.primary,
    textDecoration: 'none',
    fontWeight: 600,
    fontFamily: font.mono,
    fontSize: 13,
  },
  issueId: {
    color: C.inkSubtle,
    fontFamily: font.mono,
    fontSize: 13,
  },
};
