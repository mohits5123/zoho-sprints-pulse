import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchProjects, syncProjects, updateProjectBoardType,
  updateProjectDisplay, reorderProjects, fetchSyncStatus, Project,
} from '../api/client';
import { LastSyncedFooter } from '../components/LastSyncedFooter';

const BOARD_TYPES = ['scrum', 'kanban', 'other'] as const;
type BoardType = (typeof BOARD_TYPES)[number];

const BOARD_TYPE_COLORS: Record<BoardType, string> = {
  scrum:  '#3b82f6',
  kanban: '#10b981',
  other:  '#64748b',
};


function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function avatarColor(name: string) {
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#3b82f6', '#10b981'];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

const GROUP_COLORS = { todo: '#64748b', doing: '#3b82f6', done: '#22c55e' };

function sprintGroupCounts(sp: { statusBreakdown: string | null; rawData: string | null }) {
  const counts = { todo: 0, doing: 0, done: 0 };
  try {
    const breakdown: Record<string, number> = JSON.parse(sp.statusBreakdown ?? '{}');
    const raw = JSON.parse(sp.rawData ?? '{}');
    const groups: Record<string, 'todo' | 'doing' | 'done'> = raw.statusGroups ?? {};
    for (const [status, count] of Object.entries(breakdown)) {
      const g = groups[status] ?? 'todo';
      counts[g] += count as number;
    }
  } catch { /* return zeros on parse error */ }
  return counts;
}

function kanbanGroupCounts(project: Project) {
  const counts = { todo: 0, doing: 0, done: 0 };
  try {
    const breakdown: Record<string, number> = JSON.parse(project.statusBreakdown ?? '{}');
    const groups: Record<string, 'todo' | 'doing' | 'done'> = JSON.parse(project.statusGroups ?? '{}');
    for (const [status, count] of Object.entries(breakdown)) {
      const g = groups[status] ?? 'todo';
      counts[g] += count as number;
    }
  } catch { /* return zeros on parse error */ }
  return counts;
}

function ProjectCard({
  project, isDragging, isDropTarget, onBoardTypeChange, onHide, onNavigate,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  project: Project;
  isDragging: boolean;
  isDropTarget: boolean;
  onBoardTypeChange: (id: string, bt: string) => void;
  onHide: (id: string) => void;
  onNavigate: (id: string, sprintId?: string) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const bg = avatarColor(project.name);
  const [boardType, setBoardType] = useState<string>(project.boardType ?? 'scrum');
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  async function handleBoardTypeChange(val: string) {
    const prev = boardType;
    setBoardType(val);
    setSaving(true);
    try {
      await updateProjectBoardType(project.id, val);
      onBoardTypeChange(project.id, val);
    } catch {
      setBoardType(prev);
    } finally {
      setSaving(false);
    }
  }

  const btColor = BOARD_TYPE_COLORS[(boardType as BoardType)] ?? '#64748b';
  const isMultiSprint = boardType !== 'kanban' && project.activeSprints && project.activeSprints.length > 1;
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        ...s.card,
        opacity: isDragging ? 0.4 : 1,
        outline: isDropTarget ? '2px dashed #3b82f6' : 'none',
        cursor: 'default',
      }}
    >
      <div style={s.cardTop}>
        {/* Avatar — not clickable */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <div style={{ ...s.avatar, backgroundColor: bg }}>
            {project.prefix ?? initials(project.name)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Drag handle */}
          <span
            draggable
            onDragStart={onDragStart}
            onMouseEnter={() => setHoveredRow('drag')}
            onMouseLeave={() => setHoveredRow(null)}
            style={{
              ...s.dragHandle,
              ...(hoveredRow === 'drag' ? s.iconBtnHover : {}),
            }}
            title="Drag to reorder"
          >
            ⠿
          </span>
          {/* 3-dot menu */}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              style={{
                ...s.menuBtn,
                ...(hoveredRow === 'menu' ? s.iconBtnHover : {}),
              }}
              onMouseEnter={() => setHoveredRow('menu')}
              onMouseLeave={() => setHoveredRow(null)}
              onClick={() => setMenuOpen((o) => !o)}
              title="More options"
            >
              ⋮
            </button>
            {menuOpen && (
              <div style={s.dropdown}>
                <button
                  style={s.dropdownItem}
                  onClick={() => { setMenuOpen(false); onHide(project.id); }}
                >
                  🙈 Hide pod
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <h3 style={s.name}>{project.name}</h3>

      <div style={s.boardTypeRow}>
        <span style={{ ...s.boardTypeDot, backgroundColor: btColor }} />
        <select
          value={boardType}
          disabled={saving}
          onChange={(e) => handleBoardTypeChange(e.target.value)}
          style={{ ...s.select, color: btColor }}
        >
          {BOARD_TYPES.map((bt) => (
            <option key={bt} value={bt}>{bt.charAt(0).toUpperCase() + bt.slice(1)}</option>
          ))}
        </select>
      </div>

      <div style={s.divider} />

      {/* Sprint rows (scrum) or kanban board counts — all rows clickable */}
      {boardType === 'kanban' ? (
        <div style={s.sprintSection}>
          {project.statusBreakdown ? (() => {
            const gc = kanbanGroupCounts(project);
            return (
              <div
                style={{
                  ...s.sprintRow,
                  ...s.sprintRowClickable,
                  ...(hoveredRow === 'kanban-board' ? s.sprintRowHover : {}),
                }}
                onClick={() => onNavigate(project.id)}
                onMouseEnter={() => setHoveredRow('kanban-board')}
                onMouseLeave={() => setHoveredRow(null)}
              >
                <span style={s.sprintName}>Board items</span>
                <span style={s.sprintCounts}>
                  {(['todo', 'doing', 'done'] as const).map((g) => (
                    <span key={g} style={{ ...s.sprintGroupCount, color: GROUP_COLORS[g] }}>
                      {gc[g]}
                    </span>
                  ))}
                </span>
              </div>
            );
          })() : (
            <p style={s.noSprint}>Sync to load board data</p>
          )}
        </div>
      ) : (
        <div style={s.sprintSection}>
          {project.activeSprints && project.activeSprints.length > 0 ? (
            project.activeSprints.map((sp, idx) => {
              const gc = sprintGroupCounts(sp);
              return (
                <div key={sp.zohoId}>
                  {isMultiSprint && idx > 0 && <div style={s.sprintDivider} />}
                  <div
                    style={{
                      ...s.sprintRow,
                      ...s.sprintRowClickable,
                      ...(hoveredRow === sp.id ? s.sprintRowHover : {}),
                    }}
                    onClick={() => onNavigate(project.id, sp.id)}
                    onMouseEnter={() => setHoveredRow(sp.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    title={`Open ${sp.name}`}
                  >
                    <span style={s.sprintName}>{sp.name}</span>
                    <span style={s.sprintCounts}>
                      {(['todo', 'doing', 'done'] as const).map((g) => (
                        <span key={g} style={{ ...s.sprintGroupCount, color: GROUP_COLORS[g] }}>
                          {gc[g]}
                        </span>
                      ))}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <p style={s.noSprint}>No active sprint</p>
          )}
        </div>
      )}

      {/* Backlog — border separator above, inner row is hoverable */}
      <div style={s.backlogSeparator}>
        <div
          style={{
            ...s.backlogRow,
            ...(hoveredRow === 'backlog' ? s.sprintRowHover : {}),
          }}
          onMouseEnter={() => setHoveredRow('backlog')}
          onMouseLeave={() => setHoveredRow(null)}
        >
          <span style={s.backlogLabel}>Backlog</span>
          <span style={s.backlogValue}>
            {project.backlogCount !== null && project.backlogCount !== undefined ? project.backlogCount : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

export function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // DnD state
  const dragIndex = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  useEffect(() => {
    fetchProjects()
      .then((d) => setProjects([...d.projects].sort((a, b) => a.displayOrder - b.displayOrder)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    fetchSyncStatus().then(({ lastSyncedAt: ts }) => setLastSyncedAt(ts)).catch(() => {});
  }, []);

  async function handleResync() {
    setSyncing(true);
    setError(null);
    try {
      const result = await syncProjects();
      setProjects([...result.projects].sort((a, b) => a.displayOrder - b.displayOrder));
      fetchSyncStatus().then(({ lastSyncedAt: ts }) => setLastSyncedAt(ts)).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleHide(id: string) {
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, hidden: true } : p));
    await updateProjectDisplay(id, { hidden: true }).catch(() => {
      setProjects((prev) => prev.map((p) => p.id === id ? { ...p, hidden: false } : p));
    });
  }

  async function handleUnhide(id: string) {
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, hidden: false } : p));
    await updateProjectDisplay(id, { hidden: false }).catch(() => {
      setProjects((prev) => prev.map((p) => p.id === id ? { ...p, hidden: true } : p));
    });
  }

  function handleDragStart(_e: React.DragEvent, index: number) {
    dragIndex.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex.current !== null && dragIndex.current !== index) {
      setDropTarget(index);
    }
  }

  function handleDrop(dropIndex: number) {
    const fromIndex = dragIndex.current;
    if (fromIndex === null || fromIndex === dropIndex) return;

    setProjects((prev) => {
      const visible = prev.filter((p) => !p.hidden);
      const hidden  = prev.filter((p) => p.hidden);
      const reordered = [...visible];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(dropIndex, 0, moved);
      const updated = reordered.map((p, i) => ({ ...p, displayOrder: i }));
      // Persist to backend (fire-and-forget)
      reorderProjects(updated.map((p) => p.id));
      return [...updated, ...hidden];
    });

    dragIndex.current = null;
    setDropTarget(null);
  }

  function handleDragEnd() {
    dragIndex.current = null;
    setDropTarget(null);
  }

  const visible = projects.filter((p) => !p.hidden);
  const hidden  = projects.filter((p) => p.hidden);

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <button style={s.back} onClick={() => navigate('/')}>← Back</button>
          <div>
            <h1 style={s.title}>🗂 Pods</h1>
            <p style={s.subtitle}>{projects.length} projects synced from Zoho Sprints</p>
          </div>
        </div>
        <button style={s.resyncBtn} onClick={handleResync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync'}
        </button>
      </header>

      {error && <p style={s.errorText}>{error}</p>}
      {loading && <p style={s.muted}>Loading pods…</p>}
      {!loading && projects.length === 0 && (
        <p style={s.muted}>No pods found. Go back and sync from the dashboard.</p>
      )}

      {!loading && visible.length > 0 && (
        <div style={s.grid}>
          {visible.map((p, i) => (
            <ProjectCard
              key={p.id}
              project={p}
              isDragging={dragIndex.current === i}
              isDropTarget={dropTarget === i}
              onBoardTypeChange={(id, bt) =>
                setProjects((prev) => prev.map((x) => x.id === id ? { ...x, boardType: bt } : x))
              }
              onHide={handleHide}
              onNavigate={(id, sprintId) => navigate(`/board/${id}${sprintId ? `?sprintId=${sprintId}` : ''}`)}
              onDragStart={(e) => handleDragStart(e, i)}              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={handleDragEnd}
            />
          ))}
        </div>
      )}

      {!loading && hidden.length > 0 && (
        <div style={s.hiddenSection}>
          <button style={s.hiddenToggle} onClick={() => setHiddenOpen((o) => !o)}>
            {hiddenOpen ? '▾' : '▸'} Hidden pods ({hidden.length})
          </button>
          {hiddenOpen && (
            <div style={s.grid}>
              {hidden.map((p) => (
                <div key={p.id} style={s.hiddenCard}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                    <div style={{ ...s.avatarSm, backgroundColor: avatarColor(p.name) }}>
                      {p.prefix ?? initials(p.name)}
                    </div>
                    <span style={s.hiddenName}>{p.name}</span>
                  </div>
                  <button style={s.unhideBtn} onClick={() => handleUnhide(p.id)}>Show</button>
                </div>
              ))}
            </div>
          )}
        </div>
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '32px 0 40px',
    borderBottom: '1px solid #1e293b',
    marginBottom: 32,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 20 },
  back: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 8, padding: '7px 13px',
    color: '#94a3b8', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', userSelect: 'none' as const,
  },
  title:    { margin: 0, fontSize: 28, fontWeight: 700, color: '#f1f5f9' },
  subtitle: { margin: '4px 0 0', fontSize: 14, color: '#64748b' },
  resyncBtn: {
    padding: '8px 20px', backgroundColor: 'transparent',
    color: '#94a3b8', border: '1px solid #334155',
    borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 16,
  },
  card: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    transition: 'opacity 0.15s',
    userSelect: 'none' as const,
  },
  cardTop:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  dragHandle: {
    fontSize: 16, color: '#475569', cursor: 'grab', lineHeight: 1,
    padding: '2px 4px', borderRadius: 4,
    transition: 'background-color 0.12s',
  },
  avatar: {
    width: 40, height: 40, borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 15, fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  statusBadge: {
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const,
    letterSpacing: '0.05em', padding: '3px 8px',
    borderRadius: 20, border: '1px solid',
  },
  hideBtn: {
    display: 'none', // kept for safety, replaced by menuBtn
  },
  menuBtn: {
    backgroundColor: 'transparent', border: 'none', color: '#475569',
    fontSize: 18, cursor: 'pointer', padding: '0 4px',
    borderRadius: 4, lineHeight: 1, fontWeight: 700,
    transition: 'background-color 0.12s',
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    right: 0,
    marginTop: 4,
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: '4px',
    zIndex: 100,
    minWidth: 140,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  },
  dropdownItem: {
    display: 'block',
    width: '100%',
    background: 'none',
    border: 'none',
    color: '#cbd5e1',
    fontSize: 13,
    cursor: 'pointer',
    padding: '7px 12px',
    textAlign: 'left' as const,
    borderRadius: 6,
  },
  name:        { margin: 0, fontSize: 15, fontWeight: 600, color: '#f1f5f9', lineHeight: 1.4 },
  boardTypeRow: { display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0' },
  boardTypeDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  select: {
    background: 'transparent', border: 'none',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    padding: 0, outline: 'none',
    WebkitAppearance: 'none' as const,
  },
  sprintSection: { display: 'flex', flexDirection: 'column' as const, gap: 3, marginTop: 0 },
  sprintRow: { display: 'flex', alignItems: 'center', gap: 6 },
  sprintRowClickable: {
    cursor: 'pointer',
    padding: '4px 8px',
    margin: '0 -8px',
    borderRadius: 6,
    transition: 'background-color 0.12s',
  },
  sprintRowHover: { backgroundColor: '#1e3a52' },
  sprintDivider: { borderTop: '1px solid #1e293b', margin: '2px 8px' },
  sprintDot: { fontSize: 12, lineHeight: 1 },
  sprintName: { fontSize: 13, color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  sprintCounts: { display: 'flex', gap: 5, flexShrink: 0 },
  sprintGroupCount: { fontSize: 13, fontWeight: 600 },
  noSprint: { margin: 0, fontSize: 12, color: '#475569', fontStyle: 'italic' as const },
  divider: { borderTop: '1px solid #334155', margin: '6px 0 4px' },
  backlogSeparator: { borderTop: '1px solid #334155', marginTop: 6 },
  backlogRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 8px',
    margin: '4px -8px 0',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'background-color 0.12s',
  },
  backlogLabel: { fontSize: 13, color: '#94a3b8' },
  backlogValue: { fontSize: 13, fontWeight: 600, color: '#94a3b8' },
  iconBtnHover: { backgroundColor: '#243248', color: '#94a3b8' },
  // Hidden section
  hiddenSection: { marginTop: 40 },
  hiddenToggle: {
    background: 'none', border: 'none', color: '#64748b',
    fontSize: 14, cursor: 'pointer', padding: '4px 0',
    marginBottom: 16, display: 'block',
  },
  hiddenCard: {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 10,
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  avatarSm: {
    width: 28, height: 28, borderRadius: 6,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  hiddenName: { fontSize: 13, color: '#64748b', flex: 1 },
  unhideBtn: {
    background: 'none', border: '1px solid #334155', color: '#94a3b8',
    fontSize: 12, cursor: 'pointer', padding: '3px 10px', borderRadius: 6,
  },
  muted:     { color: '#64748b', fontSize: 14 },
  errorText: { color: '#fca5a5', fontSize: 14, marginBottom: 16 },
};
