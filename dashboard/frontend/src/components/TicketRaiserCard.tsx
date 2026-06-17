import { useEffect, useState } from 'react';
import { fetchRaiserStats, fetchKanbanRaiserStats, type RaiserStat } from '../api/client';
import { roleColor } from './UserAvatar';

/** Generate initials from name */
function initials(name: string) {
  return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

/**
 * Status indicator dot with count and label
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
  /** Raiser statistics object */
  raiser: RaiserStat;
  /** Current rank of the raiser */
  rank: number;
  /** Callback when row is clicked */
  onClick: () => void;
}

/** Individual row showing a ticket raiser with stacked progress bar */
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
  /** Project ID */
  projectId: string;
  /** Sprint ID (ignored for kanban boards) */
  sprintId: string;
  /** Board type to determine which API to call */
  boardType: 'scrum' | 'kanban';
  /** Callback when a user is clicked */
  onUserClick: (userId: string, userName: string) => void;
}

/** TicketRaiserCard displays contributor statistics showing who raised the most tickets */
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
      .then(setRaisers)
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

const s: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 10,
    gridColumn: 'span 2',
  },
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  label: {
    margin: 0, fontSize: 11, fontWeight: 600,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  sub:   { margin: '2px 0 0', fontSize: 11, color: '#475569' },
  badge: {
    fontSize: 11, fontWeight: 700, padding: '3px 8px',
    borderRadius: 20, border: '1px solid #22c55e44',
    color: '#22c55e', backgroundColor: '#22c55e11', flexShrink: 0,
  },
  list: { display: 'flex', flexDirection: 'column' },
  muted: { margin: 0, color: '#475569', fontSize: 13 },
};
