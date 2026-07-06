import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchProject, fetchBacklogStats, fetchAppConfig, toggleImportant, type IssueItem, type Project } from '../api/client';
import { IssueRow } from '../components/IssueRow';
import { UserAvatar } from '../components/UserAvatar';
import { BackButton } from '../components/BackButton';
import { loadStaleConfig, type StaleConfig } from '../components/StaleManagerModal';
import { C, R, font, groupColors } from '../theme';

/**
 * Shape of the response returned by the `fetchBacklogStats` API endpoint.
 * Contains summary counts, the oldest (most aged) issue items, and
 * an assignee distribution list for the project.
 */
interface BacklogStatsResponse {
  summary: {
    total: number;
    staleCount: number;
    statusGroups: {
      todo: number;
      doing: number;
      done: number;
    };
  };
  oldestItems: IssueItem[];
  assignees: Array<{
    id: string;
    name: string;
    role: string;
    count: number;
  }>;
}

/**
 * BacklogPage — the main view that displays a project's backlog as a sortable table
 * of issues with status indicators, age tracking, and stale-item detection.
 *
 * Data flow:
 * 1. On mount, fetches the workspace name and project metadata (parallel via separate effects).
 * 2. Loads the stale-config from local storage (persisted by StaleManagerModal).
 * 3. When `projectId`, `staleDays`, or `watchedStates` change, re-fetches backlog stats
 *    from the API and renders the summary bar + issue rows + assignee distribution.
 *
 * Route dependency: expects `projectId` from the URL params (`/projects/:projectId/backlog`).
 */
export function BacklogPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<BacklogStatsResponse | null>(null);
  const [projNo, setProjNo] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');

  const [staleConfig, setStaleConfig] = useState<StaleConfig>({ days: 7, watchedStates: [] });
  const staleDays = staleConfig.days;
  const watchedStates = staleConfig.watchedStates;

  /** Fetch workspace name once on mount (used for building Zoho URLs). */
  useEffect(() => {
    fetchAppConfig().then(({ workspaceName: wn }) => setWorkspaceName(wn)).catch(() => {});
  }, []);

  /** Fetch project metadata and load stale-config from local storage. */
  useEffect(() => {
    fetchProject(projectId!).then(({ project: p }) => {
      setProject(p);
      if (p.projNo) setProjNo(p.projNo);
      setStaleConfig(loadStaleConfig(projectId!, {}));
    }).catch(() => {});
  }, [projectId]);

  /**
   * Re-fetch backlog stats whenever the project, stale threshold, or watched states change.
   * The `watchedStates.join(',')` dependency ensures the effect reruns when the array contents change,
   * not just when the reference changes.
   */
  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetchBacklogStats(projectId, staleDays, watchedStates)
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, staleDays, watchedStates.join(',')]);

  /**
   * Copies a Zoho issue URL or issue ID to the clipboard and shows a brief "copied" indicator.
   * The visual feedback (checkmark) auto-dismisses after 1.5 seconds.
   */
  function copyItemUrl(url: string, itemNo: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(itemNo);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  /**
   * Toggles the important/watchlist status for an issue.
   * Uses the projectId as the boardId and 'local' as the userId.
   */
  async function handleToggleImportant(issueId: string) {
    try {
      await toggleImportant(issueId, projectId ?? '', 'local');
      if (stats) {
        setStats({
          ...stats,
          oldestItems: stats.oldestItems.map((item) =>
            item.zohoId === issueId ? { ...item, _important: !item._important } : item
          ),
        });
      }
    } catch (err) {
      console.error('Failed to toggle important:', err);
    }
  }

  if (!project) return <p style={s.muted}>Loading…</p>;

  /** Human-readable board label derived from the project's board type. */
  const boardLabel = project.boardType === 'kanban' ? 'Kanban board' : 'Scrum board';
  /** Red color for stale count badge when there are stale items; neutral gray otherwise. */
  const staleBadgeColor = stats && stats.summary.staleCount > 0 ? C.danger : C.inkTertiary;

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <BackButton />
          <div>
            <h1 style={s.title}>
              {project.name} — Backlog
              <span style={s.badge}>{boardLabel}</span>
            </h1>
          </div>
        </div>
        {!loading && stats && (
          <span style={s.count}>
            {stats.summary.total} issue{stats.summary.total !== 1 ? 's' : ''}
            {stats.summary.staleCount > 0 && (
              <span style={{ color: staleBadgeColor, marginLeft: 8 }}>
                · {stats.summary.staleCount} stale
              </span>
            )}
          </span>
        )}
      </header>

      {loading && <p style={s.muted}>Loading backlog…</p>}
      {error && <p style={s.err}>Error: {error}</p>}

      {!loading && !error && (!stats || stats.summary.total === 0) && (
        <p style={s.muted}>No backlog items</p>
      )}

      {!loading && stats && stats.summary.total > 0 && (
        <>
          {/* Summary bar — shows total issues, stale count, and per-status counts */}
          <div style={s.summaryBar}>
            <div style={s.summaryItem}>
              <span style={s.summaryLabel}>Total</span>
              <span style={s.summaryValue}>{stats.summary.total}</span>
            </div>
            <div style={s.summaryDivider} />
            <div style={s.summaryItem}>
              <span style={s.summaryLabel}>Stale</span>
              <span style={{ ...s.summaryValue, color: staleBadgeColor }}>{stats.summary.staleCount}</span>
            </div>
            <div style={s.summaryDivider} />
            <div style={s.summaryItem}>
              <span style={s.summaryLabel}>Todo</span>
              <span style={{ ...s.summaryValue, color: (groupColors as Record<string, string>).todo }}>{stats.summary.statusGroups.todo}</span>
            </div>
            <div style={s.summaryDivider} />
            <div style={s.summaryItem}>
              <span style={s.summaryLabel}>Doing</span>
              <span style={{ ...s.summaryValue, color: (groupColors as Record<string, string>).doing }}>{stats.summary.statusGroups.doing}</span>
            </div>
            <div style={s.summaryDivider} />
            <div style={s.summaryItem}>
              <span style={s.summaryLabel}>Done</span>
              <span style={{ ...s.summaryValue, color: (groupColors as Record<string, string>).done }}>{stats.summary.statusGroups.done}</span>
            </div>
          </div>

          {/* Items table — renders a header row and a BacklogIssueRow for each issue */}
          <div style={s.list}>
            <div style={s.colHeader}>
              <span style={{ ...s.col, ...s.colId, ...s.colHeaderText }}>ID</span>
              <span style={{ ...s.col, flex: 1, ...s.colHeaderText }}>Title</span>
              <span style={{ ...s.col, ...s.colStatus, ...s.colHeaderText }}>Status</span>
              <span style={{ ...s.col, ...s.colUser, ...s.colHeaderText }}>Creator</span>
              <span style={{ ...s.col, ...s.colUser, ...s.colHeaderText }}>Assignee</span>
              <span style={{ ...s.col, ...s.colDate, ...s.colHeaderText }}>Created</span>
              <span style={{ ...s.col, ...s.colDelay, ...s.colHeaderText }}>Age</span>
            </div>
            {stats.oldestItems.map((issue) => (
              <IssueRow
                key={issue.zohoId}
                issue={issue}
                staleDays={staleDays}
                watchedStates={watchedStates}
                workspaceName={workspaceName}
                projNo={projNo}
                copied={copied}
                onCopy={copyItemUrl}
                onToggleImportant={handleToggleImportant}
              />
            ))}
          </div>

          {/* Assignee distribution — clickable chips that navigate to user detail pages */}
          {stats.assignees.length > 0 && (
            <div style={s.assigneeSection}>
              <h3 style={s.assigneeTitle}>Assignee Distribution</h3>
              <div style={s.assigneeList}>
                {stats.assignees.map((a) => (
                  <div
                    key={a.id}
                    style={s.assigneeChip}
                    onClick={() => navigate(`/users/${a.id}`)}
                  >
                    <UserAvatar name={a.name} role={a.role} size={20} />
                    <span style={s.assigneeName}>{a.name}</span>
                    <span style={s.assigneeCount}>({a.count})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Inline style definitions for the backlog page.
 * Uses DESIGN.md tokens via theme.ts.
 */
const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', backgroundColor: C.canvas, color: C.inkMuted,
    padding: '0 24px 48px', fontFamily: font.text,
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '32px 0 40px', borderBottom: `1px solid ${C.hairline}`, marginBottom: 32,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 20 },
  title: {
    margin: 0, fontSize: 28, fontWeight: 700, color: C.inkMuted,
    display: 'flex', alignItems: 'baseline', gap: 10, fontFamily: font.display, letterSpacing: '-0.6px',
  },
  badge: {
    fontSize: 12, fontWeight: 500, color: C.inkTertiary,
    backgroundColor: C.surface1, padding: '3px 8px', borderRadius: R.sm,
  },
  count: { fontSize: 13, color: C.inkTertiary, fontFamily: font.text },
  muted: { color: C.inkTertiary, fontSize: 14, marginTop: 40, textAlign: 'center' as const, fontFamily: font.text },
  err: { color: C.danger, fontSize: 14, marginTop: 40, textAlign: 'center' as const, fontFamily: font.text },
  summaryBar: {
    display: 'flex', alignItems: 'center', gap: 24,
    padding: '16px 20px', backgroundColor: C.surface1,
    borderRadius: R.lg, marginBottom: 24,
  },
  summaryItem: { display: 'flex', alignItems: 'center', gap: 8 },
  summaryLabel: { fontSize: 12, color: C.inkTertiary, textTransform: 'uppercase' as const, letterSpacing: 0.5, fontFamily: font.text },
  summaryValue: { fontSize: 20, fontWeight: 700, color: C.inkMuted, fontFamily: font.display, fontVariantNumeric: 'tabular-nums' },
  summaryDivider: { width: 1, height: 32, backgroundColor: C.hairline },
  list: {
    border: `1px solid ${C.hairline}`, borderRadius: R.lg, overflow: 'hidden',
  },
  colHeader: {
    display: 'flex', alignItems: 'center',
    padding: '10px 16px', backgroundColor: C.surface1,
    borderBottom: `1px solid ${C.hairline}`,
  },
  colHeaderText: {
    fontSize: 11, fontWeight: 600, color: C.inkTertiary,
    textTransform: 'uppercase' as const, letterSpacing: '0.05em',
    fontFamily: font.text,
  },
  col: { display: 'flex', alignItems: 'center', flexShrink: 0 },
  colId: { width: 80 },
  colStatus: { width: 140 },
  colUser: { width: 80, justifyContent: 'center' as const },
  colDate: { width: 100, fontSize: 12, color: C.inkTertiary, justifyContent: 'flex-end' as const, fontFamily: font.text },
  colDelay: { width: 72, justifyContent: 'flex-end' as const, fontSize: 12 },
  assigneeSection: { marginTop: 32 },
  assigneeTitle: { fontSize: 14, fontWeight: 600, color: C.inkSubtle, marginBottom: 12, fontFamily: font.text },
  assigneeList: { display: 'flex', flexWrap: 'wrap' as const, gap: 12 },
  assigneeChip: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', backgroundColor: C.surface1,
    borderRadius: R.md, cursor: 'pointer',
    border: `1px solid ${C.hairline}`,
    transition: 'border-color 0.15s',
  },
  assigneeName: { fontSize: 13, color: C.inkMuted, fontFamily: font.text },
  assigneeCount: { fontSize: 12, color: C.inkTertiary, fontFamily: font.text },
};
