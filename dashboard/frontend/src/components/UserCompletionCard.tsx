import { useEffect, useState } from 'react';
import { fetchUserStats, type UserLoadStat } from '../api/client';
import { roleColor } from './UserAvatar';
import { BarGraph } from './BarGraph';
import { C, R, font } from '../theme';

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

  const barColor = pct >= 80 ? C.success : pct >= 50 ? C.primary : pct >= 25 ? '#f59e0b' : '#ef4444';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 28px 1fr 80px 44px',
        alignItems: 'center',
        gap: 10,
        padding: '6px 8px',
        borderRadius: R.sm,
        cursor: 'pointer',
        backgroundColor: hovered ? C.surface2 : 'transparent',
        borderBottom: `1px solid ${C.hairline}`,
        margin: '0 -8px',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: 12, color: C.inkTertiary, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums', fontFamily: font.text }}>
        {rank}
      </span>

      <div
        style={{
          width: 26, height: 26, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 600, color: '#fff',
          backgroundColor: roleColor(user.role), flexShrink: 0,
        }}
        title={user.role}
      >
        {initials(user.name)}
      </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
          <span style={{
            fontSize: 14, color: C.inkMuted, fontWeight: 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: font.text,
          }}>
            {user.name}
          </span>
          <BarGraph
            segments={[{ value: pct, color: barColor }]}
            height={6}
            trackColor={C.hairline}
            borderRadius={2}
            gap={0}
          />
        </div>

      <span style={{ fontSize: 12, color: C.inkTertiary, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums', fontFamily: font.text }}>
        {user.done} / {total}
      </span>

      <span style={{
        fontSize: 14, fontWeight: 500, textAlign: 'right' as const,
        color: barColor, fontVariantNumeric: 'tabular-nums',
        fontFamily: font.text,
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

  const sorted = [...users]
    .filter((u) => u.name !== 'Unknown' && u.todo + u.doing + u.done > 0)
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
            fontSize: 28, fontWeight: 600,
            color: avgPct >= 60 ? C.success : avgPct >= 30 ? '#f59e0b' : '#ef4444',
            fontVariantNumeric: 'tabular-nums',
            fontFamily: font.display,
            letterSpacing: '-0.6px',
          }}>
            {avgPct}%
          </span>
        )}
      </div>

      {!loading && sorted.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '20px 28px 1fr 80px 44px',
          gap: 10, padding: '0 8px',
          fontSize: 12, color: C.inkTertiary, fontWeight: 500, textTransform: 'uppercase' as const,
          letterSpacing: '0.4px',
          fontFamily: font.text,
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
    backgroundColor: C.surface1, border: `1px solid ${C.hairline}`,
    borderRadius: R.lg, padding: '24px',
    display: 'flex', flexDirection: 'column', gap: 10,
    gridColumn: 'span 2',
  },
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  label: {
    margin: 0, fontSize: 13, fontWeight: 500,
    color: C.inkTertiary, textTransform: 'uppercase', letterSpacing: '0.4px',
    fontFamily: font.text,
  },
  sub: { margin: '2px 0 0', fontSize: 12, color: C.inkTertiary, fontFamily: font.text },
  list: { display: 'flex', flexDirection: 'column' },
  muted: { margin: 0, color: C.inkTertiary, fontSize: 14, fontFamily: font.text },
};
