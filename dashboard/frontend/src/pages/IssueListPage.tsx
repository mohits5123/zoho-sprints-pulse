/**
 * Issue list page component.
 *
 * Displays a filtered and paginated list of issues (tickets) from a specific project (and optional sprint).
 * Supports filtering by status, status group (todo/doing/done), creator, assignee, staleness, and watched states.
 *
 * Features:
 * - Issue list with columns: ID, Title, Status, Creator, Assignee, Created, Delayed/Age
 * - Filters via URL query parameters (sprintId, status, statusGroup, userId, stale, staleDays, etc.)
 * - Click to open in Zoho Sprints (if URL available)
 * - Copy issue ID or Zoho URL to clipboard
 * - Dynamic title based on filter context (e.g., "Stale tickets", "John's issues")
 * - Staleness calculation: age in days, highlighted red if over threshold and in watched state
 * - Watched states: by default all non-done statuses; can be customized per project
 *
 * Data flows:
 * - Issues are fetched from local SQLite via backend query layer
 * - Workspace name and project number are cached from app config
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { fetchIssues, fetchIssuesKanban, fetchProject, fetchAppConfig, toggleImportant, type IssueItem } from '../api/client';
import { UserAvatar } from '../components/UserAvatar';

/**
 * Represents the high-level grouping of an issue's workflow state.
 *
 * - `todo`:   Issues not yet started (e.g. "New", "Open")
 * - `doing`:  Issues actively being worked on (e.g. "In Progress")
 * - `done`:   Issues completed (e.g. "Done", "Closed")
 * - `unknown`: Any status that doesn't map to the above groups
 */
type StatusGroup = 'todo' | 'doing' | 'done' | 'unknown';

/**
 * Color mapping for status groups, used for the status-dot indicator in each row.
 *
 * These are muted slate/blue/green tones chosen for a dark theme.
 */
const GROUP_COLORS: Record<string, string> = {
  todo:    '#64748b',
  doing:   '#3b82f6',
  done:    '#22c55e',
  unknown: '#94a3b8',
};

/**
 * Formats an ISO 8601 date string into a short locale-aware date (en-IN).
 *
 * @param iso - ISO date string to format; may be `null`
 * @returns A human-readable date like `"28 Jun 25"`, or `"—"` if the input is
 *          falsy or unparseable
 */
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

/**
 * Renders a filtered, paginated list of issues for a given project.
 *
 * Reads filter parameters from the URL query string (`sprintId`, `status`,
 * `statusGroup`, `userId`, `stale`, etc.) and fetches matching issues from the
 * backend. The fetch strategy differs by board type:
 * - **Kanban** boards: issues are fetched without a sprint scope.
 * - **Scrum** boards:  issues are fetched within a specific sprint.
 *
 * Issues are sorted by status group (`todo` → `doing` → `done`). The page
 * title and subtitle are derived from the active filters so that a URL like
 * `?stale=true&staleDays=14` produces the heading *"Stale tickets (14+ days)"*.
 *
 * **Rendering states:**
 * 1. *Loading* — shown while data is being fetched from the backend.
 * 2. *Error*    — shown when a fetch call rejects.
 * 3. *Empty*    — shown when the query returns zero results.
 * 4. *List*     — the full issue table with sortable columns and per-row actions.
 */
export function IssueListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const sprintId   = searchParams.get('sprintId')    ?? '';
  const epicId     = searchParams.get('epicId')       ?? undefined;
  const status     = searchParams.get('status')       ?? undefined;
  const statusGroup = searchParams.get('statusGroup') ?? undefined;
  const userId     = searchParams.get('userId')       ?? undefined;
  const userName   = searchParams.get('userName')     ?? '';
  // `stale=true` narrows results to issues whose age exceeds `staleDays`
  // (default 7). When `creatorOnly=true` only issues created by `userId` are shown.
  const stale      = searchParams.get('stale') === 'true';
  const staleDays  = parseInt(searchParams.get('staleDays') ?? '7', 10) || 7;
  const creatorOnly = searchParams.get('creatorOnly') === 'true';
  const sprintName = searchParams.get('sprintName')   ?? '';
  const epicName   = searchParams.get('epicName')     ?? '';
  const watchedStates = searchParams.get('watchedStates')
    ? searchParams.get('watchedStates')!.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const [issues, setIssues]         = useState<IssueItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [copied, setCopied]         = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [projNo, setProjNo]         = useState('');
  const [boardType, setBoardType]   = useState<'scrum' | 'kanban' | 'other' | null>(null);

  // Fetch workspace name and projNo independently (not from URL params)
  useEffect(() => {
    fetchAppConfig().then(({ workspaceName: wn }) => setWorkspaceName(wn)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectId) return;
    fetchProject(projectId).then(({ project }) => {
      if (project.projNo) setProjNo(project.projNo);
      if (project.boardType) setBoardType(project.boardType as 'scrum' | 'kanban' | 'other');
    }).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    
    // Determine which fetch function to use based on board type
    if (boardType === 'kanban') {
      fetchIssuesKanban(projectId, { status, statusGroup, epicId, userId, creatorOnly, stale, staleDays, watchedStates })
        .then(({ issues: data }) => {
          const ORDER: Record<string, number> = { todo: 0, doing: 1, done: 2 };
          setIssues(data.sort((a, b) => (ORDER[a.statusGroup] ?? 1) - (ORDER[b.statusGroup] ?? 1)));
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    } else {
      // Scrum or other boards - use sprint-based fetching
      if (!sprintId) return;
      fetchIssues(projectId, sprintId, { status, statusGroup, epicId, userId, creatorOnly, stale, staleDays, watchedStates })
        .then(({ issues: data }) => {
          const ORDER: Record<string, number> = { todo: 0, doing: 1, done: 2 };
          setIssues(data.sort((a, b) => (ORDER[a.statusGroup] ?? 1) - (ORDER[b.statusGroup] ?? 1)));
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [projectId, sprintId, boardType, status, epicId, userId, creatorOnly, stale, staleDays]);

  /**
   * Copies a URL or issue ID to the clipboard and shows a brief "copied"
   * indicator on the corresponding row.
   *
   * @param url - The text to copy (a full Zoho Sprints URL or a fallback `#<itemNo>`)
   * @param itemNo - The issue's item number, used as a key to clear the indicator
   */
  function copyItemUrl(url: string, itemNo: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(itemNo);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  // Page title
  const GROUP_DISPLAY: Record<string, string> = { todo: 'Todo', doing: 'In Progress', done: 'Done' };
  const title = creatorOnly && userName
    ? `Tickets raised by ${userName}`
    : userId && userName
    ? `${userName}'s issues`
    : stale
    ? `Stale tickets (${staleDays}+ days)`
    : statusGroup
    ? `${GROUP_DISPLAY[statusGroup] ?? statusGroup} issues`
    : status ?? 'All issues';

  const subtitle = [
    sprintName && `Sprint: ${sprintName}`,
    epicName   && `Epic: ${epicName}`,
  ].filter(Boolean).join('  ·  ');

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <button style={s.back} onClick={() => navigate(-1)}>Back</button>
          <div>
            <h1 style={s.title}>{title}</h1>
            {subtitle && <p style={s.subtitle}>{subtitle}</p>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!loading && <span style={s.count}>{issues.length} issue{issues.length !== 1 ? 's' : ''}</span>}
        </div>
      </header>

      {loading && <p style={s.muted}>Loading issues…</p>}
      {error   && <p style={s.err}>Error: {error}</p>}

      {!loading && !error && issues.length === 0 && (
        <p style={s.muted}>No issues match this filter.</p>
      )}

      {!loading && issues.length > 0 && (
        <div style={s.list}>
          {/* Column headers */}
          <div style={s.colHeader}>
            <span style={{ ...s.col, ...s.colId }}>ID</span>
            <span style={{ ...s.col, flex: 1 }}>Title</span>
            <span style={{ ...s.col, ...s.colStatus }}>Status</span>
            <span style={{ ...s.col, ...s.colUser }}>Creator</span>
            <span style={{ ...s.col, ...s.colUser }}>Assignee</span>
            <span style={{ ...s.col, ...s.colDate }}>Created</span>
            <span style={{ ...s.col, ...s.colDelay }}>Delayed</span>
          </div>

          {issues.map((issue) => (
            <IssueRow
              key={issue.zohoId}
              issue={issue}
              staleDays={staleDays}
              watchedStates={watchedStates}
              workspaceName={workspaceName}
              projNo={projNo}
              copied={copied}
              onCopy={copyItemUrl}
              boardId={projectId ?? ''}
              userId={userId ?? ''}
              onToggleImportant={async (issueId: string) => {
                try {
                  await toggleImportant(issueId, projectId ?? '', 'local');
                  // Refetch issues to get updated important state
                  if (boardType === 'kanban') {
                    const { issues: data } = await fetchIssuesKanban(projectId!, { status, statusGroup, epicId, userId, creatorOnly, stale, staleDays, watchedStates });
                    const ORDER: Record<string, number> = { todo: 0, doing: 1, done: 2 };
                    setIssues(data.sort((a, b) => (ORDER[a.statusGroup] ?? 1) - (ORDER[b.statusGroup] ?? 1)));
                  } else if (sprintId) {
                    const { issues: data } = await fetchIssues(projectId!, sprintId, { status, statusGroup, epicId, userId, creatorOnly, stale, staleDays, watchedStates });
                    const ORDER: Record<string, number> = { todo: 0, doing: 1, done: 2 };
                    setIssues(data.sort((a, b) => (ORDER[a.statusGroup] ?? 1) - (ORDER[b.statusGroup] ?? 1)));
                  }
                } catch (err) {
                  console.error('Failed to toggle important:', err);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders a single row inside the issue list table.
 *
 * Each row displays the issue's ID, title, status dot, creator avatar,
 * assignee avatars, created date, and (when applicable) age in days.
 *
 * **Interactions:**
 * - *Hover* — highlights the row background and reveals the copy button.
 * - *Click* — opens the Zoho Sprints detail page in a new tab (if a URL is available).
 * - *Copy button* — copies the Zoho URL (or a fallback `#<itemNo>`) to the clipboard.
 *
 * **Staleness logic:**
 * An issue's age is displayed only when its status is considered "watched".
 * By default every non-done status is watched; if the project has custom
 * `watchedStates` configured then only statuses in that list are watched.
 * When the age exceeds `staleDays` and the state is watched, the age is
 * shown in red with bold weight to draw attention to stale work.
 *
 * @param issue - The issue record to render
 * @param staleDays - Age threshold in days; values above this are flagged as stale
 * @param watchedStates - List of status strings considered "watched". Empty array
 *                        means the default rule (non-done = watched) applies
 * @param workspaceName - Zoho Sprints workspace slug, used to build the detail URL
 * @param projNo - Project number, used to build the detail URL
 * @param copied - The `itemNo` of the row that was most recently copied (for UI feedback)
 * @param onCopy - Callback invoked when the user clicks the copy button
 */
function IssueRow({
  issue,
  staleDays,
  watchedStates,
  workspaceName,
  projNo,
  copied,
  onCopy,
  onToggleImportant,
}: {
  issue: IssueItem;
  staleDays: number;
  watchedStates: string[];
  workspaceName: string;
  projNo: string;
  copied: string | null;
  onCopy: (url: string, itemNo: string) => void;
  boardId: string;
  userId: string;
  onToggleImportant: (issueId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const dotColor = GROUP_COLORS[issue.statusGroup as StatusGroup] ?? '#94a3b8';

  // Match the stale card logic exactly:
  // - Only show age if the issue's status is in watchedStates (or no watchedStates configured)
  // - Highlight red when age > staleDays and state is watched
  const ticketAge = issue.createdAt
    ? Math.floor((Date.now() - new Date(issue.createdAt).getTime()) / 86400000)
    : NaN;
  const age = !isNaN(ticketAge) && ticketAge >= 0 ? ticketAge : 0;

  // Determine if this issue's state is being watched for staleness
  const isWatchedState = watchedStates.length === 0
    ? issue.statusGroup !== 'done'
    : watchedStates.includes(issue.status);
  const isStaleByThreshold = isWatchedState && age > staleDays;

  const zohoUrl = workspaceName && projNo
    ? `https://sprints.zoho.in/workspace/${workspaceName}#P${projNo}/itemdetails/I${issue.itemNo}`
    : null;

  return (
    <div
      style={{
        ...s.row,
        backgroundColor: hovered ? '#1e293b' : 'transparent',
        cursor: zohoUrl ? 'pointer' : 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={zohoUrl ? () => window.open(zohoUrl, '_blank', 'noopener,noreferrer') : undefined}
    >
      {/* Star/Important toggle */}
      <div style={{ width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button
          style={{
            ...s.starBtn,
            color: issue._important ? '#fbbf24' : '#334155',
            opacity: hovered || issue._important ? 1 : 0.3,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleImportant(issue.zohoId);
          }}
          title={issue._important ? 'Remove from important' : 'Mark as important'}
        >
          ★
        </button>
      </div>

      {/* ID */}
      <div style={{ ...s.col, ...s.colId, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ ...s.itemNo, color: zohoUrl && hovered ? '#60a5fa' : undefined }}>#{issue.itemNo}</span>
        <button
          style={{
            ...s.copyBtn,
            opacity: hovered ? 1 : 0,
            color: copied === issue.itemNo ? '#22c55e' : '#64748b',
          }}
          onClick={(e) => { e.stopPropagation(); onCopy(zohoUrl ?? `#${issue.itemNo}`, issue.itemNo); }}
          title={zohoUrl ? 'Copy Zoho URL' : 'Copy issue ID'}
        >
          {copied === issue.itemNo ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Title */}
      <span style={{ ...s.col, flex: 1, color: '#e2e8f0', fontSize: 13 }}>{issue.title}</span>

      {/* Status */}
      <div style={{ ...s.col, ...s.colStatus, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0, display: 'inline-block' }} />
        <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' as const }}>{issue.status}</span>
      </div>

      {/* Creator */}
      <div style={{ ...s.col, ...s.colUser }}>
        {issue.creator
          ? <UserAvatar name={issue.creator.name} role={issue.creator.role} size={24} />
          : <span style={s.dash}>—</span>}
      </div>

      {/* Assignees */}
      <div style={{ ...s.col, ...s.colUser, display: 'flex', gap: 3, flexWrap: 'wrap' as const }}>
        {issue.assignees.length > 0
          ? issue.assignees.map((a) => <UserAvatar key={a.id} name={a.name} role={a.role} size={24} />)
          : <span style={s.dash}>—</span>}
      </div>

      {/* Created */}
      <span style={{ ...s.col, ...s.colDate }}>{fmtDate(issue.createdAt)}</span>

      {/* Age — only show when state is watched, red when over stale threshold */}
      {isWatchedState && (
        <span style={{
          ...s.col, ...s.colDelay,
          color: isStaleByThreshold ? '#ef4444' : '#64748b',
          fontWeight: isStaleByThreshold ? 600 : 400,
        }}>
          {age > 0 ? `${age}d` : '—'}
        </span>
      )}
      {!isWatchedState && (
        <span style={{ ...s.col, ...s.colDelay, color: '#334155', fontSize: 11, fontStyle: 'italic' }}>
          n/a
        </span>
      )}
    </div>
  );
}

/**
 * Inline style objects for the issue list page.
 *
 * All styles are hand-written (no CSS framework) and tuned for a dark
 * slate background (`#0f172a`). The layout is a flex-based table with
 * fixed-width columns for ID, status, dates, and staleness.
 */
const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', backgroundColor: '#0f172a', color: '#e2e8f0',
    padding: '0 24px 48px', fontFamily: 'system-ui, sans-serif',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '32px 0 40px', borderBottom: '1px solid #1e293b', marginBottom: 32,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 20 },
  back: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 8, padding: '7px 13px',
    color: '#94a3b8', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', userSelect: 'none' as const,
  },
  title:    { margin: 0, fontSize: 28, fontWeight: 700, color: '#f1f5f9' },
  subtitle: { margin: '4px 0 0', fontSize: 14, color: '#64748b' },
  count:    { fontSize: 13, color: '#64748b' },
  muted:    { color: '#64748b', fontSize: 14, marginTop: 40, textAlign: 'center' as const },
  err:      { color: '#f87171', fontSize: 14, marginTop: 40, textAlign: 'center' as const },
  list: {
    border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden',
  },
  colHeader: {
    display: 'flex', alignItems: 'center',
    padding: '10px 16px', backgroundColor: '#1e293b',
    borderBottom: '1px solid #334155',
  },
  col:      { display: 'flex', alignItems: 'center', flexShrink: 0 },
  colId:    { width: 80 },
  colStatus:{ width: 140 },
  colUser:  { width: 80, justifyContent: 'center' as const },
  colDate:  { width: 100, fontSize: 12, color: '#64748b', justifyContent: 'flex-end' as const },
  colDelay: { width: 72, justifyContent: 'flex-end' as const, fontSize: 12 },
  row: {
    display: 'flex', alignItems: 'center',
    padding: '10px 16px',
    borderBottom: '1px solid #1a2540',
    transition: 'background-color 0.1s',
    cursor: 'default',
  },
  itemNo: {
    fontSize: 12, fontWeight: 600, color: '#64748b',
    fontFamily: 'monospace',
  },
  copyBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 16, padding: '0 3px', lineHeight: 1,
    transition: 'opacity 0.15s, color 0.15s',
  },
  starBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 14, padding: '0 2px', lineHeight: 1,
    transition: 'color 0.15s, opacity 0.15s',
  },
  dash: { fontSize: 13, color: '#334155' },
};
