/**
 * Board page component.
 *
 * Displays a detailed view of a specific project (pod), including:
 * - Project name and board type (scrum/kanban)
 * - Sprint picker for scrum boards with multiple active sprints
 * - Sprint overview card with ticket counts and user breakdown
 * - Sprint progress card showing epic-level progress
 * - Burndown card showing sprint completion progress
 * - User load card (WIP by user)
 * - User completion card (completion % by user)
 * - User stale card (stale tickets by user)
 * - Ticket raiser card (users who raised tickets)
 * - Epic cards with status breakdown (for scrum sprints only)
 *
 * Features:
 * - Auto-selects first sprint for scrum or kanban board
 * - Sprint picker dropdown when multiple active sprints exist
 * - Stale ticket settings modal (per-project, persisted to localStorage)
 * - Click-through to filtered issue list from any card
 * - Empty states for missing data
 *
 * Data flows:
 * - Project and sprint data from local SQLite
 * - Epic data fetched per sprint (only for scrum boards)
 * - Stale config loaded from localStorage (per project)
 * - All navigation uses URL params for filter state
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { fetchProject, fetchSprintEpics, fetchSyncStatus, fetchKanbanStaleCount, fetchPastSprintData, type EpicBreakdown, type Project, type SprintSnapshot } from '../api/client';
import { SprintCard } from '../components/SprintCard';
import { EpicCard } from '../components/EpicCard';
import { SprintProgressCard } from '../components/SprintProgressCard';
import { BurndownCard } from '../components/BurndownCard';
import { UserLoadCard } from '../components/UserLoadCard';
import { UserCompletionCard } from '../components/UserCompletionCard';
import { UserStaleCard } from '../components/UserStaleCard';
import { TicketRaiserCard } from '../components/TicketRaiserCard';
import { LastSyncedFooter } from '../components/LastSyncedFooter';
import { StaleManagerModal, loadStaleConfig, type StaleConfig } from '../components/StaleManagerModal';
import { sortByRole } from '../components/UserAvatar';

/**
 * Builds a synthetic SprintSnapshot for kanban boards.
 * Kanban boards don't have real sprints; they represent the entire board as one sprint.
 *
 * @param project - The kanban project with statusBreakdown and statusGroups
 * @returns A SprintSnapshot object with id='kanban-board'
 */
function buildKanbanSprint(project: Project): SprintSnapshot {
  const breakdown = project.statusBreakdown ? JSON.parse(project.statusBreakdown) as Record<string, number> : {};
  const groups    = project.statusGroups    ? JSON.parse(project.statusGroups)    as Record<string, string>  : {};
  const total     = Object.values(breakdown).reduce((s, n) => s + n, 0);
  return {
    zohoId:          'kanban-board',
    projectZohoId:   project.zohoId,
    projectName:     project.name,
    name:            'Kanban Board',
    status:          'active',
    startDate:       null,
    endDate:         null,
    totalTickets:    total,
    statusBreakdown: project.statusBreakdown,
    rawData:         JSON.stringify({ statusGroups: groups }),
    createdAt:       project.createdAt,
    updatedAt:       project.updatedAt,
  };
}

export function BoardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const sprintIdParam = searchParams.get('sprintId');
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [selectedSprint, setSelectedSprint] = useState<SprintSnapshot | null>(null);
  const [epics, setEpics]         = useState<EpicBreakdown[]>([]);
  const [epicsLoading, setEpicsLoading] = useState(false);
  const [sprintStatusGroups, setSprintStatusGroups] = useState<Record<string, string>>({});
  const [showStaleModal, setShowStaleModal] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [kanbanStaleCount, setKanbanStaleCount] = useState<number | null>(null);

  // Stale config — loaded from localStorage once project is known
  const [staleConfig, setStaleConfig] = useState<StaleConfig>({ days: 7, watchedStates: [] });

  const staleDays     = staleConfig.days;
  const watchedStates = staleConfig.watchedStates;

  // Fetch last synced timestamp on mount
  useEffect(() => {
    fetchSyncStatus().then(({ lastSyncedAt: ts }) => setLastSyncedAt(ts)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectId) return;
    fetchProject(projectId)
      .then(async ({ project: p }) => {
        setProject(p);
        // Load stale config — statusGroups will be refined once epics load, pre-load with empty map
        setStaleConfig(loadStaleConfig(projectId, {}));
        // If a sprintId was passed via query param, use it directly
        if (sprintIdParam) {
          const match = p.activeSprints.find((s) => s.zohoId === sprintIdParam);
          if (match) { setSelectedSprint(match); return; }
          // Not in active sprints — try fetching as a past sprint
          try {
            const { sprint } = await fetchPastSprintData(projectId, sprintIdParam);
            setSelectedSprint(sprint);
            return;
          } catch {
            // Sprint not found — fall through to auto-select
          }
        }
        // Auto-select if there's exactly one sprint (or it's kanban)
        if (p.boardType === 'kanban') {
            setSelectedSprint(buildKanbanSprint(p));
            setSprintStatusGroups(p.statusGroups ? JSON.parse(p.statusGroups) : {});
        } else if (p.activeSprints.length === 1) {
          setSelectedSprint(p.activeSprints[0]);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Fetch stale count for kanban when staleDays or watchedStates changes
  useEffect(() => {
    if (!projectId || !project || project.boardType !== 'kanban') {
      setKanbanStaleCount(null);
      return;
    }
    console.log('🔍 Fetching kanban stale count for project:', projectId, 'with staleDays:', staleDays, 'watchedStates:', watchedStates);
    fetchKanbanStaleCount(projectId, { staleDays: staleDays, watchedStates })
      .then(({ staleCount }) => {
        console.log('✅ Kanban stale count:', staleCount);
        setKanbanStaleCount(staleCount);
      })
      .catch((err) => {
        console.error('❌ Failed to fetch kanban stale count:', err);
      });
  }, [projectId, project?.boardType, staleDays, watchedStates.join(',')]);

  // Fetch epics whenever a scrum sprint is selected, staleDays, or watchedStates changes
  useEffect(() => {
    if (!selectedSprint || !projectId || project?.boardType === 'kanban') {
      setEpics([]);
      return;
    }
    setEpicsLoading(true);
    fetchSprintEpics(projectId, selectedSprint.zohoId, staleDays, watchedStates)
      .then(({ epics: e, statusGroups: sg }) => { setEpics(e); setSprintStatusGroups(sg); })
      .catch((err) => console.error('Epic fetch failed:', err.message))
      .finally(() => setEpicsLoading(false));
  }, [selectedSprint?.zohoId, projectId, project?.boardType, staleDays, watchedStates.join(',')]);

  // Base params shared across all issue navigation calls
  function baseIssueParams(extra: Record<string, string>) {
    return new URLSearchParams(extra);
  }

  const showPicker = project && project.boardType !== 'kanban' && project.activeSprints.length > 1 && !selectedSprint;

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <button style={s.back} onClick={() => navigate('/projects')}>← Back</button>
          <div>
            <h1 style={s.title}>{project?.name ?? '…'}</h1>
            <p style={s.subtitle}>
              {project?.boardType === 'kanban'
                ? 'Kanban board'
                : selectedSprint
                ? selectedSprint.name
                : project
                ? `${project.activeSprints.length} active sprint${project.activeSprints.length !== 1 ? 's' : ''}`
                : ''}
            </p>
          </div>
        </div>

        <div style={s.headerRight}>
           {/* Stale settings button */}
           <button style={s.staleBtn} onClick={() => setShowStaleModal(true)} title="Configure stale ticket settings">
             ⏱ Stale: {staleDays}d
             {watchedStates.length > 0 && (
               <span style={s.staleBtnBadge}> · {watchedStates.length} state{watchedStates.length !== 1 ? 's' : ''}</span>
             )}
             <span style={s.staleBtnIcon}>⚙</span>
           </button>


          {selectedSprint && project?.boardType !== 'kanban' && project?.activeSprints && project.activeSprints.length > 1 && (
            <button style={s.switchBtn} onClick={() => { setSelectedSprint(null); setEpics([]); }}>
              ← Switch sprint
            </button>
          )}
        </div>
      </header>

      {/* Stale manager modal */}
      {showStaleModal && project && (
        <StaleManagerModal
          projectId={projectId!}
          statusGroups={sprintStatusGroups}
          config={staleConfig}
          onSave={(cfg) => { setStaleConfig(cfg); setShowStaleModal(false); }}
          onClose={() => setShowStaleModal(false)}
        />
      )}

      {error   && <p style={s.errorText}>{error}</p>}
      {loading && <p style={s.muted}>Loading…</p>}

      {/* Sprint picker — only when scrum project has multiple active sprints */}
      {showPicker && (
        <div>
          <p style={s.pickerLabel}>Select a sprint to view:</p>
          <div style={s.grid}>
            {project.activeSprints.map((sp) => (
              <button
                key={sp.zohoId}
                style={s.pickerCardBtn}
                onClick={() => setSelectedSprint(sp)}
              >
                <SprintCard sprint={sp} hideProjectName />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Board view */}
      {!loading && selectedSprint && (
        <div style={s.boardWrap}>
          {/* Sprint overview section */}
          <div style={s.section}>
            <div style={s.sectionHeader}>
              <h2 style={s.sectionTitle}>Sprint Overview</h2>
            </div>
            <div style={s.grid}>
                  <SprintCard
                    sprint={selectedSprint}
                    hideProjectName
                    staleCount={project?.boardType === 'kanban' ? (kanbanStaleCount ?? 0) : epics.reduce((sum, e) => sum + e.staleCount, 0)}
                    isKanban={project?.boardType === 'kanban'}
                    onStaleClick={() => {
                      const params = baseIssueParams({
                        stale:      'true',
                        staleDays:  String(staleDays),
                        sprintId:   project?.boardType === 'kanban' ? '' : selectedSprint.zohoId,
                        sprintName: selectedSprint.name,
                      });
                      if (watchedStates.length) params.set('watchedStates', watchedStates.join(','));
                      navigate(`/board/${projectId}/issues?${params}`);
                    }}
                  users={(() => {
                    const seen = new Map<string, { name: string; role: string }>();
                    for (const epic of epics) {
                      for (const u of epic.users) {
                        if (!seen.has(u.id)) seen.set(u.id, { name: u.name, role: u.role });
                      }
                    }
                    const all = Array.from(seen.entries()).map(([id, { name, role }]) => ({ id, name, role }));
                    return sortByRole(all);
                  })()}
                    onUserClick={(userId, userName) => {
                      const params = baseIssueParams({
                        userId,
                        userName,
                        sprintId:   project?.boardType === 'kanban' ? '' : selectedSprint.zohoId,
                        sprintName: selectedSprint.name,
                      });
                      navigate(`/board/${projectId}/issues?${params}`);
                    }}
                    onStatusClick={(status) => {
                      const params = baseIssueParams({
                        status,
                        sprintId:   project?.boardType === 'kanban' ? '' : selectedSprint.zohoId,
                        sprintName: selectedSprint.name,
                      });
                      navigate(`/board/${projectId}/issues?${params}`);
                    }}
                />


                {!epicsLoading && (epics.length > 0 || project?.boardType === 'kanban') && (
                    <SprintProgressCard
                      epics={epics}
                      statusGroups={sprintStatusGroups}
                      onGroupClick={(group) => {
                        const params = baseIssueParams({
                      statusGroup: group,
                      sprintId:   project?.boardType === 'kanban' ? '' : selectedSprint.zohoId,
                    });
                    navigate(`/board/${projectId}/issues?${params}`);
                  }}
                  isKanban={project?.boardType === 'kanban'}
                  statusBreakdown={project?.boardType === 'kanban' ? project.statusBreakdown : null}
                />
                )}



              {!epicsLoading && epics.length > 0 && (() => {
                const doneCount = epics.reduce((sum, e) => {
                  return sum + Object.entries(e.statusBreakdown)
                    .filter(([st]) => e.statusGroups[st] === 'done')
                    .reduce((s, [, n]) => s + n, 0);
                }, 0);
                const totalCount = epics.reduce((sum, e) => sum + e.total, 0);
                return (
                  <BurndownCard
                    sprint={selectedSprint}
                    doneCount={doneCount}
                    totalCount={totalCount}
                  />
                );
              })()}

                <UserLoadCard
                  projectId={projectId!}
                  sprintId={project?.boardType === 'kanban' ? '' : selectedSprint.zohoId}
                  staleDays={staleDays}
                  onUserClick={(userId, userName) => {
                    const params = baseIssueParams({
                      userId,
                      userName,
                      sprintId:   project?.boardType === 'kanban' ? '' : selectedSprint.zohoId,
                      sprintName: selectedSprint.name,
                    });
                    navigate(`/board/${projectId}/issues?${params}`);
                  }}
                  isKanban={project?.boardType === 'kanban'}
                />

                {project?.boardType !== 'kanban' && (
                  <UserCompletionCard
                    projectId={projectId!}
                    sprintId={project?.boardType === 'kanban' ? '' : selectedSprint.zohoId}
                    staleDays={staleDays}
                    onUserClick={(userId, userName) => {
                      const params = baseIssueParams({
                        userId,
                        userName,
                        sprintId:   project?.boardType === 'kanban' ? '' : selectedSprint.zohoId,
                        sprintName: selectedSprint.name,
                      });
                      navigate(`/board/${projectId}/issues?${params}`);
                    }}
                  />
                )}

                <UserStaleCard
                  projectId={projectId!}
                  sprintId={project?.boardType === 'kanban' ? '' : selectedSprint.zohoId}
                  staleDays={staleDays}
                  watchedStates={watchedStates}
                  onUserClick={(userId, userName) => {
                    const params = baseIssueParams({
                      userId,
                      userName,
                      stale:      'true',
                      staleDays:  String(staleDays),
                      sprintId:   project?.boardType === 'kanban' ? '' : selectedSprint.zohoId,
                      sprintName: selectedSprint.name,
                    });
                    navigate(`/board/${projectId}/issues?${params}`);
                  }}
                  onStaleClick={() => {
                    const params = baseIssueParams({
                      stale:      'true',
                      staleDays:  String(staleDays),
                      sprintId:   project?.boardType === 'kanban' ? '' : selectedSprint.zohoId,
                      sprintName: selectedSprint.name,
                    });
                    if (watchedStates.length) params.set('watchedStates', watchedStates.join(','));
                    navigate(`/board/${projectId}/issues?${params}`);
                  }}
                  isKanban={project?.boardType === 'kanban'}
                  style={{ gridColumn: 'span 2' }}
                />

                <TicketRaiserCard
                  projectId={projectId!}
                  sprintId={project?.boardType === 'kanban' ? '' : selectedSprint.zohoId}
                  boardType={project?.boardType === 'kanban' ? 'kanban' as const : 'scrum' as const}
                  onUserClick={(userId, userName) => {
                    const params = baseIssueParams({
                      userId,
                      userName,
                      sprintId:   project?.boardType === 'kanban' ? '' : selectedSprint.zohoId,
                      sprintName: selectedSprint.name,
                      creatorOnly: 'true',
                    });
                    navigate(`/board/${projectId}/issues?${params}`);
                  }}
                />
            </div>
          </div>

          {/* Epics section — only for scrum boards */}
          {project?.boardType !== 'kanban' && (
            <div style={s.section}>
              <div style={s.sectionHeader}>
                <h2 style={s.sectionTitle}>Epics</h2>
                {epicsLoading && <span style={s.sectionMeta}>Loading…</span>}
                {!epicsLoading && <span style={s.sectionMeta}>{epics.length} epic{epics.length !== 1 ? 's' : ''}</span>}
              </div>

              {epicsLoading && (
                <div style={s.loadingCard}>
                  <p style={s.muted}>Loading epics…</p>
                </div>
              )}

              {!epicsLoading && epics.length > 0 && (
                <div style={s.epicGrid}>
                  {[...epics].sort((a, b) => {
                    const pct = (e: typeof a) => {
                      if (e.total === 0) return 0;
                      const done = Object.entries(e.statusBreakdown)
                        .filter(([st]) => e.statusGroups[st] === 'done')
                        .reduce((s, [, n]) => s + n, 0);
                      return done / e.total;
                    };
                    return pct(a) - pct(b);
                  }).map((epic) => (
                    <EpicCard
                      key={epic.id}
                      epic={epic}
                      staleDays={staleDays}
                      onStatusClick={(status) => {
                        const params = baseIssueParams({
                          sprintId:   selectedSprint.zohoId,
                          epicId:     epic.id,
                          status,
                          sprintName: selectedSprint.name,
                          epicName:   epic.name,
                        });
                        navigate(`/board/${projectId}/issues?${params}`);
                      }}
                      onStaleClick={() => {
                        const params = baseIssueParams({
                          sprintId:   selectedSprint.zohoId,
                          epicId:     epic.id,
                          stale:      'true',
                          staleDays:  String(staleDays),
                          sprintName: selectedSprint.name,
                          epicName:   epic.name,
                        });
                        if (watchedStates.length) params.set('watchedStates', watchedStates.join(','));
                        navigate(`/board/${projectId}/issues?${params}`);
                      }}
                      onUserClick={(userId, userName) => {
                        const params = baseIssueParams({
                          sprintId:   selectedSprint.zohoId,
                          epicId:     epic.id,
                          userId,
                          userName,
                          sprintName: selectedSprint.name,
                          epicName:   epic.name,
                        });
                        navigate(`/board/${projectId}/issues?${params}`);
                      }}
                    />
                  ))}
                </div>
              )}

              {!epicsLoading && epics.length === 0 && (
                <p style={s.muted}>No epics found for this sprint.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Scrum with no active sprints */}
      {!loading && project && project.boardType !== 'kanban' && project.activeSprints.length === 0 && (
        <p style={s.muted}>No active sprint found for this project.</p>
      )}
      <LastSyncedFooter lastSyncedAt={lastSyncedAt} />
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
  headerLeft:  { display: 'flex', alignItems: 'center', gap: 20 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 16 },
  staleBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 8, padding: '7px 13px',
    color: '#f59e0b', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', userSelect: 'none' as const,
  },
  staleBtnBadge: { color: '#94a3b8', fontWeight: 400 },
  staleBtnIcon: { color: '#475569', fontSize: 12, marginLeft: 2 },
  back: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 8, padding: '7px 13px',
    color: '#94a3b8', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', userSelect: 'none' as const,
  },
  title:    { margin: 0, fontSize: 28, fontWeight: 700, color: '#f1f5f9' },
  subtitle: { margin: '4px 0 0', fontSize: 14, color: '#64748b' },
  switchBtn: {
    padding: '8px 16px', backgroundColor: 'transparent', color: '#94a3b8',
    border: '1px solid #334155', borderRadius: 8, fontSize: 13, cursor: 'pointer',
  },
  backlogBtn: {
    padding: '8px 16px', backgroundColor: '#1e293b', color: '#e2e8f0',
    border: '1px solid #334155', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', userSelect: 'none' as const,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 20,
  },
  epicGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 16,
  },
  boardWrap: { display: 'flex', flexDirection: 'column', gap: 40 },
  section: { display: 'flex', flexDirection: 'column', gap: 16 },
  sectionHeader: { display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: '1px solid #1e293b', paddingBottom: 12 },
  sectionTitle: { margin: 0, fontSize: 16, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  sectionMeta: { fontSize: 12, color: '#475569' },
  pickerLabel: { color: '#64748b', fontSize: 14, marginBottom: 20 },
  pickerCardBtn: {
    all: 'unset',
    cursor: 'pointer',
    display: 'block',
    borderRadius: 12,
    transition: 'transform 0.1s, box-shadow 0.1s',
  },
  muted: { color: '#64748b', fontSize: 14, margin: 0 },
  errorText: { color: '#fca5a5', fontSize: 14, marginBottom: 16 },
  loadingCard: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 120,
  },
};
