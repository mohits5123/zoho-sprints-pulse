import { useState } from 'react';
import type { EpicBreakdown } from '../api/client';
import { DonutChart } from './DonutChart';

/** Color mapping for status groups */
const GROUP_COLORS = { todo: '#64748b', doing: '#3b82f6', done: '#22c55e' };

/** Human-readable labels for each status group */
const GROUP_LABELS = { todo: 'Todo', doing: 'In Progress', done: 'Done' };

/** Fixed order for group display */
const GROUP_ORDER = ['todo', 'doing', 'done'] as const;

/** Type for status group values */
type Group = typeof GROUP_ORDER[number];

/** Aggregated totals across all epics by group */
interface GroupTotals {
  todo: number;
  doing: number;
  done: number;
  total: number;
}

/** Aggregate issue counts from epics into group totals */
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
  /** Array of epic breakdowns to aggregate */
  epics: EpicBreakdown[];
  /** Status to group mapping: statusName → group */
  statusGroups: Record<string, string>;
  /** Callback when a group chip is clicked (optional) */
  onGroupClick?: (group: string) => void;
  /** Whether the board is a kanban board (optional) */
  isKanban?: boolean;
  /** Raw status breakdown JSON string (optional, used for kanban) */
  statusBreakdown?: string | null;
}
 
/**
 * SprintProgressCard displays aggregated sprint progress across multiple epics
 * Shows a donut chart with overall completion percentage
 * Includes segmented progress bar and interactive group chips
 * Groups statuses into 'Todo', 'In Progress', and 'Done' buckets
 */
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
    color: GROUP_COLORS[g],
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


/**
 * Interactive chip displaying group statistics with click handler
 * Shows group label, issue count, and percentage of total
 * Clickable when an onClick prop is provided
 */
function GroupChip({ label, color, count, pct, onClick }: {
  /** Human-readable label (e.g., 'Todo', 'Done') */
  label: string;
  /** Color of the group indicator */
  color: string;
  /** Count of issues in this group */
  count: number;
  /** Percentage of total */
  pct: number;
  /** Optional callback when chip is clicked */
  onClick?: () => void;
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

/**
 * Inline styles for SprintProgressCard component
 * Configures the dark theme card appearance with donut chart and progress visualization
 */
const s: Record<string, React.CSSProperties> = {
  /** Main card container with dark background theme */
  card: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  /** Section label text */
  label: {
    margin: 0, fontSize: 11, fontWeight: 600,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  /** Header container for label */
  header: { display: 'flex', marginBottom: 8 },
  /** Centered wrapper for donut chart */
  donutWrap: { display: 'flex', justifyContent: 'center', alignItems: 'center' },
  /** Segmented progress bar track */
  barTrack: {
    display: 'flex', height: 10, borderRadius: 5,
    overflow: 'hidden', backgroundColor: '#0f172a', gap: 2,
  },
  /** Individual segment in progress bar */
  barSegment: { height: '100%', minWidth: 3, transition: 'width 0.4s ease' },
  /** Group chips container (column layout) */
  chips: { display: 'flex', flexDirection: 'column', gap: 7 },
  /** Individual group chip row */
  chip: { display: 'flex', alignItems: 'center', gap: 7 },
  /** Color dot in chip */
  chipDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  /** Group label text */
  chipLabel: { fontSize: 12, color: '#94a3b8', flex: 1 },
  /** Issue count display */
  chipCount: { fontSize: 13, fontWeight: 600, color: '#e2e8f0', minWidth: 24, textAlign: 'right' as const },
  /** Percentage display */
  chipPct: { fontSize: 11, color: '#64748b', minWidth: 32, textAlign: 'right' as const },
  /** Muted text for empty states */
  muted: { color: '#64748b', fontSize: 13, margin: 0, textAlign: 'center' },
};
