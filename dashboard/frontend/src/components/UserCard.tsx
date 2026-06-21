import { useState } from 'react';
import { User, UserRole, updateUserRole } from '../api/client';

/**
 * Metadata for user roles including color and display label.
 * Used to render role selectors and avatars.
 */
const ROLE_META: Record<UserRole, { color: string; label: string }> = {
  DEV:   { color: '#3b82f6', label: 'DEV' },
  QA:    { color: '#a855f7', label: 'QA' },
  PROD:  { color: '#f59e0b', label: 'PROD' },
  OTHER: { color: '#64748b', label: 'OTHER' },
};

/**
 * Avatar color palette for generating distinct user avatars.
 * Colors are distributed based on user name hash.
 */
const AVATAR_PALETTE = [
  '#3b82f6', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f59e0b', '#ef4444', '#22c55e', '#06b6d4',
];

/**
 * Generate a consistent avatar background color from a user's name.
 * Uses a hash of the name to select from the palette.
 * @param name User's full name
 * @returns Hex color code for avatar background
 */
function avatarColor(name: string): string {
  const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

/**
 * Extract first two letters of a name as initials.
 * Used for avatar display when no avatar image is available.
 * @param name User's full name
 * @returns Uppercase string of first two letters
 */
function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((n) => n[0] ?? '').join('').toUpperCase();
}

/**
 * Props for UserCard component.
 * Renders a card showing user info, avatar, and role selector.
 */
type Props = {
  /** User object containing name, email, and role */
  user:          User;
  /** Current work in progress count for this user */
  wip?:          number;
  /** Number of stale tickets assigned to this user */
  staleCount?:   number;
  /** Callback when role is changed */
  onRoleChange?: (id: string, role: UserRole) => void;
  /** Click handler for navigating to user profile */
  onClick?:      () => void;
};

/**
 * UserCard component displays user information with role management.
 * Shows avatar, name, email, WIP count, and provides role selection.
 * Handles stale ticket indicators and user interaction.
 */
export function UserCard({ user, wip = 0, staleCount = 0, onRoleChange, onClick }: Props) {
  // State for role management and hover effects
  const [role, setRole] = useState<UserRole>(user.role as UserRole);
  const [updating, setUpdating] = useState(false);
  const [hovered, setHovered]   = useState(false);

  /**
   * Handle role change with optimistic update and error recovery.
   * Updates local state immediately, reverts on API failure.
   * @param newRole The new role to assign to the user
   */
  async function handleRoleChange(newRole: UserRole) {
    const prev = role;
    setRole(newRole);
    setUpdating(true);
    try {
      await updateUserRole(user.zohoId, newRole);
      onRoleChange?.(user.zohoId, newRole);
    } catch {
      // Revert to previous role on failure
      setRole(prev);
    } finally {
      setUpdating(false);
    }
  }

  // Generate avatar color and get role metadata
  const bg   = avatarColor(user.name);
  const meta = ROLE_META[role];

  return (
    <div
      style={{ ...s.card, cursor: onClick ? 'pointer' : 'default', borderColor: hovered && onClick ? '#475569' : '#334155' }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={s.top}>
        {/* Avatar with stale ticket indicator */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ ...s.avatar, backgroundColor: bg }}>
            {initials(user.name)}
          </div>
          {/* Orange dot indicates stale tickets assigned to user */}
          {staleCount > 0 && (
            <span
              title={`${staleCount} stale ticket${staleCount !== 1 ? 's' : ''}`}
              style={s.staleDot}
            />
          )}
        </div>

        <div style={s.info}>
          <span style={s.name}>{user.name}</span>
          <span style={s.email}>{user.email ?? '—'}</span>
        </div>

        {/* WIP (Work In Progress) badge - shows current active tickets */}
        {/* Red when overloaded (>5), blue otherwise */}
        {wip > 0 && (
          <span
            title={`${wip} ticket${wip !== 1 ? 's' : ''} in progress`}
            style={{
              ...s.wipBadge,
              backgroundColor: wip > 5 ? '#ef444422' : '#3b82f622',
              color:           wip > 5 ? '#ef4444'   : '#60a5fa',
              borderColor:     wip > 5 ? '#ef444444' : '#3b82f644',
            }}
          >
            {wip} WIP
          </span>
        )}
      </div>

      {/* Divider separating user info from role selector */}
      <div style={s.divider} />

      <div style={s.bottom}>
        {/* Role selector dropdown for changing user role */}
        <span style={s.roleLabel}>Role</span>
        <select
          value={role}
          disabled={updating}
          onChange={(e) => handleRoleChange(e.target.value as UserRole)}
          style={{
            ...s.select,
            color:           meta.color,
            borderColor:     `${meta.color}66`,
            backgroundColor: `${meta.color}11`,
            opacity: updating ? 0.6 : 1,
          }}
        >
          {Object.entries(ROLE_META).map(([r, m]) => (
            <option key={r} value={r}>{m.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  top: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 15,
    fontWeight: 700,
    color: '#fff',
  },
  staleDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 11,
    height: 11,
    borderRadius: '50%',
    backgroundColor: '#f59e0b',
    border: '2px solid #1e293b',
  },
  wipBadge: {
    marginLeft: 'auto',
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 7px',
    borderRadius: 20,
    border: '1px solid',
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
  },
  info: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: 600,
    color: '#f1f5f9',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  email: {
    fontSize: 12,
    color: '#64748b',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  divider: {
    height: 1,
    backgroundColor: '#0f172a',
    marginBottom: 16,
  },
  bottom: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roleLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 500,
  },
  select: {
    fontSize: 12,
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid',
    cursor: 'pointer',
    outline: 'none',
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    paddingRight: 22,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394a3b8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 6px center',
  },
};
