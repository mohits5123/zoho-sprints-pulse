import { useEffect, useState } from 'react';
import { fetchUserStats, type UserLoadStat } from '../api/client';
import { roleColor } from './UserAvatar';

function initials(name: string) {
  return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function CompletionRow({ user, rank, onClick }: {
  user:    UserLoadStat;
  rank:    number;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const total = user.todo + user.doing + user.done;
  if (total === 0) return null;

  const pct = Math.round((user.done / total) * 100);

  // Colour the bar by completion level
  const barColor = pct >= 80 ? '#22c55e' : pct >= 50 ? '#3b82f6' : pct >= 25 ? '#f59e0b' : '#ef4444';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 28px 1fr 80px 44px',
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
          backgroundColor: roleColor(user.role), flexShrink: 0,
        }}
        title={user.role}
      >
        {initials(user.name)}
      </div>

      {/* Name + progress bar */}
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

      {/* done / total */}
      <span style={{ fontSize: 11, color: '#64748b', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' }}>
        {user.done} / {total}
      </span>

      {/* Percentage */}
      <span style={{
        fontSize: 13, fontWeight: 700, textAlign: 'right' as const,
        color: barColor, fontVariantNumeric: 'tabular-nums',
      }}>
        {pct}%
      </span>
    </div>
  );
}

export function UserCompletionCard({ projectId, sprintId, staleDays = 7, onUserClick }: {
  projectId:   string;
  sprintId:    string;
  staleDays?:  number;
  onUserClick: (userId: string, userName: string) => void;
}) {
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

  // Sort by completion % desc, then by total desc as tiebreaker
  const sorted = [...users]
    .filter((u) => u.todo + u.doing + u.done > 0)
    .sort((a, b) => {
      const ta = a.todo + a.doing + a.done;
      const tb = b.todo + b.doing + b.done;
      const pa = ta > 0 ? a.done / ta : 0;
      const pb = tb > 0 ? b.done / tb : 0;
      return pb - pa || tb - ta;
    });

  const avgPct = sorted.length > 0
    ? Math.round(sorted.reduce((s, u) => {
        const t = u.todo + u.doing + u.done;
        return s + (t > 0 ? u.done / t : 0);
      }, 0) / sorted.length * 100)
    : 0;

  return (
    <div style={s.card}>
      <div style={s.headerRow}>
        <div>
          <p style={s.label}>Completion Rate</p>
          {!loading && sorted.length > 0 && (
            <p style={s.sub}>{sorted.length} contributors · team avg {avgPct}%</p>
          )}
        </div>
        {!loading && sorted.length > 0 && (
          <span style={{
            fontSize: 22, fontWeight: 800, color: avgPct >= 60 ? '#22c55e' : avgPct >= 30 ? '#f59e0b' : '#ef4444',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {avgPct}%
          </span>
        )}
      </div>

      {/* Column headers */}
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
  sub: { margin: '2px 0 0', fontSize: 11, color: '#475569' },
  list: { display: 'flex', flexDirection: 'column' },
  muted: { margin: 0, color: '#475569', fontSize: 13 },
};
