/**
 * Users page component.
 *
 * Displays all team members from Zoho Sprints with their local roles (DEV/QA/PROD/OTHER),
 * shows role distribution stats, and allows changing a user's role via the dropdown.
 * Each user card shows their current WIP (work in progress) count and stale ticket count.
 *
 * Features:
 * - Grid of user cards with avatar, name, email, and role badge
 * - Role distribution stats in header (counts per role)
 * - Cross-sprint WIP breakdown by role (when data available)
 * - Total stale tickets count
 * - Per-user WIP and stale ticket count badges on cards
 * - Role change dropdown on each card (optimistic update, persisted on next sync)
 * - Click on user to navigate to their profile page
 *
 * Data flows:
 * - `fetchUsers()` loads Zoho users and sets their `role` to the local role (if changed).
 * - `fetchTeamLoad()` loads cross-sprint WIP and stale counts from the local SQLite DB.
 * - Role changes are optimistic (UI updates immediately) and persisted on next sync.
 * - WIP/stale counts are computed from local data (not live Zoho data)
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, UserRole, fetchUsers, fetchTeamLoad, type TeamLoadStat } from '../api/client';
import { UserCard } from '../components/UserCard';

/**
 * Role metadata mapping for color-coding and label display.
 * DEV (blue), QA (purple), PROD (orange), OTHER (gray).
 */
const ROLE_META: Record<UserRole, { color: string; label: string }> = {
  DEV:   { color: '#3b82f6', label: 'DEV' },
  QA:    { color: '#a855f7', label: 'QA' },
  PROD:  { color: '#f59e0b', label: 'PROD' },
  OTHER: { color: '#64748b', label: 'OTHER' },
};

/**
 * Defines the display order of roles in the stats row and user list.
 * DEV → QA → PROD → OTHER.
 */
const ROLE_ORDER: Record<string, number> = { DEV: 0, QA: 1, PROD: 2, OTHER: 3 };

/**
 * Renders the Team/Users page.
 *
 * @returns The Users component JSX.
 *
 * @remarks
 * - Fetches users from Zoho and displays them with local role badges.
 * - Fetches team load data (WIP, stale counts) from the local SQLite DB.
 * - Allows role changes via dropdown on each user card.
 * - Shows summary stats: total members, role counts, cross-sprint WIP by role, and total stale tickets.
 * - Gracefully degrades if team load data is unavailable (badges won't show, but users still render).
 */
export function Users() {
  const navigate = useNavigate();
  const [users, setUsers]           = useState<User[]>([]);
  const [loadMap, setLoadMap]       = useState<Map<string, TeamLoadStat>>(new Map());
  const [loadMeta, setLoadMeta]     = useState<{ sprintCount: number; projectCount: number } | null>(null);
  const [loading, setLoading]       = useState(true);
  const [loadFetching, setLoadFetching] = useState(true);

  // Fetch users from Zoho and sort them by role order (DEV → QA → PROD → OTHER).
  // This runs once on mount.
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

  // Fetch team load data (WIP and stale counts) from the local SQLite DB.
  // Silently degrades on failure — badges simply won't display.
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

  /**
   * Counts of users per role.
   * Used for the role distribution stats in the header.
   * Computed from the local user list (not from Zoho).
   *
   * Result shape: `{ DEV: 5, QA: 3, PROD: 1, OTHER: 2 }` (only roles with users).
   */
  const roleCounts = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});

  /**
   * Cross-sprint WIP (work in progress) aggregated by role.
   * Sums `todo + doing` tickets from all sprints for each user,
   * grouped by their local role (DEV/QA/PROD/OTHER).
   * Only used when load data is available.
   *
   * Note: This aggregates WIP per role, not per user.
   * The per-user WIP is shown on individual user cards.
   *
   * Result shape: `{ DEV: 12, QA: 5, PROD: 0, OTHER: 3 }` (only roles with WIP).
   */
  const roleWip = users.reduce<Record<string, number>>((acc, u) => {
    const stat = loadMap.get(u.zohoId);
    if (stat) acc[u.role] = (acc[u.role] ?? 0) + stat.todo + stat.doing;
    return acc;
  }, {});

  /**
   * Total count of stale tickets across all users.
   * A ticket is considered stale if it exceeds the `staleDays` threshold.
   * Computed from local team load data.
   */
  const totalStale = [...loadMap.values()].reduce((s, u) => s + u.stale, 0);

  /**
   * Optimistically updates a user's local role in the UI.
   * The change is persisted to the DB on the next sync.
   *
   * @param id - The user's local ID (not Zoho ID)
   * @param newRole - The new role to assign (DEV/QA/PROD/OTHER)
   */
  function handleRoleChange(id: string, newRole: UserRole) {
    setUsers((prev) => prev.map((u) => (u.zohoId === id ? { ...u, role: newRole } : u)));
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
        {/* Loading state — shown while fetchUsers is pending. */}
        {loading && <p style={s.muted}>Loading users…</p>}

        {/* Empty state — users loaded but none exist (no sync yet). */}
        {!loading && users.length === 0 && (
          <p style={s.muted}>No users found. Go back and sync your team first.</p>
        )}

        {/* User cards grid — each card shows avatar, name, role badge, WIP, and stale count. */}
        {!loading && users.length > 0 && (
          <div style={s.grid}>
            {users.map((user) => {
              // Look up per-user stats from local team load data.
              const stat = loadMap.get(user.zohoId);
              return (
                <UserCard
                  key={user.zohoId}
                  user={user}
                  wip={stat ? stat.todo + stat.doing : 0}
                  staleCount={stat?.stale ?? 0}
                  onRoleChange={handleRoleChange}
                  onClick={() => navigate(`/users/${user.zohoId}`)}
                />
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

/**
  * CSS-in-JS style object for the Users page.
  * Dark theme using slate colors (#0f172a background, #1e293b surfaces).
  * Grid layout uses a 5-column responsive grid.
  */
const s: Record<string, React.CSSProperties> = {
  /** Page container with dark background and system font stack. */
  page: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '0 24px 48px',
  },
  /** Header with back button and title/subtitle. */
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    padding: '32px 0 40px',
    borderBottom: '1px solid #1e293b',
    marginBottom: 32,
  },
  /** Back navigation button with subtle styling. */
  back: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 8, padding: '7px 13px',
    color: '#94a3b8', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
  },
  /** Main title for the page. */
  title:    { margin: 0, fontSize: 28, fontWeight: 700, color: '#f1f5f9' },
  /** Subtitle describing the page purpose. */
  subtitle: { margin: '4px 0 0', fontSize: 14, color: '#64748b' },
  /** Stats row container with role counts and WIP metrics. */
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
  /** Individual stat block (e.g., member count, role count, WIP). */
  statsBlock: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 1,
    minWidth: 36,
  },
  /** Large stat number with tabular nums for alignment. */
  statBig: {
    fontSize: 20,
    fontWeight: 700,
    color: '#f1f5f9',
    lineHeight: 1.1,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  /** Stat label (e.g., "DEV", "WIP", "stale"). */
  statLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: '#475569',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap' as const,
  },
  /** Meta stat text (e.g., "Across 3 sprints"). */
  statMeta: {
    fontSize: 11,
    color: '#475569',
    whiteSpace: 'nowrap' as const,
  },
  /** Vertical divider between stat groups. */
  statDivider: { width: 1, height: 32, backgroundColor: '#334155' },
  /** Main content area. */
  main: {},
  /** Grid container for user cards. */
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    gap: 16,
  },
  /** Muted text for loading/empty states. */
  muted: { color: '#64748b', fontSize: 14 },
};
