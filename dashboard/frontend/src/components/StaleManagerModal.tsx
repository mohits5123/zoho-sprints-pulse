import { useState } from 'react';

/**
 * Configuration for stale ticket detection settings
 * Stores per-project settings for what constitutes a stale ticket
 */
export interface StaleConfig {
  /** Number of days after which a ticket is considered stale */
  days: number;
  /** Array of status names to monitor for staleness (excludes 'done') */
  watchedStates: string[];
}

/** Storage key for stale config (project-scoped) */
const STORAGE_KEY = (projectId: string) => `zonaliser_stale_config_${projectId}`;
/** Legacy storage key for migration */
const LEGACY_KEY  = (projectId: string) => `zonaliser_stale_days_${projectId}`;

/** Fixed group order for display */
const GROUP_ORDER = ['todo', 'doing', 'done', 'unknown'] as const;

/** Human-readable labels for each group */
const GROUP_LABEL: Record<string, string> = {
  todo:    'To Do',
  doing:   'In Progress',
  done:    'Done',
  unknown: 'Other',
};

/** Color mapping for each group */
const GROUP_COLOR: Record<string, string> = {
  todo:    '#64748b',
  doing:   '#3b82f6',
  done:    '#22c55e',
  unknown: '#94a3b8',
};

/**
 * Load stale config from localStorage with legacy migration
 * Falls back to default settings if no config exists
 * Migrates from old 'stale_days' format to new 'stale_config' format
 * @param projectId - Project identifier for storage key
 * @param statusGroups - Mapping of status names to their group assignments
 * @returns StaleConfig object with days threshold and watched states
 */
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

/**
 * Save stale config to localStorage
 * Persists the project's stale ticket detection settings
 * @param projectId - Project identifier for storage key
 * @param cfg - StaleConfig object to save
 */
export function saveStaleConfig(projectId: string, cfg: StaleConfig): void {
  localStorage.setItem(STORAGE_KEY(projectId), JSON.stringify(cfg));
}

interface StaleManagerModalProps {
  /** Project ID for storage key */
  projectId: string;
  /** Status to group mapping: statusName → group */
  statusGroups: Record<string, string>;
  /** Current stale configuration */
  config: StaleConfig;
  /** Callback when configuration is saved */
  onSave: (cfg: StaleConfig) => void;
  /** Callback when modal is closed */
  onClose: () => void;
}

/**
 * Modal for configuring stale ticket detection settings per project
 * Allows users to set how many days to wait before marking tickets as stale
 * And which statuses to monitor (excludes 'done' status)
 * Settings are stored in localStorage per project
 * @param projectId - Project identifier for storage key
 * @param statusGroups - Mapping of status names to their group assignments
 * @param config - Current stale configuration loaded from localStorage
 * @param onSave - Callback invoked when configuration is saved
 * @param onClose - Callback invoked when modal is closed
 */
export function StaleManagerModal({ projectId, statusGroups, config, onSave, onClose }: StaleManagerModalProps) {
  const [days, setDays] = useState(String(config.days));

  // If no states were previously saved, default to all non-done states
  /** Default watched states: all non-done statuses if none previously saved */
  const defaultWatched = () => {
    if (config.watchedStates.length > 0) return new Set(config.watchedStates);
    return new Set(
      Object.entries(statusGroups)
        .filter(([, g]) => g !== 'done')
        .map(([name]) => name)
    );
  };
  const [watched, setWatched] = useState<Set<string>>(defaultWatched);

  /** Group statuses by their bucket (todo/doing/done/unknown) */
  // Group statuses
  const grouped: Record<string, string[]> = {};
  for (const [name, group] of Object.entries(statusGroups)) {
    const g = GROUP_ORDER.includes(group as typeof GROUP_ORDER[number]) ? group : 'unknown';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(name);
  }

  /** Toggle a single state on/off */
  function toggleState(name: string) {
    setWatched(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  /** Save configuration to localStorage and notify parent */
  function handleSave() {
    const parsedDays = Math.max(1, parseInt(days, 10) || 7);
    const cfg: StaleConfig = { days: parsedDays, watchedStates: Array.from(watched) };
    saveStaleConfig(projectId, cfg);
    onSave(cfg);
  }

  /** Select all states in a group, or all non-done states if no group specified */
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

  /** Clear all states in a group, or all states if no group specified */
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

/**
 * Inline styles for StaleManagerModal component
 * Configures the modal appearance for configuring stale ticket detection settings
 * Uses dark theme with accessible contrast and interactive elements
 */
const s: Record<string, React.CSSProperties> = {
  /** Full-screen overlay for modal with semi-transparent background */
  overlay: {
    position: 'fixed', inset: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  /** Modal container with dark theme and shadow */
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
  /** Modal header with title and close button */
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 20px 14px',
    borderBottom: '1px solid #1e293b',
    flexShrink: 0,
  },
  /** Modal title */
  title: { fontSize: 15, fontWeight: 700, color: '#f1f5f9' },
  /** Close button */
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#64748b', fontSize: 16, padding: '0 2px',
    lineHeight: 1,
  },
  /** Section container */
  section: {
    padding: '16px 20px 0',
  },
  /** Section label text */
  sectionLabel: {
    fontSize: 11, fontWeight: 600, color: '#64748b',
    textTransform: 'uppercase' as const, letterSpacing: '0.06em',
    display: 'block', marginBottom: 10,
  },
  /** Days input row */
  daysRow: {
    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4,
  },
  /** Days input field */
  daysInput: {
    width: 72, padding: '6px 10px',
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 6, color: '#f1f5f9', fontSize: 15, fontWeight: 700,
    outline: 'none',
  },
  /** Days unit text */
  daysUnit: { fontSize: 13, color: '#94a3b8' },
  /** States header with bulk action buttons */
  statesHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  /** Bulk action buttons container */
  bulkBtns: { display: 'flex', gap: 6 },
  /** Bulk action button */
  bulkBtn: {
    background: 'none', border: '1px solid #334155',
    borderRadius: 5, color: '#94a3b8', fontSize: 11,
    padding: '3px 8px', cursor: 'pointer',
  },
  /** Scrollable states list */
  statesList: {
    overflowY: 'auto' as const,
    maxHeight: '42vh',
    paddingBottom: 4,
    paddingRight: 4,
  },
  /** Status group block */
  groupBlock: {
    marginBottom: 14,
  },
  /** Group header with dot, label, and bulk buttons */
  groupHeader: {
    display: 'flex', alignItems: 'center', gap: 7,
    marginBottom: 6,
  },
  /** Color dot for group */
  groupDot: {
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
  },
  /** Group label text */
  groupLabel: {
    fontSize: 12, fontWeight: 600, color: '#cbd5e1',
    flex: 1,
  },
  /** Bulk action buttons for group */
  groupBulk: { display: 'flex', gap: 5 },
  /** Small underlined button */
  tinyBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#475569', fontSize: 11, padding: '0 2px',
    textDecoration: 'underline',
  },
  /** Note for done group (excluded) */
  doneNote: { fontSize: 11, color: '#475569', fontStyle: 'italic' },
  /** State row with checkbox */
  stateRow: {
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '5px 8px',
    borderRadius: 6,
    userSelect: 'none' as const,
  },
  /** Checkbox */
  checkbox: { width: 14, height: 14, accentColor: '#3b82f6', cursor: 'pointer', flexShrink: 0 },
  /** Color dot for state */
  stateDot: {
    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
  },
  /** State name text */
  stateName: { fontSize: 13, color: '#e2e8f0' },
  /** Modal footer */
  footer: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px',
    borderTop: '1px solid #1e293b',
    flexShrink: 0,
  },
  /** Selected states count */
  watchCount: { fontSize: 12, color: '#475569' },
  /** Footer buttons container */
  footerBtns: { display: 'flex', gap: 8 },
  /** Cancel button */
  cancelBtn: {
    padding: '7px 16px', borderRadius: 7,
    background: 'none', border: '1px solid #334155',
    color: '#94a3b8', fontSize: 13, cursor: 'pointer',
  },
  /** Save button */
  saveBtn: {
    padding: '7px 18px', borderRadius: 7,
    backgroundColor: '#3b82f6', border: 'none',
    color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
};
