import { useState } from 'react';
import type { EpicBreakdown } from '../api/client';
import { DonutChart } from './DonutChart';

/**
 * Color mapping for the three status groups used throughout the card.
 * - `todo`: slate gray for issues not yet started
 * - `doing`: blue for issues currently in progress
 * - `done`: green for completed issues
 */
const GROUP_COLORS = { todo: '#64748b', doing: '#3b82f6', done: '#22c55e' };

/**
 * Human-readable labels mapped to each status group key.
 * Used for display in chips, tooltips, and the segmented bar.
 */
const GROUP_LABELS = { todo: 'Todo', doing: 'In Progress', done: 'Done' };

/**
 * Fixed display order for status groups.
 * Ensures consistent rendering order across all visualizations (donut, bar, chips).
 */
const GROUP_ORDER = ['todo', 'doing', 'done'] as const;

/**
 * Union type representing the three valid status group keys.
 * Derived from `GROUP_ORDER` for type safety.
 */
type Group = typeof GROUP_ORDER[number];

/**
 * Aggregated totals across all epics (or a raw breakdown) grouped by status.
 *
 * Holds per-group counts (`todo`, `doing`, `done`) plus a `total`
 * representing the sum of all issues tracked.
 */
interface GroupTotals {
  /** Count of issues in the "Todo" group */
  todo: number;
  /** Count of issues in the "In Progress" group */
  doing: number;
  /** Count of issues in the "Done" group */
  done: number;
  /** Sum of all group counts */
  total: number;
}

/**
 * Aggregates issue counts from an array of epics into grouped totals.
 *
 * Iterates over each epic's `statusBreakdown`, maps each status to its
 * corresponding group via `statusGroups`, and accumulates counts.
 * Only statuses that resolve to a known group (`todo`, `doing`, `done`)
 * are added to their respective bucket; all others still contribute to `total`.
 *
 * @param epics - Array of epic breakdowns containing per-status issue counts
 * @param statusGroups - Mapping of raw status names (e.g., "Open", "In Review") to group keys (e.g., "todo", "doing", "done")
 * @returns Aggregated `GroupTotals` object with per-group and overall counts
 */
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

/**
 * Props for the SprintProgressCard component.
 *
 * The card can operate in two modes:
 * - **Epic mode** (default): aggregates data from an array of epics
 * - **Kanban mode**: uses a raw JSON status breakdown string instead
 */
interface SprintProgressCardProps {
  /** Array of epic breakdowns to aggregate. Ignored when `statusBreakdown` is provided. */
  epics: EpicBreakdown[];
  /**
   * Mapping of raw status names (e.g., "Open", "In Review", "Blocked") to
   * high-level group keys (`"todo"`, `"doing"`, `"done"`).
   *
   * Example: `{ "Open": "todo", "In Progress": "doing", "Review": "doing", "Closed": "done" }`
   */
  statusGroups: Record<string, string>;
  /**
   * Optional callback invoked when a group chip (Todo / In Progress / Done) is clicked.
   * Receives the group key (`"todo"`, `"doing"`, or `"done"`) so the parent component
   * can filter or focus the view on that group.
   */
  onGroupClick?: (group: string) => void;
  /** Whether the board is a kanban board. Changes the header label to "Board Progress". */
  isKanban?: boolean;
  /**
   * Raw status breakdown JSON string (or object) used instead of epics for kanban boards.
   * Example: `{ "Open": 5, "In Progress": 3, "Closed": 12 }`
   * When provided, this takes precedence over `epics`.
   */
  statusBreakdown?: string | null;
}
 
/**
 * Displays aggregated sprint progress across multiple epics (or a raw kanban breakdown).
 *
 * Renders three visual elements:
 * 1. **Donut chart** — shows overall completion percentage with a center label
 * 2. **Segmented progress bar** — horizontal bar with color-coded segments for each group
 * 3. **Group chips** — clickable indicators for Todo, In Progress, and Done with counts and percentages
 *
 * The card resolves its data source based on props:
 * - If `statusBreakdown` is provided, it parses and aggregates that raw data directly (kanban mode).
 * - Otherwise, it aggregates issue counts from the `epics` array using the `statusGroups` mapping.
 *
 * When `total` is zero, a muted "No ticket data yet." message is displayed instead.
 *
 * @param epics - Array of epic breakdowns to aggregate (used when `statusBreakdown` is absent)
 * @param statusGroups - Mapping of status names to group keys
 * @param onGroupClick - Optional callback fired when a group chip is clicked
 * @param isKanban - When true, header reads "Board Progress" instead of "Sprint Progress"
 * @param statusBreakdown - Optional raw JSON breakdown; takes precedence over `epics`
 */
export function SprintProgressCard({ epics, statusGroups, onGroupClick, isKanban, statusBreakdown }: SprintProgressCardProps) {
  // Resolve data source: use raw breakdown if provided, otherwise aggregate from epics
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
  // Completion percentage rounded to nearest integer; 0 when there are no issues
  const pct = total > 0 ? Math.round((totals.done / total) * 100) : 0;

  // Build segments for the donut chart with value, color, and tooltip label per group
  const segments = GROUP_ORDER.map((g) => ({
    value: totals[g],
    color: GROUP_COLORS[g],
    label: `${GROUP_LABELS[g]}: ${totals[g]}`,
  }));

  return (
    <div style={s.card}>
      {/* Header: "Sprint Progress" or "Board Progress" depending on mode */}
      <div style={s.header}>
        <p style={s.label}>{isKanban ? 'Board Progress' : 'Sprint Progress'}</p>
      </div>

      {/* Donut chart showing completion percentage */}
      <div style={s.donutWrap}>
        <DonutChart
          segments={segments}
          size={140}
          strokeWidth={14}
          centerLabel={`${pct}%`}
          centerSub={`${totals.done} / ${total} done`}
        />
      </div>

      {/* Segmented progress bar — hidden when there is no data */}
      {total > 0 && (
        <div style={s.barTrack}>
          {GROUP_ORDER.map((g) => {
            const count = totals[g];
            // Skip rendering segments with zero count
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

      {/* Interactive group chips — each shows label, count, and percentage */}
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

      {/* Empty state message when no issues are tracked */}
      {total === 0 && <p style={s.muted}>No ticket data yet.</p>}
    </div>
  );
}


/**
 * Interactive chip displaying statistics for a single status group.
 *
 * Renders a small row containing:
 * - A colored dot indicating the group's category
 * - The group's human-readable label
 * - The issue count (dimmed when zero)
 * - The percentage of total issues this group represents (dimmed when zero)
 *
 * When `onClick` is provided, the chip becomes clickable with a hover highlight
 * effect. Otherwise it renders as a static info indicator.
 *
 * @param label - Human-readable group name (e.g., `'Todo'`, `'Done'`)
 * @param color - Hex color string for the group's indicator dot
 * @param count - Number of issues in this group
 * @param pct - Percentage of total issues this group represents
 * @param onClick - Optional click handler; presence of this prop enables interactivity
 */
function GroupChip({ label, color, count, pct, onClick }: {
  /** Human-readable label (e.g., 'Todo', 'Done') */
  label: string;
  /** Color of the group indicator dot */
  color: string;
  /** Count of issues in this group */
  count: number;
  /** Percentage of total issues represented by this group */
  pct: number;
  /** Optional callback when chip is clicked */
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        ...s.chip,
        // Only show pointer cursor when the chip is interactive
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: 5,
        margin: '0 -6px',
        padding: '2px 6px',
        // Highlight background on hover, but only for clickable chips
        backgroundColor: hovered && onClick ? '#243248' : 'transparent',
        transition: 'background-color 0.1s',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Colored indicator dot */}
      <span style={{ ...s.chipDot, backgroundColor: color }} />
      {/* Group label */}
      <span style={s.chipLabel}>{label}</span>
      {/* Issue count — dimmed when zero to signal no data */}
      <span style={{ ...s.chipCount, color: count === 0 ? '#475569' : '#e2e8f0' }}>{count}</span>
      {/* Percentage — dimmed when zero to signal no data */}
      <span style={{ ...s.chipPct, color: count === 0 ? '#334155' : '#64748b' }}>{pct}%</span>
    </div>
  );
}

/**
 * Inline styles for the SprintProgressCard component.
 *
 * All styles use a slate-based dark theme palette consistent with the
 * dashboard's design system. Each property is documented with its
 * visual purpose below.
 */
const s: Record<string, React.CSSProperties> = {
  /**
   * Main card container.
   * Dark slate background with subtle border, rounded corners, and vertical flex layout.
   */
  card: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  /**
   * Section label text (e.g., "Sprint Progress" or "Board Progress").
   * Small, uppercase, muted text with increased letter spacing.
   */
  label: {
    margin: 0, fontSize: 11, fontWeight: 600,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  /**
   * Flex container wrapping the section label.
   * Provides a small bottom margin to separate from the donut chart.
   */
  header: { display: 'flex', marginBottom: 8 },
  /**
   * Centered wrapper for the donut chart.
   * Uses flexbox to horizontally and vertically center the chart within the card.
   */
  donutWrap: { display: 'flex', justifyContent: 'center', alignItems: 'center' },
  /**
   * Segmented progress bar track.
   * Dark background with rounded corners; holds individual color-coded segments.
   */
  barTrack: {
    display: 'flex', height: 10, borderRadius: 5,
    overflow: 'hidden', backgroundColor: '#0f172a', gap: 2,
  },
  /**
   * Individual segment within the progress bar.
   * Fills its width based on the group's proportion of the total; includes a smooth transition.
   */
  barSegment: { height: '100%', minWidth: 3, transition: 'width 0.4s ease' },
  /**
   * Container for group chips.
   * Vertical column layout with consistent spacing between chips.
   */
  chips: { display: 'flex', flexDirection: 'column', gap: 7 },
  /**
   * Individual group chip row.
   * Horizontal flex layout aligning the color dot, label, count, and percentage.
   */
  chip: { display: 'flex', alignItems: 'center', gap: 7 },
  /**
   * Small circular color dot that visually identifies each group.
   * Fixed 7×7px circle that never shrinks.
   */
  chipDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  /**
   * Group label text (e.g., "Todo", "In Progress", "Done").
   * Muted slate color with flex growth to push count and percentage to the right.
   */
  chipLabel: { fontSize: 12, color: '#94a3b8', flex: 1 },
  /**
   * Issue count display.
   * Bold, bright text aligned right; dimmed when the count is zero.
   */
  chipCount: { fontSize: 13, fontWeight: 600, color: '#e2e8f0', minWidth: 24, textAlign: 'right' as const },
  /**
   * Percentage display.
   * Muted text aligned right; dimmed when the count is zero.
   */
  chipPct: { fontSize: 11, color: '#64748b', minWidth: 32, textAlign: 'right' as const },
  /**
   * Muted text for empty states (e.g., "No ticket data yet.").
   * Centered, dimmed text centered within the card.
   */
  muted: { color: '#64748b', fontSize: 13, margin: 0, textAlign: 'center' },
};
