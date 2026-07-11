import { useState } from 'react';
import { Star } from 'lucide-react';
import { type IssueItem } from '../api/client';
import { UserAvatar } from './UserAvatar';
import { C, font, groupColors } from '../theme';

type StatusGroup = 'todo' | 'doing' | 'done' | 'unknown';

export function WatchlistCompactRow({
  issue,
  boardId,
  staleDays,
  watchedStates,
  workspaceName,
  projNo,
  hasDeadline,
  onToggleImportant,
}: {
  issue: IssueItem;
  boardId: string;
  staleDays: number;
  watchedStates: string[];
  workspaceName: string;
  projNo: string;
  hasDeadline?: boolean;
  onToggleImportant: (issueId: string, boardId: string) => void;
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
            ...(hasDeadline && issue._important ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (hasDeadline && issue._important) {
              alert('Cannot unwatch ticket with active deadline. To unwatch: 1) Go to Deadlines page 2) Find and remove the deadline for this ticket 3) Then unwatch it');
            } else {
              onToggleImportant(issue.zohoId, boardId);
            }
          }}
          title={hasDeadline && issue._important 
            ? 'Cannot unwatch ticket with active deadline. Remove the deadline first.' 
            : issue._important ? 'Remove from important' : 'Mark as important'}
        >
          <Star
            size={14}
            strokeWidth={1.5}
            color={issue._important ? C.warning : C.inkTertiary}
            fill={issue._important ? C.warning : 'none'}
          />
        </button>
      </div>

      <div style={{ ...s.col, ...s.colId }}>
        <span style={{ ...s.itemNo, color: zohoUrl && hovered ? C.primaryHover : undefined }}>#{issue.itemNo}</span>
      </div>

      <div style={s.colTitle}>{issue.title}</div>

      <div style={{ ...s.col, ...s.colStatus, display: 'flex', alignItems: 'flex-start', gap: 5, paddingTop: 3 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0, display: 'inline-block', marginTop: 3 }} />
        <span style={{ fontSize: 11, color: C.inkSubtle, fontFamily: font.text, lineHeight: '1.3', wordBreak: 'break-word' as const }}>{issue.status}</span>
      </div>

      <div style={{ ...s.col, ...s.colUser, display: 'flex', gap: 3, flexWrap: 'wrap' as const }}>
        {issue.assignees.length > 0
          ? issue.assignees.map((a) => <UserAvatar key={a.id} name={a.name} role={a.role} size={20} />)
          : <span style={s.dash}>—</span>}
      </div>

      <span style={{
        ...s.col, ...s.colAge,
        color: isStaleByThreshold ? C.danger : C.inkTertiary,
        fontWeight: isStaleByThreshold ? 500 : 400,
      }}>
        {age > 0 ? `${age}d` : '—'}
      </span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex', alignItems: 'center',
    padding: '8px 12px',
    borderBottom: `1px solid ${C.hairline}`,
    transition: 'background-color 0.1s',
    cursor: 'default',
  },
  col:      { display: 'flex', alignItems: 'center', flexShrink: 0, boxSizing: 'border-box' as const },
  colStar:  { width: '4%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  colId:    { width: '8%' },
  colTitle: {
    width: '42%', flexShrink: 0, boxSizing: 'border-box' as const,
    fontSize: 13, fontFamily: font.text, color: C.inkMuted,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
    lineHeight: '1.4',
    wordBreak: 'break-word' as const,
  },
  colStatus:{ width: '18%' },
  colUser:  { width: '16%', justifyContent: 'center' as const },
  colAge:   { width: '12%', justifyContent: 'flex-end' as const, fontSize: 11, fontFamily: font.text },
  itemNo: {
    fontSize: 12, fontWeight: 400, color: C.inkTertiary,
    fontFamily: font.mono,
  },
  starBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 14, padding: '0 2px', lineHeight: 1,
    transition: 'color 0.15s, opacity 0.15s',
  },
  dash: { fontSize: 13, color: C.hairline, fontFamily: font.text },
};
