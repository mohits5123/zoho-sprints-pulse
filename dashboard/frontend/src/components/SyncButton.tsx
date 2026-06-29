import { useSyncProgress } from '../contexts/SyncProgressContext';

interface SyncButtonProps {
  onClick: () => void;
  /** Button label shown when idle. Defaults to "Sync". */
  label?: string;
  style?: React.CSSProperties;
}

/**
 * Shared sync button used across all pages.
 *
 * Reads `syncActive` from `SyncProgressContext` so the disabled / syncing
 * state is automatically shared across every page — clicking sync on one
 * page disables the button everywhere until the operation completes.
 *
 * Visual behaviour:
 * - Idle:    outline button with the provided label.
 * - Syncing: spinning indicator + "Syncing…" label, button disabled.
 *   The `syncSpin` CSS animation must be defined in the app's global stylesheet.
 */
export function SyncButton({ onClick, label = 'Sync', style }: SyncButtonProps) {
  const { syncActive } = useSyncProgress();

  return (
    <button
      onClick={onClick}
      disabled={syncActive}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '8px 18px',
        backgroundColor: 'transparent',
        color: syncActive ? '#475569' : '#94a3b8',
        border: `1px solid ${syncActive ? '#1e293b' : '#334155'}`,
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 500,
        cursor: syncActive ? 'not-allowed' : 'pointer',
        transition: 'color 0.15s, border-color 0.15s',
        userSelect: 'none',
        flexShrink: 0,
        ...style,
      }}
    >
      {syncActive && (
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            border: '2px solid #334155',
            borderTopColor: '#3b82f6',
            borderRadius: '50%',
            animation: 'syncSpin 0.7s linear infinite',
            flexShrink: 0,
          }}
        />
      )}
      {syncActive ? 'Syncing…' : label}
    </button>
  );
}
