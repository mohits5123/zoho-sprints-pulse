import { useState } from 'react';
import type { EpicBreakdown } from '../api/client';
import { UserAvatar, sortByRole } from './UserAvatar';
import { DonutChart } from './DonutChart';

/**
 * EpicCard displays a visual breakdown of an epic's issues across sprints,
 * grouped by status buckets (todo/doing/done).
 *
 * Features:
 * - Donut chart showing completion percentage
 * - Status breakdown rows (clickable if callback provided)
 * - User avatars with optional click handlers
 * - Stale badge for aged issues (default: 7 days)
 * - Done badge when all tickets are completed
 */

/**
 * Color mapping for status groups used throughout the donut chart and status rows.
 * - todo: slate (neutral)
 * - doing: blue (in-progress)
 * - done: green (completed)
 */
const GROUP_COLORS = { todo: '#64748b', doing: '#3b82f6', done: '#22c55e' };

/**
 * Canonical ordering for status groups, ensuring consistent rendering
 * across the donut chart segments and status breakdown rows.
 */
const GROUP_ORDER  = ['todo', 'doing', 'done'] as const;

interface EpicCardProps {
  /** The epic data to display */
  epic: EpicBreakdown;
  /** Number of days to consider an issue stale (default: 7) */
  staleDays?: number;
  /** Callback when a status row is clicked */
  onStatusClick?: (status: string) => void;
  /** Callback when stale badge is clicked */
  onStaleClick?: () => void;
  /** Callback when a user avatar is clicked */
  onUserClick?: (userId: string, userName: string) => void;
}

export function EpicCard({ epic, staleDays, onStatusClick, onStaleClick, onUserClick }: EpicCardProps) {
  // Convert the status breakdown map to a sorted array, ordered by GROUP_ORDER.
  const rawEntries = Object.entries(epic.statusBreakdown);
  // Use the precomputed total from the API if available; otherwise sum from breakdown.
  const total      = epic.total || rawEntries.reduce((s, [, n]) => s + n, 0);
  // An epic is "all done" when every status maps to the 'done' group and total > 0.
  const allDone    = total > 0 && rawEntries.every(([status]) => epic.statusGroups[status] === 'done');

  // Aggregate raw status counts into their parent groups (todo/doing/done) for the donut chart.
  const groupCounts: Record<string, number> = { todo: 0, doing: 0, done: 0 };
  for (const [status, count] of rawEntries) {
    const g = epic.statusGroups[status] ?? 'todo';
    if (g in groupCounts) groupCounts[g] += count;
  }
  const doneCount = groupCounts.done;
  // Compute completion percentage, guarded against division by zero.
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  // Build segments for the donut chart in canonical order.
  const donutSegments = GROUP_ORDER.map((g) => ({
    value: groupCounts[g],
    color: GROUP_COLORS[g],
    label: `${g}: ${groupCounts[g]}`,
  }));

  return (
    <div style={{ ...s.card, ...(allDone ? { borderColor: '#22c55e55' } : {}) }}>
      {/* Header row: epic label with optional badges */}
      <div style={s.header}>
        <span style={s.epicLabel}>Epic</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Show a green "Done" badge when every ticket in the epic is completed. */}
          {allDone && (
            <span style={s.doneBadge} title="All tickets done">✓ Done</span>
          )}
          {/* Show a yellow stale badge when there are aged issues (only if not all done). */}
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

      {/* User avatars sorted by role, each optionally clickable */}
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

      {/* Donut chart and status breakdown displayed side by side */}
      <div style={s.ringRow}>
        <DonutChart
          segments={donutSegments}
          size={106}
          strokeWidth={11}
          centerLabel={`${pct}%`}
          centerSub={`${doneCount}/${total}`}
        />
        {/* Status breakdown rows — each row is clickable to trigger filtering */}
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

      {/* Empty state shown when the epic has no tickets at all */}
      {total === 0 && <p style={s.muted}>No tickets in this sprint.</p>}
    </div>
  );
}

/**
 * EpicStatusRow renders a single row in the status breakdown panel.
 *
 * Each row shows:
 * - A colored dot reflecting the status's group (todo/doing/done)
 * - The status label (e.g. "todo", "done")
 * - The raw count of issues
 * - The percentage of total issues this status represents
 *
 * When `onClick` is provided the row becomes interactive (pointer cursor + hover highlight).
 */
function EpicStatusRow({ status, count, total, color, onClick }: {
  /** Status name (e.g., 'todo', 'done') */
  status: string;
  /** Number of issues in this status */
  count: number;
  /** Total issues across all statuses */
  total: number;
  /** Color of the status dot, derived from the status group mapping */
  color: string;
  /** Optional callback when row is clicked, enabling filter-by-status behavior */
  onClick?: () => void;
}) {
  // Track hover state to highlight the row on mouse-over (only when clickable).
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

/**
 * Inline styles for EpicCard and EpicStatusRow.
 * All values are tuned for the app's dark theme (slate-based palette).
 */
const s: Record<string, React.CSSProperties> = {
  /** Card container with dark theme and rounded corners */
  card: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  /** Header row with label and badges */
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  /** Epic label text */
  epicLabel: {
    fontSize: 11, fontWeight: 600, color: '#a78bfa',
    textTransform: 'uppercase' as const, letterSpacing: '0.06em',
  },
  /** Stale warning badge (yellow) */
  staleBadge: {
    fontSize: 11, fontWeight: 600, color: '#f59e0b',
    backgroundColor: '#f59e0b18', border: '1px solid #f59e0b44',
    borderRadius: 20, padding: '2px 8px', letterSpacing: '0.02em',
  },
  /** Done completion badge (green) */
  doneBadge: {
    fontSize: 11, fontWeight: 700, color: '#22c55e',
    backgroundColor: '#22c55e18', border: '1px solid #22c55e55',
    borderRadius: 20, padding: '2px 8px',
  },
  /** Epic name title */
  epicName: { margin: 0, fontSize: 15, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.3 },
  /** User avatars container */
  users: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  /** Donut chart and breakdown side-by-side row */
  ringRow: { display: 'flex', alignItems: 'center', gap: 12 },
  /** Status breakdown rows container */
  breakdown: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1 },
  /** Single status row layout */
  breakdownRow: { display: 'flex', alignItems: 'center', gap: 6 },
  /** Status indicator dot */
  dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  /** Status label text */
  statusLabel: { fontSize: 12, color: '#94a3b8', flex: 1 },
  /** Issue count display */
  statusCount: { fontSize: 13, fontWeight: 600, minWidth: 24, textAlign: 'right' as const },
  /** Percentage display */
  statusPct:   { fontSize: 11, color: '#64748b', minWidth: 32, textAlign: 'right' as const },
  /** Muted text for empty states */
  muted: { color: '#64748b', fontSize: 14, margin: 0 },
};
