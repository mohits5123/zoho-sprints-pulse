/**
 * Sprints page component.
 *
 * Displays a grid of sprint cards showing active sprint status for all scrum projects.
 * Each card shows sprint name, status, and ticket counts by status group (todo/doing/done).
 *
 * Features:
 * - Grid of SprintCard components, one per active sprint
 * - Sync button to refresh sprint data from Zoho (background poll after sync)
 * - Auto-refresh: polls every 5s after sync until lastSyncedAt changes
 * - Empty state with sync prompt if no sprint data available
 * - Back navigation to dashboard
 * - Hide/unhide sprints (local UI preference, persists across syncs)
 *
 * Data flows:
 * - Sprint data fetched from local SQLite (served by backend)
 * - Sync is fire-and-forget; backend returns immediately, frontend polls for completion
 *
 * @module SprintHealth
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Eye, X } from 'lucide-react';
import { fetchSprints, syncSprints, fetchSyncStatus, fetchPastSprintNames, fetchPastSprintData, fetchProjects, SprintSnapshot, Project, PastSprintName, updateSprintDisplay } from '../api/client';
import { SprintCard } from '../components/SprintCard';
import { SyncButton } from '../components/SyncButton';
import { BackButton } from '../components/BackButton';
import { useSyncProgress } from '../contexts/SyncProgressContext';
import { C, font, R, S } from '../theme';

/**
 * SprintHealth page component.
 *
 * Renders a dashboard view of all sprints across scrum projects, organized into
 * "Active Sprints" and "Past Sprints" sections. Supports syncing from Zoho,
 * loading historical sprint data, and hiding/showing individual sprint cards.
 *
 * State management:
 * - `sprints`: Current sprint data (fetched from backend on mount and after sync)
 * - `lastSyncedAt`: Timestamp of the most recent successful sync, used to detect
 *   when a background sync has completed (polling compares against this value)
 * - `hiddenOpen`: Toggle for the collapsible "Hidden sprints" section
 * - Modal state (`showPastModal`, `selectedProject`, `selectedPastSprints`):
 *   Controls the "Load Past Sprints" modal flow: select project → select sprints → fetch
 *
 * Side effects:
 * - On mount: fetches sprints and sync status; cleans up polling interval on unmount
 * - On sync: starts a 5-second polling loop that checks `lastSyncedAt` to detect
 *   completion of the background sync operation
 */
export function SprintHealth() {
  const navigate = useNavigate();
  const { syncActive, setSyncActive } = useSyncProgress();
  function onSprintClick(projectId: string, sprintZohoId: string) {
    navigate(`/board/${projectId}?sprintId=${sprintZohoId}`);
  }
  const [sprints, setSprints]   = useState<SprintSnapshot[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showPastModal, setShowPastModal] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [pastSprintNames, setPastSprintNames] = useState<PastSprintName[]>([]);
  const [selectedPastSprints, setSelectedPastSprints] = useState<Set<string>>(new Set());
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingPast, setLoadingPast] = useState(false);
  const [fetchingPast, setFetchingPast] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);

  /**
   * Formats a date string for display.
   *
   * @param dateStr - ISO date string to format, or null
   * @returns Human-readable date (e.g. "Jan 15, 2025"), or "No date" if null,
   *          or the raw string if parsing fails
   */
  function formatDate(dateStr: string | null): string {
    if (!dateStr) return 'No date';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Mount: load sprints and sync status; clean up polling interval on unmount.
  useEffect(() => {
    fetchSprints()
      .then((d) => setSprints(d.sprints))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  /**
   * Hides a sprint card in the UI and persists the preference to the backend.
   *
   * Optimistic update: marks the sprint as hidden locally first, then rolls back
   * if the backend call fails.
   *
   * @param id - The Zoho sprint ID to hide
   */
  async function handleHide(id: string) {
    setSprints((prev) => prev.map((sp) => sp.zohoId === id ? { ...sp, hidden: true } : sp));
    await updateSprintDisplay(id, { hidden: true }).catch(() => {
      setSprints((prev) => prev.map((sp) => sp.zohoId === id ? { ...sp, hidden: false } : sp));
    });
  }

  /**
   * Restores a previously hidden sprint card in the UI and persists the change.
   *
   * Optimistic update: marks the sprint as visible locally first, then rolls back
   * if the backend call fails.
   *
   * @param id - The Zoho sprint ID to unhide
   */
  async function handleUnhide(id: string) {
    setSprints((prev) => prev.map((sp) => sp.zohoId === id ? { ...sp, hidden: false } : sp));
    await updateSprintDisplay(id, { hidden: false }).catch(() => {
      setSprints((prev) => prev.map((sp) => sp.zohoId === id ? { ...sp, hidden: true } : sp));
    });
  }

  /**
   * Opens the "Load Past Sprints" modal and loads the list of projects.
   *
   * Resets all modal-related state to a clean initial state before fetching
   * the project list from the backend.
   */
  async function handleLoadPast() {
    setShowPastModal(true);
    setLoadingProjects(true);
    setSelectedProject('');
    setPastSprintNames([]);
    setSelectedPastSprints(new Set());
    try {
      const { projects } = await fetchProjects();
      setProjects(projects);
    } catch {
      setError('Failed to load projects');
    } finally {
      setLoadingProjects(false);
    }
  }

  /**
   * Loads the list of past sprint names for a selected project.
   *
   * Clears any previously selected past sprints when switching projects.
   *
   * @param projectId - The Zoho project ID whose past sprints to load
   */
  async function handleProjectSelect(projectId: string) {
    setSelectedProject(projectId);
    setSelectedPastSprints(new Set());
    setLoadingPast(true);
    try {
      const { sprints } = await fetchPastSprintNames(projectId);
      setPastSprintNames(sprints);
    } catch {
      setError('Failed to load past sprints');
      setPastSprintNames([]);
    } finally {
      setLoadingPast(false);
    }
  }

  /**
   * Toggles the selection of a past sprint in the modal.
   *
   * Uses functional state update to create a new Set, ensuring React
   * detects the state change immutably.
   *
   * @param zohoId - The Zoho sprint ID to toggle
   */
  function togglePastSprint(zohoId: string) {
    setSelectedPastSprints(prev => {
      const next = new Set(prev);
      if (next.has(zohoId)) {
        next.delete(zohoId);
      } else {
        next.add(zohoId);
      }
      return next;
    });
  }

  /**
   * Fetches historical data for all selected past sprints, then refreshes the
   * main sprint list and closes the modal.
   *
   * Iterates over selected sprint IDs sequentially (not in parallel) to avoid
   * overwhelming the backend. After all fetches complete, re-fetches the full
   * sprint list so the dashboard reflects the newly loaded data.
   */
  async function handleFetchSelected() {
    if (selectedPastSprints.size === 0) return;
    setFetchingPast(true);
    try {
      for (const sprintZohoId of selectedPastSprints) {
        await fetchPastSprintData(selectedProject, sprintZohoId);
      }
      const updated = await fetchSprints();
      setSprints(updated.sprints);
      setShowPastModal(false);
      setSelectedProject('');
      setPastSprintNames([]);
      setSelectedPastSprints(new Set());
    } catch {
      setError('Failed to fetch past sprints');
    } finally {
      setFetchingPast(false);
    }
  }

  /**
   * Initiates a full sync of sprint data from Zoho.
   *
   * Sync flow:
   * 1. Calls `syncSprints()` which returns immediately (fire-and-forget)
   * 2. Starts polling `fetchSyncStatus()` every 5 seconds
   * 3. Compares the returned `lastSyncedAt` against the value captured before sync;
   *    when it changes, the sync is considered complete
   * 4. Re-fetches the full sprint list and updates UI state
   *
   * The polling interval is stored in `pollRef` so it can be cleared on unmount.
   *
   * @param err.message - Error detail on failure, or a generic message if the error
   *                      is not an `Error` instance
   */
  async function handleSync() {
    setError(null);
    setSyncActive(true);
    try {
      await syncSprints();
      pollRef.current = setInterval(async () => {
        try {
          await fetchSyncStatus();
          const updated = await fetchSprints();
          setSprints(updated.sprints);
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setSyncActive(false);
        } catch { /* keep polling */ }
      }, 5_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      setSyncActive(false);
    }
  }

  // Categorize sprints for rendering: visible vs. hidden, active vs. past.
  const visibleSprints = sprints.filter(sp => !sp.hidden);
  const hiddenSprints = sprints.filter(sp => sp.hidden);
  const activeSprints = visibleSprints.filter(sp => sp.status === 'active');
  const pastSprints = visibleSprints.filter(sp => sp.status !== 'active');

  const visibleCount = visibleSprints.length;

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <BackButton />
          <div>
            <h1 style={s.title}>Sprints</h1>
            <p style={s.subtitle}>
              {visibleCount > 0
                ? `${visibleCount} visible sprint${visibleCount !== 1 ? 's' : ''}${hiddenSprints.length > 0 ? ` · ${hiddenSprints.length} hidden` : ''}`
                : 'Current sprint status for all scrum projects'}
            </p>
          </div>
        </div>
        <div style={s.headerActions}>
          <button style={s.pastBtn} onClick={handleLoadPast} disabled={loading || syncActive}>
            Load Past Sprints
          </button>
          <SyncButton onClick={handleSync} />
        </div>
      </header>

      {error && <p style={s.errorText}>{error}</p>}
      {loading && <p style={s.muted}>Loading sprint data…</p>}

      {!loading && sprints.length === 0 && !syncActive && (
        <div style={s.empty}>
          <p style={s.emptyTitle}>No sprint data yet</p>
          <p style={s.muted}>Make sure your Zoho credentials are set in ~/.zshrc, then click <strong>Sync</strong>.</p>
          <SyncButton onClick={handleSync} label="Sync" style={{ marginTop: S.xs, padding: `${S.sm}px ${S.xxl}px`, fontSize: 15, fontWeight: 600 }} />
        </div>
      )}

      {!loading && sprints.length > 0 && (
        <>
          {activeSprints.length > 0 && (
            <>
              <div style={s.sectionHeader}>Active Sprints</div>
              <div style={s.grid}>
                {activeSprints.map((sp) => (
                  <SprintCard
                    key={sp.zohoId}
                    sprint={sp}
                    onSprintClick={() => onSprintClick(sp.projectZohoId, sp.zohoId)}
                    onHide={() => handleHide(sp.zohoId)}
                  />
                ))}
              </div>
            </>
          )}
          {activeSprints.length > 0 && pastSprints.length > 0 && (
            <hr style={s.divider} />
          )}
          {pastSprints.length > 0 && (
            <>
              <div style={s.sectionHeader}>Past Sprints</div>
              <div style={s.grid}>
                {pastSprints.map((sp) => (
                  <SprintCard
                    key={sp.zohoId}
                    sprint={sp}
                    onSprintClick={() => onSprintClick(sp.projectZohoId, sp.zohoId)}
                    onHide={() => handleHide(sp.zohoId)}
                  />
                ))}
              </div>
            </>
          )}
          {hiddenSprints.length > 0 && (
            <>
              <hr style={s.divider} />
              <div style={s.hiddenSection}>
                <button style={s.hiddenToggle} onClick={() => setHiddenOpen((o) => !o)}>
                  {hiddenOpen ? <ChevronDown size={14} strokeWidth={1.5} color={C.inkTertiary} style={{ verticalAlign: 'middle' }} /> : <ChevronRight size={14} strokeWidth={1.5} color={C.inkTertiary} style={{ verticalAlign: 'middle' }} />} Hidden sprints ({hiddenSprints.length})
                </button>
                {hiddenOpen && (
                  <div style={s.grid}>
                    {hiddenSprints.map((sp) => (
                      <div key={sp.zohoId} style={s.hiddenCard}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                          <div style={{ ...s.avatarSm, backgroundColor: avatarColor(sp.name) }}>
                            {initials(sp.name)}
                          </div>
                          <span style={s.hiddenName}>{sp.name}</span>
                        </div>
                        <button style={s.unhideBtn} onClick={() => handleUnhide(sp.zohoId)}>
                          <Eye size={12} strokeWidth={1.5} color={C.inkMuted} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                          Show
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
      {showPastModal && (
        <div style={s.modalOverlay} onClick={() => setShowPastModal(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>Load Past Sprints</h2>
              <button style={s.modalClose} onClick={() => setShowPastModal(false)}>
                <X size={20} strokeWidth={1.5} color={C.inkSubtle} />
              </button>
            </div>

            {!selectedProject && (
              <div style={s.modalBody}>
                <p style={s.muted}>Select a project to fetch its past sprints:</p>
                {loadingProjects && <p style={s.muted}>Loading projects…</p>}
                {!loadingProjects && projects.length === 0 && (
                  <p style={s.muted}>No projects found.</p>
                )}
                <div style={s.projectList}>
                  {projects.map((p) => (
                    <button
                      key={p.zohoId}
                      style={s.projectBtn}
                      onClick={() => handleProjectSelect(p.zohoId)}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedProject && (
              <div style={s.modalBody}>
                <button style={s.backBtn} onClick={() => { setSelectedProject(''); setPastSprintNames([]); setSelectedPastSprints(new Set()); }}>
                  Back to projects
                </button>
                {loadingPast && <p style={s.muted}>Loading past sprints…</p>}
                {!loadingPast && pastSprintNames.length === 0 && (
                  <p style={s.muted}>No past sprints found for this project.</p>
                )}
                {!loadingPast && pastSprintNames.length > 0 && (
                  <>
                    <p style={s.muted}>Select sprints to load:</p>
                    <div style={s.sprintList}>
                      {pastSprintNames.map((sp) => (
                        <label key={sp.zohoId} style={s.sprintCheck}>
                          <input
                            type="checkbox"
                            checked={selectedPastSprints.has(sp.zohoId)}
                            onChange={() => togglePastSprint(sp.zohoId)}
                          />
                          <span style={s.sprintName}>{sp.name}</span>
                          <span style={s.sprintMeta}>{formatDate(sp.startDate)} - {formatDate(sp.endDate)}</span>
                        </label>
                      ))}
                    </div>
                    <div style={s.modalActions}>
                      <button
                        style={s.confirmBtn}
                        onClick={handleFetchSelected}
                        disabled={selectedPastSprints.size === 0 || fetchingPast}
                      >
                        {fetchingPast ? 'Loading…' : `Load ${selectedPastSprints.size} sprint${selectedPastSprints.size !== 1 ? 's' : ''}`}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Computes a deterministic background color for a sprint avatar based on its name.
 *
 * Uses a simple hash of the name characters to pick from a fixed palette of
 * 8 colors. Same name always produces the same color, enabling visual consistency
 * across renders.
 *
 * @param name - The sprint name to hash
 * @returns A hex color string from the palette
 */
function avatarColor(name: string): string {
  const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', C.success, '#06b6d4', '#ef4444', '#6366f1'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Extracts the first two initials from a sprint name.
 *
 * Splits the name on whitespace, takes the first character of each word,
 * takes the first two characters, and uppercases them.
 *
 * @param name - The sprint name (e.g. "Sprint One" → "SO")
 * @returns Uppercase initials string (e.g. "SO")
 */
function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Inline style definitions for the SprintHealth page.
 *
 * Uses a flat object keyed by semantic name (e.g. "page", "header", "grid")
 * with values typed as React.CSSProperties for type-safe inline styles.
 */
const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: C.canvas,
    color: C.inkMuted,
    fontFamily: font.text,
    padding: `0 ${S.xxl}px ${S.section}px`,
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `${S.xxl}px 0 ${S.xxl + S.lg}px`, borderBottom: `1px solid ${C.hairline}`, marginBottom: S.xxl,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: S.lg },
  headerActions: { display: 'flex', alignItems: 'center', gap: S.md },
  title:    { margin: 0, fontSize: 28, fontWeight: 600, color: C.inkMuted, fontFamily: font.display, letterSpacing: '-0.6px' },
  subtitle: { margin: '4px 0 0', fontSize: 14, color: C.inkSubtle },
  pastBtn: {
    padding: `${R.md}px 20px`, backgroundColor: C.surface1, color: C.inkMuted,
    border: `1px solid ${C.hairline}`, borderRadius: R.md, fontSize: 14, fontWeight: 500, cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: S.lg,
  },
  empty: {
    maxWidth: 480, margin: '80px auto 0', textAlign: 'center' as const,
    display: 'flex', flexDirection: 'column', gap: S.sm, alignItems: 'center',
  },
  emptyTitle: { fontSize: 18, fontWeight: 600, color: C.inkMuted, margin: 0 },
  muted: { color: C.inkTertiary, fontSize: 14, margin: 0 },
  errorText: { color: C.danger, fontSize: 14, marginBottom: S.md },
  sectionHeader: { fontSize: 18, fontWeight: 600, color: C.inkSubtle, marginTop: S.xxl, marginBottom: S.md },
  divider: { border: 'none', borderTop: `1px solid ${C.hairline}`, margin: `${S.xxl}px 0` },
  hiddenSection: { marginTop: S.xxl },
  hiddenToggle: {
    backgroundColor: 'transparent', border: 'none',
    color: C.inkTertiary, fontSize: 14, fontWeight: 600, cursor: 'pointer',
    padding: `${R.md}px 0`,
  },
  hiddenCard: {
    backgroundColor: C.surface1, border: `1px solid ${C.hairline}`,
    borderRadius: R.lg, padding: `14px 18px`,
    display: 'flex', alignItems: 'center', gap: S.md,
  },
  avatarSm: {
    width: 32, height: 32, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700, color: C.canvas, flexShrink: 0,
  },
  hiddenName: { color: C.inkSubtle, fontSize: 13, fontWeight: 500 },
  unhideBtn: {
    padding: '5px 14px', backgroundColor: C.primary, color: C.inkMuted,
    border: 'none', borderRadius: R.sm, fontSize: 12, fontWeight: 500, cursor: 'pointer',
  },
  modalOverlay: {
    position: 'fixed', inset: 0, backgroundColor: `rgba(0,0,0,0.6)`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: C.surface1, borderRadius: R.lg, padding: S.lg,
    minWidth: 400, maxWidth: 560, maxHeight: '80vh',
    overflow: 'auto', border: `1px solid ${C.hairline}`,
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: S.lg,
  },
  modalTitle: { margin: 0, fontSize: 20, fontWeight: 600, color: C.inkMuted, fontFamily: font.display, letterSpacing: '-0.2px' },
  modalClose: {
    backgroundColor: 'transparent', border: 'none', color: C.inkSubtle,
    fontSize: 24, cursor: 'pointer', lineHeight: 1, padding: `0 ${R.xs}px`,
  },
  modalBody: { display: 'flex', flexDirection: 'column', gap: S.sm },
  projectList: { display: 'flex', flexDirection: 'column', gap: R.md, marginTop: R.md },
  projectBtn: {
    padding: `10px ${S.md}px`, backgroundColor: C.canvas, border: `1px solid ${C.hairlineStrong}`,
    borderRadius: R.md, color: C.inkMuted, fontSize: 14, cursor: 'pointer',
    textAlign: 'left' as const,
  },
  sprintList: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: R.md, maxHeight: 300, overflow: 'auto' },
  sprintCheck: {
    display: 'flex', alignItems: 'center', gap: 10, padding: `${R.md} 10px`,
    backgroundColor: C.canvas, borderRadius: R.sm, cursor: 'pointer',
  },
  sprintName: { color: C.inkMuted, fontSize: 14, fontWeight: 500, flex: 1 },
  sprintMeta: { color: C.inkTertiary, fontSize: 12 },
  modalActions: { marginTop: S.md, display: 'flex', justifyContent: 'flex-end' },
  confirmBtn: {
    padding: `10px ${S.lg}px`, backgroundColor: C.primary, color: C.inkMuted,
    border: 'none', borderRadius: R.md, fontSize: 14, fontWeight: 500, cursor: 'pointer',
  },
  backBtn: {
    backgroundColor: 'transparent', border: 'none', color: C.inkSubtle,
    fontSize: 13, cursor: 'pointer', padding: '4px 0', marginBottom: R.md,
  },
};
