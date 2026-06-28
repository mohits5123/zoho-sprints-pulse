import { useState } from 'react';

/**
 * Color mapping for user roles used throughout the avatar component.
 * Each role gets a distinct, accessible color for visual differentiation.
 */
export const ROLE_COLORS: Record<string, string> = {
  DEV:   '#1d4ed8',  // Blue   — Developers
  QA:    '#15803d',  // Green  — Quality Assurance
  PROD:  '#b45309',  // Amber  — Product / Project roles
  OTHER: '#7e22ce',  // Purple — Unrecognised or fallback roles
};

/**
 * Defines the sort priority for roles. Lower numbers appear first.
 * This ensures a consistent ordering: DEV → QA → PROD → OTHER.
 */
const ROLE_ORDER: Record<string, number> = { DEV: 0, QA: 1, PROD: 2, OTHER: 3 };

/**
 * Sorts an array of users by their role using the predefined priority order.
 *
 * This is a **pure, non-mutating** sort — it returns a new array
 * so callers can safely pass in reference arrays without side effects.
 *
 * @param users — Array of objects with a `role` string property.
 * @returns A new array sorted by role priority. Users with unknown roles
 *          are placed last (under the `OTHER` bucket).
 */
export function sortByRole<T extends { role: string }>(users: T[]): T[] {
  return [...users].sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? ROLE_ORDER.OTHER;
    const rb = ROLE_ORDER[b.role] ?? ROLE_ORDER.OTHER;
    return ra - rb;
  });
}

/** Maps status labels (e.g. "todo") to their canonical sort group. */
const STATUS_GROUP_ORDER: Record<string, number> = { todo: 0, doing: 1, done: 2 };

/**
 * Sorts `[status, count]` tuples into the canonical workflow order:
 * `todo` → `doing` → `done`.
 *
 * The `groups` map translates arbitrary status strings into one of the
 * three canonical groups so that even custom labels (e.g. "in-review")
 * can be bucketed correctly.
 *
 * @param entries — Array of `[statusLabel, count]` tuples.
 * @param groups  — A lookup table mapping status labels to group names.
 * @returns A new array sorted by group, then by original position within
 *          the group (stable sort).
 */
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
 * Resolves a user role to its corresponding hex color.
 *
 * @param role — User role string (e.g. `"DEV"`, `"QA"`, `"PROD"`).
 * @returns The hex color code associated with the role. Falls back to
 *          the `OTHER` color for any unrecognised role.
 */
export function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? ROLE_COLORS.OTHER;
}

/**
 * Extracts the initials from a full name for display inside the avatar circle.
 *
 * - Single-word names → first two characters (uppercased).
 * - Multi-word names  → first letter of the first word + first letter of the
 *   last word (uppercased).
 *
 * @param name — A person's full name.
 * @returns A 1- or 2-character initials string.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Renders a circular avatar with the user's initials, colour-coded by role.
 *
 * On hover (when `onClick` is provided) the avatar dims slightly and shows
 * a tooltip containing the user's full name. The component is designed to
 * be lightweight and self-contained — all styling is inline.
 *
 * @param name — The user's full name; the first letter(s) are used as the
 *               avatar's displayed initials.
 * @param role — A role identifier (`"DEV"`, `"QA"`, `"PROD"`, etc.) that
 *               determines the avatar's background colour.
 * @param size — Diameter of the avatar circle in pixels. Defaults to **28**.
 * @param onClick — Optional click handler. When supplied the avatar becomes
 *                  interactive (pointer cursor + hover dim effect) and the
 *                  name tooltip is shown on hover.
 */
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
