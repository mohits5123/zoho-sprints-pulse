export function LastSyncedFooter({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  if (!lastSyncedAt) return null;

  const date = new Date(lastSyncedAt);
  const formatted = date.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

  return (
    <div style={s.footer}>
      <span style={s.dot} />
      Last synced: {formatted}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  footer: {
    marginTop: 48,
    paddingTop: 16,
    borderTop: '1px solid #1e293b',
    fontSize: 12,
    color: '#334155',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6, height: 6, borderRadius: '50%',
    backgroundColor: '#22c55e', flexShrink: 0,
  },
};
