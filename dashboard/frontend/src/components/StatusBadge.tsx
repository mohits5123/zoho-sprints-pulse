import { Wifi, WifiOff, Loader } from 'lucide-react';
import { C, R, font } from '../theme';

interface StatusBadgeProps {
  connected: boolean | null;
}

export function StatusBadge({ connected }: StatusBadgeProps) {
  if (connected === null) {
    return (
      <span style={styles.badge(C.inkSubtle)}>
        <Loader size={12} strokeWidth={1.5} color={C.inkSubtle} style={{ animation: 'syncSpin 1s linear infinite' }} />
        Checking…
      </span>
    );
  }

  return connected ? (
    <span style={styles.badge(C.success)}>
      <Wifi size={12} strokeWidth={1.5} color={C.success} />
      Connected
    </span>
  ) : (
    <span style={styles.badge('#ef4444')}>
      <WifiOff size={12} strokeWidth={1.5} color={'#ef4444'} />
      Connection failed
    </span>
  );
}

const styles = {
  badge: (color: string): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 8px',
    borderRadius: R.pill,
    backgroundColor: `${color}22`,
    color,
    fontSize: 12,
    fontWeight: 400,
    fontFamily: font.text,
    border: `1px solid ${color}44`,
  }),

  dot: (color: string): React.CSSProperties => ({
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: color,
  }),
};
