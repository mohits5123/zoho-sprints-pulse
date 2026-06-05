type Props = {
  connected: boolean | null;
};

export function StatusBadge({ connected }: Props) {
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

const styles = {
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
  dot: (color: string): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: color,
  }),
};
