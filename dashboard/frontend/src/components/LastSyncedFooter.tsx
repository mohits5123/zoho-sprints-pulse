/**
 * Footer component displaying the last synchronization timestamp.
 *
 * Renders a small indicator with a green dot and the formatted date/time
 * when data was last synchronized from Zoho Sprints. If no sync has
 * occurred (`lastSyncedAt` is null or falsy), the component renders
 * nothing (returns `null`).
 *
 * @param lastSyncedAt — ISO 8601 datetime string of the most recent sync.
 *   A value of `null` or any falsy value means the dashboard has never
 *   synced, and the footer will not be displayed.
 */
export function LastSyncedFooter({ lastSyncedAt }: {
  /** ISO 8601 datetime string of the last sync (null when never synced) */
  lastSyncedAt: string | null;
}) {
  if (!lastSyncedAt) return null;

  // Parse the ISO string into a Date and format it for Indian English
  // locale (en-IN) so the timestamp is readable in the user's region.
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
 * Inline styles for the LastSyncedFooter component.
 *
 * Defines the visual appearance of the sync-status footer bar,
 * including a green status dot and muted gray timestamp text.
 *
 * All values are kept as inline styles to avoid any external CSS
 * dependency for this small, self-contained component.
 */
const s: Record<string, React.CSSProperties> = {
  /**
   * Footer container — a flex row with a top border separator.
   *
   * Pushed below the main content by `marginTop: 48` and styled with
   * a muted color and small font to keep the footer visually unobtrusive.
   */
  footer: {
    marginTop: 48,
    paddingTop: 16,
    borderTop: '1px solid #1e293b',
    fontSize: 12,
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '16px 24px',
  },

  /**
   * Small green dot that signals an active / current sync state.
   *
   * Sized at 6×6 px with a circular border-radius; `flexShrink: 0`
   * ensures it never collapses in narrow layouts.
   */
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: '#22c55e',
    flexShrink: 0,
  },
};
