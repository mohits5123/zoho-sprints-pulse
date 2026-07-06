import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { fetchIssues, fetchIssuesKanban, fetchProject, fetchAppConfig, toggleImportant, type IssueItem } from '../api/client';
import { IssueRow } from '../components/IssueRow';
import { BackButton } from '../components/BackButton';

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
};
