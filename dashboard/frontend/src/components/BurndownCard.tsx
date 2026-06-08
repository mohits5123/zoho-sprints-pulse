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
 * Converts a Date object to YYYY-MM-DD string
 */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Formats a date string as day.month (e.g., "6 Jun")
 */
function fmtLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Builds a Map of snapshots keyed by date for O(1) lookup
 */
function buildSnapshotMap(snapshots: BurndownPoint[]): Map<string, BurndownPoint> {
  return new Map(snapshots.map((s) => [s.date, s]));
}

/**
 * Generates all calendar days between start and end dates (inclusive)
 */
function sprintDays(start: Date, axisEnd: Date): string[] {
  const days: string[] = [];
  const cur = new Date(start);
  while (cur <= axisEnd) {
    days.push(toDateStr(cur));
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
 * - For days with snapshots: uses real Zoho data (solid line)
 * - For gaps between snapshots: linearly interpolates (dashed line)
 * - Before first snapshot: holds constant at totalCount
 * - After last snapshot: flatlines (sprint may have finished or is idle)
 * 
 * @param days - Array of date strings to generate points for
 * @param snapshots - Map of actual snapshot data by date
 * @param totalFallback - Total task count to use if no snapshots exist
 */
function buildTimeline(
  days: string[],
  snapshots: Map<string, BurndownPoint>,
  totalFallback: number,
): TimelinePoint[] {
  // Index known snapshot points by array index (not date string)
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

  // Use last snapshot's total or fallback value
  const totalCount = snapshots.size > 0
    ? [...snapshots.values()][snapshots.size - 1].totalCount
    : totalFallback;

  // Generate point for each day
  return days.map((date, i) => {
    if (known.has(i)) {
      // This day has an actual snapshot
      const k = known.get(i)!;
      return { date, remaining: k.remaining, doneCount: k.doneCount, totalCount: k.totalCount, isActual: true };
    }

    // Find previous and next known snapshot indices
    let prevIdx = -1;
    let nextIdx = days.length;
    for (const [ki] of known) {
      if (ki < i && ki > prevIdx) prevIdx = ki;
      if (ki > i && ki < nextIdx) nextIdx = ki;
    }

    let remaining: number;
    let doneCount: number;

    if (prevIdx === -1 && nextIdx === days.length) {
      // No snapshots at all — flatline at totalCount
      remaining = totalCount;
      doneCount = 0;
    } else if (prevIdx === -1) {
      // Before first snapshot — interpolate to first known point
      const next = known.get(nextIdx)!;
      remaining = Math.round(Math.min(totalCount, next.remaining + next.remaining / (nextIdx - i)));
      doneCount = totalCount - remaining;
    } else if (nextIdx === days.length) {
      // Past last snapshot — flatline (sprint may have finished or is idle)
      const prev = known.get(prevIdx)!;
      remaining = prev.remaining;
      doneCount = prev.doneCount;
    } else {
      // Between snapshots — linear interpolation
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

  // Parse sprint dates, handling edge cases
  const start = sprint.startDate && sprint.startDate !== '-1' ? new Date(sprint.startDate) : null;
  const end   = sprint.endDate   && sprint.endDate   !== '-1' ? new Date(sprint.endDate)   : null;

  // Fetch burndown data from API when sprint changes
  useEffect(() => {
    if (!sprint.zohoId) return;
    fetchBurndownData(sprint.zohoId, { doneCount, totalCount })
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
  }, [sprint.zohoId, doneCount, totalCount]);

  // Early return if data is insufficient
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

  // Determine chart axis endpoint
  const lastSnap    = snapshots.length > 0 ? new Date(snapshots[snapshots.length - 1].date + 'T00:00:00') : end;
  const axisEnd     = isCompleted
    ? new Date(Math.max(end.getTime(), lastSnap.getTime()))  // Completed: extend to last snapshot if past end
    : new Date(Math.max(end.getTime(), now.getTime()));       // Active: extend to today (even if overdue)

  // Build timeline data
  const snapshotMap = buildSnapshotMap(snapshots);
  const days        = sprintDays(start, axisEnd);
  const timeline    = buildTimeline(days, snapshotMap, totalCount);

  // Coordinate scaling functions
  const totalMs = axisEnd.getTime() - start.getTime();
  
  /** Convert date to X pixel position */
  const xOf = (date: Date) => {
    const ms = Math.min(Math.max(date.getTime() - start.getTime(), 0), totalMs);
    return PAD.left + (ms / totalMs) * IW;
  };

  /** Convert remaining count to Y pixel position (inverted: more = lower) */
  const yOf = (remaining: number) => PAD.top + (1 - remaining / totalCount) * IH;

  // Calculate overdue zone geometry
  const endX   = xOf(end);
  const showOverdueZone = axisEnd > end;

  // Ideal burndown line (start: totalCount → end: 0)
  const ix1 = PAD.left;
  const iy1 = yOf(totalCount);
  const ix2 = endX;
  const iy2 = yOf(0);

  // Split timeline into segments by actual/estimated type
  const actualPts = timeline.filter((p) => p.isActual);
  const allPts    = timeline;

  type Seg = { pts: TimelinePoint[]; isActual: boolean };
  const segments: Seg[] = [];
  let cur: Seg | null = null;
  for (const pt of allPts) {
    if (!cur || cur.isActual !== pt.isActual) {
      const carry: TimelinePoint[] = cur ? [cur.pts[cur.pts.length - 1]] : [];
      cur = { pts: [...carry, pt], isActual: pt.isActual };
      segments.push(cur);
    } else {
      cur.pts.push(pt);
    }
  }

  /** Convert timeline points to SVG path coordinates */
  const segPath = (pts: TimelinePoint[]) =>
    pts.map((p, i) => {
      const px = xOf(new Date(p.date + 'T00:00:00'));
      const py = yOf(p.remaining);
      return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
    }).join(' ');

  // Y-axis tick labels at 0%, 25%, 50%, 75%, 100%
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * totalCount));

  // X-axis tick labels
  const plannedMid = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
  const xTicks: { d: Date; label: string; emphasize?: boolean }[] = [
    { d: start,       label: fmtLabel(toDateStr(start)) },
    { d: plannedMid,  label: fmtLabel(toDateStr(plannedMid)) },
    { d: end,         label: fmtLabel(toDateStr(end)), emphasize: true },
  ];

  // Add "Today" tick only when overdue and significantly past due (>1.5 days)
  if (showOverdueZone && (now.getTime() - end.getTime()) > 86400000 * 1.5) {
    xTicks.push({ d: now, label: 'Today', emphasize: true });
  }

  const todayX  = xOf(now);
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86400000);
  const overdueBy = Math.ceil((now.getTime() - end.getTime()) / 86400000);

  // Status pill color and label based on sprint state
  const pillColor = isOverdue ? '#ef4444' : isCompleted ? '#22c55e' : '#f59e0b';
  const daysLabel = isCompleted
    ? '✓ Completed'
    : isOverdue
    ? `${overdueBy}d overdue`
    : daysLeft === 0 ? 'Last day' : `${daysLeft}d left`;

  /** Handle mouse move for interactive tooltip */
  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;

    // Exit if cursor outside chart area
    if (svgX < PAD.left || svgX > PAD.left + IW || allPts.length === 0) {
      setTooltip(null);
      return;
    }

    // Find closest timeline point horizontally
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
        {/* Overdue zone: light red shading for area past due date */}
        {showOverdueZone && (
          <rect
            x={endX} y={PAD.top}
            width={PAD.left + IW - endX} height={IH}
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

        {/* Ideal burndown line: perfect trajectory from start to due date */}
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

        {/* Actual/estimated line segments */}
        {segments.map((seg, i) => (
          <path
            key={i}
            d={segPath(seg.pts)}
            fill="none"
            stroke={seg.isActual ? '#3b82f6' : '#3b82f680'}
            strokeWidth={seg.isActual ? 2 : 1.5}
            strokeDasharray={seg.isActual ? undefined : '4 3'}
          />
        ))}

        {/* Actual data points (dots) */}
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

        {/* Interactive hover crosshair and tooltip */}
        {tooltip && (() => {
          const { x, y, point } = tooltip;
          const overduePoint = point.date > toDateStr(end);

          // Position tooltip (flip left if would overflow)
          const tipW = 138;
          const tipX = x + tipW + 10 > W ? x - tipW - 6 : x + 10;
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

              {/* Date label */}
              <text x={tipX + 8} y={tipY + 14} fill="#94a3b8" fontSize={10}>
                {fmtLabel(point.date)}
                {!point.isActual && <tspan fill="#f59e0b" fontSize={9}> est</tspan>}
                {overduePoint && <tspan fill="#ef4444" fontSize={9}> overdue</tspan>}
              </text>

              {/* Remaining tasks */}
              <text x={tipX + 8} y={tipY + 30} fill="#f1f5f9" fontSize={12} fontWeight={700}>
                {point.remaining} remaining
              </text>

              {/* Completion progress */}
              <text x={tipX + 8} y={tipY + 46} fill="#64748b" fontSize={10}>
                {point.doneCount} / {point.totalCount} done
              </text>

              {/* Overdue indicator */}
              {overduePoint && (
                <text x={tipX + 8} y={tipY + 62} fill="#ef444499" fontSize={10}>
                  {Math.round((new Date(point.date + 'T00:00:00').getTime() - end.getTime()) / 86400000)}d past due
                </text>
              )}
            </>
          );
        })()}
      </svg>

      {/* Legend explaining chart elements */}
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
        {showOverdueZone && (
          <span style={s.legendItem}>
            <span style={{ ...s.legendDash, borderTop: '2px dashed #f59e0b' }} />
            <span style={{ color: '#f59e0b' }}>Due date</span>
          </span>
        )}
        <span style={{ ...s.legendItem, marginLeft: 'auto' }}>
          <span style={s.legendDot} />
          {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

/**
 * Component styles object (React.CSSProperties)
 */
const s: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 8,
    gridColumn: 'span 2',
  },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  label: {
    margin: 0, fontSize: 11, fontWeight: 600,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  labelSub: { fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 10 },
  pill: {
    fontSize: 11, fontWeight: 700, padding: '3px 8px',
    borderRadius: 20, border: '1px solid',
  },
  muted: { color: '#64748b', fontSize: 13, margin: 0 },
  legend: { display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' as const, marginTop: 2 },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b' },
  legendDash: { display: 'inline-block', width: 20, height: 0 },
  legendDot:  { display: 'inline-block', width: 6, height: 6, borderRadius: '50%', backgroundColor: '#3b82f6' },
};
