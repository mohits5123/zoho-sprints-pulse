import { useState } from 'react';
import type { EpicBreakdown } from '../api/client';
import { DonutChart } from './DonutChart';
import { C, R, font, groupColors } from '../theme';

const GROUP_LABELS = { todo: 'Todo', doing: 'In Progress', done: 'Done' };
const GROUP_ORDER = ['todo', 'doing', 'done'] as const;
type Group = typeof GROUP_ORDER[number];

interface GroupTotals {
  todo: number;
  doing: number;
  done: number;
  total: number;
}

function aggregate(epics: EpicBreakdown[], statusGroups: Record<string, string>): GroupTotals {
  const t: GroupTotals = { todo: 0, doing: 0, done: 0, total: 0 };
  for (const epic of epics) {
    for (const [status, count] of Object.entries(epic.statusBreakdown)) {
       const g = statusGroups[status] as Group;
      if (g in t) (t[g] as number) += count;
      t.total += count;
    }
  }
  return t;
}

interface SprintProgressCardProps {
  epics: EpicBreakdown[];
  statusGroups: Record<string, string>;
  onGroupClick?: (group: string) => void;
  isKanban?: boolean;
  statusBreakdown?: string | null;
}
 
export function SprintProgressCard({ epics, statusGroups, onGroupClick, isKanban, statusBreakdown }: SprintProgressCardProps) {
  const totals = statusBreakdown
    ? (function() {
          const parsed = (typeof statusBreakdown === 'string' ? JSON.parse(statusBreakdown) : statusBreakdown) as Record<string, number>;
        const t: GroupTotals = { todo: 0, doing: 0, done: 0, total: 0 };
        for (const [status, count] of Object.entries(parsed)) {
          const g = statusGroups[status] as Group;
          if (g in t) {
            (t[g] as number) += count;
          }
          t.total += count;
        }
        return t;
      })()
    : aggregate(epics, statusGroups);
  const { total } = totals;
  const pct = total > 0 ? Math.round((totals.done / total) * 100) : 0;

  const segments = GROUP_ORDER.map((g) => ({
    value: totals[g],
    color: groupColors[g],
    label: `${GROUP_LABELS[g]}: ${totals[g]}`,
  }));

  return (
    <div style={s.card}>
      <div style={s.header}>
        <p style={s.label}>{isKanban ? 'Board Progress' : 'Sprint Progress'}</p>
      </div>

      <div style={s.donutWrap}>
        <DonutChart
          segments={segments}
          size={140}
          strokeWidth={6}
          centerLabel={`${pct}%`}
          centerSub={`${totals.done} / ${total} done`}
        />
      </div>

      <div style={s.chips}>
        {GROUP_ORDER.map((g) => (
          <GroupChip
            key={g}
            label={GROUP_LABELS[g]}
            color={groupColors[g]}
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
  label: string;
  color: string;
  count: number;
  pct: number;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        ...s.chip,
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: R.xs,
        margin: '0 -6px',
        padding: '2px 6px',
        backgroundColor: hovered && onClick ? C.surface2 : 'transparent',
        transition: 'background-color 0.1s',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ ...s.chipDot, backgroundColor: color }} />
      <span style={s.chipLabel}>{label}</span>
      <span style={{ ...s.chipCount, color: count === 0 ? C.inkTertiary : C.inkMuted }}>{count}</span>
      <span style={{ ...s.chipPct, color: count === 0 ? C.hairline : C.inkTertiary }}>{pct}%</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: C.surface1, border: `1px solid ${C.hairline}`,
    borderRadius: R.lg, padding: '24px',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  label: {
    margin: 0, fontSize: 13, fontWeight: 500,
    color: C.inkTertiary, textTransform: 'uppercase', letterSpacing: '0.4px',
    fontFamily: font.text,
  },
  header: { display: 'flex', marginBottom: 8 },
  donutWrap: { display: 'flex', justifyContent: 'center', alignItems: 'center' },
  chips: { display: 'flex', flexDirection: 'column', gap: 7 },
  chip: { display: 'flex', alignItems: 'center', gap: 7 },
  chipDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  chipLabel: { fontSize: 14, color: C.inkSubtle, flex: 1, fontFamily: font.text },
  chipCount: { fontSize: 14, fontWeight: 500, color: C.inkMuted, minWidth: 24, textAlign: 'right' as const, fontFamily: font.text },
  chipPct: { fontSize: 12, color: C.inkTertiary, minWidth: 32, textAlign: 'right' as const, fontFamily: font.text },
  muted: { color: C.inkTertiary, fontSize: 14, margin: 0, textAlign: 'center', fontFamily: font.text },
};
