import { RefreshCw } from 'lucide-react';
import { useSyncProgress } from '../contexts/SyncProgressContext';
import { C, R, font } from '../theme';

interface SyncButtonProps {
  onClick: () => void;
  label?: string;
  style?: React.CSSProperties;
}

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
        padding: '8px 14px',
        backgroundColor: C.surface1,
        color: syncActive ? C.inkTertiary : C.inkMuted,
        border: `1px solid ${syncActive ? C.hairline : C.hairlineStrong}`,
        borderRadius: R.md,
        fontSize: 14,
        fontWeight: 500,
        fontFamily: font.text,
        cursor: syncActive ? 'not-allowed' : 'pointer',
        transition: 'color 0.15s, border-color 0.15s',
        userSelect: 'none',
        flexShrink: 0,
        ...style,
      }}
    >
      {!syncActive && (
        <RefreshCw size={14} strokeWidth={1.5} color={C.inkMuted} />
      )}
      {syncActive && (
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            border: `2px solid ${C.hairline}`,
            borderTopColor: C.primary,
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
