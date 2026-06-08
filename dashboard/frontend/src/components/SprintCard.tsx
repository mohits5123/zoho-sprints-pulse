import { useState } from 'react';
import type { SprintSnapshot } from '../api/client';
import { UserAvatar, sortByRole, sortStatusEntries } from './UserAvatar';

/** Status group type for bucketing issues */
type StatusGroup = 'todo' | 'doing' | 'done';

/** Color mapping for status groups */
const GROUP_COLORS: Record<StatusGroup, string> = {
  todo:  '#64748b',
  doing: '#3b82f6',
  done:  '#22c55e',
};

/** Parse status breakdown JSON string into count object */
function parseBreakdown(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, number>; } catch { return {}; }
}

/** Parse status groups JSON to determine bucket assignments */
function parseStatusGroups(rawData: string | null): Record<string, StatusGroup> {
  if (!rawData) return {};
  try {
    const d = JSON.parse(rawData) as { statusGroups?: Record<string, StatusGroup> };
    return d.statusGroups ?? {};
  } catch { return {}; }
}

/** Get color for a given status based on its group assignment */
function statusColor(name: string, groups: Record<string, StatusGroup>): string {
  const group = groups[name];
  return group ? GROUP_COLORS[group] : '#94a3b8';
}

interface SprintCardProps {
  /** Sprint data to display (required) */
  sprint: SprintSnapshot;
  /** Whether to hide project name label (default: false) */
  hideProjectName?: boolean;
  /** Count of stale tickets in this sprint for warning badge */
  staleCount?: number;
  /** Callback when a status row is clicked (optional) */
  onStatusClick?: (status: string) => void;
  /** Callback when stale badge is clicked */
  onStaleClick?: () => void;
  /** Array of users assigned to issues in this sprint */
  users?: { id: string; name: string; role: string }[];
  /** Callback when a user avatar is clicked (optional) */
  onUserClick?: (userId: string, userName: string) => void;
}

/**
 * SprintCard displays sprint progress with status breakdown visualization
 * Shows sprint name, dates, total tickets, progress bar, and detailed status rows
 * Includes stale ticket warnings and user avatars for assigned team members
 */
export function SprintCard({ sprint, hideProjectName, staleCount, onStatusClick, onStaleClick, users, onUserClick }: SprintCardProps) {
  const breakdown    = parseBreakdown(sprint.statusBreakdown);
  const statusGroups = parseStatusGroups(sprint.rawData);
  const rawEntries   = Object.entries(breakdown);
  const entries      = sortStatusEntries(rawEntries, statusGroups);
  const total        = sprint.totalTickets || rawEntries.reduce((s, [, n]) => s + n, 0);
  const allDone      = total > 0 && rawEntries.every(([status]) => statusGroups[status] === 'done');

  const sprintStatusColor =
    sprint.status === 'active'    ? '#22c55e' :
    sprint.status === 'planned'   ? '#f59e0b' :
    sprint.status === 'completed' ? '#64748b' : '#94a3b8';

  const startFmt = sprint.startDate && sprint.startDate !== '-1'
    ? new Date(sprint.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;
  const endFmt = sprint.endDate && sprint.endDate !== '-1'
    ? new Date(sprint.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;

  return (
    <div style={{ ...s.card, ...(allDone ? { borderColor: '#22c55e55' } : {}) }}>
      {!hideProjectName && <p style={s.projectName}>{sprint.projectName}</p>}

      <div style={s.sprintHeader}>
        <h3 style={s.sprintName}>{sprint.name}</h3>
        <div style={s.headerRight}>
          {allDone && (
            <span style={s.doneBadge} title="All tickets done">✓ Done</span>
          )}
          {!allDone && (staleCount ?? 0) > 0 && (
            <span
              style={{ ...s.staleBadge, cursor: onStaleClick ? 'pointer' : 'default' }}
              onClick={onStaleClick}
              title={`${staleCount} stale ticket${staleCount !== 1 ? 's' : ''} in this sprint`}
            >
              ⚠ {staleCount} stale
            </span>
          )}
          <span style={{ ...s.statusPill, color: sprintStatusColor, borderColor: `${sprintStatusColor}44`, backgroundColor: `${sprintStatusColor}11` }}>
            {sprint.status}
          </span>
        </div>
      </div>

      {(startFmt || endFmt) && (
        <p style={s.dates}>{startFmt ?? '?'} → {endFmt ?? '?'}</p>
      )}

      {users && users.length > 0 && (
        <div style={s.users}>
          {sortByRole(users).map((u) => <UserAvatar key={u.id} name={u.name} role={u.role} onClick={onUserClick ? () => onUserClick(u.id, u.name) : undefined} />)}
        </div>
      )}

      <p style={s.totalLine}>
        <span style={s.totalCount}>{total}</span>
        <span style={s.totalLabel}> tickets</span>
      </p>

      {total > 0 && (
        <div style={s.barTrack}>
          {entries.map(([status, count]) => count > 0 && (
            <div
              key={status}
              title={`${status}: ${count}`}
              style={{
                ...s.barSegment,
                width: `${(count / total) * 100}%`,
                backgroundColor: statusColor(status, statusGroups),
              }}
            />
          ))}
        </div>
      )}

      {entries.length > 0 && (
        <div style={s.breakdown}>
          {entries.map(([status, count]) => (
            <StatusRow
              key={status}
              status={status}
              count={count}
              total={total}
              color={statusColor(status, statusGroups)}
              onClick={onStatusClick ? () => onStatusClick(status) : undefined}
            />
          ))}
        </div>
      )}

      {total === 0 && <p style={s.muted}>No tickets found.</p>}
    </div>
  );
}

/**
 * Status row displaying a single status with count and percentage
 * Used in the breakdown section to show individual status details
 * Clickable when an onClick handler is provided
 */
function StatusRow({ status, count, total, color, onClick }: {
  /** Status name (e.g., 'todo', 'doing', 'done') */
  status: string;
  /** Number of issues in this status */
  count: number;
  /** Total issues across all statuses */
  total: number;
  /** Color of the status dot */
  color: string;
  /** Optional callback when row is clicked */
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const clickable = !!onClick;
  return (
    <div
      style={{
        ...s.breakdownRow,
        cursor: clickable ? 'pointer' : 'default',
        borderRadius: 5,
        margin: '0 -6px',
        padding: '2px 6px',
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
 * Inline styles for SprintCard component
 * Configures the dark theme card appearance with status breakdown visualization
 */
const s: Record<string, React.CSSProperties> = {
  /** Main card container with dark background theme */
  card: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  /** Project name label (shown when not hidden) */
  projectName: { margin: 0, fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' },
  /** Sprint header with name and badges (flex layout) */
  sprintHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  /** Badges and status pill aligned to the right with wrap enabled */
  headerRight:  { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' as const, justifyContent: 'flex-end' },
  /** Sprint name title with full width */
  sprintName: { margin: 0, fontSize: 15, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.3, flex: 1 },
  /** Stale warning badge (yellow) for tickets pending action */
  staleBadge: {
    fontSize: 11, fontWeight: 700, padding: '3px 8px',
    borderRadius: 20, border: '1px solid #f59e0b66',
    backgroundColor: '#f59e0b11', color: '#f59e0b',
  },
  /** Done completion badge (green) when all tickets are done */
  doneBadge: {
    fontSize: 11, fontWeight: 700, padding: '3px 8px',
    borderRadius: 20, border: '1px solid #22c55e55',
    backgroundColor: '#22c55e11', color: '#22c55e',
  },
  /** Sprint status pill showing active/planned/completed state */
  statusPill: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '0.06em', padding: '3px 8px',
    borderRadius: 20, border: '1px solid', flexShrink: 0,
  },
  /** Sprint date range display */
  dates: { margin: 0, fontSize: 12, color: '#64748b' },
  /** User avatars container with wrap enabled */
  users: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  /** Total tickets line */
  totalLine: { margin: 0 },
  /** Total count display (large number) */
  totalCount: { fontSize: 26, fontWeight: 700, color: '#e2e8f0', lineHeight: 1 },
  /** Total label text */
  totalLabel: { fontSize: 13, color: '#94a3b8' },
  /** Progress bar track for status breakdown */
  barTrack: {
    display: 'flex', height: 6, borderRadius: 3,
    overflow: 'hidden', backgroundColor: '#0f172a', gap: 1,
  },
  /** Individual progress bar segment with smooth transition */
  barSegment: { height: '100%', minWidth: 2, transition: 'width 0.3s ease' },
  /** Status breakdown rows container */
  breakdown: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 },
  /** Single status row layout with flexbox */
  breakdownRow: { display: 'flex', alignItems: 'center', gap: 7 },
  /** Status indicator dot */
  dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  /** Status label text */
  statusLabel: { fontSize: 12, color: '#94a3b8', flex: 1 },
  /** Issue count display */
  statusCount: { fontSize: 13, fontWeight: 600, color: '#e2e8f0', minWidth: 24, textAlign: 'right' as const },
  /** Percentage display */
  statusPct:   { fontSize: 11, color: '#64748b', minWidth: 32, textAlign: 'right' as const },
  /** Muted text for empty states */
  muted: { color: '#64748b', fontSize: 14, margin: 0 },
};
