import { useEffect, useState } from 'react';
import { fetchUserStats, fetchKanbanUserStats, type UserLoadStat } from '../api/client';
import { roleColor } from './UserAvatar';
import { BarGraph } from './BarGraph';
import { C, R, font } from '../theme';

const GROUP_COLORS = {
  todo:  C.inkTertiary,
  doing: C.primary,
  done:  C.success,
} as const;

const GROUP_LABELS = { todo: 'Todo', doing: 'In Progress', done: 'Done' } as const;

function initials(name: string) {
  return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function Bar({ user, rank, maxActive, onClick, isKanban }: {
  user:      UserLoadStat;
  rank:      number;
  maxActive: number;
  onClick:   () => void;
  isKanban: boolean;
}) {
  const active = user.todo + user.doing;
  const total  = active + user.done;
  const [hovered, setHovered] = useState(false);
  if (total === 0) return null;

  const barW  = maxActive > 0 ? Math.max((active / maxActive) * 100, active > 0 ? 4 : 0) : 0;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 28px 1fr 64px',
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

      <div style={{ ...b.avatar, backgroundColor: roleColor(user.role) }} title={user.role}>
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
        <div style={{ height: 12, display: 'flex', alignItems: 'center' }}>
          <div style={{ width: `${barW}%` }}>
            <BarGraph
              segments={[
                ...(user.todo > 0 ? [{ value: user.todo, color: GROUP_COLORS.todo, label: `${user.todo} todo` }] : []),
                ...(user.doing > 0 ? [{ value: user.doing, color: GROUP_COLORS.doing, label: `${user.doing} in progress` }] : []),
                ...(!isKanban && user.done > 0 ? [{ value: user.done, color: GROUP_COLORS.done, label: `${user.done} done` }] : []),
              ]}
              height={6}
              borderRadius={R.xs}
              gap={1}
            />
          </div>
        </div>
      </div>

      <div style={b.counts}>
        {user.todo > 0  && <span style={{ color: GROUP_COLORS.todo  }}>{user.todo}</span>}
        {user.doing > 0 && <span style={{ color: GROUP_COLORS.doing }}>{user.doing}</span>}
        {!isKanban && user.done > 0 && <span style={{ color: GROUP_COLORS.done }}>{user.done}</span>}
      </div>
    </div>
  );
}

export function UserLoadCard({ projectId, sprintId, staleDays = 7, onUserClick, isKanban }: {
  projectId:   string;
  sprintId:    string;
  staleDays?:  number;
  onUserClick: (userId: string, userName: string) => void;
  isKanban: boolean;
}) {
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

  const maxActive = users.reduce((m, u) => Math.max(m, u.todo + u.doing), 0);
  const totalIssues = users.reduce((s, u) => s + u.todo + u.doing + u.done, 0);
  const overloaded  = users.filter((u) => u.todo + u.doing > 5).length;
  const usersWithIssues = users
    .filter((u) => u.name !== 'Unknown')
    .filter((u) =>
      isKanban ? u.todo + u.doing > 0 : u.todo + u.doing + u.done > 0,
    );

  return (
    <div style={s.card}>
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

      <div style={s.legend}>
        {usersWithIssues.length > 0
          ? (['todo', 'doing', 'done'] as const).map((g) => (
              <span key={g} style={s.legendItem}>
                <span style={{ ...s.dot, backgroundColor: GROUP_COLORS[g] }} />
                {GROUP_LABELS[g]}
              </span>
            ))
          : <p style={s.muted}>No assignee data for this sprint.</p>}
      </div>

      {!loading && usersWithIssues.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '20px 28px 1fr 64px',
          gap: 10, padding: '0 8px',
          fontSize: 12, color: C.inkTertiary, fontWeight: 500, textTransform: 'uppercase' as const,
          letterSpacing: '0.4px',
          fontFamily: font.text,
        }}>
          <span style={{ textAlign: 'right' as const }}>#</span>
          <span />
          <span>Name</span>
          <span style={{ textAlign: 'right' as const }}>Load</span>
        </div>
      )}

      <div style={s.list}>
        {loading && <p style={s.muted}>Loading user stats…</p>}
        {error   && <p style={s.muted}>Failed to load: {error}</p>}
        {!loading && usersWithIssues.length === 0 && !error && (
          <p style={s.muted}>No assignee data for this sprint.</p>
        )}
        {!loading && usersWithIssues.map((u, i) => (
          <Bar key={u.id} user={u} rank={i + 1} maxActive={maxActive} onClick={() => onUserClick(u.id, u.name)} isKanban={isKanban} />
        ))}
      </div>
    </div>
  );
}

const b: Record<string, React.CSSProperties> = {
  avatar: {
    width: 26, height: 26, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, fontWeight: 600, color: '#fff', flexShrink: 0,
  },
  counts: {
    display: 'flex', gap: 4, justifyContent: 'flex-end',
    fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums',
    color: C.inkTertiary,
  },
};

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
  warnPill: {
    fontSize: 12, fontWeight: 400, padding: '2px 8px',
    borderRadius: R.pill, border: '1px solid #f59e0b44',
    color: '#f59e0b', backgroundColor: '#f59e0b11', flexShrink: 0,
    fontFamily: font.text,
  },
  legend: { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' as const },
  legendItem: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.inkTertiary, fontFamily: font.text },
  dot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
  list: { display: 'flex', flexDirection: 'column' },
  muted: { margin: 0, color: C.inkTertiary, fontSize: 14, fontFamily: font.text },
};
