import { useEffect, useRef, useState } from 'react';
import { fetchBurndownData, type BurndownPoint, type SprintSnapshot } from '../api/client';
import { C, R, font } from '../theme';

const PAD = { top: 24, right: 24, bottom: 40, left: 48 };
const W = 520;
const H = 210;
const IW = W - PAD.left - PAD.right;
const IH = H - PAD.top  - PAD.bottom;

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function buildSnapshotMap(snapshots: BurndownPoint[]): Map<string, BurndownPoint> {
  return new Map(snapshots.map((s) => [s.date, s]));
}

function sprintDays(start: Date, axisEnd: Date): string[] {
  const days: string[] = [];
  const cur = new Date(start);
  while (cur <= axisEnd) {
    days.push(toDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

interface TimelinePoint {
  date:       string;
  remaining:  number;
  doneCount:  number;
  totalCount: number;
  isActual:   boolean;
}

function buildTimeline(
  days: string[],
  snapshots: Map<string, BurndownPoint>,
  totalFallback: number,
): TimelinePoint[] {
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

  const totalCount = snapshots.size > 0
    ? [...snapshots.values()][snapshots.size - 1].totalCount
    : totalFallback;

  return days.map((date, i) => {
    if (known.has(i)) {
      const k = known.get(i)!;
      return { date, remaining: k.remaining, doneCount: k.doneCount, totalCount: k.totalCount, isActual: true };
    }

    let prevIdx = -1;
    let nextIdx = days.length;
    for (const [ki] of known) {
      if (ki < i && ki > prevIdx) prevIdx = ki;
      if (ki > i && ki < nextIdx) nextIdx = ki;
    }

    let remaining: number;
    let doneCount: number;

    if (prevIdx === -1 && nextIdx === days.length) {
      remaining = totalCount;
      doneCount = 0;
    } else if (prevIdx === -1) {
      const next = known.get(nextIdx)!;
      remaining = Math.round(Math.min(totalCount, next.remaining + next.remaining / (nextIdx - i)));
      doneCount = totalCount - remaining;
    } else if (nextIdx === days.length) {
      const prev = known.get(prevIdx)!;
      remaining = prev.remaining;
      doneCount = prev.doneCount;
    } else {
      const prev = known.get(prevIdx)!;
      const next = known.get(nextIdx)!;
      const t    = (i - prevIdx) / (nextIdx - prevIdx);
      remaining  = Math.round(prev.remaining + t * (next.remaining - prev.remaining));
      doneCount  = Math.round(prev.doneCount  + t * (next.doneCount  - prev.doneCount));
    }

    return { date, remaining, doneCount, totalCount, isActual: false };
  });
}

interface BurndownCardProps {
  sprint: SprintSnapshot;
  doneCount: number;
  totalCount: number;
}

export function BurndownCard({ sprint, doneCount, totalCount }: BurndownCardProps) {
  const [snapshots, setSnapshots] = useState<BurndownPoint[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; point: TimelinePoint; svgX: number;
  } | null>(null);

  const start = sprint.startDate && sprint.startDate !== '-1' ? new Date(sprint.startDate) : null;
  const end   = sprint.endDate   && sprint.endDate   !== '-1' ? new Date(sprint.endDate)   : null;

  useEffect(() => {
    if (!sprint.zohoId) return;
    fetchBurndownData(sprint.zohoId, { doneCount, totalCount })
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
  }, [sprint.zohoId, doneCount, totalCount]);

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

  const lastSnap    = snapshots.length > 0 ? new Date(snapshots[snapshots.length - 1].date + 'T00:00:00') : end;
  const axisEnd     = isCompleted
    ? new Date(Math.max(end.getTime(), lastSnap.getTime()))
    : new Date(Math.max(end.getTime(), now.getTime()));

  const snapshotMap = buildSnapshotMap(snapshots);
  const days        = sprintDays(start, axisEnd);
  const timeline    = buildTimeline(days, snapshotMap, totalCount);

  const totalMs = axisEnd.getTime() - start.getTime();

  const peakRemaining = timeline.reduce((m, p) => Math.max(m, p.remaining), totalCount);
  const yMax = Math.ceil(peakRemaining * 1.1) || totalCount;

  const xOf = (date: Date) => {
    const ms = Math.min(Math.max(date.getTime() - start.getTime(), 0), totalMs);
    return PAD.left + (ms / totalMs) * IW;
  };

  const yOf = (remaining: number) => PAD.top + (1 - remaining / yMax) * IH;

  const endX   = xOf(end);
  const showOverdueZone = axisEnd > end;

  const ix1 = PAD.left;
  const iy1 = yOf(totalCount);
  const ix2 = endX;
  const iy2 = yOf(0);

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

  const segPath = (pts: TimelinePoint[]) =>
    pts.map((p, i) => {
      const px = xOf(new Date(p.date + 'T00:00:00'));
      const py = yOf(p.remaining);
      return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
    }).join(' ');

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * yMax));

  const plannedMid = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
  const xTicks: { d: Date; label: string; emphasize?: boolean }[] = [
    { d: start,       label: fmtLabel(toDateStr(start)) },
    { d: plannedMid,  label: fmtLabel(toDateStr(plannedMid)) },
    { d: end,         label: fmtLabel(toDateStr(end)), emphasize: true },
  ];

  if (showOverdueZone && (now.getTime() - end.getTime()) > 86400000 * 1.5) {
    xTicks.push({ d: now, label: 'Today', emphasize: true });
  }

  const todayX  = xOf(now);
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86400000);
  const overdueBy = Math.ceil((now.getTime() - end.getTime()) / 86400000);

  const pillColor = isOverdue ? '#ef4444' : isCompleted ? C.success : '#f59e0b';
  const daysLabel = isCompleted
    ? 'Completed'
    : isOverdue
    ? `${overdueBy}d overdue`
    : daysLeft === 0 ? 'Last day' : `${daysLeft}d left`;

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;

    if (svgX < PAD.left || svgX > PAD.left + IW || allPts.length === 0) {
      setTooltip(null);
      return;
    }

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
          {showOverdueZone && (
          <rect
            x={endX} y={PAD.top}
            width={PAD.left + IW - endX} height={IH}
            fill="#ef444409"
          />
        )}

        {yTicks.map((t) => {
          const y = yOf(t);
          return (
            <g key={t}>
              <line x1={PAD.left} y1={y} x2={PAD.left + IW} y2={y}
                stroke={C.hairline} strokeWidth={1} />
              <text x={PAD.left - 6} y={y} textAnchor="end" dominantBaseline="middle"
                fill={C.inkTertiary} fontSize={10}>{t}</text>
            </g>
          );
        })}

        {xTicks.map(({ d, label, emphasize }) => (
          <text
            key={label}
            x={xOf(d)}
            y={H - PAD.bottom + 14}
            textAnchor="middle"
            fill={emphasize ? C.inkSubtle : C.inkTertiary}
            fontSize={10}
            fontWeight={emphasize ? 500 : 400}
          >
            {label}
          </text>
        ))}

        <line x1={ix1} y1={iy1} x2={ix2} y2={iy2}
          stroke={C.hairlineStrong} strokeWidth={1.5} strokeDasharray="6 4" />

        {showOverdueZone && (
          <>
            <line x1={endX} y1={PAD.top} x2={endX} y2={PAD.top + IH}
              stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={endX} y={PAD.top - 7} textAnchor="middle"
              fill="#f59e0b" fontSize={9} fontWeight={500}>Due</text>
          </>
        )}

        {now >= start && now <= axisEnd && (
          <line x1={todayX} y1={PAD.top} x2={todayX} y2={PAD.top + IH}
            stroke={C.inkTertiary} strokeWidth={1} strokeDasharray="3 3" />
        )}

        {segments.map((seg, i) => (
          <path
            key={i}
            d={segPath(seg.pts)}
            fill="none"
            stroke={seg.isActual ? C.primary : `${C.primary}80`}
            strokeWidth={seg.isActual ? 2 : 1.5}
            strokeDasharray={seg.isActual ? undefined : '4 3'}
          />
        ))}

        {actualPts.map((p) => {
          const px = xOf(new Date(p.date + 'T00:00:00'));
          const py = yOf(p.remaining);
          return <circle key={p.date} cx={px} cy={py} r={3.5} fill={C.primary} />;
        })}

        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + IH}
          stroke={C.hairline} strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top + IH} x2={PAD.left + IW} y2={PAD.top + IH}
          stroke={C.hairline} strokeWidth={1} />

        {tooltip && (() => {
          const { x, y, point } = tooltip;
          const overduePoint = point.date > toDateStr(end);

          const tipW = 138;
          const tipX = x + tipW + 10 > W ? x - tipW - 6 : x + 10;
          const tipY = Math.max(PAD.top, Math.min(y - 30, PAD.top + IH - 62));

          return (
            <>
              <line x1={x} y1={PAD.top} x2={x} y2={PAD.top + IH}
                stroke={C.primaryHover} strokeWidth={1} strokeDasharray="3 2" opacity={0.5} />

              <circle cx={x} cy={y} r={5}
                fill={point.isActual ? C.primary : `${C.primaryHover}80`}
                stroke={point.isActual ? C.primaryHover : C.primaryHover} strokeWidth={1.5} />

              <rect x={tipX} y={tipY} width={tipW} height={overduePoint ? 72 : 58} rx={R.sm}
                fill={C.surface1} stroke={C.hairline} strokeWidth={1} />

              <text x={tipX + 8} y={tipY + 14} fill={C.inkSubtle} fontSize={10}>
                {fmtLabel(point.date)}
                {!point.isActual && <tspan fill="#f59e0b" fontSize={9}> est</tspan>}
                {overduePoint && <tspan fill="#ef4444" fontSize={9}> overdue</tspan>}
              </text>

              <text x={tipX + 8} y={tipY + 30} fill={C.inkMuted} fontSize={12} fontWeight={600}>
                {point.remaining} remaining
              </text>

              <text x={tipX + 8} y={tipY + 46} fill={C.inkTertiary} fontSize={10}>
                {point.doneCount} / {point.totalCount} done
              </text>

              {overduePoint && (
                <text x={tipX + 8} y={tipY + 62} fill="#ef444499" fontSize={10}>
                  {Math.round((new Date(point.date + 'T00:00:00').getTime() - end.getTime()) / 86400000)}d past due
                </text>
              )}
            </>
          );
        })()}
      </svg>

      <div style={s.legend}>
        <span style={s.legendItem}>
          <span style={{ ...s.legendDash, borderTop: `2px dashed ${C.hairlineStrong}` }} /> Ideal
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.legendDash, borderTop: `2px solid ${C.primary}` }} /> Actual
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.legendDash, borderTop: `2px dashed ${C.primary}80` }} />
          <span style={{ color: `${C.primaryHover}80` }}>Estimated</span>
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

const s: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: C.surface1, border: `1px solid ${C.hairline}`,
    borderRadius: R.lg, padding: '24px',
    display: 'flex', flexDirection: 'column', gap: 8,
    gridColumn: 'span 2',
  },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  label: {
    margin: 0, fontSize: 13, fontWeight: 500,
    color: C.inkTertiary, textTransform: 'uppercase', letterSpacing: '0.4px',
    fontFamily: font.text,
  },
  labelSub: { fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 12 },
  pill: {
    fontSize: 12, fontWeight: 400, padding: '2px 8px',
    borderRadius: R.pill, border: '1px solid',
    fontFamily: font.text,
  },
  muted: { color: C.inkTertiary, fontSize: 14, margin: 0, fontFamily: font.text },
  legend: { display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' as const, marginTop: 2 },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.inkTertiary, fontFamily: font.text },
  legendDash: { display: 'inline-block', width: 20, height: 0 },
  legendDot:  { display: 'inline-block', width: 6, height: 6, borderRadius: '50%', backgroundColor: C.primary },
};
