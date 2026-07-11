import { useCallback, useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import {
  fetchWatchlist, toggleImportant, fetchIssueById, fetchAppConfig, fetchProject,
  type WatchlistEntry, type IssueItem,
} from '../api/client';
import { handleApiError } from '../errorHandler';
import { WatchlistCompactRow } from '../components/WatchlistCompactRow';
import { BackButton } from '../components/BackButton';
import { C, R, font } from '../theme';

export function WatchlistPage() {
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

  const handleToggleImportant = useCallback(async (issueId: string, boardId: string) => {
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
  }, []);

  const groupedByBoard = watchlist.reduce((acc, entry) => {
    const boardId = entry.boardId;
    if (!acc[boardId]) acc[boardId] = [];
    acc[boardId].push(entry);
    return acc;
  }, {} as Record<string, WatchlistEntry[]>);

  if (loading) {
    return (
      <div style={s.page}>
        <header style={s.header}>
          <div style={s.headerLeft}>
            <BackButton />
            <h1 style={s.title}>
              <Eye size={24} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 8 }} />
              Watchlist
            </h1>
          </div>
        </header>
        <div style={s.content}>
          <div style={s.card}>
            <p style={s.placeholder}>Loading watchlist...</p>
          </div>
        </div>
      </div>
    );
  }

  if (watchlist.length === 0) {
    return (
      <div style={s.page}>
        <header style={s.header}>
          <div style={s.headerLeft}>
            <BackButton />
            <h1 style={s.title}>
              <Eye size={24} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 8 }} />
              Watchlist
            </h1>
          </div>
        </header>
        <div style={s.content}>
          <div style={s.card}>
            <p style={s.placeholder}>No items in your watchlist. Star issues on the issue list page to add them here.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <BackButton />
          <h1 style={s.title}>
            <Eye size={24} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            Watchlist
          </h1>
        </div>
        <span style={s.count}>{watchlist.length} item{watchlist.length !== 1 ? 's' : ''}</span>
      </header>

      <div style={s.content}>
        <div style={s.card}>
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
  count: {
    fontSize: 14,
    color: C.inkTertiary,
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
};
