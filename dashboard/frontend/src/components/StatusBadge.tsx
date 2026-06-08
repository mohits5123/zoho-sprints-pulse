/**
 * Props for StatusBadge component
 * @param connected Connection status: null=checking, true=connected, false=disconnected
 */
interface StatusBadgeProps {
  connected: boolean | null;
}

/**
 * Status badge showing connection status with color-coded indicator
 * @param connected Connection status
 * @returns Badge element showing current connection state
 */
export function StatusBadge({ connected }: StatusBadgeProps) {
  if (connected === null) {
    return (
      <span style={styles.badge('#94a3b8')}>
        <span style={styles.dot('#94a3b8')} />
        Checking…
      </span>
    );
  }

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
 * Inline styles factory for StatusBadge component
 * @param color Hex color string (e.g., '#22c55e') for badge styling
 */
const styles = {
  /** Generates badge style with given color */
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
  /** Generates dot style with given color */
  dot: (color: string): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: color,
  }),
};
