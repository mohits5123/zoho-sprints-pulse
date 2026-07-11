import { useState } from 'react';
import { Star, Copy, Check } from 'lucide-react';
import { type IssueItem } from '../api/client';
import { UserAvatar } from './UserAvatar';
import { C, font, groupColors } from '../theme';

type StatusGroup = 'todo' | 'doing' | 'done' | 'unknown';

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
  const dotColor = (groupColors as Record<string, string>)[issue.statusGroup as StatusGroup] ?? C.inkSubtle;

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
        backgroundColor: hovered ? C.surface1 : 'transparent',
        cursor: zohoUrl ? 'pointer' : 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={zohoUrl ? () => window.open(zohoUrl, '_blank', 'noopener,noreferrer') : undefined}
    >
      <div style={s.colStar}>
        <button
          style={{
            ...s.starBtn,
            opacity: hovered || issue._important ? 1 : 0.3,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleImportant(issue.zohoId);
          }}
          title={issue._important ? 'Remove from important' : 'Mark as important'}
        >
          <Star
            size={14}
            strokeWidth={1.5}
            color={issue._important ? '#f59e0b' : C.inkTertiary}
            fill={issue._important ? '#f59e0b' : 'none'}
          />
        </button>
      </div>

      <div style={{ ...s.col, ...s.colId, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ ...s.itemNo, color: zohoUrl && hovered ? C.primaryHover : undefined }}>#{issue.itemNo}</span>
        <button
          style={{
            ...s.copyBtn,
            opacity: hovered ? 1 : 0,
            color: copied === issue.itemNo ? C.success : C.inkTertiary,
          }}
          onClick={(e) => { e.stopPropagation(); onCopy(zohoUrl ?? `#${issue.itemNo}`, issue.itemNo); }}
          title={zohoUrl ? 'Copy Zoho URL' : 'Copy issue ID'}
        >
          {copied === issue.itemNo ? <Check size={14} strokeWidth={1.5} color={C.success} /> : <Copy size={14} strokeWidth={1.5} color={C.inkTertiary} />}
        </button>
      </div>

      <div style={s.colTitle}>{issue.title}</div>

      <div style={{ ...s.col, ...s.colStatus, display: 'flex', alignItems: 'flex-start', gap: 5, paddingTop: 4 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0, display: 'inline-block', marginTop: 4 }} />
        <span style={{ fontSize: 12, color: C.inkSubtle, fontFamily: font.text, lineHeight: '1.3', wordBreak: 'break-word' as const }}>{issue.status}</span>
      </div>

      <div style={{ ...s.col, ...s.colUser }}>
        {issue.creator
          ? <UserAvatar name={issue.creator.name} role={issue.creator.role} size={24} />
          : <span style={s.dash}>—</span>}
      </div>

      <div style={{ ...s.col, ...s.colUser, display: 'flex', gap: 3, flexWrap: 'wrap' as const }}>
        {issue.assignees.length > 0
          ? issue.assignees.map((a) => <UserAvatar key={a.id} name={a.name} role={a.role} size={24} />)
          : <span style={s.dash}>—</span>}
      </div>

      <span style={{ ...s.col, ...s.colDate }}>{fmtDate(issue.createdAt)}</span>

      {isWatchedState && (
        <span style={{
          ...s.col, ...s.colDelay,
          color: isStaleByThreshold ? '#ef4444' : C.inkTertiary,
          fontWeight: isStaleByThreshold ? 500 : 400,
        }}>
          {age > 0 ? `${age}d` : '—'}
        </span>
      )}
      {!isWatchedState && (
        <span style={{ ...s.col, ...s.colDelay, color: C.hairline, fontSize: 12, fontStyle: 'italic' }}>
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
    borderBottom: `1px solid ${C.hairline}`,
    transition: 'background-color 0.1s',
    cursor: 'default',
  },
  col:      { display: 'flex', alignItems: 'center', flexShrink: 0, boxSizing: 'border-box' as const },
  colStar:  { width: '4%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  colId:    { width: '8%' },
  colTitle: {
    width: '36%', flexShrink: 0, boxSizing: 'border-box' as const,
    fontSize: 14, fontFamily: font.text, color: C.inkMuted,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
    lineHeight: '1.4',
    wordBreak: 'break-word' as const,
  },
  colStatus:{ width: '14%' },
  colUser:  { width: '8%', justifyContent: 'center' as const },
  colDate:  { width: '12%', fontSize: 12, color: C.inkTertiary, justifyContent: 'flex-end' as const, fontFamily: font.text },
  colDelay: { width: '10%', justifyContent: 'flex-end' as const, fontSize: 12 },
  itemNo: {
    fontSize: 13, fontWeight: 400, color: C.inkTertiary,
    fontFamily: font.mono,
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
  dash: { fontSize: 14, color: C.hairline, fontFamily: font.text },
};
