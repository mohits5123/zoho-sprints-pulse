import { useState } from 'react';
import { type IssueItem } from '../api/client';
import { UserAvatar } from './UserAvatar';

type StatusGroup = 'todo' | 'doing' | 'done' | 'unknown';

const GROUP_COLORS: Record<string, string> = {
  todo:    '#64748b',
  doing:   '#3b82f6',
  done:    '#22c55e',
  unknown: '#94a3b8',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

export function IssueRow({
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
  onToggleImportant: (issueId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const dotColor = GROUP_COLORS[issue.statusGroup as StatusGroup] ?? '#94a3b8';

  const ticketAge = issue.createdAt
    ? Math.floor((Date.now() - new Date(issue.createdAt).getTime()) / 86400000)
    : NaN;
  const age = !isNaN(ticketAge) && ticketAge >= 0 ? ticketAge : 0;

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

const s: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex', alignItems: 'center',
    padding: '10px 16px',
    borderBottom: '1px solid #1a2540',
    transition: 'background-color 0.1s',
    cursor: 'default',
  },
  col:      { display: 'flex', alignItems: 'center', flexShrink: 0 },
  colId:    { width: 80 },
  colStatus:{ width: 140 },
  colUser:  { width: 80, justifyContent: 'center' as const },
  colDate:  { width: 100, fontSize: 12, color: '#64748b', justifyContent: 'flex-end' as const },
  colDelay: { width: 72, justifyContent: 'flex-end' as const, fontSize: 12 },
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
