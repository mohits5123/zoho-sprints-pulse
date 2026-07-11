import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { fetchIssues, fetchIssuesKanban, fetchProject, fetchAppConfig, toggleImportant, type IssueItem } from '../api/client';
import { handleApiError } from '../errorHandler';
import { IssueRow } from '../components/IssueRow';
import { BackButton } from '../components/BackButton';
import { C, R, font } from '../theme';

export function IssueListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();

  const sprintId   = searchParams.get('sprintId')    ?? '';
  const epicId     = searchParams.get('epicId')       ?? undefined;
  const status     = searchParams.get('status')       ?? undefined;
  const statusGroup = searchParams.get('statusGroup') ?? undefined;
  const userId     = searchParams.get('userId')       ?? undefined;
  const userName   = searchParams.get('userName')     ?? '';
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
    
    if (boardType === 'kanban') {
      fetchIssuesKanban(projectId, { status, statusGroup, epicId, userId, creatorOnly, stale, staleDays, watchedStates })
        .then(({ issues: data }) => {
          const ORDER: Record<string, number> = { todo: 0, doing: 1, done: 2 };
          setIssues(data.sort((a, b) => (ORDER[a.statusGroup] ?? 1) - (ORDER[b.statusGroup] ?? 1)));
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    } else {
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

  function copyItemUrl(url: string, itemNo: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(itemNo);
      setTimeout(() => setCopied(null), 1500);
    });
  }

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
          <BackButton />
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
          <div style={s.colHeader}>
            <span style={{ width: 32 }}></span>
            <span style={{ ...s.col, ...s.colId, ...s.colHeaderText }}>ID</span>
            <span style={{ ...s.col, flex: 1, ...s.colHeaderText }}>Title</span>
            <span style={{ ...s.col, ...s.colStatus, ...s.colHeaderText }}>Status</span>
            <span style={{ ...s.col, ...s.colUser, ...s.colHeaderText }}>Creator</span>
            <span style={{ ...s.col, ...s.colUser, ...s.colHeaderText }}>Assignee</span>
            <span style={{ ...s.col, ...s.colDate, ...s.colHeaderText }}>Created</span>
            <span style={{ ...s.col, ...s.colDelay, ...s.colHeaderText }}>Delayed</span>
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
              onToggleImportant={async (issueId: string) => {
                try {
                  await toggleImportant(issueId, projectId ?? '', 'local');
                  if (boardType === 'kanban') {
                    const { issues: data } = await fetchIssuesKanban(projectId!, { status, statusGroup, epicId, userId, creatorOnly, stale, staleDays, watchedStates });
                    const ORDER: Record<string, number> = { todo: 0, doing: 1, done: 2 };
                    setIssues(data.sort((a, b) => (ORDER[a.statusGroup] ?? 1) - (ORDER[b.statusGroup] ?? 1)));
                  } else if (sprintId) {
                    const { issues: data } = await fetchIssues(projectId!, sprintId, { status, statusGroup, epicId, userId, creatorOnly, stale, staleDays, watchedStates });
                    const ORDER: Record<string, number> = { todo: 0, doing: 1, done: 2 };
                    setIssues(data.sort((a, b) => (ORDER[a.statusGroup] ?? 1) - (ORDER[b.statusGroup] ?? 1)));
                  }
                } catch (err: unknown) {
                  handleApiError(err, 'Failed to toggle important:');
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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
  title:    { margin: 0, fontSize: 28, fontWeight: 700, color: C.inkMuted, fontFamily: font.display, letterSpacing: '-0.6px' },
  subtitle: { margin: '4px 0 0', fontSize: 14, color: C.inkTertiary, fontFamily: font.text },
  count:    { fontSize: 13, color: C.inkTertiary, fontFamily: font.text },
  muted:    { color: C.inkTertiary, fontSize: 14, marginTop: 40, textAlign: 'center' as const, fontFamily: font.text },
  err:      { color: C.danger, fontSize: 14, marginTop: 40, textAlign: 'center' as const, fontFamily: font.text },
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
  col:      { display: 'flex', alignItems: 'center', flexShrink: 0 },
  colId:    { width: 80 },
  colStatus:{ width: 140 },
  colUser:  { width: 80, justifyContent: 'center' as const },
  colDate:  { width: 100, fontSize: 12, color: C.inkTertiary, justifyContent: 'flex-end' as const, fontFamily: font.text },
  colDelay: { width: 72, justifyContent: 'flex-end' as const, fontSize: 12 },
};
