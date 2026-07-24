import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GripVertical, MoreHorizontal, ChevronDown, ChevronRight, Eye } from 'lucide-react';
import {
  fetchProjects, updateProjectBoardType,
  updateProjectDisplay, reorderProjects, Project,
} from '../api/client';
import { BackButton } from '../components/BackButton';
import { StatusGroupCounts } from '../components/StatusGroupCounts';
import { C, R, font } from '../theme';

const BOARD_TYPES = ['scrum', 'kanban', 'other'] as const;
type BoardType = (typeof BOARD_TYPES)[number];

const BOARD_TYPE_COLORS: Record<BoardType, string> = {
  scrum:  C.primary,
  kanban: C.success,
  other:  C.inkTertiary,
};

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function avatarColor(name: string) {
  const colors = [C.primary, '#a855f7', '#ec4899', '#f59e0b', C.primary, C.success];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

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
      await updateProjectBoardType(project.zohoId, val);
      onBoardTypeChange(project.zohoId, val);
    } catch {
      setBoardType(prev);
    } finally {
      setSaving(false);
    }
  }

  const btColor = BOARD_TYPE_COLORS[(boardType as BoardType)] ?? C.inkTertiary;
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
        outline: isDropTarget ? `2px dashed ${C.primary}` : 'none',
        cursor: 'default',
      }}
    >
      <div style={s.cardTop}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <div style={{ ...s.avatar, backgroundColor: bg }}>
            {project.prefix ?? initials(project.name)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
            <GripVertical size={16} strokeWidth={1.5} color={C.inkTertiary} />
          </span>
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
              <MoreHorizontal size={16} strokeWidth={1.5} color={C.inkTertiary} />
            </button>
            {menuOpen && (
              <div style={s.dropdown}>
                <button
                  style={s.dropdownItem}
                  onClick={() => { setMenuOpen(false); onHide(project.zohoId); }}
                >
                  Hide project
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
                onClick={() => onNavigate(project.zohoId)}
                onMouseEnter={() => setHoveredRow('kanban-board')}
                onMouseLeave={() => setHoveredRow(null)}
              >
                <span style={s.sprintName}>Board items</span>
                <StatusGroupCounts counts={gc} />
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
                      ...(hoveredRow === sp.zohoId ? s.sprintRowHover : {}),
                    }}
                    onClick={() => onNavigate(project.zohoId, sp.zohoId)}
                    onMouseEnter={() => setHoveredRow(sp.zohoId)}
                    onMouseLeave={() => setHoveredRow(null)}
                    title={`Open ${sp.name}`}
                  >
                    <span style={s.sprintName}>{sp.name}</span>
                    <StatusGroupCounts counts={gc} />
                  </div>
                </div>
              );
            })
          ) : (
            <p style={s.noSprint}>No active sprint</p>
          )}
        </div>
      )}

      <div style={s.backlogSeparator}>
         <div
           style={{
             ...s.backlogRow,
             ...(hoveredRow === 'backlog' ? s.sprintRowHover : {}),
           }}
           onMouseEnter={() => setHoveredRow('backlog')}
           onMouseLeave={() => setHoveredRow(null)}
           onClick={() => onNavigate(project.zohoId, 'backlog')}
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
  const [error, setError]       = useState<string | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  useEffect(() => {
    fetchProjects()
      .then((d) => setProjects([...d.projects].sort((a, b) => a.displayOrder - b.displayOrder)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleHide(id: string) {
    setProjects((prev) => prev.map((p) => p.zohoId === id ? { ...p, hidden: true } : p));
    await updateProjectDisplay(id, { hidden: true }).catch(() => {
      setProjects((prev) => prev.map((p) => p.zohoId === id ? { ...p, hidden: false } : p));
    });
  }

  async function handleUnhide(id: string) {
    setProjects((prev) => prev.map((p) => p.zohoId === id ? { ...p, hidden: false } : p));
    await updateProjectDisplay(id, { hidden: false }).catch(() => {
      setProjects((prev) => prev.map((p) => p.zohoId === id ? { ...p, hidden: true } : p));
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
      reorderProjects(updated.map((p) => p.zohoId));
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
          <BackButton />
          <div>
            <h1 style={s.title}>Projects</h1>
            <p style={s.subtitle}>{projects.length} projects synced from Zoho Sprints</p>
          </div>
        </div>
      </header>

      {error && <p style={s.errorText}>{error}</p>}
      {loading && <p style={s.muted}>Loading projects…</p>}
      {!loading && projects.length === 0 && (
        <p style={s.muted}>No projects found. Go back and sync from the dashboard.</p>
      )}

      {!loading && visible.length > 0 && (
        <div style={s.grid}>
          {visible.map((p, i) => (
          <ProjectCard
               key={p.zohoId}
               project={p}
               isDragging={dragIndex.current === i}
               isDropTarget={dropTarget === i}
               onBoardTypeChange={(id, bt) =>
                 setProjects((prev) => prev.map((x) => x.zohoId === id ? { ...x, boardType: bt } : x))
               }
              onHide={handleHide}
               onNavigate={(id, sprintId) => {
                 if (sprintId === 'backlog') {
                   navigate(`/backlog/${id}`);
                 } else {
                   navigate(`/board/${id}${sprintId ? `?sprintId=${sprintId}` : ''}`);
                 }
               }}

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
            {hiddenOpen ? <ChevronDown size={14} strokeWidth={1.5} color={C.inkTertiary} style={{ verticalAlign: 'middle' }} /> : <ChevronRight size={14} strokeWidth={1.5} color={C.inkTertiary} style={{ verticalAlign: 'middle' }} />} Hidden projects ({hidden.length})
          </button>
          {hiddenOpen && (
            <div style={s.grid}>
              {hidden.map((p) => (
                <div key={p.zohoId} style={s.hiddenCard}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                    <div style={{ ...s.avatarSm, backgroundColor: avatarColor(p.name) }}>
                      {p.prefix ?? initials(p.name)}
                    </div>
                    <span style={s.hiddenName}>{p.name}</span>
                  </div>
                  <button style={s.unhideBtn} onClick={() => handleUnhide(p.zohoId)}>
                    <Eye size={12} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                    Show
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: C.canvas,
    color: C.inkMuted,
    fontFamily: font.text,
    padding: '0 24px 48px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '32px 0 40px',
    borderBottom: `1px solid ${C.hairline}`,
    marginBottom: 32,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 20 },
  title:    { margin: 0, fontSize: 28, fontWeight: 600, color: C.inkMuted, fontFamily: font.display, letterSpacing: '-0.6px' },
  subtitle: { margin: '4px 0 0', fontSize: 14, color: C.inkTertiary, fontFamily: font.text },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 16,
  },
  card: {
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    transition: 'opacity 0.15s',
    userSelect: 'none' as const,
  },
  cardTop:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  dragHandle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: C.inkTertiary, cursor: 'grab',
    padding: '2px 4px', borderRadius: R.xs,
    transition: 'background-color 0.12s',
  },
  avatar: {
    width: 40, height: 40, borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 15, fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  menuBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent', border: 'none', color: C.inkTertiary,
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: R.xs,
    transition: 'background-color 0.12s',
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    right: 0,
    marginTop: 4,
    backgroundColor: C.surface2,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.md,
    padding: '4px',
    zIndex: 100,
    minWidth: 140,
  },
  dropdownItem: {
    display: 'block',
    width: '100%',
    background: 'none',
    border: 'none',
    color: C.inkMuted,
    fontSize: 13,
    cursor: 'pointer',
    padding: '7px 12px',
    textAlign: 'left' as const,
    borderRadius: R.sm,
    fontFamily: font.text,
  },
  name:        { margin: 0, fontSize: 15, fontWeight: 600, color: C.inkMuted, lineHeight: 1.4, fontFamily: font.display },
  boardTypeRow: { display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0' },
  boardTypeDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  select: {
    background: 'transparent', border: 'none',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    padding: 0, outline: 'none',
    WebkitAppearance: 'none' as const,
    fontFamily: font.text,
  },
  sprintSection: { display: 'flex', flexDirection: 'column' as const, gap: 3, marginTop: 0 },
  sprintRow: { display: 'flex', alignItems: 'center', gap: 6 },
  sprintRowClickable: {
    cursor: 'pointer',
    padding: '4px 8px',
    margin: '0 -8px',
    borderRadius: R.sm,
    transition: 'background-color 0.12s',
  },
  sprintRowHover: { backgroundColor: C.surface2 },
  sprintDivider: { borderTop: `1px solid ${C.hairline}`, margin: '2px 8px' },
  sprintName: { fontSize: 13, color: C.inkSubtle, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, fontFamily: font.text },
  noSprint: { margin: 0, fontSize: 12, color: C.inkTertiary, fontStyle: 'italic' as const, fontFamily: font.text },
  divider: { borderTop: `1px solid ${C.hairline}`, margin: '6px 0 4px' },
  backlogSeparator: { borderTop: `1px solid ${C.hairline}`, marginTop: 6 },
  backlogRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 8px',
    margin: '4px -8px 0',
    borderRadius: R.sm,
    cursor: 'pointer',
    transition: 'background-color 0.12s',
  },
  backlogLabel: { fontSize: 13, color: C.inkSubtle, fontFamily: font.text },
  backlogValue: { fontSize: 13, fontWeight: 600, color: C.inkSubtle, fontFamily: font.text },
  iconBtnHover: { backgroundColor: C.surface2, color: C.inkSubtle },
  hiddenSection: { marginTop: 40 },
  hiddenToggle: {
    background: 'none', border: 'none', color: C.inkTertiary,
    fontSize: 14, cursor: 'pointer', padding: '4px 0',
    marginBottom: 16, display: 'block',
    fontFamily: font.text,
  },
  hiddenCard: {
    backgroundColor: C.canvas,
    border: `1px solid ${C.hairline}`,
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
  hiddenName: { fontSize: 13, color: C.inkTertiary, flex: 1, fontFamily: font.text },
  unhideBtn: {
    background: 'none', border: `1px solid ${C.hairline}`, color: C.inkSubtle,
    fontSize: 12, cursor: 'pointer', padding: '3px 10px', borderRadius: R.sm,
    fontFamily: font.text,
  },
  muted:     { color: C.inkTertiary, fontSize: 14, fontFamily: font.text },
  errorText: { color: '#ef4444', fontSize: 14, marginBottom: 16, fontFamily: font.text },
};
