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
 *
 * Data flows:
 * - Sprint data fetched from local SQLite (served by backend)
 * - Sync is fire-and-forget; backend returns immediately, frontend polls for completion
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSprints, syncSprints, fetchSyncStatus, fetchPastSprintNames, fetchPastSprintData, fetchProjects, SprintSnapshot, Project, PastSprintName } from '../api/client';
import { SprintCard } from '../components/SprintCard';
import { LastSyncedFooter } from '../components/LastSyncedFooter';

export function SprintHealth() {
  const navigate = useNavigate();
  function onSprintClick(projectId: string, sprintZohoId: string) {
    navigate(`/board/${projectId}?sprintId=${sprintZohoId}`);
  }
  const [sprints, setSprints]   = useState<SprintSnapshot[]>([]);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showPastModal, setShowPastModal] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [pastSprintNames, setPastSprintNames] = useState<PastSprintName[]>([]);
  const [selectedPastSprints, setSelectedPastSprints] = useState<Set<string>>(new Set());
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingPast, setLoadingPast] = useState(false);
  const [fetchingPast, setFetchingPast] = useState(false);

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return 'No date';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  useEffect(() => {
    fetchSprints()
      .then((d) => setSprints(d.sprints))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    fetchSyncStatus().then(({ lastSyncedAt: ts }) => setLastSyncedAt(ts)).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

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

  async function handleSync() {
    setSyncing(true);
    setError(null);
    const prevSyncedAt = lastSyncedAt;
    try {
      // Sync starts in background on server — returns immediately
      await syncSprints();
      // Poll every 5s until lastSyncedAt changes, then re-fetch sprints
      pollRef.current = setInterval(async () => {
        try {
          const { lastSyncedAt: ts } = await fetchSyncStatus();
          if (ts && ts !== prevSyncedAt) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            const updated = await fetchSprints();
            setSprints(updated.sprints);
            setLastSyncedAt(ts);
            setSyncing(false);
          }
        } catch { /* keep polling */ }
      }, 5_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      setSyncing(false);
    }
  }

  const activeSprints = sprints.filter(sp => sp.status === 'active');
  const pastSprints = sprints.filter(sp => sp.status !== 'active');

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <button style={s.back} onClick={() => navigate('/')}>← Back</button>
          <div>
            <h1 style={s.title}>🏃 Sprints</h1>
            <p style={s.subtitle}>
              {sprints.length > 0
                ? `${sprints.length} scrum project${sprints.length !== 1 ? 's' : ''} · latest sprint data`
                : 'Current sprint status for all scrum projects'}
            </p>
          </div>
        </div>
        <div style={s.headerActions}>
          <button style={s.pastBtn} onClick={handleLoadPast} disabled={loading || syncing}>
            Load Past Sprints
          </button>
          <button style={s.syncBtn} onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing… (background)' : 'Sync'}
          </button>
        </div>
      </header>

      {error && <p style={s.errorText}>{error}</p>}
      {loading && <p style={s.muted}>Loading sprint data…</p>}

      {!loading && sprints.length === 0 && !syncing && (
        <div style={s.empty}>
          <p style={s.emptyTitle}>No sprint data yet</p>
          <p style={s.muted}>Make sure your Zoho credentials are set in ~/.zshrc, then click <strong>Sync</strong>.</p>
          <button style={s.syncBtnLarge} onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
        </div>
      )}

      {!loading && sprints.length > 0 && (
        <>
          {activeSprints.length > 0 && (
            <>
              <div style={s.sectionHeader}>Active Sprints</div>
              <div style={s.grid}>
                {activeSprints.map((sp) => <SprintCard key={sp.zohoId} sprint={sp} onSprintClick={() => onSprintClick(sp.projectZohoId, sp.zohoId)} />)}
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
                {pastSprints.map((sp) => <SprintCard key={sp.zohoId} sprint={sp} onSprintClick={() => onSprintClick(sp.projectZohoId, sp.zohoId)} />)}
              </div>
            </>
          )}
        </>
      )}
      <LastSyncedFooter lastSyncedAt={lastSyncedAt} />

      {showPastModal && (
        <div style={s.modalOverlay} onClick={() => setShowPastModal(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>Load Past Sprints</h2>
              <button style={s.modalClose} onClick={() => setShowPastModal(false)}>×</button>
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
                  ← Back to projects
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
                          <span style={s.sprintMeta}>{formatDate(sp.startDate)} → {formatDate(sp.endDate)}</span>
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

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '0 24px 48px',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '32px 0 40px', borderBottom: '1px solid #1e293b', marginBottom: 32,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 20 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 12 },
  back: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 8, padding: '7px 13px',
    color: '#94a3b8', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', userSelect: 'none' as const,
  },
  title:    { margin: 0, fontSize: 28, fontWeight: 700, color: '#f1f5f9' },
  subtitle: { margin: '4px 0 0', fontSize: 14, color: '#64748b' },
  syncBtn: {
    padding: '8px 20px', backgroundColor: '#3b82f6', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  pastBtn: {
    padding: '8px 20px', backgroundColor: '#1e293b', color: '#94a3b8',
    border: '1px solid #334155', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 20,
  },
  empty: {
    maxWidth: 480, margin: '80px auto 0', textAlign: 'center' as const,
    display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center',
  },
  emptyTitle: { fontSize: 18, fontWeight: 600, color: '#e2e8f0', margin: 0 },
  syncBtnLarge: {
    marginTop: 8, padding: '12px 32px', backgroundColor: '#3b82f6',
    color: '#fff', border: 'none', borderRadius: 8,
    fontSize: 15, fontWeight: 600, cursor: 'pointer',
  },
  muted: { color: '#64748b', fontSize: 14, margin: 0 },
  errorText: { color: '#fca5a5', fontSize: 14, marginBottom: 16 },
  sectionHeader: { fontSize: 18, fontWeight: 600, color: '#94a3b8', marginTop: 32, marginBottom: 16 },
  divider: { border: 'none', borderTop: '1px solid #1e293b', margin: '32px 0', },
  modalOverlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#1e293b', borderRadius: 12, padding: 24,
    minWidth: 400, maxWidth: 560, maxHeight: '80vh',
    overflow: 'auto', border: '1px solid #334155',
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: { margin: 0, fontSize: 20, fontWeight: 700, color: '#f1f5f9' },
  modalClose: {
    backgroundColor: 'transparent', border: 'none', color: '#94a3b8',
    fontSize: 24, cursor: 'pointer', lineHeight: 1, padding: '0 4px',
  },
  modalBody: { display: 'flex', flexDirection: 'column', gap: 12 },
  projectList: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 },
  projectBtn: {
    padding: '10px 16px', backgroundColor: '#0f172a', border: '1px solid #334155',
    borderRadius: 8, color: '#e2e8f0', fontSize: 14, cursor: 'pointer',
    textAlign: 'left' as const,
  },
  sprintList: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, maxHeight: 300, overflow: 'auto' },
  sprintCheck: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
    backgroundColor: '#0f172a', borderRadius: 6, cursor: 'pointer',
  },
  sprintName: { color: '#e2e8f0', fontSize: 14, fontWeight: 500, flex: 1 },
  sprintMeta: { color: '#64748b', fontSize: 12 },
  modalActions: { marginTop: 16, display: 'flex', justifyContent: 'flex-end' },
  confirmBtn: {
    padding: '10px 24px', backgroundColor: '#3b82f6', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  backBtn: {
    backgroundColor: 'transparent', border: 'none', color: '#94a3b8',
    fontSize: 13, cursor: 'pointer', padding: '4px 0', marginBottom: 8,
  },
};
