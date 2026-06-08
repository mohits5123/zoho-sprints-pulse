import React, { useEffect, useState } from 'react';
import { fetchIssues, type UserLoadStat } from '../api/client';
import { roleColor } from './UserAvatar';

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
      <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </span>
  );
}

interface UserStaleCardProps {
  projectId:     string;
  sprintId:      string;
  staleDays?:    number | null;
  watchedStates?: string[];
  onUserClick?:  (userId: string, userName: string) => void;
}

type StaleUser = UserLoadStat & { doing: number; stale: number };

function StaleRow({ user, rank, onUserClick }: {
  user:        StaleUser;
  rank:        number;
  onUserClick?: (userId: string, userName: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const todo  = user.todo  ?? 0;
  const doing = user.doing ?? 0;
  const done  = user.done  ?? 0;
  const total = todo + doing + done;
  if (total === 0) return null;

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
      onClick={() => onUserClick?.(String(user.id), user.name)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Rank */}
      <span style={{ fontSize: 11, color: '#475569', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {rank}
      </span>

      {/* Avatar — circular, role-colored */}
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

      {/* Name + stacked bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
        <span style={{
          fontSize: 12, color: '#e2e8f0', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {user.name}
        </span>
        <div style={{ height: 4, borderRadius: 2, backgroundColor: '#0f172a', overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${(todo  / total) * 100}%`, backgroundColor: '#64748b', transition: 'width 0.4s' }} />
          <div style={{ width: `${(doing / total) * 100}%`, backgroundColor: '#3b82f6', transition: 'width 0.4s' }} />
          <div style={{ width: `${(done  / total) * 100}%`, backgroundColor: '#22c55e', transition: 'width 0.4s' }} />
        </div>
      </div>

      {/* Status dots + total */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusDot color="#64748b" count={todo}  label="todo"        />
        <StatusDot color="#3b82f6" count={doing} label="in progress" />
        <StatusDot color="#22c55e" count={done}  label="done"        />
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#e2e8f0',
          marginLeft: 4, minWidth: 18, textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {total}
        </span>
      </div>
    </div>
  );
}

export function UserStaleCard({
  projectId, sprintId, staleDays = 7,
  watchedStates = [], onUserClick,
}: UserStaleCardProps) {
  const [users,            setUsers]            = useState<StaleUser[]>([]);
  const [totalStaleIssues, setTotalStaleIssues] = useState(0);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState<string | null>(null);

  const watchedStatesKey = watchedStates.join(',');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const d = Number(staleDays) || 7;
        // Do NOT pass watchedStates to the API — the backend compares them against
        // actual Zoho status names but our watchedStates may be group names or
        // actual names depending on the caller. Filter client-side on it.status instead.
        const issuesRes = await fetchIssues(projectId, sprintId, { stale: true, staleDays: d });
        if (!mounted) return;
        const issues = issuesRes.issues || [];

        const map = new Map<string, StaleUser>();

        for (const it of issues) {
          // watchedStates can be actual Zoho status names; skip issues not in the watched set
          if (watchedStates.length && !watchedStates.includes(it.status)) continue;
          const group = it.statusGroup || 'todo';

          for (const a of (it.assignees || [])) {
            const id = String(a.id);
            if (!map.has(id)) {
              map.set(id, { id, name: a.name || 'Unknown', role: a.role || 'OTHER', todo: 0, doing: 0, done: 0, stale: 0 });
            }
            const t = map.get(id)!;
            if      (group === 'todo')  t.todo++;
            else if (group === 'doing') t.doing++;
            else                        t.done++;
            t.stale++;
          }
        }

        const usersArr = [...map.values()].sort((a, b) => {
          const diff = (b.todo + b.doing) - (a.todo + a.doing);
          return diff !== 0 ? diff : a.name.localeCompare(b.name);
        });
        setUsers(usersArr);
        setTotalStaleIssues(issues.length);
      } catch (err: unknown) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch user stats');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sprintId, staleDays, watchedStatesKey]);

  const sorted = users.filter(u => (u.todo + u.doing + u.done) > 0);

  return (
    <div style={s.card}>
      {/* Header */}
      <div style={s.headerRow}>
        <div>
          <p style={s.label}>Stale Issues by User</p>
          {!loading && sorted.length > 0 && (
            <p style={s.sub}>{sorted.length} assignee{sorted.length !== 1 ? 's' : ''} · {totalStaleIssues} tickets</p>
          )}
        </div>
        {!loading && totalStaleIssues > 0 && (
          <span style={s.staleBadge}>⚠ {totalStaleIssues} stale</span>
        )}
      </div>

      {/* Column headers */}
      {!loading && sorted.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: '18px 28px 1fr auto',
          gap: 10, padding: '0 8px',
          fontSize: 10, color: '#475569', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <span style={{ textAlign: 'right' }}>#</span>
          <span />
          <span>Assignee</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 18, textAlign: 'center' }}>◻</span>
            <span style={{ width: 18, textAlign: 'center' }}>▶</span>
            <span style={{ width: 18, textAlign: 'center' }}>✓</span>
            <span style={{ width: 22, textAlign: 'right' }}>Tot</span>
          </div>
        </div>
      )}

      <div style={s.list}>
        {loading && <p style={s.muted}>Loading…</p>}
        {error   && <p style={s.muted}>Failed to load: {error}</p>}
        {!loading && sorted.length === 0 && !error && (
          <p style={s.muted}>No stale issues in watched states.</p>
        )}
        {!loading && sorted.map((user, idx) => (
          <StaleRow key={user.id} user={user} rank={idx + 1} onUserClick={onUserClick} />
        ))}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    gridColumn: 'span 2',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  label: {
    margin: 0, fontSize: 11, fontWeight: 600,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  sub:   { margin: '2px 0 0', fontSize: 11, color: '#475569' },
  staleBadge: {
    fontSize: 11, fontWeight: 700, padding: '3px 8px',
    borderRadius: 20, border: '1px solid #f59e0b66',
    backgroundColor: '#f59e0b11', color: '#f59e0b', flexShrink: 0,
  },
  list:  { display: 'flex', flexDirection: 'column' },
  muted: { margin: 0, color: '#475569', fontSize: 13 },
};
