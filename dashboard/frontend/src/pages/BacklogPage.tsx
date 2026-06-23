import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchProject, fetchBacklogStats, fetchAppConfig, type IssueItem, type Project } from '../api/client';
import { UserAvatar } from '../components/UserAvatar';
import { loadStaleConfig, type StaleConfig } from '../components/StaleManagerModal';

type StatusGroup = 'todo' | 'doing' | 'done';

const GROUP_COLORS: Record<StatusGroup, string> = {
  todo:    '#64748b',
  doing:   '#3b82f6',
  done:    '#22c55e',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

function fmtAge(iso: string | null): { days: number; isWatched: boolean } {
  if (!iso) return { days: 0, isWatched: false };
  const age = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return { days: age, isWatched: true };
}

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

  useEffect(() => {
    fetchAppConfig().then(({ workspaceName: wn }) => setWorkspaceName(wn)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchProject(projectId!).then(({ project: p }) => {
      setProject(p);
      if (p.projNo) setProjNo(p.projNo);
      setStaleConfig(loadStaleConfig(projectId!, {}));
    }).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetchBacklogStats(projectId, staleDays, watchedStates)
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, staleDays, watchedStates.join(',')]);

  function copyItemUrl(url: string, itemNo: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(itemNo);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  if (!project) return <p style={s.muted}>Loading…</p>;

  const boardLabel = project.boardType === 'kanban' ? 'Kanban board' : 'Scrum board';
  const staleBadgeColor = stats && stats.summary.staleCount > 0 ? '#ef4444' : '#64748b';

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <button style={s.back} onClick={() => navigate('/projects')}>← Back</button>
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
          {/* Summary bar */}
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
              <span style={{ ...s.summaryValue, color: GROUP_COLORS.todo }}>{stats.summary.statusGroups.todo}</span>
            </div>
            <div style={s.summaryDivider} />
            <div style={s.summaryItem}>
              <span style={s.summaryLabel}>Doing</span>
              <span style={{ ...s.summaryValue, color: GROUP_COLORS.doing }}>{stats.summary.statusGroups.doing}</span>
            </div>
            <div style={s.summaryDivider} />
            <div style={s.summaryItem}>
              <span style={s.summaryLabel}>Done</span>
              <span style={{ ...s.summaryValue, color: GROUP_COLORS.done }}>{stats.summary.statusGroups.done}</span>
            </div>
          </div>

          {/* Items table */}
          <div style={s.list}>
            <div style={s.colHeader}>
              <span style={{ ...s.col, ...s.colId }}>ID</span>
              <span style={{ ...s.col, flex: 1 }}>Title</span>
              <span style={{ ...s.col, ...s.colStatus }}>Status</span>
              <span style={{ ...s.col, ...s.colUser }}>Creator</span>
              <span style={{ ...s.col, ...s.colUser }}>Assignee</span>
              <span style={{ ...s.col, ...s.colDate }}>Created</span>
              <span style={{ ...s.col, ...s.colDelay }}>Age</span>
            </div>
            {stats.oldestItems.map((issue) => (
              <BacklogIssueRow
                key={issue.zohoId}
                issue={issue}
                staleDays={staleDays}
                watchedStates={watchedStates}
                workspaceName={workspaceName}
                projNo={projNo}
                copied={copied}
                onCopy={copyItemUrl}
              />
            ))}
          </div>

          {/* Assignee distribution */}
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

function BacklogIssueRow({
  issue,
  staleDays,
  watchedStates,
  workspaceName,
  projNo,
  copied,
  onCopy,
}: {
  issue: IssueItem;
  staleDays: number;
  watchedStates: string[];
  workspaceName: string;
  projNo: string;
  copied: string | null;
  onCopy: (url: string, itemNo: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const dotColor = GROUP_COLORS[issue.statusGroup as StatusGroup] ?? '#94a3b8';

  const { days: age } = fmtAge(issue.createdAt);
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
      {/* ID */}
      <div style={{ ...s.col, ...s.colId, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ ...s.itemNo, color: zohoUrl && hovered ? '#60a5fa' : '#64748b' }}>#{issue.itemNo}</span>
        <button
          style={{
            ...s.copyBtn,
            opacity: hovered ? 1 : 0,
            color: copied === issue.itemNo ? '#22c55e' : '#64748b',
          }}
          onClick={(e) => { e.stopPropagation(); onCopy(zohoUrl ?? `#${issue.itemNo}`, issue.itemNo); }}
          title={zohoUrl ? 'Copy Zoho URL' : 'Copy issue ID'}
        >
          {copied === issue.itemNo ? '✓' : '⧉'}
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

      {/* Age */}
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
  title: {
    margin: 0, fontSize: 28, fontWeight: 700, color: '#f1f5f9',
    display: 'flex', alignItems: 'baseline', gap: 10,
  },
  badge: {
    fontSize: 12, fontWeight: 500, color: '#64748b',
    backgroundColor: '#1e293b', padding: '3px 8px', borderRadius: 4,
  },
  count: { fontSize: 13, color: '#64748b' },
  muted: { color: '#64748b', fontSize: 14, marginTop: 40, textAlign: 'center' as const },
  err: { color: '#f87171', fontSize: 14, marginTop: 40, textAlign: 'center' as const },
  summaryBar: {
    display: 'flex', alignItems: 'center', gap: 24,
    padding: '16px 20px', backgroundColor: '#1e293b',
    borderRadius: 10, marginBottom: 24,
  },
  summaryItem: { display: 'flex', alignItems: 'center', gap: 8 },
  summaryLabel: { fontSize: 12, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  summaryValue: { fontSize: 20, fontWeight: 700, color: '#f1f5f9' },
  summaryDivider: { width: 1, height: 32, backgroundColor: '#334155' },
  list: {
    border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden',
  },
  colHeader: {
    display: 'flex', alignItems: 'center',
    padding: '10px 16px', backgroundColor: '#1e293b',
    borderBottom: '1px solid #334155',
  },
  col: { display: 'flex', alignItems: 'center', flexShrink: 0 },
  colId: { width: 80 },
  colStatus: { width: 140 },
  colUser: { width: 80, justifyContent: 'center' as const },
  colDate: { width: 100, fontSize: 12, color: '#64748b', justifyContent: 'flex-end' as const },
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
  dash: { fontSize: 13, color: '#334155' },
  assigneeSection: { marginTop: 32 },
  assigneeTitle: { fontSize: 14, fontWeight: 600, color: '#94a3b8', marginBottom: 12 },
  assigneeList: { display: 'flex', flexWrap: 'wrap' as const, gap: 12 },
  assigneeChip: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', backgroundColor: '#1e293b',
    borderRadius: 8, cursor: 'pointer',
    border: '1px solid #334155',
    transition: 'border-color 0.15s',
  },
  assigneeName: { fontSize: 13, color: '#e2e8f0' },
  assigneeCount: { fontSize: 12, color: '#64748b' },
};
