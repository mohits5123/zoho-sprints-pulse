/**
 * BurndownCard - Sprint Burndown Chart Component
 * 
 * A sprint burndown visualization that compares actual vs ideal progress towards task completion.
 * Displays estimated vs actual data points with interactive tooltips, overdue indicators, and timeline markers.
 */

import { useEffect, useRef, useState } from 'react';
import { fetchBurndownData, type BurndownPoint, type SprintSnapshot } from '../api/client';

// Chart dimensions and padding
const PAD = { top: 24, right: 24, bottom: 40, left: 48 };
const W = 520; // Chart width in pixels
const H = 210; // Chart height in pixels
const IW = W - PAD.left - PAD.right;
const IH = H - PAD.top  - PAD.bottom;

/**
 * Converts a Date object to YYYY-MM-DD string.
 * 
 * @param d - Date to format
 * @returns ISO date string in YYYY-MM-DD format (e.g., "2024-01-15")
 */
function toDateStr(d: Date): string {
  // slice(0, 10) extracts "YYYY-MM-DD" from the full ISO string "YYYY-MM-DDTHH:MM:SS.sssZ"
  return d.toISOString().slice(0, 10);
}

/**
 * Formats a date string as "d MMM" (e.g., "6 Jun") using Indian English locale.
 * 
 * @param iso - ISO date string in YYYY-MM-DD format
 * @returns Formatted label like "6 Jun" or "15 Dec"
 * 
 * Note: Appends 'T00:00:00' to avoid timezone offset issues that can shift the date
 * when constructing Date from a bare YYYY-MM-DD string.
 */
function fmtLabel(iso: string): string {
  // Appending T00:00:00 ensures the date is interpreted in local timezone rather than UTC,
  // which would shift the day for users in positive UTC-offset timezones (e.g., IST, UTC+5:30).
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Builds a Map of snapshots keyed by date for O(1) lookup.
 * 
 * @param snapshots - Array of burndown data points from the API
 * @returns Map with date strings as keys for fast lookup during timeline construction
 */
function buildSnapshotMap(snapshots: BurndownPoint[]): Map<string, BurndownPoint> {
  return new Map(snapshots.map((s) => [s.date, s]));
}

/**
 * Generates all calendar days between start and end dates (inclusive).
 * 
 * @param start - Sprint start date
 * @param axisEnd - Chart axis end date (may extend beyond sprint end for overdue tracking)
 * @returns Array of YYYY-MM-DD strings for every calendar day in range
 */
function sprintDays(start: Date, axisEnd: Date): string[] {
  const days: string[] = [];
  const cur = new Date(start);
  while (cur <= axisEnd) {
    days.push(toDateStr(cur));
    // setDate with relative value mutates in-place; safe here since `cur` is a fresh Date copy
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/**
 * Timeline point representing a single day's burndown state
 */
interface TimelinePoint {
  date:       string;     // YYYY-MM-DD format
  remaining:  number;     // Estimated remaining tasks on this day
  doneCount:  number;     // Number of tasks completed by end of previous day
  totalCount: number;     // Total tasks at sprint start (unchanging)
  isActual:   boolean;    // Whether data came from actual snapshot or interpolation
}

/**
 * Builds the complete timeline with actual and interpolated points.
 * 
 * Timeline construction strategy:
 * - Days with snapshots: uses real Zoho data (solid line, `isActual: true`)
 * - Gaps between snapshots: linearly interpolates (dashed line, `isActual: false`)
 * - Before first snapshot: holds constant at totalCount (no data yet)
 * - After last snapshot: flatlines (sprint may have finished or is idle)
 * 
 * @param days - Array of YYYY-MM-DD date strings to generate points for
 * @param snapshots - Map of actual snapshot data keyed by date
 * @param totalFallback - Total task count to use as baseline when no snapshots exist
 * @returns TimelinePoint array with one entry per day, including actual and interpolated values
 */
function buildTimeline(
  days: string[],
  snapshots: Map<string, BurndownPoint>,
  totalFallback: number,
): TimelinePoint[] {
  // Index known snapshot points by their array position (not date string)
  // so we can do linear interpolation using integer indices.
  const known = new Map<number, { remaining: number; doneCount: number; totalCount: number }>();

  for (let i = 0; i < days.length; i++) {
    const snap = snapshots.get(days[i]);
    if (snap) {
      known.set(i, {
        remaining:  snap.totalCount - snap.doneCount,
        doneCount:  snap.doneCount,
        totalCount: snap.totalCount,
      });
    }
  }

  // Use the last snapshot's total task count, or fall back to the initial totalCount
  // if no snapshots are available at all.
  const totalCount = snapshots.size > 0
    ? [...snapshots.values()][snapshots.size - 1].totalCount
    : totalFallback;

  // Generate a timeline point for each calendar day in the sprint range
  return days.map((date, i) => {
    if (known.has(i)) {
      // This day has an actual snapshot — use real data directly
      const k = known.get(i)!;
      return { date, remaining: k.remaining, doneCount: k.doneCount, totalCount: k.totalCount, isActual: true };
    }

    // Find the nearest known snapshot indices before (prevIdx) and after (nextIdx) this day
    // These define the interpolation bounds for this gap.
    let prevIdx = -1;
    let nextIdx = days.length;
    for (const [ki] of known) {
      if (ki < i && ki > prevIdx) prevIdx = ki;
      if (ki > i && ki < nextIdx) nextIdx = ki;
    }

    let remaining: number;
    let doneCount: number;

    if (prevIdx === -1 && nextIdx === days.length) {
      // No snapshots exist at all — flatline at totalCount (no burndown yet)
      remaining = totalCount;
      doneCount = 0;
    } else if (prevIdx === -1) {
      // Before the first snapshot — extrapolate toward the first known point
      // Uses a proportional estimate based on distance to the first snapshot.
      const next = known.get(nextIdx)!;
      remaining = Math.round(Math.min(totalCount, next.remaining + next.remaining / (nextIdx - i)));
      doneCount = totalCount - remaining;
    } else if (nextIdx === days.length) {
      // Past the last snapshot — flatline at the last known state
      // The sprint may have ended early or data collection paused.
      const prev = known.get(prevIdx)!;
      remaining = prev.remaining;
      doneCount = prev.doneCount;
    } else {
      // Between two snapshots — linear interpolation based on relative position
      // t ranges from 0 (at prevIdx) to 1 (at nextIdx).
      const prev = known.get(prevIdx)!;
      const next = known.get(nextIdx)!;
      const t    = (i - prevIdx) / (nextIdx - prevIdx);
      remaining  = Math.round(prev.remaining + t * (next.remaining - prev.remaining));
      doneCount  = Math.round(prev.doneCount  + t * (next.doneCount  - prev.doneCount));
    }

    return { date, remaining, doneCount, totalCount, isActual: false };
  });
}

/**
 * BurndownCard Component Props
 */
interface BurndownCardProps {
  /** Sprint snapshot data containing dates, status, and Zoho ID */
  sprint: SprintSnapshot;
  /** Number of tasks completed (from parent component) */
  doneCount: number;
  /** Total tasks at sprint start (from parent component) */
  totalCount: number;
}

/**
 * BurndownCard - Sprint Burndown Visualization Component
 * 
 * Displays a sprint burndown chart comparing:
 * - Actual progress from Zoho snapshots (solid blue line with dots)
 * - Ideal burndown trajectory (dashed gray line from start to due date)
 * - Estimated progress between snapshots (dashed blue line)
 * 
 * Features:
 * - Interactive hover tooltips showing detailed metrics
 * - Overdue zone shading (light red background when past due date)
 * - Vertical markers for: Due date, Today (when overdue), Sprint start/mid/end
 * - Dynamic axis labels based on sprint timeline and current date
 * - Legend showing all line types and data sources
 * 
 * States displayed:
 * - Days remaining / overdue indicator in status pill
 * - Completed (green), Overdue (red), Active with countdown (orange)
 */
export function BurndownCard({ sprint, doneCount, totalCount }: BurndownCardProps) {
  const [snapshots, setSnapshots] = useState<BurndownPoint[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; point: TimelinePoint; svgX: number;
  } | null>(null);

  // Parse sprint dates, handling sentinel value "-1" which indicates missing/invalid dates
  const start = sprint.startDate && sprint.startDate !== '-1' ? new Date(sprint.startDate) : null;
  const end   = sprint.endDate   && sprint.endDate   !== '-1' ? new Date(sprint.endDate)   : null;

  // Fetch burndown data from API when sprint changes
  useEffect(() => {
    if (!sprint.zohoId) return;
    fetchBurndownData(sprint.zohoId, { doneCount, totalCount })
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
  }, [sprint.zohoId, doneCount, totalCount]);

  // Early return: need valid dates and at least one task to render anything meaningful
  if (!start || !end || totalCount === 0) {
    return (
      <div style={s.card}>
        <p style={s.label}>Sprint Burndown</p>
        <p style={s.muted}>Not enough data (missing sprint dates or tickets).</p>
      </div>
    );
  }

  const now         = new Date();
  const isCompleted = sprint.status === 'completed' || sprint.status === 'closed';
  const isOverdue   = now > end && !isCompleted;

  // Determine the rightmost point of the chart axis.
  // For completed sprints: extends to whichever is later — the due date or the last snapshot.
  // For active sprints: extends to today so we can show progress up to the current moment.
  const lastSnap    = snapshots.length > 0 ? new Date(snapshots[snapshots.length - 1].date + 'T00:00:00') : end;
  const axisEnd     = isCompleted
    ? new Date(Math.max(end.getTime(), lastSnap.getTime()))
    : new Date(Math.max(end.getTime(), now.getTime()));

  // Build timeline data
  const snapshotMap = buildSnapshotMap(snapshots);
  const days        = sprintDays(start, axisEnd);
  const timeline    = buildTimeline(days, snapshotMap, totalCount);

  // Coordinate scaling: maps dates → X pixels and remaining counts → Y pixels.
  const totalMs = axisEnd.getTime() - start.getTime();

  // Dynamic Y-axis max: the highest "remaining" value seen in the timeline (can exceed
  // the original totalCount when issues are added to the sprint after it starts).
  // Adding a 10% top-padding margin keeps the peak point inside the chart bounds.
  const peakRemaining = timeline.reduce((m, p) => Math.max(m, p.remaining), totalCount);
  const yMax = Math.ceil(peakRemaining * 1.1) || totalCount;

  /**
   * Converts a date to its X pixel position within the chart area.
   * Clamps the result to [PAD.left, PAD.left + IW] to handle out-of-range dates.
   */
  const xOf = (date: Date) => {
    // Math.min/max clamps the millisecond offset to [0, totalMs], preventing values outside the chart bounds
    const ms = Math.min(Math.max(date.getTime() - start.getTime(), 0), totalMs);
    return PAD.left + (ms / totalMs) * IW;
  };

  /**
   * Converts a remaining task count to its Y pixel position.
   * Inverted axis: 0 remaining → bottom of chart, yMax → top of chart.
   * Uses dynamic yMax so the chart stays within bounds even when issues are added mid-sprint.
   */
  const yOf = (remaining: number) => PAD.top + (1 - remaining / yMax) * IH;

  // Calculate overdue zone geometry
  const endX   = xOf(end);
  const showOverdueZone = axisEnd > end;

  // Ideal burndown line (start: totalCount → end: 0)
  const ix1 = PAD.left;
  const iy1 = yOf(totalCount);
  const ix2 = endX;
  const iy2 = yOf(0);

  // Split timeline into contiguous segments of the same type (actual vs interpolated).
  // This allows rendering each segment with its own stroke style (solid vs dashed).
  // When switching between types, carry over the last point of the previous segment
  // to ensure visual continuity at the transition point.
  const actualPts = timeline.filter((p) => p.isActual);
  const allPts    = timeline;

  type Seg = { pts: TimelinePoint[]; isActual: boolean };
  const segments: Seg[] = [];
  let cur: Seg | null = null;
  for (const pt of allPts) {
    if (!cur || cur.isActual !== pt.isActual) {
      // Start a new segment; carry over the last point for visual continuity
      const carry: TimelinePoint[] = cur ? [cur.pts[cur.pts.length - 1]] : [];
      cur = { pts: [...carry, pt], isActual: pt.isActual };
      segments.push(cur);
    } else {
      cur.pts.push(pt);
    }
  }

  /**
   * Converts an array of timeline points into an SVG path `d` string.
   * First point uses 'M' (move to), subsequent points use 'L' (line to).
   */
  const segPath = (pts: TimelinePoint[]) =>
    pts.map((p, i) => {
      const px = xOf(new Date(p.date + 'T00:00:00'));
      const py = yOf(p.remaining);
      return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
    }).join(' ');

 // Y-axis grid lines at 0%, 25%, 50%, 75%, 100% of yMax (dynamic scale)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * yMax));

  // X-axis tick labels: start, midpoint, due date (always), and "Today" (conditionally)
  const plannedMid = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
  const xTicks: { d: Date; label: string; emphasize?: boolean }[] = [
    { d: start,       label: fmtLabel(toDateStr(start)) },
    { d: plannedMid,  label: fmtLabel(toDateStr(plannedMid)) },
    { d: end,         label: fmtLabel(toDateStr(end)), emphasize: true },
  ];

  // Only show "Today" tick when sprint is overdue by more than 1.5 days
  // to avoid cluttering the chart with a "Today" label during normal sprint progress.
  if (showOverdueZone && (now.getTime() - end.getTime()) > 86400000 * 1.5) {
    xTicks.push({ d: now, label: 'Today', emphasize: true });
  }

  const todayX  = xOf(now);
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86400000);
  const overdueBy = Math.ceil((now.getTime() - end.getTime()) / 86400000);

  // Status pill: color-coded based on sprint state — red (overdue), green (completed), amber (active)
  const pillColor = isOverdue ? '#ef4444' : isCompleted ? '#22c55e' : '#f59e0b';
  const daysLabel = isCompleted
    ? 'Completed'
    : isOverdue
    ? `${overdueBy}d overdue`
    : daysLeft === 0 ? 'Last day' : `${daysLeft}d left`;

  /**
   * Handles mouse movement over the SVG to show an interactive tooltip.
   * Finds the nearest timeline point to the cursor's X position and displays
   * remaining tasks, completion progress, and overdue status.
   */
  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    
    const rect = svg.getBoundingClientRect();
    // Convert client coordinates to SVG viewBox coordinates
    const svgX = ((e.clientX - rect.left) / rect.width) * W;

    // Hide tooltip if cursor is outside the chart's drawable area
    if (svgX < PAD.left || svgX > PAD.left + IW || allPts.length === 0) {
      setTooltip(null);
      return;
    }

    // Find the timeline point whose X position is closest to the cursor
    let closest = allPts[0];
    let minDist  = Infinity;
    for (const pt of allPts) {
      const px = xOf(new Date(pt.date + 'T00:00:00'));
      const d  = Math.abs(px - svgX);
      if (d < minDist) { minDist = d; closest = pt; }
    }

    const px = xOf(new Date(closest.date + 'T00:00:00'));
    const py = yOf(closest.remaining);
    setTooltip({ x: px, y: py, point: closest, svgX: px });
  }

  return (
    <div style={s.card}>
      {/* Header with label and status pill */}
      <div style={s.headerRow}>
        <p style={s.label}>
          Sprint Burndown <span style={s.labelSub}>(estimated)</span>
        </p>
        <span style={{ ...s.pill, color: pillColor, borderColor: `${pillColor}44`, backgroundColor: `${pillColor}11` }}>
          {daysLabel}
        </span>
      </div>

      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ overflow: 'visible', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
          {/* Overdue zone: subtle red shading for the area past the due date */}
        {showOverdueZone && (
          <rect
            x={endX} y={PAD.top}
            width={PAD.left + IW - endX} height={IH}
            // Hex alpha: #ef4444 with ~3% opacity
            fill="#ef444409"
          />
        )}

        {/* Y-axis grid lines and labels */}
        {yTicks.map((t) => {
          const y = yOf(t);
          return (
            <g key={t}>
              <line x1={PAD.left} y1={y} x2={PAD.left + IW} y2={y}
                stroke="#1e293b" strokeWidth={1} />
              <text x={PAD.left - 6} y={y} textAnchor="end" dominantBaseline="middle"
                fill="#475569" fontSize={10}>{t}</text>
            </g>
          );
        })}

        {/* X-axis tick labels with emphasis on due date */}
        {xTicks.map(({ d, label, emphasize }) => (
          <text
            key={label}
            x={xOf(d)}
            y={H - PAD.bottom + 14}
            textAnchor="middle"
            fill={emphasize ? '#94a3b8' : '#475569'}
            fontSize={10}
            fontWeight={emphasize ? 600 : 400}
          >
            {label}
          </text>
        ))}

        {/* Ideal burndown line: the perfect straight-line trajectory from totalCount at sprint start to 0 at due date */}
        <line x1={ix1} y1={iy1} x2={ix2} y2={iy2}
          stroke="#334155" strokeWidth={1.5} strokeDasharray="6 4" />

        {/* Due date vertical marker */}
        {showOverdueZone && (
          <>
            <line x1={endX} y1={PAD.top} x2={endX} y2={PAD.top + IH}
              stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={endX} y={PAD.top - 7} textAnchor="middle"
              fill="#f59e0b" fontSize={9} fontWeight={600}>Due</text>
          </>
        )}

        {/* Today vertical guide: shows when overdue */}
        {now >= start && now <= axisEnd && (
          <line x1={todayX} y1={PAD.top} x2={todayX} y2={PAD.top + IH}
            stroke="#475569" strokeWidth={1} strokeDasharray="3 3" />
        )}

       {/* Actual vs estimated line segments */}
        {/* Solid blue = actual snapshot data; dashed semi-transparent blue = interpolated estimates */}
        {segments.map((seg, i) => (
          <path
            key={i}
            d={segPath(seg.pts)}
            fill="none"
            stroke={seg.isActual ? '#3b82f6' : '#3b82f680'}
            strokeWidth={seg.isActual ? 2 : 1.5}
            // Solid stroke for actual data, dashed for estimated/interpolated
            strokeDasharray={seg.isActual ? undefined : '4 3'}
          />
        ))}

       {/* Actual data point markers: solid blue dots at each snapshot location */}
        {actualPts.map((p) => {
          const px = xOf(new Date(p.date + 'T00:00:00'));
          const py = yOf(p.remaining);
          return <circle key={p.date} cx={px} cy={py} r={3.5} fill="#3b82f6" />;
        })}

        {/* Axis borders */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + IH}
          stroke="#334155" strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top + IH} x2={PAD.left + IW} y2={PAD.top + IH}
          stroke="#334155" strokeWidth={1} />

        {/* Interactive hover crosshair and tooltip (rendered via inline IIFE to access tooltip state) */}
        {tooltip && (() => {
          const { x, y, point } = tooltip;
          // A point is overdue if its date is past the sprint's end date
          const overduePoint = point.date > toDateStr(end);

          // Tooltip width in pixels
          const tipW = 138;
          // Flip tooltip to the left if it would overflow the right edge of the SVG
          const tipX = x + tipW + 10 > W ? x - tipW - 6 : x + 10;
          // Clamp tooltip Y to stay within the chart area
          const tipY = Math.max(PAD.top, Math.min(y - 30, PAD.top + IH - 62));

          return (
            <>
              {/* Hover crosshair line */}
              <line x1={x} y1={PAD.top} x2={x} y2={PAD.top + IH}
                stroke="#60a5fa" strokeWidth={1} strokeDasharray="3 2" opacity={0.5} />

              {/* Highlighted point on chart */}
              <circle cx={x} cy={y} r={5}
                fill={point.isActual ? '#3b82f6' : '#60a5fa80'}
                stroke={point.isActual ? '#93c5fd' : '#60a5fa'} strokeWidth={1.5} />

              {/* Tooltip box */}
              <rect x={tipX} y={tipY} width={tipW} height={overduePoint ? 72 : 58} rx={6}
                fill="#0f172a" stroke="#334155" strokeWidth={1} />

      {/* Date label with contextual annotations */}
              {/* Shows formatted date; appends "est" in amber for interpolated points, "overdue" in red for past-due */}
              <text x={tipX + 8} y={tipY + 14} fill="#94a3b8" fontSize={10}>
                {fmtLabel(point.date)}
                {!point.isActual && <tspan fill="#f59e0b" fontSize={9}> est</tspan>}
                {overduePoint && <tspan fill="#ef4444" fontSize={9}> overdue</tspan>}
              </text>

              {/* Remaining tasks count — bold for emphasis */}
              <text x={tipX + 8} y={tipY + 30} fill="#f1f5f9" fontSize={12} fontWeight={700}>
                {point.remaining} remaining
              </text>

              {/* Completion progress: completed / total */}
              <text x={tipX + 8} y={tipY + 46} fill="#64748b" fontSize={10}>
                {point.doneCount} / {point.totalCount} done
              </text>

              {/* Overdue indicator: shows days past due for points after the sprint end date */}
              {overduePoint && (
                <text x={tipX + 8} y={tipY + 62} fill="#ef444499" fontSize={10}>
                  {Math.round((new Date(point.date + 'T00:00:00').getTime() - end.getTime()) / 86400000)}d past due
                </text>
              )}
            </>
          );
        })()}
      </svg>

      {/* Legend explaining chart line types and data sources */}
      {/* Ideal = dashed gray (perfect trajectory), Actual = solid blue (real data),
          Estimated = dashed blue (interpolated), Due date = dashed amber (conditional) */}
      <div style={s.legend}>
        <span style={s.legendItem}>
          <span style={{ ...s.legendDash, borderTop: '2px dashed #334155' }} /> Ideal
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.legendDash, borderTop: '2px solid #3b82f6' }} /> Actual
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.legendDash, borderTop: '2px dashed #3b82f680' }} />
          <span style={{ color: '#60a5fa80' }}>Estimated</span>
        </span>
        {/* Due date legend item only shown when an overdue zone exists */}
        {showOverdueZone && (
          <span style={s.legendItem}>
            <span style={{ ...s.legendDash, borderTop: '2px dashed #f59e0b' }} />
            <span style={{ color: '#f59e0b' }}>Due date</span>
          </span>
        )}
        {/* Snapshot count: dynamically shows how many real data points were collected */}
        <span style={{ ...s.legendItem, marginLeft: 'auto' }}>
          <span style={s.legendDot} />
          {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

/**
 * Component styles object (React.CSSProperties).
 * 
 * All styles use a slate-based dark theme (#1e293b background, #334155 borders).
 * Colors are chosen for accessibility and consistency with the dashboard's design system.
 */
const s: Record<string, React.CSSProperties> = {
  // Main card container: dark background with border, vertical layout
  card: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 8,
    // Spans 2 grid columns to give the chart enough horizontal space
    gridColumn: 'span 2',
  },
  // Header row: label on the left, status pill on the right
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  // Section label: uppercase, small, muted color
  label: {
    margin: 0, fontSize: 11, fontWeight: 600,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  // Sub-label (e.g., "(estimated)"): smaller, normal weight, no transformation
  labelSub: { fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 10 },
  // Status pill: rounded badge with colored border and background
  pill: {
    fontSize: 11, fontWeight: 700, padding: '3px 8px',
    borderRadius: 20, border: '1px solid',
  },
  // Muted text for informational messages
  muted: { color: '#64748b', fontSize: 13, margin: 0 },
  // Legend row: horizontal with wrapping, items spaced evenly
  legend: { display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' as const, marginTop: 2 },
  // Individual legend item: label + line sample
  legendItem: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b' },
  // Sample line swatch: 20px wide, 0 height with top border for the line style
  legendDash: { display: 'inline-block', width: 20, height: 0 },
  // Snapshot dot indicator: small filled circle
  legendDot:  { display: 'inline-block', width: 6, height: 6, borderRadius: '50%', backgroundColor: '#3b82f6' },
};
