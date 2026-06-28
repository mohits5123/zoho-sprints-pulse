import { useEffect, useState } from 'react';
import { fetchUserStats, fetchKanbanUserStats, type UserLoadStat } from '../api/client';
import { roleColor } from './UserAvatar';

/**
 * Color palette for kanban status groups.
 * Maps each ticket state to a consistent hex color used throughout the bar chart.
 *
 * - `todo`    — Slate gray for unstarted tasks
 * - `doing`   — Blue for in-progress tasks
 * - `done`    — Green for completed tasks
 */
const GROUP_COLORS = {
  todo:  '#475569',
  doing: '#3b82f6',
  done:  '#22c55e',
} as const;

/**
 * Human-readable labels corresponding to each status group.
 * Rendered in the card's legend beneath the header.
 */
const GROUP_LABELS = { todo: 'Todo', doing: 'In Progress', done: 'Done' } as const;

/**
 * Derives a two-letter avatar initial from a user's full name.
 *
 * Splits the name on whitespace, takes the first character of each word,
 * concatenates them, and returns the first two characters uppercased.
 *
 * @param name  User's full name (e.g. `"Jane Doe"`)
 * @returns     Uppercase initials (e.g. `"JD"`)
 */
function initials(name: string) {
  return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

/**
 * Renders a single row showing one user's ticket load as a stacked bar.
 *
 * Each row displays the user's avatar, name, role badge, a segmented bar
 * (todo → doing → done), and per-status counts. Rows with zero total tickets
 * are omitted entirely. The bar width is proportional to the user's active
 * ticket count relative to the maximum active count across all users.
 *
 * @param user      — Load statistics for a single assignee
 * @param maxActive — Highest active (todo + doing) count among all users; used to normalise bar widths
 * @param onClick   — Fired when the row is clicked (navigates to user profile)
 * @param isKanban  — When `true`, the "done" segment is hidden (kanban boards don't track done columns)
 */
function Bar({ user, maxActive, onClick, isKanban }: {
  /** User load statistics */
  user:      UserLoadStat;
  /** Maximum active tickets across all users (for scaling bars) */
  maxActive: number;
  /** Click handler to navigate to user profile */
  onClick:   () => void;
  /** Whether this is a kanban board (hide done states) */
  isKanban: boolean;
}) {
  const active = user.todo + user.doing;
  const total  = active + user.done;
  const [hovered, setHovered] = useState(false);
  if (total === 0) return null;

  // Scale bar width to the max active count; minimum 4% visible when any active tickets exist.
  const barW  = maxActive > 0 ? Math.max((active / maxActive) * 100, active > 0 ? 4 : 0) : 0;
  // Done segment width as a percentage of total (todo + doing + done).
  const doneW = total > 0 ? (user.done / total) * 100 : 0;

  // Distribute the active portion of the bar proportionally between todo and doing segments.
  const todoFrac  = active > 0 ? (user.todo  / active) * barW : 0;
  const doingFrac = active > 0 ? (user.doing / active) * barW : 0;

  return (
    /* User load row with avatar, stacked bar, and counts */
    <div
      style={{
        ...b.row,
        backgroundColor: hovered ? '#263148' : 'transparent',
        cursor: 'pointer',
        borderRadius: 6,
        margin: '0 -6px',
        padding: '5px 6px',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar showing user initials with role color */}
      <div style={{ ...b.avatar, backgroundColor: roleColor(user.role) }} title={user.role}>
        {initials(user.name)}
      </div>

      {/* Name + role chip */}
      <div style={b.nameCol}>
        <span style={b.name}>{user.name}</span>
        <span style={{ ...b.roleChip, color: roleColor(user.role), borderColor: `${roleColor(user.role)}44` }}>
          {user.role}
        </span>
      </div>

      {/* Stacked bar showing todo, doing, and done tickets */}
      <div style={b.barTrack}>
        <div style={b.barInner}>
          {/* Todo segment (gray) */}
          {user.todo > 0 && (
            <div
              style={{ width: `${todoFrac}%`, backgroundColor: GROUP_COLORS.todo, ...b.seg }}
              title={`${user.todo} todo`}
            />
          )}
          {/* Doing segment (blue) */}
          {user.doing > 0 && (
            <div
              style={{ width: `${doingFrac}%`, backgroundColor: GROUP_COLORS.doing, ...b.seg }}
              title={`${user.doing} in progress`}
            />
          )}
          {/* Done segment (green, fainter) - hidden for kanban */}
          {!isKanban && user.done > 0 && (
            <div
              style={{ width: `${Math.max(doneW * 0.4, 2)}%`, backgroundColor: GROUP_COLORS.done + '66', ...b.seg }}
              title={`${user.done} done`}
            />
          )}
        </div>
      </div>

      {/* Ticket counts for each status (done hidden for kanban) */}
      <div style={b.counts}>
        {user.todo > 0  && <span style={{ color: GROUP_COLORS.todo  }}>{user.todo}</span>}
        {user.doing > 0 && <span style={{ color: GROUP_COLORS.doing }}>{user.doing}</span>}
        {!isKanban && user.done > 0 && <span style={{ color: GROUP_COLORS.done }}>{user.done}</span>}
      </div>
    </div>
  );
}

/**
 * Displays a workload overview for all assignees in a project or sprint.
 *
 * Fetches per-user ticket counts (todo, in-progress, done) and renders a
 * stacked bar chart where each row corresponds to one team member.
 *
 * Key features:
 * - Bars are scaled proportionally to the user with the most active tickets.
 * - A warning pill appears when any user has more than 5 active tickets.
 * - Rows are clickable; clicking opens a detail view for that assignee.
 * - In kanban mode, the "done" column is omitted entirely.
 *
 * @param projectId   — Identifier of the project whose issues to display
 * @param sprintId    — Identifier of the sprint (used when not in kanban mode)
 * @param staleDays   — Tickets older than this many days are treated as stale; defaults to `7`
 * @param onUserClick — Callback invoked with `(userId, userName)` when a row is clicked
 * @param isKanban    — When `true`, fetches kanban stats and hides done segments
 */
export function UserLoadCard({ projectId, sprintId, staleDays = 7, onUserClick, isKanban }: {
  /** Project identifier for filtering issues */
  projectId:   string;
  /** Sprint identifier (used when not in kanban mode) */
  sprintId:    string;
  /** Days threshold for stale tickets; defaults to `7` */
  staleDays?:  number;
  /** Callback fired when a user row is clicked */
  onUserClick: (userId: string, userName: string) => void;
  /** Whether this card is rendering kanban data */
  isKanban: boolean;
}) {
  // Reactive state for user load data fetched from the API.
  const [users, setUsers]   = useState<UserLoadStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    if (isKanban) {
      fetchKanbanUserStats(projectId, staleDays)
        .then(({ users }) => setUsers(users))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      fetchUserStats(projectId, sprintId, staleDays)
        .then(({ users }) => setUsers(users))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [projectId, sprintId, staleDays, isKanban]);

  // Highest active (todo + doing) ticket count across all users — used to normalise bar widths.
  const maxActive = users.reduce((m, u) => Math.max(m, u.todo + u.doing), 0);
  // Total issues across all users for the summary line.
  const totalIssues = users.reduce((s, u) => s + u.todo + u.doing + u.done, 0);
  // Users exceeding the overload threshold of 5 active tickets.
  const overloaded  = users.filter((u) => u.todo + u.doing > 5).length;
  // Exclude "Unknown" assignees and users with zero relevant tickets.
  const usersWithIssues = users
    .filter((u) => u.name !== 'Unknown')
    .filter((u) =>
      isKanban ? u.todo + u.doing > 0 : u.todo + u.doing + u.done > 0,
    );

  return (
    <div style={s.card}>
      {/* Header with title, contributor count, and warning for overloaded users */}
      <div style={s.headerRow}>
        <div>
          <p style={s.label}>User Load</p>
          {!loading && usersWithIssues.length > 0 && (
            <p style={s.sub}>{usersWithIssues.length} contributors · {totalIssues} tickets</p>
          )}
        </div>
        {overloaded > 0 && (
          <span style={s.warnPill}>{overloaded} overloaded</span>
        )}
      </div>

      {/* Legend explaining color coding for status groups */}
      <div style={s.legend}>
        {usersWithIssues.length > 0
          ? (['todo', 'doing', 'done'] as const).map((g) => (
              <span key={g} style={s.legendItem}>
                <span style={{ ...s.dot, backgroundColor: GROUP_COLORS[g] + (g === 'done' ? '66' : '') }} />
                {GROUP_LABELS[g]}
              </span>
            ))
          : <p style={s.muted}>No assignee data for this sprint.</p>}
      </div>

      {/* User load rows or loading/error messages */}
      <div style={s.list}>
        {loading && <p style={s.muted}>Loading user stats…</p>}
        {error   && <p style={s.muted}>Failed to load: {error}</p>}
        {!loading && usersWithIssues.length === 0 && !error && (
          <p style={s.muted}>No assignee data for this sprint.</p>
        )}
        {!loading && usersWithIssues.map((u) => (
          <Bar key={u.id} user={u} maxActive={maxActive} onClick={() => onUserClick(u.id, u.name)} isKanban={isKanban} />
        ))}
      </div>
    </div>
  );
}

// ── Shared inline styles for individual user-load rows ───────────────────────
const b: Record<string, React.CSSProperties> = {
  row: {
    /** Four-column grid: avatar | name+role | bar | counts */
    display: 'grid',
    gridTemplateColumns: '28px 120px 1fr 64px',
    alignItems: 'center',
    gap: 10,
    borderBottom: '1px solid #1e293b',
  },
  avatar: {
    /** Circular badge showing initials; background reflects user role */
    width: 26, height: 26, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  nameCol: { display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' },
  name: {
    /** Truncated user name */
    fontSize: 12, color: '#e2e8f0', fontWeight: 500,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  roleChip: {
    /** Small role badge with a colored border matching the user's role */
    fontSize: 9, fontWeight: 700, padding: '1px 5px',
    borderRadius: 10, border: '1px solid', flexShrink: 0,
  },
  barTrack: { height: 12, display: 'flex', alignItems: 'center' },
  barInner: { display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', width: '100%', gap: 1 },
  seg: { height: '100%', minWidth: 2, borderRadius: 2, transition: 'width 0.3s ease' },
  counts: {
    /** Right-aligned per-status ticket counts */
    display: 'flex', gap: 4, justifyContent: 'flex-end',
    fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
    color: '#64748b',
  },
};

// ── Shared inline styles for the card container and chrome ───────────────────
const s: Record<string, React.CSSProperties> = {
  card: {
    /** Dark-themed card; spans two grid columns in the dashboard layout */
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 10,
    gridColumn: 'span 2',
  },
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  label: {
    /** Uppercase section heading */
    margin: 0, fontSize: 11, fontWeight: 600,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  sub: { margin: '2px 0 0', fontSize: 11, color: '#475569' },
  warnPill: {
    /** Amber warning badge shown when overloaded users are detected */
    fontSize: 11, fontWeight: 700, padding: '3px 8px',
    borderRadius: 20, border: '1px solid #f59e0b44',
    color: '#f59e0b', backgroundColor: '#f59e0b11', flexShrink: 0,
  },
  legend: { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' as const },
  legendItem: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#64748b' },
  dot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
  list: { display: 'flex', flexDirection: 'column' },
  muted: { margin: 0, color: '#475569', fontSize: 13 },
};
