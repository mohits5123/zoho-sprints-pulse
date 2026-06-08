import { useState } from 'react';

export const ROLE_COLORS: Record<string, string> = {
  DEV:   '#1d4ed8',
  QA:    '#15803d',
  PROD:  '#b45309',
  OTHER: '#7e22ce',
};

const ROLE_ORDER: Record<string, number> = { DEV: 0, QA: 1, PROD: 2, OTHER: 3 };

export function sortByRole<T extends { role: string }>(users: T[]): T[] {
  return [...users].sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? ROLE_ORDER.OTHER;
    const rb = ROLE_ORDER[b.role] ?? ROLE_ORDER.OTHER;
    return ra - rb;
  });
}

const STATUS_GROUP_ORDER: Record<string, number> = { todo: 0, doing: 1, done: 2 };

/** Sort [status, count] entries by group order: todo → doing → done. */
export function sortStatusEntries(
  entries: [string, number][],
  groups: Record<string, string>,
): [string, number][] {
  return [...entries].sort(([a], [b]) => {
    const ga = STATUS_GROUP_ORDER[groups[a]] ?? 1;
    const gb = STATUS_GROUP_ORDER[groups[b]] ?? 1;
    return ga - gb;
  });
}

/**
 * Get color for a user role
 * @param role User role string (DEV, QA, PROD, OTHER)
 * @returns Hex color code for the role
 */
export function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? ROLE_COLORS.OTHER;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function UserAvatar({
  name,
  role,
  size = 28,
  onClick,
}: {
  name: string;
  role: string;
  size?: number;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <div style={{
        width: size, height: size, borderRadius: '50%',
        backgroundColor: roleColor(role),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.36, fontWeight: 700, color: '#fff',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        border: '2px solid #0f172a',
        transition: 'opacity 0.1s',
        opacity: hovered && onClick ? 0.85 : 1,
      }}>
        {initials(name)}
      </div>
      {hovered && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#0f172a',
          border: '1px solid #334155',
          color: '#e2e8f0',
          fontSize: 11,
          fontWeight: 500,
          padding: '3px 8px',
          borderRadius: 5,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 20,
        }}>
          {name}
        </div>
      )}
    </div>
  );
}
