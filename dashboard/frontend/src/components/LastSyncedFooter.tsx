/**
 * Footer component displaying the last synchronization timestamp
 * Shows the formatted date/time when data was last synchronized from Zoho Sprints
 * Only renders when a lastSyncedAt value exists
 */
export function LastSyncedFooter({ lastSyncedAt }: {
  /** ISO datetime string of the last sync (or null if never synced) */
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
      <span style={s.dot} />
      Last synced: {formatted}
    </div>
  );
}

/**
 * Inline styles for LastSyncedFooter component
 * Configures the visual appearance of the sync timestamp footer
 */
const s: Record<string, React.CSSProperties> = {
  /** Footer container styled with top border and flex layout */
  footer: {
    marginTop: 48,              // Spacing from main content above
    paddingTop: 16,            // Internal padding
    borderTop: '1px solid #1e293b',  // Dark separator line
    fontSize: 12,               // Small text for footer info
    color: '#334155',           // Muted gray color
    display: 'flex',            // Horizontal layout
    alignItems: 'center',       // Vertically align dot and text
    gap: 6,                     // Spacing between dot and text
  },
  /** Green dot indicator showing sync status is current */
  dot: {
    width: 6, height: 6, borderRadius: '50%',
    backgroundColor: '#22c55e', flexShrink: 0,
  },
};
