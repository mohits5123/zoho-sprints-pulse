import { useEffect, useState } from 'react';
import { fetchUserStats, type UserLoadStat } from '../api/client';
import { roleColor } from './UserAvatar';

/**
 * Extract first two characters of a name as initials for avatar display.
 * Splits the name on spaces, takes the first character of each word,
 * joins them, and returns the first two characters uppercased.
 *
 * @param name User's full name (e.g. "Jane Doe")
 * @returns Uppercase initials (e.g. "JD")
 */
function initials(name: string) {
  return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

/**
 * CompletionRow renders a single row in the completion leaderboard.
 * Displays the user's rank, avatar with role color, name, a color-coded
 * progress bar, completed/total ticket count, and completion percentage.
 *
 * @param user - User load statistics (todo, doing, done counts, name, role, id)
 * @param rank - User's position in the sorted leaderboard (1-based)
 * @param onClick - Callback fired when the row is clicked
 */
function CompletionRow({ user, rank, onClick }: {
  /** User load statistics (todo, doing, done counts, name, role, id) */
  user:    UserLoadStat;
  /** User's position in the sorted leaderboard (1-based) */
  rank:    number;
  /** Callback fired when the row is clicked, navigates to user profile */
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const total = user.todo + user.doing + user.done;

  // Skip rendering users with zero tickets across all statuses
  if (total === 0) return null;

  // Completion percentage rounded to nearest integer
  const pct = Math.round((user.done / total) * 100);

  // Bar color encodes completion level:
  //   green   (>=80%) — good
  //   blue    (>=50%)  — in progress, on track
  //   orange  (>=25%)  — warning, behind
  //   red     (<25%)   — poor, needs attention
  const barColor = pct >= 80 ? '#22c55e' : pct >= 50 ? '#3b82f6' : pct >= 25 ? '#f59e0b' : '#ef4444';

  return (
    /* User completion row with rank, avatar, name, progress bar, and stats */
    <div
      style={{
        // 5-column grid: rank | avatar | name+bar | count | pct
        display: 'grid',
        gridTemplateColumns: '20px 28px 1fr 80px 44px',
        alignItems: 'center',
        gap: 10,
        padding: '6px 8px',
        borderRadius: 6,
        cursor: 'pointer',
        // Hover highlight for interactive rows
        backgroundColor: hovered ? '#263148' : 'transparent',
        borderBottom: '1px solid #1e293b',
        // Negative margins so hover bg extends full card width
        margin: '0 -8px',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* User rank in completion leaderboard */}
      <span style={{ fontSize: 11, color: '#475569', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' }}>
        {rank}
      </span>

      {/* Avatar circle showing user initials, colored by role */}
      <div
        style={{
          width: 26, height: 26, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700, color: '#fff',
          // Background tint derived from user's role (via roleColor helper)
          backgroundColor: roleColor(user.role), flexShrink: 0,
        }}
        title={user.role}
      >
        {initials(user.name)}
      </div>

      {/* Name + progress bar showing completion status */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
        <span style={{
          fontSize: 12, color: '#e2e8f0', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {user.name}
        </span>
        <div style={{ height: 4, borderRadius: 2, backgroundColor: '#334155', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            backgroundColor: barColor,
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {/* Completed / total ticket count (e.g. "12 / 20") */}
      <span style={{ fontSize: 11, color: '#64748b', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' }}>
        {user.done} / {total}
      </span>

      {/* Completion percentage, color-coded to match barColor */}
      <span style={{
        fontSize: 13, fontWeight: 700, textAlign: 'right' as const,
        color: barColor, fontVariantNumeric: 'tabular-nums',
      }}>
        {pct}%
      </span>
    </div>
  );
}

/**
 * UserCompletionCard displays completion rate leaderboard for team members.
 * Shows users ranked by their completion percentage (done tickets / total tickets).
 * Includes progress bars with color-coded status and average team completion.
 * 
 * @param projectId - The project ID to filter issues
 * @param sprintId - The sprint ID to filter issues
 * @param staleDays - Number of days to consider tickets as stale (default: 7)
 * @param onUserClick - Callback when a user row is clicked
 */
export function UserCompletionCard({ projectId, sprintId, staleDays = 7, onUserClick }: {
  projectId:   string;
  sprintId:    string;
  staleDays?:  number;
  onUserClick: (userId: string, userName: string) => void;
}) {
  // Reactive state: refetches whenever projectId, sprintId, or staleDays change
  const [users, setUsers]     = useState<UserLoadStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchUserStats(projectId, sprintId, staleDays)
      .then(({ users }) => setUsers(users))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId, sprintId, staleDays]);

  // Sort: highest completion % first, then by total ticket count (descending) as tiebreaker.
  // Filters out "Unknown" assignees and users with zero tickets.
  const sorted = [...users]
    .filter((u) => u.name !== 'Unknown' && u.todo + u.doing + u.done > 0)
    .sort((a, b) => {
      const ta = a.todo + a.doing + a.done;
      const tb = b.todo + b.doing + b.done;
      const pa = ta > 0 ? a.done / ta : 0;
      const pb = tb > 0 ? b.done / tb : 0;
      return pb - pa || tb - ta;
    });

  // Average completion percentage across all displayed users (rounded).
  // Excludes users with zero tickets from the average to avoid skewing.
  const avgPct = sorted.length > 0
    ? Math.round(sorted.reduce((s, u) => {
        const t = u.todo + u.doing + u.done;
        return s + (t > 0 ? u.done / t : 0);
      }, 0) / sorted.length * 100)
    : 0;

  return (
    <div style={s.card}>
      {/* Header with title, team stats, and overall completion percentage */}
      <div style={s.headerRow}>
        {/* Section title with contributor count and team average */}
        <div>
          <p style={s.label}>Completion Rate</p>
          {!loading && sorted.length > 0 && (
            <p style={s.sub}>{sorted.length} contributors · team avg {avgPct}%</p>
          )}
        </div>
        {/* Large team average percentage, color-coded: green (>=60%), orange (>=30%), red (<30%) */}
        {!loading && sorted.length > 0 && (
          <span style={{
            fontSize: 22, fontWeight: 800,
            color: avgPct >= 60 ? '#22c55e' : avgPct >= 30 ? '#f59e0b' : '#ef4444',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {avgPct}%
          </span>
        )}
      </div>

      {/* Fixed column headers matching the 5-column grid layout: Rank | (empty) | Name | Count | Rate */}
      {!loading && sorted.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '20px 28px 1fr 80px 44px',
          gap: 10, padding: '0 8px',
          fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase' as const,
          letterSpacing: '0.05em',
        }}>
          <span style={{ textAlign: 'right' as const }}>#</span>
          <span />
          <span>Name</span>
          <span style={{ textAlign: 'right' as const }}>Done / Total</span>
          <span style={{ textAlign: 'right' as const }}>Rate</span>
        </div>
      )}

      {/*
     * Leaderboard content: loading indicator, error message, empty state,
     * or mapped CompletionRow components for each user.
     */}
      <div style={s.list}>
        {loading && <p style={s.muted}>Loading…</p>}
        {error   && <p style={s.muted}>Failed to load: {error}</p>}
        {!loading && sorted.length === 0 && !error && (
          <p style={s.muted}>No assignee data for this sprint.</p>
        )}
        {!loading && sorted.map((u, i) => (
          <CompletionRow
            key={u.id}
            user={u}
            rank={i + 1}
            onClick={() => onUserClick(u.id, u.name)}
          />
        ))}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  /**
   * Main card container: dark background, rounded corners, 2-column grid span.
   * Flex column layout with internal gap spacing.
   */
  card: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 10,
    gridColumn: 'span 2',
  },
  /** Header row: label on the left, large average percentage on the right */
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  /** Uppercase section label with subtle letter-spacing */
  label: {
    margin: 0, fontSize: 11, fontWeight: 600,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  /** Sub-label text (e.g. contributor count and team average) */
  sub: { margin: '2px 0 0', fontSize: 11, color: '#475569' },
  /** Vertical list container for column headers and rows */
  list: { display: 'flex', flexDirection: 'column' },
  /** Muted text for loading, error, and empty-state messages */
  muted: { margin: 0, color: '#475569', fontSize: 13 },
};
