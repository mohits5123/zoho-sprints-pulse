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
import { BackButton } from '../components/BackButton';
import { StatPill } from '../components/StatPill';
import { SearchBar } from '../components/SearchBar';
import { C, R, font } from '../theme';

/**
 * Role metadata mapping for color-coding and label display.
 * DEV (blue), QA (purple), PROD (orange), OTHER (gray).
 */
const ROLE_META: Record<UserRole, { color: string; label: string }> = {
  DEV:   { color: C.primary, label: 'DEV' },
  QA:    { color: '#a855f7', label: 'QA' },
  PROD:  { color: '#f59e0b', label: 'PROD' },
  OTHER: { color: C.inkTertiary, label: 'OTHER' },
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
  const [search, setSearch]         = useState('');

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
        <BackButton />
        <div>
          <h1 style={s.title}>Team</h1>
          <p style={s.subtitle}>Assign local roles to your Zoho Sprints members</p>
        </div>
      </header>

      {!loading && users.length > 0 && (
        <div style={s.statsRow}>
          <StatPill value={users.length} label="members" color={C.inkMuted} />
          <div style={s.statDivider} />
          {(['DEV', 'QA', 'PROD', 'OTHER'] as UserRole[]).map((role) => (
            <StatPill
              key={role}
              value={roleCounts[role] ?? 0}
              label={role}
              color={ROLE_META[role].color}
            />
          ))}
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
                  <StatPill
                    key={`wip-${role}`}
                    value={wip}
                    label={`${role} WIP`}
                    color={ROLE_META[role].color}
                  />
                );
              })}
              {totalStale > 0 && (
                <StatPill value={totalStale} label="stale" color="#f59e0b" />
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

        {/* Search bar — shown once users are loaded. */}
        {!loading && users.length > 0 && (
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search by name…"
          />
        )}

        {/* User cards grid — each card shows avatar, name, role badge, WIP, and stale count. */}
        {!loading && users.length > 0 && (() => {
          const q = search.trim().toLowerCase();
          const filtered = q
            ? users.filter((u) => u.name.toLowerCase().includes(q))
            : users;
          if (filtered.length === 0) {
            return <p style={s.muted}>No users match "{search}".</p>;
          }
          return (
            <div style={s.grid}>
              {filtered.map((user) => {
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
          );
        })()}
      </main>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: C.canvas,
    color: C.inkMuted,
    fontFamily: font.text,
    padding: '0 24px 48px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    padding: '32px 0 40px',
    borderBottom: `1px solid ${C.hairline}`,
    marginBottom: 32,
  },
  title:    { margin: 0, fontSize: 28, fontWeight: 600, color: C.inkMuted, fontFamily: font.display, letterSpacing: '-0.6px' },
  subtitle: { margin: '4px 0 0', fontSize: 14, color: C.inkTertiary, fontFamily: font.text },
  statsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    marginBottom: 28,
    flexWrap: 'wrap',
    padding: '16px 20px',
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
  },
  statsBlock: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 1,
    minWidth: 36,
  },
  statMeta: {
    fontSize: 11,
    color: C.inkTertiary,
    whiteSpace: 'nowrap',
    fontFamily: font.text,
  },
  statDivider: { width: 1, height: 32, backgroundColor: C.hairline },
  main: {},
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    gap: 16,
  },
  muted: { color: C.inkTertiary, fontSize: 14, fontFamily: font.text },
};
