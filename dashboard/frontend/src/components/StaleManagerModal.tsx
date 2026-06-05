import { useState } from 'react';

export interface StaleConfig {
  days: number;
  watchedStates: string[];
}

const STORAGE_KEY = (projectId: string) => `zonaliser_stale_config_${projectId}`;
const LEGACY_KEY  = (projectId: string) => `zonaliser_stale_days_${projectId}`;

const GROUP_ORDER = ['todo', 'doing', 'done', 'unknown'] as const;
const GROUP_LABEL: Record<string, string> = {
  todo:    'To Do',
  doing:   'In Progress',
  done:    'Done',
  unknown: 'Other',
};
const GROUP_COLOR: Record<string, string> = {
  todo:    '#64748b',
  doing:   '#3b82f6',
  done:    '#22c55e',
  unknown: '#94a3b8',
};

export function loadStaleConfig(projectId: string, statusGroups: Record<string, string>): StaleConfig {
  const raw = localStorage.getItem(STORAGE_KEY(projectId));
  if (raw) {
    try { return JSON.parse(raw) as StaleConfig; } catch { /* fall through */ }
  }
  // Migrate from legacy key
  const legacyDays = localStorage.getItem(LEGACY_KEY(projectId));
  const days = legacyDays ? Math.max(1, parseInt(legacyDays, 10) || 7) : 7;
  // Default: watch all non-done states
  const watchedStates = Object.entries(statusGroups)
    .filter(([, g]) => g !== 'done')
    .map(([name]) => name);
  return { days, watchedStates };
}

export function saveStaleConfig(projectId: string, cfg: StaleConfig): void {
  localStorage.setItem(STORAGE_KEY(projectId), JSON.stringify(cfg));
}

interface Props {
  projectId:    string;
  statusGroups: Record<string, string>;  // statusName → group
  config:       StaleConfig;
  onSave:       (cfg: StaleConfig) => void;
  onClose:      () => void;
}

export function StaleManagerModal({ projectId, statusGroups, config, onSave, onClose }: Props) {
  const [days, setDays] = useState(String(config.days));

  // If no states were previously saved, default to all non-done states
  const defaultWatched = () => {
    if (config.watchedStates.length > 0) return new Set(config.watchedStates);
    return new Set(
      Object.entries(statusGroups)
        .filter(([, g]) => g !== 'done')
        .map(([name]) => name)
    );
  };
  const [watched, setWatched] = useState<Set<string>>(defaultWatched);

  // Group statuses
  const grouped: Record<string, string[]> = {};
  for (const [name, group] of Object.entries(statusGroups)) {
    const g = GROUP_ORDER.includes(group as typeof GROUP_ORDER[number]) ? group : 'unknown';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(name);
  }

  function toggleState(name: string) {
    setWatched(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function handleSave() {
    const parsedDays = Math.max(1, parseInt(days, 10) || 7);
    const cfg: StaleConfig = { days: parsedDays, watchedStates: Array.from(watched) };
    saveStaleConfig(projectId, cfg);
    onSave(cfg);
  }

  function selectAll(group?: string) {
    setWatched(prev => {
      const next = new Set(prev);
      const names = group
        ? (grouped[group] ?? [])
        : Object.keys(statusGroups).filter(n => statusGroups[n] !== 'done');
      names.forEach(n => next.add(n));
      return next;
    });
  }

  function clearAll(group?: string) {
    setWatched(prev => {
      const next = new Set(prev);
      const names = group ? (grouped[group] ?? []) : Object.keys(statusGroups);
      names.forEach(n => next.delete(n));
      return next;
    });
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={s.header}>
          <span style={s.title}>⏱ Stale Ticket Settings</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Days */}
        <div style={s.section}>
          <label style={s.sectionLabel}>Mark ticket as stale after</label>
          <div style={s.daysRow}>
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={e => setDays(e.target.value)}
              style={s.daysInput}
            />
            <span style={s.daysUnit}>days since creation</span>
          </div>
        </div>

        {/* States */}
        <div style={s.section}>
          <div style={s.statesHeader}>
            <label style={s.sectionLabel}>Monitor these states</label>
            <div style={s.bulkBtns}>
              <button style={s.bulkBtn} onClick={() => selectAll()}>All non-done</button>
              <button style={s.bulkBtn} onClick={() => clearAll()}>Clear all</button>
            </div>
          </div>

          <div style={s.statesList}>
            {GROUP_ORDER.filter(g => grouped[g]?.length).map(group => {
              const isDoneGroup = group === 'done';
              return (
                <div key={group} style={s.groupBlock}>
                  <div style={s.groupHeader}>
                    <span style={{ ...s.groupDot, backgroundColor: GROUP_COLOR[group] }} />
                    <span style={s.groupLabel}>{GROUP_LABEL[group]}</span>
                    {!isDoneGroup && (
                      <div style={s.groupBulk}>
                        <button style={s.tinyBtn} onClick={() => selectAll(group)}>all</button>
                        <button style={s.tinyBtn} onClick={() => clearAll(group)}>none</button>
                      </div>
                    )}
                    {isDoneGroup && (
                      <span style={s.doneNote}>Always excluded</span>
                    )}
                  </div>
                  {grouped[group].map(name => (
                    <label
                      key={name}
                      style={{
                        ...s.stateRow,
                        opacity: isDoneGroup ? 0.4 : 1,
                        cursor:  isDoneGroup ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={watched.has(name)}
                        disabled={isDoneGroup}
                        onChange={() => !isDoneGroup && toggleState(name)}
                        style={s.checkbox}
                      />
                      <span style={{ ...s.stateDot, backgroundColor: GROUP_COLOR[group] }} />
                      <span style={s.stateName}>{name}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <span style={s.watchCount}>
            {watched.size} state{watched.size !== 1 ? 's' : ''} selected
          </span>
          <div style={s.footerBtns}>
            <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
            <button style={s.saveBtn} onClick={handleSave}>Save</button>
          </div>
        </div>

      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 12,
    width: 460,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 20px 14px',
    borderBottom: '1px solid #1e293b',
    flexShrink: 0,
  },
  title: { fontSize: 15, fontWeight: 700, color: '#f1f5f9' },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#64748b', fontSize: 16, padding: '0 2px',
    lineHeight: 1,
  },
  section: {
    padding: '16px 20px 0',
  },
  sectionLabel: {
    fontSize: 11, fontWeight: 600, color: '#64748b',
    textTransform: 'uppercase' as const, letterSpacing: '0.06em',
    display: 'block', marginBottom: 10,
  },
  daysRow: {
    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4,
  },
  daysInput: {
    width: 72, padding: '6px 10px',
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 6, color: '#f1f5f9', fontSize: 15, fontWeight: 700,
    outline: 'none',
  },
  daysUnit: { fontSize: 13, color: '#94a3b8' },
  statesHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  bulkBtns: { display: 'flex', gap: 6 },
  bulkBtn: {
    background: 'none', border: '1px solid #334155',
    borderRadius: 5, color: '#94a3b8', fontSize: 11,
    padding: '3px 8px', cursor: 'pointer',
  },
  statesList: {
    overflowY: 'auto' as const,
    maxHeight: '42vh',
    paddingBottom: 4,
    paddingRight: 4,
  },
  groupBlock: {
    marginBottom: 14,
  },
  groupHeader: {
    display: 'flex', alignItems: 'center', gap: 7,
    marginBottom: 6,
  },
  groupDot: {
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
  },
  groupLabel: {
    fontSize: 12, fontWeight: 600, color: '#cbd5e1',
    flex: 1,
  },
  groupBulk: { display: 'flex', gap: 5 },
  tinyBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#475569', fontSize: 11, padding: '0 2px',
    textDecoration: 'underline',
  },
  doneNote: { fontSize: 11, color: '#475569', fontStyle: 'italic' },
  stateRow: {
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '5px 8px',
    borderRadius: 6,
    userSelect: 'none' as const,
  },
  checkbox: { width: 14, height: 14, accentColor: '#3b82f6', cursor: 'pointer', flexShrink: 0 },
  stateDot: {
    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
  },
  stateName: { fontSize: 13, color: '#e2e8f0' },
  footer: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px',
    borderTop: '1px solid #1e293b',
    flexShrink: 0,
  },
  watchCount: { fontSize: 12, color: '#475569' },
  footerBtns: { display: 'flex', gap: 8 },
  cancelBtn: {
    padding: '7px 16px', borderRadius: 7,
    background: 'none', border: '1px solid #334155',
    color: '#94a3b8', fontSize: 13, cursor: 'pointer',
  },
  saveBtn: {
    padding: '7px 18px', borderRadius: 7,
    backgroundColor: '#3b82f6', border: 'none',
    color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
};
