import { useState } from 'react';
import { X } from 'lucide-react';
import { C, R, font } from '../theme';

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
  todo:    C.inkTertiary,
  doing:   C.primary,
  done:    C.success,
  unknown: C.inkSubtle,
};

export function loadStaleConfig(projectId: string, statusGroups: Record<string, string>): StaleConfig {
  const raw = localStorage.getItem(STORAGE_KEY(projectId));
  if (raw) {
    try { return JSON.parse(raw) as StaleConfig; } catch { /* fall through */ }
  }
  const legacyDays = localStorage.getItem(LEGACY_KEY(projectId));
  const days = legacyDays ? Math.max(1, parseInt(legacyDays, 10) || 7) : 7;
  const watchedStates = Object.entries(statusGroups)
    .filter(([, g]) => g !== 'done')
    .map(([name]) => name);
  return { days, watchedStates };
}

export function saveStaleConfig(projectId: string, cfg: StaleConfig): void {
  localStorage.setItem(STORAGE_KEY(projectId), JSON.stringify(cfg));
}

interface StaleManagerModalProps {
  projectId: string;
  statusGroups: Record<string, string>;
  config: StaleConfig;
  onSave: (cfg: StaleConfig) => void;
  onClose: () => void;
}

export function StaleManagerModal({ projectId, statusGroups, config, onSave, onClose }: StaleManagerModalProps) {
  const [days, setDays] = useState(String(config.days));

  const defaultWatched = () => {
    if (config.watchedStates.length > 0) return new Set(config.watchedStates);
    return new Set(
      Object.entries(statusGroups)
        .filter(([, g]) => g !== 'done')
        .map(([name]) => name)
    );
  };
  const [watched, setWatched] = useState<Set<string>>(defaultWatched);

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

        <div style={s.header}>
          <span style={s.title}>Stale Ticket Settings</span>
          <button style={s.closeBtn} onClick={onClose}>
            <X size={18} strokeWidth={1.5} color={C.inkTertiary} />
          </button>
        </div>

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

        <div style={s.section}>
          <div style={s.statesHeader}>
            <label style={s.sectionLabel}>Monitor these states</label>
            <div style={s.bulkBtns}>
              <button style={s.bulkBtn} onClick={() => selectAll()}>All non-done</button>
              <button style={s.bulkBtn} onClick={() => clearAll()}>Clear all</button>
            </div>
          </div>

          <div style={s.statesList}>
            {GROUP_ORDER.filter(g => grouped[g]?.length).map(group => (
              <div key={group} style={s.groupBlock}>
                <div style={s.groupHeader}>
                  <span style={{ ...s.groupDot, backgroundColor: GROUP_COLOR[group] }} />
                  <span style={s.groupLabel}>{GROUP_LABEL[group]}</span>
                  <div style={s.groupBulk}>
                    <button style={s.tinyBtn} onClick={() => selectAll(group)}>all</button>
                    <button style={s.tinyBtn} onClick={() => clearAll(group)}>none</button>
                  </div>
                </div>
                {grouped[group].map(name => (
                  <label key={name} style={{ ...s.stateRow, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={watched.has(name)}
                      onChange={() => toggleState(name)}
                      style={s.checkbox}
                    />
                    <span style={{ ...s.stateDot, backgroundColor: GROUP_COLOR[group] }} />
                    <span style={s.stateName}>{name}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>

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
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
    width: 460,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 20px 14px',
    borderBottom: `1px solid ${C.hairline}`,
    flexShrink: 0,
  },
  title: { fontSize: 20, fontWeight: 400, color: C.inkMuted, fontFamily: font.display, letterSpacing: '-0.2px' },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: C.inkTertiary, fontSize: 16, padding: '0 2px',
    lineHeight: 1,
  },
  section: {
    padding: '16px 20px 0',
  },
  sectionLabel: {
    fontSize: 13, fontWeight: 500, color: C.inkTertiary,
    textTransform: 'uppercase' as const, letterSpacing: '0.4px',
    display: 'block', marginBottom: 10,
    fontFamily: font.text,
  },
  daysRow: {
    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4,
  },
  daysInput: {
    width: 72, padding: '8px 12px',
    backgroundColor: C.surface1, border: `1px solid ${C.hairline}`,
    borderRadius: R.md, color: C.inkMuted, fontSize: 16, fontWeight: 500,
    outline: 'none', fontFamily: font.text,
  },
  daysUnit: { fontSize: 14, color: C.inkSubtle, fontFamily: font.text },
  statesHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  bulkBtns: { display: 'flex', gap: 6 },
  bulkBtn: {
    background: 'none', border: `1px solid ${C.hairline}`,
    borderRadius: R.md, color: C.inkSubtle, fontSize: 14,
    padding: '8px 14px', cursor: 'pointer',
    fontFamily: font.text, fontWeight: 500,
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
    fontSize: 14, fontWeight: 500, color: C.inkMuted,
    flex: 1, fontFamily: font.text,
  },
  groupBulk: { display: 'flex', gap: 5 },
  tinyBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: C.inkTertiary, fontSize: 12, padding: '0 2px',
    textDecoration: 'underline',
    fontFamily: font.text,
  },
  doneNote: { fontSize: 12, color: C.inkTertiary, fontStyle: 'italic' },
  stateRow: {
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '5px 8px',
    borderRadius: R.sm,
    userSelect: 'none' as const,
  },
  checkbox: { width: 14, height: 14, accentColor: C.primary, cursor: 'pointer', flexShrink: 0 },
  stateDot: {
    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
  },
  stateName: { fontSize: 14, color: C.inkMuted, fontFamily: font.text },
  footer: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px',
    borderTop: `1px solid ${C.hairline}`,
    flexShrink: 0,
  },
  watchCount: { fontSize: 12, color: C.inkTertiary, fontFamily: font.text },
  footerBtns: { display: 'flex', gap: 8 },
  cancelBtn: {
    padding: '8px 14px', borderRadius: R.md,
    background: 'none', border: `1px solid ${C.hairline}`,
    color: C.inkSubtle, fontSize: 14, cursor: 'pointer',
    fontFamily: font.text, fontWeight: 500,
  },
  saveBtn: {
    padding: '8px 14px', borderRadius: R.md,
    backgroundColor: C.primary, border: 'none',
    color: C.inkMuted, fontSize: 14, fontWeight: 500, cursor: 'pointer',
    fontFamily: font.text,
  },
};
