import { Clock } from 'lucide-react';
import { C, font } from '../theme';

export function LastSyncedFooter({ lastSyncedAt }: {
  lastSyncedAt: string | null;
}) {
  if (!lastSyncedAt) return null;

  const date = new Date(lastSyncedAt);
  const formatted = date.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

  return (
    <div style={s.footer}>
      <Clock size={14} strokeWidth={1.5} color={C.success} />
      Last synced: {formatted}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  footer: {
    marginTop: 48,
    borderTop: `1px solid ${C.hairline}`,
    fontSize: 12,
    fontWeight: 400,
    fontFamily: font.text,
    color: C.inkSubtle,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '24px 32px',
  },
};
