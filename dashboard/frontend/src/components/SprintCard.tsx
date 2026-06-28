import { useRef, useState } from 'react';
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

/**
 * Parses a JSON string containing status breakdowns into a map of status names to ticket counts.
 * Returns an empty object when the input is null, empty, or invalid JSON.
 *
 * @param raw - Raw JSON string from the API (e.g., `{"todo": 3, "doing": 5}`)
 * @returns A record mapping status names to their ticket counts
 */
function parseBreakdown(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, number>; } catch { return {}; }
}

/**
 * Parses a JSON string containing status group definitions into a map of status names to their group buckets.
 * Returns an empty object when the input is null, empty, or invalid JSON.
 *
 * @param rawData - Raw JSON string from the API defining which statuses belong to which group
 * @returns A record mapping status names to their assigned `StatusGroup` bucket
 */
function parseStatusGroups(rawData: string | null): Record<string, StatusGroup> {
  if (!rawData) return {};
  try {
    const d = JSON.parse(rawData) as { statusGroups?: Record<string, StatusGroup> };
    return d.statusGroups ?? {};
  } catch { return {}; }
}

/**
 * Resolves the display color for a status by looking up its group assignment.
 * Falls back to a neutral gray when the status has no group mapping.
 *
 * @param name - The status name to look up
 * @param groups - Map of status names to their group assignments
 * @returns The hex color string associated with the status's group
 */
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
  /** Whether the board is a kanban board (optional) */
  isKanban?: boolean;
  /** Callback when stale badge is clicked */
  onStaleClick?: () => void;
  /** Array of users assigned to issues in this sprint */
  users?: { id: string; name: string; role: string }[];
  /** Callback when a user avatar is clicked (optional) */
  onUserClick?: (userId: string, userName: string) => void;
  /** Callback when the card is clicked (optional) */
  onSprintClick?: () => void;
  /** Callback when hide is triggered (optional) */
  onHide?: () => void;
}

/**
 * SprintCard displays a sprint's progress with status breakdown visualization.
 *
 * Renders a card containing the sprint name, date range, total ticket count,
 * a segmented progress bar, and detailed per-status rows with counts and percentages.
 *
 * Features:
 * - Shows a "Done" badge when all tickets in the sprint are completed.
 * - Displays a stale ticket warning when `staleCount` is greater than zero.
 * - Renders user avatars for team members assigned to issues in this sprint.
 * - Supports click-to-filter on individual status rows, the card itself, and the stale badge.
 *
 * @example
 * ```tsx
 * <SprintCard
 *   sprint={sprintData}
 *   staleCount={3}
 *   onStatusClick={(status) => filterByStatus(status)}
 *   onStaleClick={() => showStaleTickets()}
 *   users={assignedUsers}
 *   onUserClick={(id, name) => openUserProfile(id)}
 *   onSprintClick={() => navigateToSprint()}
 * />
 * ```
 */
export function SprintCard({ sprint, hideProjectName, staleCount, onStatusClick, onStaleClick, users, onUserClick, onSprintClick, onHide }: SprintCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Parse raw JSON fields from the API into usable structures
  const breakdown    = parseBreakdown(sprint.statusBreakdown);
  const statusGroups = parseStatusGroups(sprint.rawData);
  const rawEntries   = Object.entries(breakdown);
  // Sort entries by their group bucket (todo → doing → done)
  const entries      = sortStatusEntries(rawEntries, statusGroups);
  // Total is the explicit value from the API, or the sum of all breakdown counts
  const total        = sprint.totalTickets || rawEntries.reduce((s, [, n]) => s + n, 0);
  // A sprint is "all done" when every status in the breakdown belongs to the 'done' group
  const allDone      = total > 0 && rawEntries.every(([status]) => statusGroups[status] === 'done');

  // Color the sprint status pill based on its current state
  const sprintStatusColor =
    sprint.status === 'active'    ? '#22c55e' :
    sprint.status === 'planned'   ? '#f59e0b' :
    sprint.status === 'completed' ? '#64748b' : '#94a3b8';

  // Format dates for display using Indian locale (DD MMM); null if date is missing or sentinel
  const startFmt = sprint.startDate && sprint.startDate !== '-1'
    ? new Date(sprint.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;
  const endFmt = sprint.endDate && sprint.endDate !== '-1'
    ? new Date(sprint.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;

  return (
    <div
      style={{ ...s.card, ...(allDone ? { borderColor: '#22c55e55' } : {}), ...(onSprintClick ? { cursor: 'pointer' } : {}) }}
      onClick={onSprintClick}
    >
      {!hideProjectName && <p style={s.projectName}>{sprint.projectName}</p>}

      <div style={s.sprintHeader}>
        <h3 style={s.sprintName}>{sprint.name}</h3>
        <div style={s.headerRight}>
          {allDone && (
            <span style={s.doneBadge} title="All tickets done">Done</span>
          )}
          {!allDone && (staleCount ?? 0) > 0 && (
            <span
              style={{ ...s.staleBadge, cursor: onStaleClick ? 'pointer' : 'default' }}
              onClick={onStaleClick}
              title={`${staleCount} stale ticket${staleCount !== 1 ? 's' : ''} in this sprint`}
            >
              {staleCount} stale
            </span>
          )}
          <span style={{ ...s.statusPill, color: sprintStatusColor, borderColor: `${sprintStatusColor}44`, backgroundColor: `${sprintStatusColor}11` }}>
            {sprint.status}
          </span>
          {onHide && (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                style={s.menuBtn}
                onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
                title="More options"
              >
                ⋮
              </button>
              {menuOpen && (
                <div style={s.dropdown}>
                  <button
                    style={s.dropdownItem}
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onHide(); }}
                  >
                    Hide sprint
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {(startFmt || endFmt) && (
        <p style={s.dates}>{startFmt ?? '?'} - {endFmt ?? '?'}</p>
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
 * StatusRow renders a single row within the status breakdown section.
 *
 * Displays a colored dot, the status name, the ticket count, and the
 * percentage of total tickets that fall into this status. Rows with
 * zero tickets are dimmed to indicate an absence of data.
 *
 * Supports hover highlighting and click-to-navigate when `onClick` is provided.
 *
 * @param status - The status label to display (e.g., `'todo'`, `'doing'`, `'done'`)
 * @param count - Number of issues in this status
 * @param total - Total issues across all statuses (used to compute percentage)
 * @param color - The dot color corresponding to this status's group
 * @param onClick - Optional callback invoked when the row is clicked
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
 * Inline styles for SprintCard — a themed style object for the dark-mode card UI.
 *
 * Each property is a `React.CSSProperties` object that can be spread into
 * an element's `style` attribute. The naming follows the component's visual
 * hierarchy (card → header → badges → progress bar → breakdown rows).
 */
const s: Record<string, React.CSSProperties> = {
  /** Main card container: dark slate background with rounded corners and vertical stacking */
  card: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  /** Project name label: small uppercase text rendered above the sprint header */
  projectName: { margin: 0, fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' },
  /** Sprint header: horizontally splits the sprint name from the badge cluster */
  sprintHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  /** Right-aligned badge cluster: wraps when space is tight, keeps items flush to the end */
  headerRight:  { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' as const, justifyContent: 'flex-end' },
  /** Sprint name: takes remaining horizontal space within the header */
  sprintName: { margin: 0, fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 },
  /** Stale warning badge: amber-colored badge indicating tickets needing attention */
  staleBadge: {
    fontSize: 11, fontWeight: 700, padding: '3px 8px',
    borderRadius: 20, border: '1px solid #f59e0b66',
    backgroundColor: '#f59e0b11', color: '#f59e0b',
  },
  /** Done completion badge: green badge shown when every ticket in the sprint is completed */
  doneBadge: {
    fontSize: 11, fontWeight: 700, padding: '3px 8px',
    borderRadius: 20, border: '1px solid #22c55e55',
    backgroundColor: '#22c55e11', color: '#22c55e',
  },
  /** Sprint status pill: small badge for active / planned / completed state with dynamic color */
  statusPill: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '0.06em', padding: '3px 8px',
    borderRadius: 20, border: '1px solid', flexShrink: 0,
  },
  /** More options (⋮) button: transparent background, minimal padding */
  menuBtn: {
    backgroundColor: 'transparent', border: 'none',
    color: '#64748b', fontSize: 14, cursor: 'pointer',
    padding: '2px 4px', borderRadius: 4, lineHeight: 1,
  },
  /** Dropdown menu: absolutely positioned below the menu button with a shadow */
  dropdown: {
    position: 'absolute', top: '100%', right: 0,
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 8, padding: '4px 0', minWidth: 140,
    zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  /** Dropdown menu item: full-width clickable button */
  dropdownItem: {
    width: '100%', padding: '8px 16px', backgroundColor: 'transparent',
    border: 'none', color: '#e2e8f0', fontSize: 13, cursor: 'pointer',
    textAlign: 'left' as const,
  },
  /** Sprint date range: rendered between the header and the user avatars */
  dates: { margin: 0, fontSize: 12, color: '#64748b' },
  /** User avatars container: wraps rows of avatars when there are many users */
  users: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  /** Container for the total ticket count text */
  totalLine: { margin: 0 },
  /** Large, bold number showing the total ticket count */
  totalCount: { fontSize: 26, fontWeight: 700, color: '#e2e8f0', lineHeight: 1 },
  /** Label text ("tickets") next to the total count */
  totalLabel: { fontSize: 13, color: '#94a3b8' },
  /** Progress bar track: dark background with rounded corners and a 1px gap between segments */
  barTrack: {
    display: 'flex', height: 6, borderRadius: 3,
    overflow: 'hidden', backgroundColor: '#0f172a', gap: 1,
  },
  /** Individual progress bar segment: each status gets a proportional-width bar */
  barSegment: { height: '100%', minWidth: 2, transition: 'width 0.3s ease' },
  /** Status breakdown rows: vertical stack of per-status detail rows */
  breakdown: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 },
  /** Single status row: horizontal flex layout aligning dot, label, count, and percentage */
  breakdownRow: { display: 'flex', alignItems: 'center', gap: 7 },
  /** Status indicator dot: small circle whose color reflects the status group */
  dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  /** Status label text: left-aligned, medium-gray */
  statusLabel: { fontSize: 12, color: '#94a3b8', flex: 1 },
  /** Issue count: right-aligned, bold white text; dimmed when count is zero */
  statusCount: { fontSize: 13, fontWeight: 600, color: '#e2e8f0', minWidth: 24, textAlign: 'right' as const },
  /** Percentage: right-aligned, secondary-gray; shows "—" when total is zero */
  statusPct:   { fontSize: 11, color: '#64748b', minWidth: 32, textAlign: 'right' as const },
  /** Empty-state text: muted gray message shown when no tickets are found */
  muted: { color: '#64748b', fontSize: 14, margin: 0 },
};
