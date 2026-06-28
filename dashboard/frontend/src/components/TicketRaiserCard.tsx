import { useEffect, useState } from 'react';
import { fetchRaiserStats, fetchKanbanRaiserStats, type RaiserStat } from '../api/client';
import { roleColor } from './UserAvatar';

/**
 * Extract up to two initials from a full name for use in avatar placeholders.
 *
 * Splits the name on spaces, takes the first character of each word,
 * joins them together, slices to 2 characters, and uppercases the result.
 *
 * @param name Full name string (e.g. "John Doe")
 * @returns Uppercase initials string (e.g. "JD")
 */
function initials(name: string) {
  return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

/**
 * Renders a small colored dot alongside a status count, with a tooltip
 * showing the count and its descriptive label on hover.
 *
 * This component is used within the status counts section of each raiser row
 * to visually communicate how many tickets are in each state (Todo, In Progress, Done).
 *
 * @param color Hex color string for the dot indicator
 * @param count Number of items in this status
 * @param label Status label shown in tooltip
 */
function StatusDot({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <span title={`${count} ${label}`} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        backgroundColor: color, flexShrink: 0,
      }} />
      <span style={{ fontSize: 11, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
        {count}
      </span>
    </span>
  );
}

interface RaiserRowProps {
  /** Raiser statistics object containing per-user ticket counts */
  raiser: RaiserStat;
  /** Current rank of the raiser (1-indexed, based on total ticket volume) */
  rank: number;
  /** Callback when row is clicked; typically opens a user detail view */
  onClick: () => void;
}

/**
 * Renders a single row for a ticket raiser (contributor) in the leaderboard.
 *
 * Displays the raiser's rank, avatar (derived from initials and role color),
 * name, and a stacked progress bar showing the proportion of tickets in each
 * status (Todo → Doing → Done). On the right side, individual status counts
 * are shown via StatusDot components along with the total.
 *
 * The row is interactive: hovering highlights the background, and clicking
 * triggers the `onClick` callback.
 *
 * @param raiser Raiser statistics object containing per-user ticket counts
 * @param rank Current rank of the raiser (1-indexed, based on total ticket volume)
 * @param onClick Callback when row is clicked; typically opens a user detail view
 */
function RaiserRow({ raiser, rank, onClick }: RaiserRowProps) {
  const [hovered, setHovered] = useState(false);
  const total = raiser.todo + raiser.doing + raiser.done;
  const doneRatio = total > 0 ? raiser.done / total : 0;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '18px 28px 1fr auto',
        alignItems: 'center',
        gap: 10,
        padding: '6px 8px',
        borderRadius: 6,
        cursor: 'pointer',
        backgroundColor: hovered ? '#263148' : 'transparent',
        borderBottom: '1px solid #1e293b',
        margin: '0 -8px',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Rank */}
      <span style={{ fontSize: 11, color: '#475569', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' }}>
        {rank}
      </span>

      {/* Avatar */}
      <div
        style={{
          width: 26, height: 26, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700, color: '#fff',
          backgroundColor: roleColor(raiser.role), flexShrink: 0,
        }}
        title={raiser.role}
      >
        {initials(raiser.name)}
      </div>

      {/* Name + progress bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
        <span style={{
          fontSize: 12, color: '#e2e8f0', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {raiser.name}
        </span>
        {/* stacked status bar */}
        <div style={{ height: 4, borderRadius: 2, backgroundColor: '#0f172a', overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${(raiser.todo  / total) * 100}%`, backgroundColor: '#64748b', transition: 'width 0.4s' }} />
          <div style={{ width: `${(raiser.doing / total) * 100}%`, backgroundColor: '#3b82f6', transition: 'width 0.4s' }} />
          <div style={{ width: `${doneRatio * 100}%`, backgroundColor: '#22c55e', transition: 'width 0.4s' }} />
        </div>
      </div>

      {/* Status counts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusDot color="#64748b" count={raiser.todo}  label="todo"  />
        <StatusDot color="#3b82f6" count={raiser.doing} label="in progress" />
        <StatusDot color="#22c55e" count={raiser.done}  label="done"  />
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#e2e8f0',
          marginLeft: 4, minWidth: 18, textAlign: 'right' as const,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {total}
        </span>
      </div>
    </div>
  );
}

interface TicketRaiserCardProps {
  /** Project ID used to fetch raiser statistics from the API */
  projectId: string;
  /** Sprint ID passed to the API for scrum boards; ignored for kanban boards */
  sprintId: string;
  /** Board type that determines which API endpoint is called */
  boardType: 'scrum' | 'kanban';
  /** Callback when a user row is clicked; receives the user's ID and name */
  onUserClick: (userId: string, userName: string) => void;
}

/**
 * TicketRaiserCard displays a leaderboard of contributors ranked by the number
 * of tickets they have raised within a project or sprint.
 *
 * On mount (and whenever projectId, sprintId, or boardType changes), the card
 * fetches raiser statistics from the appropriate API endpoint — `fetchKanbanRaiserStats`
 * for kanban boards, or `fetchRaiserStats` for scrum boards. Results are filtered
 * to exclude entries with the name "Unknown".
 *
 * The card shows:
 * - A summary header with total contributors, total tickets, and overall completion percentage
 * - Column headers for rank, raiser name, and status counts (Todo, In Progress, Done)
 * - A scrollable list of ranked raiser rows, each with a stacked progress bar
 *
 * @param projectId Project ID used to fetch raiser statistics from the API
 * @param sprintId Sprint ID passed to the API for scrum boards; ignored for kanban boards
 * @param boardType Board type that determines which API endpoint is called
 * @param onUserClick Callback when a user row is clicked; receives the user's ID and name
 */
export function TicketRaiserCard({ projectId, sprintId, boardType, onUserClick }: TicketRaiserCardProps) {
  const [raisers, setRaisers] = useState<RaiserStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const promise = boardType === 'kanban'
      ? fetchKanbanRaiserStats(projectId)
      : fetchRaiserStats(projectId, sprintId);
    promise
      .then((data) => setRaisers(data.filter((r) => r.name !== 'Unknown')))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId, sprintId, boardType]);

  const totalRaised = raisers.reduce((s, r) => s + r.todo + r.doing + r.done, 0);
  const totalDone   = raisers.reduce((s, r) => s + r.done, 0);
  const overallPct  = totalRaised > 0 ? Math.round((totalDone / totalRaised) * 100) : 0;

  return (
    <div style={s.card}>
      <div style={s.headerRow}>
        <div>
          <p style={s.label}>Tickets Raised</p>
          {!loading && raisers.length > 0 && (
            <p style={s.sub}>{raisers.length} contributor{raisers.length !== 1 ? 's' : ''} · {totalRaised} tickets</p>
          )}
        </div>
        {!loading && totalRaised > 0 && (
          <span style={s.badge}>{overallPct}% done</span>
        )}
      </div>

      {/* Column headers */}
      {!loading && raisers.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '18px 28px 1fr auto',
          gap: 10, padding: '0 8px',
          fontSize: 10, color: '#475569', fontWeight: 600,
          textTransform: 'uppercase' as const, letterSpacing: '0.05em',
        }}>
          <span style={{ textAlign: 'right' as const }}>#</span>
          <span />
          <span>Raiser</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 18, textAlign: 'center' as const }}>◻</span>
            <span style={{ width: 18, textAlign: 'center' as const }}>▶</span>
            <span style={{ width: 18, textAlign: 'center' as const }}>✓</span>
            <span style={{ width: 22, textAlign: 'right' as const }}>Tot</span>
          </div>
        </div>
      )}

      <div style={s.list}>
        {loading && <p style={s.muted}>Loading…</p>}
        {error   && <p style={s.muted}>Failed to load: {error}</p>}
        {!loading && raisers.length === 0 && !error && (
          <p style={s.muted}>No creator data for this sprint.</p>
        )}
        {!loading && raisers.map((r, i) => (
          <RaiserRow
            key={r.id}
            raiser={r}
            rank={i + 1}
            onClick={() => onUserClick(r.id, r.name)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Inline style objects used throughout the card component.
 *
 * All styles use a dark theme color palette (slate tones) consistent with
 * the dashboard's design system. The card spans 2 columns in the grid layout.
 */
const s: Record<string, React.CSSProperties> = {
  /** Card container: dark background, bordered, with vertical gap between sections */
  card: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 10,
    gridColumn: 'span 2',
  },
  /** Header row: label on the left, completion badge on the right */
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  /** Section label (e.g. "TICKETS RAISED") in uppercase with tracking */
  label: {
    margin: 0, fontSize: 11, fontWeight: 600,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  /** Sub-label text showing contributor count and ticket count */
  sub:   { margin: '2px 0 0', fontSize: 11, color: '#475569' },
  /** Green badge showing overall completion percentage */
  badge: {
    fontSize: 11, fontWeight: 700, padding: '3px 8px',
    borderRadius: 20, border: '1px solid #22c55e44',
    color: '#22c55e', backgroundColor: '#22c55e11', flexShrink: 0,
  },
  /** Scrollable list container for raiser rows */
  list: { display: 'flex', flexDirection: 'column' },
  /** Muted text for loading states, errors, and empty states */
  muted: { margin: 0, color: '#475569', fontSize: 13 },
};
