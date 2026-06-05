import { useState } from 'react';
import type { EpicBreakdown } from '../api/client';
import { UserAvatar, sortByRole } from './UserAvatar';
import { DonutChart } from './DonutChart';

const GROUP_COLORS = { todo: '#64748b', doing: '#3b82f6', done: '#22c55e' };
const GROUP_ORDER  = ['todo', 'doing', 'done'] as const;

export function EpicCard({ epic, staleDays, onStatusClick, onStaleClick, onUserClick }: {
  epic: EpicBreakdown;
  staleDays?: number;
  onStatusClick?: (status: string) => void;
  onStaleClick?: () => void;
  onUserClick?: (userId: string, userName: string) => void;
}) {
  const rawEntries = Object.entries(epic.statusBreakdown);
  const total      = epic.total || rawEntries.reduce((s, [, n]) => s + n, 0);
  const allDone    = total > 0 && rawEntries.every(([status]) => epic.statusGroups[status] === 'done');

  // Aggregate counts by group for donut
  const groupCounts: Record<string, number> = { todo: 0, doing: 0, done: 0 };
  for (const [status, count] of rawEntries) {
    const g = epic.statusGroups[status] ?? 'todo';
    if (g in groupCounts) groupCounts[g] += count;
  }
  const doneCount = groupCounts.done;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const donutSegments = GROUP_ORDER.map((g) => ({
    value: groupCounts[g],
    color: GROUP_COLORS[g],
    label: `${g}: ${groupCounts[g]}`,
  }));

  return (
    <div style={{ ...s.card, ...(allDone ? { borderColor: '#22c55e55' } : {}) }}>
      {/* Header row */}
      <div style={s.header}>
        <span style={s.epicLabel}>Epic</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {allDone && (
            <span style={s.doneBadge} title="All tickets done">✓ Done</span>
          )}
          {!allDone && epic.staleCount > 0 && (
            <span
              style={{ ...s.staleBadge, cursor: onStaleClick ? 'pointer' : 'default' }}
              onClick={onStaleClick}
              title={`${epic.staleCount} ticket${epic.staleCount !== 1 ? 's' : ''} created ${staleDays ?? 7}+ days ago`}
            >
              ⚠ {epic.staleCount} stale
            </span>
          )}
        </div>
      </div>

      <h3 style={s.epicName}>{epic.name}</h3>

      {/* Users */}
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

      {/* Donut + total side by side */}
      <div style={s.ringRow}>
        <DonutChart
          segments={donutSegments}
          size={106}
          strokeWidth={11}
          centerLabel={`${pct}%`}
          centerSub={`${doneCount}/${total}`}
        />
        {/* Status breakdown rows — clickable */}
        <div style={s.breakdown}>
          {rawEntries.map(([status, count]) => (
            <EpicStatusRow
              key={status}
              status={status}
              count={count}
              total={total}
              color={GROUP_COLORS[(epic.statusGroups[status] ?? 'todo') as keyof typeof GROUP_COLORS] ?? '#94a3b8'}
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
  status: string; count: number; total: number; color: string; onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const clickable = !!onClick;
  return (
    <div
      style={{
        ...s.breakdownRow,
        cursor: clickable ? 'pointer' : 'default',
        borderRadius: 5,
        margin: '0 -4px',
        padding: '2px 4px',
        backgroundColor: hovered && clickable ? '#243248' : 'transparent',
        transition: 'background-color 0.1s',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ ...s.dot, backgroundColor: color }} />
      <span style={s.statusLabel}>{status}</span>
      <span style={{ ...s.statusCount, color: count === 0 ? '#475569' : '#e2e8f0' }}>{count}</span>
      <span style={{ ...s.statusPct, color: count === 0 ? '#334155' : '#64748b' }}>
        {total > 0 ? `${Math.round((count / total) * 100)}%` : '—'}
      </span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  epicLabel: {
    fontSize: 11, fontWeight: 600, color: '#a78bfa',
    textTransform: 'uppercase' as const, letterSpacing: '0.06em',
  },
  staleBadge: {
    fontSize: 11, fontWeight: 600, color: '#f59e0b',
    backgroundColor: '#f59e0b18', border: '1px solid #f59e0b44',
    borderRadius: 20, padding: '2px 8px', letterSpacing: '0.02em',
  },
  doneBadge: {
    fontSize: 11, fontWeight: 700, color: '#22c55e',
    backgroundColor: '#22c55e18', border: '1px solid #22c55e55',
    borderRadius: 20, padding: '2px 8px',
  },
  epicName: { margin: 0, fontSize: 15, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.3 },
  users: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  ringRow: { display: 'flex', alignItems: 'center', gap: 12 },
  breakdown: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1 },
  breakdownRow: { display: 'flex', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  statusLabel: { fontSize: 12, color: '#94a3b8', flex: 1 },
  statusCount: { fontSize: 13, fontWeight: 600, minWidth: 24, textAlign: 'right' as const },
  statusPct:   { fontSize: 11, color: '#64748b', minWidth: 32, textAlign: 'right' as const },
  muted: { color: '#64748b', fontSize: 14, margin: 0 },
};
