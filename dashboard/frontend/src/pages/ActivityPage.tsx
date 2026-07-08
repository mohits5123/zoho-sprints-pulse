import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Plus, Calendar, Eye, FileText, X, ArrowRight } from 'lucide-react';
import {
  fetchNotes, deleteNote,
  fetchNotifications, markNotificationRead,
  fetchWatchlist, toggleImportant, fetchIssueById, fetchAppConfig, fetchProject,
  fetchCombinedDeadlines, fetchNote,
  type NoteEntry, type ActivityNotification, type WatchlistEntry, type IssueItem,
  type CombinedDeadline,
} from '../api/client';
import { WatchlistCompactRow } from '../components/WatchlistCompactRow';
import { BackButton } from '../components/BackButton';
import { CreateDeadlineModal } from '../components/CreateDeadlineModal';
import { DeadlineRow } from '../components/DeadlineRow';
import { C, R, font } from '../theme';

export function ActivityPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [issueDetails, setIssueDetails] = useState<Map<string, { itemNo: string; projNo: string }>>(new Map());
  const [noteDetails, setNoteDetails] = useState<Map<string, string>>(new Map());
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
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

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerTop}>
          <div style={s.headerLeft}>
            <BackButton />
            <h1 style={s.title}>Activity</h1>
          </div>
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
                              ) : (
                                <>Notification</>
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
        </div>
      </header>

      <div style={s.content}>
        <DeadlinesCard />
        <div style={s.twoColumnLayout}>
          <WatchlistCard />
          <NotesCard />
        </div>
      </div>
    </div>
  );
}

function DeadlinesCard() {
  const navigate = useNavigate();
  const [deadlines, setDeadlines] = useState<CombinedDeadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState<CombinedDeadline | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchAppConfig().then(({ workspaceName: wn }) => setWorkspaceName(wn)).catch(() => {});
  }, []);

  const loadDeadlines = useCallback(async () => {
    try {
      const { deadlines: data } = await fetchCombinedDeadlines();
      const sorted = [...data].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
      setDeadlines(sorted.slice(0, 5));
      // Initialize all multi-item deadlines as expanded by default (only on first load)
      setExpandedGroups(prev => {
        if (prev.size > 0) return prev; // Already initialized, preserve user state
        return new Set(sorted.filter(dl => dl.subItems.length > 1).map(dl => dl.id));
      });
    } catch (err) {
      console.error('Failed to load deadlines:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeadlines();
    const interval = setInterval(loadDeadlines, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadDeadlines]);

  const toggleExpand = useCallback((groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }, []);

  return (
    <div style={s.deadlinesCard}>
      <div style={s.cardHeader}>
        <h2 style={s.cardTitle}>
          <Calendar size={16} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Deadlines
        </h2>
        <button style={s.addNoteBtn} onClick={() => setShowCreateModal(true)}>
          <Plus size={12} strokeWidth={1.5} color="#fff" style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Add
        </button>
      </div>
      {(showCreateModal || editingDeadline) && (
        <CreateDeadlineModal
          onClose={() => { setShowCreateModal(false); setEditingDeadline(null); }}
          onCreated={() => loadDeadlines()}
          editDeadline={editingDeadline ?? undefined}
        />
      )}
      <div style={s.cardBody}>
        {loading ? (
          <p style={s.placeholder}>Loading deadlines...</p>
        ) : deadlines.length === 0 ? (
          <p style={s.placeholder}>No deadlines set. Add a deadline to a note to see it here.</p>
        ) : (
          <>
            <div style={s.deadlinesList}>
              {deadlines.map(dl => (
                <DeadlineRow
                  key={dl.id}
                  deadline={dl}
                  workspaceName={workspaceName}
                  isExpanded={expandedGroups.has(dl.id)}
                  onToggleExpand={() => toggleExpand(dl.id)}
                  onEdit={() => setEditingDeadline(dl)}
                />
              ))}
            </div>
            <div style={s.cardFooter}>
              <button style={s.viewAllBtn} onClick={() => navigate('/deadlines')}>
                View All <ArrowRight size={12} strokeWidth={1.5} style={{ marginLeft: 4 }} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function WatchlistCard() {
  const navigate = useNavigate();
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [issues, setIssues] = useState<Map<string, IssueItem>>(new Map());
  const [projects, setProjects] = useState<Map<string, { name: string; projNo: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [workspaceName, setWorkspaceName] = useState('');

  useEffect(() => {
    fetchAppConfig().then(({ workspaceName: wn }) => setWorkspaceName(wn)).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { watchlist: data } = await fetchWatchlist(undefined, 'local');
        if (!cancelled) setWatchlist(data);
      } catch (err) {
        console.error('Failed to load watchlist:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (watchlist.length === 0) return;
    const fetchDetails = async () => {
      const results = await Promise.all(
        watchlist.map(async (entry) => {
          const issue = await fetchIssueById(entry.issueId);
          return { issueId: entry.issueId, issue };
        })
      );
      const details = new Map<string, IssueItem>();
      for (const { issueId, issue } of results) {
        if (issue) details.set(issueId, issue);
      }
      setIssues(details);
    };
    fetchDetails();
  }, [watchlist]);

  useEffect(() => {
    if (watchlist.length === 0) return;
    const fetchProjectDetails = async () => {
      const uniqueBoardIds = Array.from(new Set(watchlist.map(w => w.boardId)));
      const results = await Promise.all(
        uniqueBoardIds.map(async (boardId) => {
          try {
            const { project } = await fetchProject(boardId);
            return { boardId, project: { name: project.name, projNo: project.projNo ?? '' } };
          } catch {
            return { boardId, project: null };
          }
        })
      );
      const projectMap = new Map<string, { name: string; projNo: string }>();
      for (const { boardId, project } of results) {
        if (project) projectMap.set(boardId, project);
      }
      setProjects(projectMap);
    };
    fetchProjectDetails();
  }, [watchlist]);

  const handleToggleImportant = async (issueId: string, boardId: string) => {
    try {
      await toggleImportant(issueId, boardId, 'local');
      const { watchlist: data } = await fetchWatchlist(undefined, 'local');
      setWatchlist(data);
      const issue = await fetchIssueById(issueId);
      if (issue) {
        setIssues(prev => {
          const next = new Map(prev);
          next.set(issueId, issue);
          return next;
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      if (message) {
        alert(message);
      } else {
        console.error('Failed to toggle important:', err);
      }
    }
  };

  const groupedByBoard = (() => {
    const sortedWatchlist = [...watchlist]
      .map(entry => ({ entry, issue: issues.get(entry.issueId) }))
      .filter(({ issue }) => issue !== undefined)
      .sort((a, b) => {
        const aDate = a.issue?.createdAt ? new Date(a.issue.createdAt).getTime() : 0;
        const bDate = b.issue?.createdAt ? new Date(b.issue.createdAt).getTime() : 0;
        return bDate - aDate;
      })
      .slice(0, 15)
      .map(({ entry }) => entry);

    return sortedWatchlist.reduce((acc, entry) => {
      const boardId = entry.boardId;
      if (!acc[boardId]) acc[boardId] = [];
      acc[boardId].push(entry);
      return acc;
    }, {} as Record<string, WatchlistEntry[]>);
  })();

  if (loading) {
    return (
      <div style={s.card}>
        <div style={s.cardHeader}>
          <h2 style={s.cardTitle}>
            <Eye size={16} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Watchlist
          </h2>
        </div>
        <div style={s.cardBody}>
          <p style={s.placeholder}>Loading watchlist...</p>
        </div>
      </div>
    );
  }

  if (watchlist.length === 0) {
    return (
      <div style={s.card}>
        <div style={s.cardHeader}>
          <h2 style={s.cardTitle}>
            <Eye size={16} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Watchlist
          </h2>
        </div>
        <div style={s.cardBody}>
          <p style={s.placeholder}>No items in your watchlist. Star issues on the issue list page to add them here.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <h2 style={s.cardTitle}>
          <Eye size={16} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Watchlist
        </h2>
        <span style={s.cardMeta}>{watchlist.length} item{watchlist.length !== 1 ? 's' : ''}</span>
      </div>
      <div style={s.cardBody}>
        {Object.entries(groupedByBoard).map(([boardId, entries]) => {
          const project = projects.get(boardId);
          const boardName = project?.name ?? 'Unknown Board';
          const projNo = project?.projNo ?? '';
          return (
            <div key={boardId} style={s.boardGroup}>
              <div style={s.boardGroupHeader}>{boardName}</div>
              <div style={s.boardGroupContent}>
                <div style={s.compactHeader}>
                  <span style={{ width: 32 }}></span>
                  <span style={{ ...s.compactCol, ...s.compactColId }}>ID</span>
                  <span style={{ ...s.compactCol, flex: 1 }}>Title</span>
                  <span style={{ ...s.compactCol, ...s.compactColStatus }}>Status</span>
                  <span style={{ ...s.compactCol, ...s.compactColUser }}>Assignee</span>
                  <span style={{ ...s.compactCol, ...s.compactColAge }}>Age</span>
                </div>
                {entries.map(entry => {
                  const issue = issues.get(entry.issueId);
                  if (!issue) return null;
                  return (
                    <WatchlistCompactRow
                      key={entry.id}
                      issue={issue}
                      boardId={entry.boardId}
                      staleDays={7}
                      watchedStates={[]}
                      workspaceName={workspaceName}
                      projNo={projNo}
                      onToggleImportant={handleToggleImportant}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div style={s.cardFooter}>
        <button style={s.viewAllBtn} onClick={() => navigate('/watchlist')}>
          View All <ArrowRight size={12} strokeWidth={1.5} style={{ marginLeft: 4 }} />
        </button>
      </div>
    </div>
  );
}

function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*|__/g, '')
    .replace(/\*|_/g, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/>\s/g, '')
    .replace(/[-*+]\s/g, '')
    .replace(/\n/g, ' ')
    .trim();
}

function NotesCard() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { notes: data } = await fetchNotes(undefined, 'active');
        const sorted = [...data].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        if (!cancelled) setNotes(sorted.slice(0, 10));
      } catch (err) {
        console.error('Failed to load notes:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleDeleteNote = useCallback(async (noteId: string) => {
    try {
      await deleteNote(noteId);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  }, []);

  const relativeTime = (dateStr: string): string => {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  };

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <h2 style={s.cardTitle}>
          <FileText size={16} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Notes
        </h2>
        <button style={s.addNoteBtn} onClick={() => navigate('/notes/new')}>
          <Plus size={12} strokeWidth={1.5} color="#fff" style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Add
        </button>
      </div>
      <div style={s.cardBody}>
        {loading ? (
          <p style={s.placeholder}>Loading notes...</p>
        ) : notes.length === 0 ? (
          <p style={s.placeholder}>No active notes.</p>
        ) : (
          <div style={s.notesList}>
            {notes.map(note => (
              <div
                key={note.id}
                style={s.noteListItem}
                onClick={() => navigate(`/notes/${note.id}`)}
              >
                <div style={s.noteListItemTitle}>{note.title || 'Untitled'}</div>
                <div style={s.noteListItemPreview}>
                  {stripMarkdown(note.content).slice(0, 80) || 'No content'}
                </div>
                <div style={s.noteListItemMeta}>
                  <span style={s.noteListItemTime}>{relativeTime(note.updatedAt)}</span>
                </div>
                <button
                  style={s.noteDeleteBtn}
                  onClick={(e) => { e.stopPropagation(); handleDeleteNote(note.id); }}
                  title="Delete note"
                >
                  <X size={16} strokeWidth={1.5} color={C.inkTertiary} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={s.cardFooter}>
        <button style={s.viewAllBtn} onClick={() => navigate('/notes')}>
          View All <ArrowRight size={12} strokeWidth={1.5} style={{ marginLeft: 4 }} />
        </button>
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
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: C.inkMuted,
    fontFamily: font.display,
    letterSpacing: '-0.6px',
  },
  content: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 24,
  },
  placeholder: {
    color: C.inkTertiary,
    fontSize: 14,
    textAlign: 'center' as const,
    padding: '48px 0',
    fontFamily: font.text,
  },

  card: {
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: `1px solid ${C.hairline}`,
  },
  cardTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: C.inkMuted,
    fontFamily: font.display,
  },
  cardMeta: {
    fontSize: 12,
    color: C.inkTertiary,
    fontFamily: font.text,
  },
  cardBody: {
    padding: '0',
    flex: 1,
    overflowY: 'auto' as const,
  },
  twoColumnLayout: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 24,
  },
  deadlinesCard: {
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    minHeight: 120,
  },

  deadlinesList: {
    display: 'flex',
    flexDirection: 'column' as const,
  },

  boardGroup: {
    borderBottom: `1px solid ${C.hairline}`,
  },
  boardGroupHeader: {
    padding: '12px 20px',
    fontSize: 13,
    fontWeight: 600,
    color: C.inkSubtle,
    backgroundColor: C.surface2,
    borderBottom: `1px solid ${C.hairline}`,
    fontFamily: font.text,
  },
  boardGroupContent: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  compactHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    fontSize: 11,
    fontWeight: 600,
    color: C.inkTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    fontFamily: font.text,
    borderBottom: `1px solid ${C.hairline}`,
  },
  compactCol: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  compactColId: { width: 60 },
  compactColStatus: { width: 120 },
  compactColUser: { width: 80, justifyContent: 'center' as const },
  compactColAge: { width: 50, justifyContent: 'flex-end' as const },

  addNoteBtn: {
    padding: '6px 12px',
    backgroundColor: C.primary,
    color: '#fff',
    border: 'none',
    borderRadius: R.sm,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: font.text,
  },
  notesList: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  noteListItem: {
    padding: '12px 20px',
    cursor: 'pointer',
    borderBottom: `1px solid ${C.hairline}`,
    position: 'relative' as const,
    transition: 'background-color 0.1s',
  },
  noteListItemTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: C.inkMuted,
    marginBottom: 4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    paddingRight: 24,
    fontFamily: font.text,
  },
  noteListItemPreview: {
    fontSize: 12,
    color: C.inkTertiary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontFamily: font.text,
  },
  noteListItemMeta: {
    display: 'flex',
    alignItems: 'center',
    marginTop: 4,
  },
  noteListItemTime: {
    fontSize: 11,
    color: C.inkTertiary,
  },
  noteDeleteBtn: {
    position: 'absolute' as const,
    top: 12,
    right: 12,
    background: 'none',
    border: 'none',
    color: C.inkTertiary,
    fontSize: 18,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  cardFooter: {
    padding: '12px 20px',
    display: 'flex',
    justifyContent: 'flex-start',
    flexShrink: 0,
    borderTop: `1px solid ${C.hairline}`,
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
};
