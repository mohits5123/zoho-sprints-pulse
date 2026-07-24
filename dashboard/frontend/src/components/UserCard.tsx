import { useState } from 'react';
import { User, UserRole, updateUserRole } from '../api/client';
import { C, R, font } from '../theme';

const ROLE_META: Record<UserRole, { color: string; label: string }> = {
  DEV:   { color: C.primary, label: 'DEV' },
  QA:    { color: '#a855f7', label: 'QA' },
  PROD:  { color: '#f59e0b', label: 'PROD' },
  OTHER: { color: C.inkTertiary, label: 'OTHER' },
};

const AVATAR_PALETTE = [
  C.primary, '#a855f7', '#ec4899',
  '#f59e0b', '#ef4444', C.success, '#06b6d4',
];

function avatarColor(name: string): string {
  const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((n) => n[0] ?? '').join('').toUpperCase();
}

type Props = {
  user:          User;
  wip?:          number;
  staleCount?:   number;
  onRoleChange?: (id: string, role: UserRole) => void;
  onClick?:      () => void;
};

export function UserCard({ user, wip = 0, staleCount = 0, onRoleChange, onClick }: Props) {
  const [role, setRole] = useState<UserRole>(user.role as UserRole);
  const [updating, setUpdating] = useState(false);
  const [hovered, setHovered]   = useState(false);

  async function handleRoleChange(newRole: UserRole) {
    const prev = role;
    setRole(newRole);
    setUpdating(true);
    try {
      await updateUserRole(user.zohoId, newRole);
      onRoleChange?.(user.zohoId, newRole);
    } catch {
      setRole(prev);
    } finally {
      setUpdating(false);
    }
  }

  const bg   = avatarColor(user.name);
  const meta = ROLE_META[role];

  return (
    <div
      style={{ ...s.card, cursor: onClick ? 'pointer' : 'default', borderColor: hovered && onClick ? C.hairlineStrong : C.hairline }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={s.top}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ ...s.avatar, backgroundColor: bg }}>
            {initials(user.name)}
          </div>
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

        {wip > 0 && (
          <span
            title={`${wip} ticket${wip !== 1 ? 's' : ''} in progress`}
            style={{
              ...s.wipBadge,
              backgroundColor: wip > 5 ? '#ef444422' : `${C.primary}22`,
              color:           wip > 5 ? '#ef4444'   : C.primaryHover,
              borderColor:     wip > 5 ? '#ef444444' : `${C.primary}44`,
            }}
          >
            {wip} WIP
          </span>
        )}
      </div>

      <div style={s.divider} />

      <div style={s.bottom}>
        <span style={s.roleLabel}>Role</span>
        <select
          value={role}
          disabled={updating}
          onClick={(e) => e.stopPropagation()}
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
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
    padding: '24px',
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
    fontWeight: 600,
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
    border: `2px solid ${C.surface1}`,
  },
  wipBadge: {
    marginLeft: 'auto',
    fontSize: 12,
    fontWeight: 400,
    padding: '2px 8px',
    borderRadius: R.pill,
    border: '1px solid',
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
    fontFamily: font.text,
  },
  info: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: 400,
    color: C.inkMuted,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontFamily: font.display,
    letterSpacing: '-0.2px',
  },
  email: {
    fontSize: 14,
    color: C.inkTertiary,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontFamily: font.text,
  },
  divider: {
    height: 1,
    backgroundColor: C.hairline,
    marginBottom: 16,
  },
  bottom: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roleLabel: {
    fontSize: 14,
    color: C.inkTertiary,
    fontWeight: 400,
    fontFamily: font.text,
  },
  select: {
    fontSize: 14,
    fontWeight: 500,
    padding: '4px 10px',
    borderRadius: R.md,
    border: '1px solid',
    cursor: 'pointer',
    outline: 'none',
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    paddingRight: 22,
    fontFamily: font.text,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238a8f98' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 6px center',
  },
};
