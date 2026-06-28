/**
 * StatusBadge
 *
 * Renders a small, color-coded badge that reflects the current connection
 * state of the application. The badge shows a circular indicator dot beside
 * a short label:
 *
 *   • null → "Checking…"  (slate   #94a3b8)
 *   • true → "Connected"  (green   #22c55e)
 *   • false→ "Connection failed" (red #ef4444)
 *
 * @module StatusBadge
 */

/** Props accepted by {@link StatusBadge}. */
interface StatusBadgeProps {
  /**
   * The current connection status.
   *
   * - `null` — the status is still being determined (spinner / "Checking" state).
   * - `true` — a successful connection has been established.
   * - `false`— the connection attempt has failed.
   */
  connected: boolean | null;
}

/**
 * Renders a color-coded badge reflecting the current connection status.
 *
 * Three visual states are supported:
 *
 * | `connected` | Label                | Color  |
 * |-------------|----------------------|--------|
 * | `null`      | "Checking…"          | Slate  |
 * | `true`      | "Connected"          | Green  |
 * | `false`     | "Connection failed"  | Red    |
 *
 * @param props - Component props (see {@link StatusBadgeProps}).
 * @returns A `<span>` element representing the connection badge.
 */
export function StatusBadge({ connected }: StatusBadgeProps) {
  // Indeterminate state — still determining connection status.
  if (connected === null) {
    return (
      <span style={styles.badge('#94a3b8')}>
        <span style={styles.dot('#94a3b8')} />
        Checking…
      </span>
    );
  }

  // Connected or disconnected — render the appropriate color scheme.
  return connected ? (
    <span style={styles.badge('#22c55e')}>
      <span style={styles.dot('#22c55e')} />
      Connected
    </span>
  ) : (
    <span style={styles.badge('#ef4444')}>
      <span style={styles.dot('#ef4444')} />
      Connection failed
    </span>
  );
}

/**
 * Inline-style factory that produces styled objects for the badge and its
 * indicator dot.
 *
 * Each method takes a hex color string (e.g. `'#22c55e'`) and returns a
 * `React.CSSProperties` object. The alpha channel is derived by appending
 * `"22"` (≈13 % opacity) for the background and `"44"` (≈27 % opacity) for
 * the border, keeping the design consistent across all three states.
 */
const styles = {
  /**
   * Returns the style object for the outer badge wrapper.
   *
   * Produces a pill-shaped container (`borderRadius: 999`) with a subtle
   * translucent background, a thin semi-transparent border, and the given
   * text color.
   *
   * @param color - Hex color string used for the text, border, and background tint.
   * @returns Style object for the badge container.
   */
  badge: (color: string): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    borderRadius: 999,
    backgroundColor: `${color}22`,
    color,
    fontSize: 13,
    fontWeight: 600,
    border: `1px solid ${color}44`,
  }),

  /**
   * Returns the style object for the small circular indicator dot.
   *
   * @param color - Hex color string applied as the dot's background fill.
   * @returns Style object for the indicator dot.
   */
  dot: (color: string): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: color,
  }),
};
