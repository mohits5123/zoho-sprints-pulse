import { useState } from 'react';
import { C, R, font } from '../theme';

export const ROLE_COLORS: Record<string, string> = {
  DEV:   '#5e6ad2',
  QA:    '#27a644',
  PROD:  '#f59e0b',
  OTHER: '#8a8f98',
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
        border: `2px solid ${C.canvas}`,
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
          backgroundColor: C.surface2,
          border: `1px solid ${C.hairline}`,
          color: C.inkMuted,
          fontSize: 12,
          fontWeight: 400,
          fontFamily: font.text,
          padding: '3px 8px',
          borderRadius: R.sm,
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
