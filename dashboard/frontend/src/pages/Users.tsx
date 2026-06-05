import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, UserRole, fetchUsers, fetchTeamLoad, type TeamLoadStat } from '../api/client';
import { UserCard } from '../components/UserCard';

const ROLE_META: Record<UserRole, { color: string; label: string }> = {
  DEV:   { color: '#3b82f6', label: 'DEV' },
  QA:    { color: '#a855f7', label: 'QA' },
  PROD:  { color: '#f59e0b', label: 'PROD' },
  OTHER: { color: '#64748b', label: 'OTHER' },
};

const ROLE_ORDER: Record<string, number> = { DEV: 0, QA: 1, PROD: 2, OTHER: 3 };

export function Users() {
  const navigate = useNavigate();
  const [users, setUsers]           = useState<User[]>([]);
  const [loadMap, setLoadMap]       = useState<Map<string, TeamLoadStat>>(new Map());
  const [loadMeta, setLoadMeta]     = useState<{ sprintCount: number; projectCount: number } | null>(null);
  const [loading, setLoading]       = useState(true);
  const [loadFetching, setLoadFetching] = useState(true);

  useEffect(() => {
    fetchUsers()
      .then((data) => {
        const sorted = [...data.users].sort(
          (a, b) => (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99),
        );
        setUsers(sorted);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setLoadFetching(true);
    fetchTeamLoad()
      .then((data) => {
        setLoadMap(new Map(data.users.map((u) => [u.id, u])));
        setLoadMeta({ sprintCount: data.sprintCount, projectCount: data.projectCount });
      })
      .catch(() => {/* silently degrade — badges just won't show */})
      .finally(() => setLoadFetching(false));
  }, []);

  const roleCounts = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});

  // Cross-sprint WIP per role group
  const roleWip = users.reduce<Record<string, number>>((acc, u) => {
    const stat = loadMap.get(u.zohoId);
    if (stat) acc[u.role] = (acc[u.role] ?? 0) + stat.todo + stat.doing;
    return acc;
  }, {});

  // Total stale across all users
  const totalStale = [...loadMap.values()].reduce((s, u) => s + u.stale, 0);

  function handleRoleChange(id: string, newRole: UserRole) {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role: newRole } : u)));
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <button style={s.back} onClick={() => navigate('/')}>← Back</button>
        <div>
          <h1 style={s.title}>Team</h1>
          <p style={s.subtitle}>Assign local roles to your Zoho Sprints members</p>
        </div>
      </header>

      {!loading && users.length > 0 && (
        <div style={s.statsRow}>
          {/* Members summary */}
          <div style={s.statsBlock}>
            <span style={s.statBig}>{users.length}</span>
            <span style={s.statLabel}>members</span>
          </div>

          <div style={s.statDivider} />

          {/* Role counts */}
          {(['DEV', 'QA', 'PROD', 'OTHER'] as UserRole[]).map((role) => (
            <div key={role} style={s.statsBlock}>
              <span style={{ ...s.statBig, color: ROLE_META[role].color }}>
                {roleCounts[role] ?? 0}
              </span>
              <span style={s.statLabel}>{role}</span>
            </div>
          ))}

          {/* Cross-sprint WIP breakdown — shown once load data arrives */}
          {!loadFetching && loadMeta && loadMeta.sprintCount > 0 && (
            <>
              <div style={s.statDivider} />
              <div style={s.statsBlock}>
                <span style={s.statMeta}>
                  Across {loadMeta.sprintCount} sprint{loadMeta.sprintCount !== 1 ? 's' : ''}
                </span>
              </div>
              {(['DEV', 'QA', 'PROD', 'OTHER'] as UserRole[]).map((role) => {
                const wip = roleWip[role] ?? 0;
                if (wip === 0) return null;
                return (
                  <div key={`wip-${role}`} style={s.statsBlock}>
                    <span style={{ ...s.statBig, color: ROLE_META[role].color }}>{wip}</span>
                    <span style={s.statLabel}>{role} WIP</span>
                  </div>
                );
              })}
              {totalStale > 0 && (
                <div style={s.statsBlock}>
                  <span style={{ ...s.statBig, color: '#f59e0b' }}>{totalStale}</span>
                  <span style={s.statLabel}>stale</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <main style={s.main}>
        {loading && <p style={s.muted}>Loading users…</p>}

        {!loading && users.length === 0 && (
          <p style={s.muted}>No users found. Go back and sync your team first.</p>
        )}

        {!loading && users.length > 0 && (
          <div style={s.grid}>
            {users.map((user) => {
              const stat = loadMap.get(user.zohoId);
              return (
                <UserCard
                  key={user.id}
                  user={user}
                  wip={stat ? stat.todo + stat.doing : 0}
                  staleCount={stat?.stale ?? 0}
                  onRoleChange={handleRoleChange}
                  onClick={() => navigate(`/users/${user.id}`)}
                />
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '0 24px 48px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    padding: '32px 0 40px',
    borderBottom: '1px solid #1e293b',
    marginBottom: 32,
  },
  back: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 8, padding: '7px 13px',
    color: '#94a3b8', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
  },
  title:    { margin: 0, fontSize: 28, fontWeight: 700, color: '#f1f5f9' },
  subtitle: { margin: '4px 0 0', fontSize: 14, color: '#64748b' },
  statsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    marginBottom: 28,
    flexWrap: 'wrap' as const,
    padding: '16px 20px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
  },
  statsBlock: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 1,
    minWidth: 36,
  },
  statBig: {
    fontSize: 20,
    fontWeight: 700,
    color: '#f1f5f9',
    lineHeight: 1.1,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: '#475569',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap' as const,
  },
  statMeta: {
    fontSize: 11,
    color: '#475569',
    whiteSpace: 'nowrap' as const,
  },
  statDivider: { width: 1, height: 32, backgroundColor: '#334155' },
  main: {},
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    gap: 16,
  },
  muted: { color: '#64748b', fontSize: 14 },
};
