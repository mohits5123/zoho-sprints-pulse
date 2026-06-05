import { useState } from 'react';
import type { EpicBreakdown } from '../api/client';
import { DonutChart } from './DonutChart';

const GROUP_COLORS = { todo: '#64748b', doing: '#3b82f6', done: '#22c55e' };
const GROUP_LABELS = { todo: 'Todo', doing: 'In Progress', done: 'Done' };
const GROUP_ORDER  = ['todo', 'doing', 'done'] as const;

type Group = typeof GROUP_ORDER[number];

interface GroupTotals { todo: number; doing: number; done: number; total: number }

function aggregate(epics: EpicBreakdown[], statusGroups: Record<string, string>): GroupTotals {
  const t: GroupTotals = { todo: 0, doing: 0, done: 0, total: 0 };
  for (const epic of epics) {
    for (const [status, count] of Object.entries(epic.statusBreakdown)) {
      const g = (statusGroups[status] ?? 'todo') as Group;
      if (g in t) (t[g] as number) += count;
      t.total += count;
    }
  }
  return t;
}
export function SprintProgressCard({ epics, statusGroups, onGroupClick }: {
  epics:          EpicBreakdown[];
  statusGroups:   Record<string, string>;
  onGroupClick?:  (group: string) => void;
}) {
  const totals = aggregate(epics, statusGroups);
  const { total } = totals;
  const pct = total > 0 ? Math.round((totals.done / total) * 100) : 0;

  const segments = GROUP_ORDER.map((g) => ({
    value: totals[g],
    color: GROUP_COLORS[g],
    label: `${GROUP_LABELS[g]}: ${totals[g]}`,
  }));

  return (
    <div style={s.card}>
      <p style={s.label}>Sprint Progress</p>

      <div style={s.donutWrap}>
        <DonutChart
          segments={segments}
          size={140}
          strokeWidth={14}
          centerLabel={`${pct}%`}
          centerSub={`${totals.done} / ${total} done`}
        />
      </div>

      {/* Segmented bar */}
      {total > 0 && (
        <div style={s.barTrack}>
          {GROUP_ORDER.map((g) => {
            const count = totals[g];
            if (count === 0) return null;
            return (
              <div
                key={g}
                title={`${GROUP_LABELS[g]}: ${count}`}
                style={{ ...s.barSegment, width: `${(count / total) * 100}%`, backgroundColor: GROUP_COLORS[g] }}
              />
            );
          })}
        </div>
      )}

      {/* Group chips */}
      <div style={s.chips}>
        {GROUP_ORDER.map((g) => (
          <GroupChip
            key={g}
            group={g}
            label={GROUP_LABELS[g]}
            color={GROUP_COLORS[g]}
            count={totals[g]}
            pct={total > 0 ? Math.round((totals[g] / total) * 100) : 0}
            onClick={onGroupClick ? () => onGroupClick(g) : undefined}
          />
        ))}
      </div>

      {total === 0 && <p style={s.muted}>No ticket data yet.</p>}
    </div>
  );
}

function GroupChip({ label, color, count, pct, onClick }: {
  group: string; label: string; color: string; count: number; pct: number; onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        ...s.chip,
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: 5,
        margin: '0 -6px',
        padding: '2px 6px',
        backgroundColor: hovered && onClick ? '#243248' : 'transparent',
        transition: 'background-color 0.1s',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ ...s.chipDot, backgroundColor: color }} />
      <span style={s.chipLabel}>{label}</span>
      <span style={{ ...s.chipCount, color: count === 0 ? '#475569' : '#e2e8f0' }}>{count}</span>
      <span style={{ ...s.chipPct, color: count === 0 ? '#334155' : '#64748b' }}>{pct}%</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  label: {
    margin: 0, fontSize: 11, fontWeight: 600,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  donutWrap: { display: 'flex', justifyContent: 'center', alignItems: 'center' },
  barTrack: {
    display: 'flex', height: 10, borderRadius: 5,
    overflow: 'hidden', backgroundColor: '#0f172a', gap: 2,
  },
  barSegment: { height: '100%', minWidth: 3, transition: 'width 0.4s ease' },
  chips: { display: 'flex', flexDirection: 'column', gap: 7 },
  chip:  { display: 'flex', alignItems: 'center', gap: 7 },
  chipDot:   { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  chipLabel: { fontSize: 12, color: '#94a3b8', flex: 1 },
  chipCount: { fontSize: 13, fontWeight: 600, color: '#e2e8f0', minWidth: 24, textAlign: 'right' as const },
  chipPct:   { fontSize: 11, color: '#64748b', minWidth: 32, textAlign: 'right' as const },
  muted: { color: '#64748b', fontSize: 13, margin: 0, textAlign: 'center' },
};
