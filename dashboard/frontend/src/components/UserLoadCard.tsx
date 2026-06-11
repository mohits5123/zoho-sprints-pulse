import { useEffect, useState } from 'react';
import { fetchUserStats, fetchKanbanUserStats, type UserLoadStat } from '../api/client';
import { roleColor } from './UserAvatar';

/**
 * Color mapping for status groups.
 * Used to color-code tasks by their current state.
 */
const GROUP_COLORS = {
  todo:  '#475569',
  doing: '#3b82f6',
  done:  '#22c55e',
} as const;

/**
 * Display labels for status groups.
 * Used in legend to show task states.
 */
const GROUP_LABELS = { todo: 'Todo', doing: 'In Progress', done: 'Done' } as const;

/**
 * Extract first two characters of a name as initials.
 * Used for avatar display.
 * @param name User's full name
 * @returns Uppercase string of first two characters
 */
function initials(name: string) {
  return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

/**
 * Props for the Bar component rendering individual user load rows.
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

  // Calculate bar widths based on active tickets vs max across all users
  const barW  = maxActive > 0 ? Math.max((active / maxActive) * 100, active > 0 ? 4 : 0) : 0;
  const doneW = total > 0 ? (user.done / total) * 100 : 0;

  // Split active bar into todo and doing segments
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
 * UserLoadCard displays workload distribution across team members.
 * Shows stacked bars for each user indicating their todo, in-progress, and done tickets.
 * Highlights overloaded users (>5 active tickets) and provides clickable rows.
 * 
 * @param projectId - The project ID to filter issues
 * @param sprintId - The sprint ID to filter issues
 * @param staleDays - Number of days to consider tickets as stale (default: 7)
 * @param onUserClick - Callback when a user row is clicked
 */
export function UserLoadCard({ projectId, sprintId, staleDays = 7, onUserClick, isKanban }: {
  projectId:   string;
  sprintId:    string;
  staleDays?:  number;
  onUserClick: (userId: string, userName: string) => void;
  isKanban: boolean;
}) {
  // State for fetching and displaying user load statistics
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

  // Calculate metrics from user data
  const maxActive = users.reduce((m, u) => Math.max(m, u.todo + u.doing), 0);
  const totalIssues = users.reduce((s, u) => s + u.todo + u.doing + u.done, 0);
  // Count users with more than 5 active tickets (overloaded threshold)
  const overloaded  = users.filter((u) => u.todo + u.doing > 5).length;
  // Filter out users with 0 issues (todo + doing + done for scrum, todo + doing for kanban)
  const usersWithIssues = isKanban
    ? users.filter((u) => u.todo + u.doing > 0)
    : users.filter((u) => u.todo + u.doing + u.done > 0);

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
          <span style={s.warnPill}>⚠ {overloaded} overloaded</span>
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

// ── Row styles for individual user load entries ──────────────────────────────
const b: Record<string, React.CSSProperties> = {
  row: {
    /** Grid layout for user row */
    display: 'grid',
    gridTemplateColumns: '28px 120px 1fr 64px',
    alignItems: 'center',
    gap: 10,
    borderBottom: '1px solid #1e293b',
  },
  avatar: {
    /** Circular avatar with role color */
    width: 26, height: 26, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  nameCol: { display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' },
  name: {
    /** User name with truncation */
    fontSize: 12, color: '#e2e8f0', fontWeight: 500,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  roleChip: {
    /** Role badge with role color */
    fontSize: 9, fontWeight: 700, padding: '1px 5px',
    borderRadius: 10, border: '1px solid', flexShrink: 0,
  },
  barTrack: { height: 12, display: 'flex', alignItems: 'center' },
  barInner: { display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', width: '100%', gap: 1 },
  seg: { height: '100%', minWidth: 2, borderRadius: 2, transition: 'width 0.3s ease' },
  counts: {
    /** Ticket counts for each status group */
    display: 'flex', gap: 4, justifyContent: 'flex-end',
    fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
    color: '#64748b',
  },
};

// ── Card styles for the main container ───────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  card: {
    /** Main card styling with dark theme */
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 10,
    gridColumn: 'span 2',
  },
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  label: {
    /** Section label styling */
    margin: 0, fontSize: 11, fontWeight: 600,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  sub: { margin: '2px 0 0', fontSize: 11, color: '#475569' },
  warnPill: {
    /** Warning indicator for overloaded users */
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
