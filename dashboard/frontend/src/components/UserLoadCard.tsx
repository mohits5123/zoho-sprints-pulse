import { useEffect, useState } from 'react';
import { fetchUserStats, type UserLoadStat } from '../api/client';
import { roleColor } from './UserAvatar';

const GROUP_COLORS = {
  todo:  '#475569',
  doing: '#3b82f6',
  done:  '#22c55e',
} as const;

const GROUP_LABELS = { todo: 'Todo', doing: 'In Progress', done: 'Done' } as const;

function initials(name: string) {
  return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function Bar({ user, maxActive, onClick }: {
  user:      UserLoadStat;
  maxActive: number;
  onClick:   () => void;
}) {
  const active = user.todo + user.doing;
  const total  = active + user.done;
  const [hovered, setHovered] = useState(false);
  if (total === 0) return null;

  const barW  = maxActive > 0 ? Math.max((active / maxActive) * 100, active > 0 ? 4 : 0) : 0;
  const doneW = total > 0 ? (user.done / total) * 100 : 0;

  const todoFrac  = active > 0 ? (user.todo  / active) * barW : 0;
  const doingFrac = active > 0 ? (user.doing / active) * barW : 0;

  return (
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
      {/* Avatar */}
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

      {/* Stacked bar */}
      <div style={b.barTrack}>
        <div style={b.barInner}>
          {user.todo > 0 && (
            <div
              style={{ width: `${todoFrac}%`, backgroundColor: GROUP_COLORS.todo, ...b.seg }}
              title={`${user.todo} todo`}
            />
          )}
          {user.doing > 0 && (
            <div
              style={{ width: `${doingFrac}%`, backgroundColor: GROUP_COLORS.doing, ...b.seg }}
              title={`${user.doing} in progress`}
            />
          )}
          {/* Done shown as a fainter track to the right */}
          {user.done > 0 && (
            <div
              style={{ width: `${Math.max(doneW * 0.4, 2)}%`, backgroundColor: GROUP_COLORS.done + '66', ...b.seg }}
              title={`${user.done} done`}
            />
          )}
        </div>
      </div>

      {/* Counts */}
      <div style={b.counts}>
        {user.todo > 0  && <span style={{ color: GROUP_COLORS.todo  }}>{user.todo}</span>}
        {user.doing > 0 && <span style={{ color: GROUP_COLORS.doing }}>{user.doing}</span>}
        {user.done > 0  && <span style={{ color: GROUP_COLORS.done  }}>{user.done}</span>}
      </div>
    </div>
  );
}

export function UserLoadCard({ projectId, sprintId, staleDays = 7, onUserClick }: {
  projectId:   string;
  sprintId:    string;
  staleDays?:  number;
  onUserClick: (userId: string, userName: string) => void;
}) {
  const [users, setUsers]   = useState<UserLoadStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchUserStats(projectId, sprintId, staleDays)
      .then(({ users }) => setUsers(users))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId, sprintId, staleDays]);

  const maxActive = users.reduce((m, u) => Math.max(m, u.todo + u.doing), 0);
  const totalIssues = users.reduce((s, u) => s + u.todo + u.doing + u.done, 0);
  const overloaded  = users.filter((u) => u.todo + u.doing > 5).length;

  return (
    <div style={s.card}>
      {/* Header */}
      <div style={s.headerRow}>
        <div>
          <p style={s.label}>User Load</p>
          {!loading && users.length > 0 && (
            <p style={s.sub}>{users.length} contributors · {totalIssues} tickets</p>
          )}
        </div>
        {overloaded > 0 && (
          <span style={s.warnPill}>⚠ {overloaded} overloaded</span>
        )}
      </div>

      {/* Legend */}
      <div style={s.legend}>
        {(['todo', 'doing', 'done'] as const).map((g) => (
          <span key={g} style={s.legendItem}>
            <span style={{ ...s.dot, backgroundColor: GROUP_COLORS[g] + (g === 'done' ? '66' : '') }} />
            {GROUP_LABELS[g]}
          </span>
        ))}
      </div>

      {/* Rows */}
      <div style={s.list}>
        {loading && <p style={s.muted}>Loading user stats…</p>}
        {error   && <p style={s.muted}>Failed to load: {error}</p>}
        {!loading && users.length === 0 && !error && (
          <p style={s.muted}>No assignee data for this sprint.</p>
        )}
        {!loading && users.map((u) => (
          <Bar key={u.id} user={u} maxActive={maxActive} onClick={() => onUserClick(u.id, u.name)} />
        ))}
      </div>
    </div>
  );
}

// ── Row styles ────────────────────────────────────────────────────────────────
const b: Record<string, React.CSSProperties> = {
  row: {
    display: 'grid',
    gridTemplateColumns: '28px 120px 1fr 64px',
    alignItems: 'center',
    gap: 10,
    borderBottom: '1px solid #1e293b',
  },
  avatar: {
    width: 26, height: 26, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  nameCol: { display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' },
  name: {
    fontSize: 12, color: '#e2e8f0', fontWeight: 500,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  roleChip: {
    fontSize: 9, fontWeight: 700, padding: '1px 5px',
    borderRadius: 10, border: '1px solid', flexShrink: 0,
  },
  barTrack: { height: 12, display: 'flex', alignItems: 'center' },
  barInner: { display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', width: '100%', gap: 1 },
  seg: { height: '100%', minWidth: 2, borderRadius: 2, transition: 'width 0.3s ease' },
  counts: {
    display: 'flex', gap: 4, justifyContent: 'flex-end',
    fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
    color: '#64748b',
  },
};

// ── Card styles ───────────────────────────────────────────────────────────────
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
  warnPill: {
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
