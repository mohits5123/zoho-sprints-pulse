import { useState } from 'react';
import type { EpicBreakdown } from '../api/client';
import { UserAvatar, sortByRole } from './UserAvatar';
import { DonutChart } from './DonutChart';
import { C, R, font, groupColors } from '../theme';

const GROUP_ORDER = ['todo', 'doing', 'done'] as const;

interface EpicCardProps {
  epic: EpicBreakdown;
  staleDays?: number;
  onStatusClick?: (status: string) => void;
  onStaleClick?: () => void;
  onUserClick?: (userId: string, userName: string) => void;
}

export function EpicCard({ epic, staleDays, onStatusClick, onStaleClick, onUserClick }: EpicCardProps) {
  const rawEntries = Object.entries(epic.statusBreakdown);
  const total      = epic.total || rawEntries.reduce((s, [, n]) => s + n, 0);
  const allDone    = total > 0 && rawEntries.every(([status]) => epic.statusGroups[status] === 'done');

  const groupCounts: Record<string, number> = { todo: 0, doing: 0, done: 0 };
  for (const [status, count] of rawEntries) {
    const g = epic.statusGroups[status] ?? 'todo';
    if (g in groupCounts) groupCounts[g] += count;
  }
  const doneCount = groupCounts.done;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const donutSegments = GROUP_ORDER.map((g) => ({
    value: groupCounts[g],
    color: groupColors[g],
    label: `${g}: ${groupCounts[g]}`,
  }));

  return (
    <div style={{ ...s.card, ...(allDone ? { borderColor: `${C.success}55` } : {}) }}>
      <div style={s.header}>
        <span style={s.epicLabel}>Epic</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {allDone && (
            <span style={s.doneBadge} title="All tickets done">Done</span>
          )}
          {!allDone && epic.staleCount > 0 && (
            <span
              style={{ ...s.staleBadge, cursor: onStaleClick ? 'pointer' : 'default' }}
              onClick={onStaleClick}
              title={`${epic.staleCount} ticket${epic.staleCount !== 1 ? 's' : ''} created ${staleDays ?? 7}+ days ago`}
            >
              {epic.staleCount} stale
            </span>
          )}
        </div>
      </div>

      <h3 style={s.epicName}>{epic.name}</h3>

      {epic.users.length > 0 && (
        <div style={s.users}>
          {sortByRole(epic.users).map((u) => (
            <UserAvatar
              key={u.id}
              name={u.name}
              role={u.role}
              onClick={onUserClick ? () => onUserClick(u.id, u.name) : undefined}
            />
          ))}
        </div>
      )}

      <div style={s.ringRow}>
        <DonutChart
          segments={donutSegments}
          size={106}
          strokeWidth={6}
          centerLabel={`${pct}%`}
          centerSub={`${doneCount}/${total}`}
        />
        <div style={s.breakdown}>
          {rawEntries.map(([status, count]) => (
            <EpicStatusRow
              key={status}
              status={status}
              count={count}
              total={total}
              color={groupColors[(epic.statusGroups[status] ?? 'todo') as keyof typeof groupColors] ?? C.inkSubtle}
              onClick={onStatusClick ? () => onStatusClick(status) : undefined}
            />
          ))}
        </div>
      </div>

      {total === 0 && <p style={s.muted}>No tickets in this sprint.</p>}
    </div>
  );
}

function EpicStatusRow({ status, count, total, color, onClick }: {
  status: string;
  count: number;
  total: number;
  color: string;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const clickable = !!onClick;
  return (
    <div
      style={{
        ...s.breakdownRow,
        cursor: clickable ? 'pointer' : 'default',
        borderRadius: R.xs,
        margin: '0 -4px',
        padding: '2px 4px',
        backgroundColor: hovered && clickable ? C.surface2 : 'transparent',
        transition: 'background-color 0.1s',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ ...s.dot, backgroundColor: color }} />
      <span style={s.statusLabel}>{status}</span>
      <span style={{ ...s.statusCount, color: count === 0 ? C.inkTertiary : C.inkMuted }}>{count}</span>
      <span style={{ ...s.statusPct, color: count === 0 ? C.hairline : C.inkTertiary }}>
        {total > 0 ? `${Math.round((count / total) * 100)}%` : '—'}
      </span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: C.surface1, border: `1px solid ${C.hairline}`,
    borderRadius: R.lg, padding: '24px',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  epicLabel: {
    fontSize: 13, fontWeight: 500, color: C.primary,
    textTransform: 'uppercase' as const, letterSpacing: '0.4px',
    fontFamily: font.text,
  },
  staleBadge: {
    fontSize: 12, fontWeight: 400, color: '#f59e0b',
    backgroundColor: '#f59e0b18', border: '1px solid #f59e0b44',
    borderRadius: R.pill, padding: '2px 8px',
    fontFamily: font.text,
  },
  doneBadge: {
    fontSize: 12, fontWeight: 400, color: C.success,
    backgroundColor: `${C.success}18`, border: `1px solid ${C.success}55`,
    borderRadius: R.pill, padding: '2px 8px',
    fontFamily: font.text,
  },
  epicName: { margin: 0, fontSize: 20, fontWeight: 400, color: C.inkMuted, lineHeight: 1.4, letterSpacing: '-0.2px', fontFamily: font.display },
  users: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  ringRow: { display: 'flex', alignItems: 'center', gap: 12 },
  breakdown: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1 },
  breakdownRow: { display: 'flex', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  statusLabel: { fontSize: 14, color: C.inkSubtle, flex: 1, fontFamily: font.text },
  statusCount: { fontSize: 14, fontWeight: 500, minWidth: 24, textAlign: 'right' as const, fontFamily: font.text },
  statusPct:   { fontSize: 12, color: C.inkTertiary, minWidth: 32, textAlign: 'right' as const, fontFamily: font.text },
  muted: { color: C.inkTertiary, fontSize: 14, margin: 0, fontFamily: font.text },
};
