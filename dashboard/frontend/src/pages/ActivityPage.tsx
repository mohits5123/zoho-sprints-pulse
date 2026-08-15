import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Calendar, Eye, FileText, ArrowRight } from 'lucide-react';
import {
  fetchNotes,
  fetchWatchlist, toggleImportant, fetchIssueById, fetchAppConfig, fetchProject,
  fetchCombinedDeadlines,
  type NoteEntry, type WatchlistEntry, type IssueItem,
  type CombinedDeadline,
} from '../api/client';
import { handleApiError } from '../errorHandler';
import { WatchlistCompactRow } from '../components/WatchlistCompactRow';
import { BackButton } from '../components/BackButton';
import { CreateDeadlineModal } from '../components/CreateDeadlineModal';
import { DeadlineRow } from '../components/DeadlineRow';
import { C, R, font } from '../theme';

export function ActivityPage() {
  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <BackButton />
          <h1 style={s.title}>Activity</h1>
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
      handleApiError(err, 'Failed to toggle important:');
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
                      hasDeadline={entry.hasDeadline}
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

  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
  },
};
