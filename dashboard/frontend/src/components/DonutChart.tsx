import { C } from '../theme';

export interface DonutSegment {
  value: number;
  color: string;
  label?: string;
}

export function DonutChart({
  segments,
  size = 120,
  strokeWidth = 12,
  centerLabel,
  centerSub,
}: {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerSub?: string;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeWidth) / 2 - 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0);

  let accumulated = 0;
  const arcs = segments.map((seg) => {
    const len = total > 0 ? (seg.value / total) * circ : 0;
    const dashOffset = circ / 4 - accumulated;
    accumulated += len;
    return { ...seg, len, dashArray: `${len} ${circ - len}`, dashOffset };
  });

  const labelSize = size * 0.16;
  const subSize = size * 0.09;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.canvas} strokeWidth={strokeWidth} />

      {total === 0 ? (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.surface1} strokeWidth={strokeWidth} />
      ) : (
        arcs.map((arc, i) => {
          const hasLength = arc.len > 0;
          return (
            hasLength && (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={arc.color}
                strokeWidth={strokeWidth}
                strokeDasharray={arc.dashArray}
                strokeDashoffset={arc.dashOffset}
                strokeLinecap="butt"
                style={{ transition: 'stroke-dasharray 0.4s ease' }}
              >
                {arc.label && <title>{arc.label}</title>}
              </circle>
            )
          );
        })
      )}

      {centerLabel && (
        <text
          x={cx}
          y={cy - subSize * 0.6}
          textAnchor="middle"
          fill={C.inkMuted}
          fontSize={labelSize}
          fontWeight={600}
          dominantBaseline="auto"
        >
          {centerLabel}
        </text>
      )}

      {centerSub && (
        <text
          x={cx}
          y={cy + labelSize * 0.6}
          textAnchor="middle"
          fill={C.inkSubtle}
          fontSize={subSize}
          dominantBaseline="hanging"
        >
          {centerSub}
        </text>
      )}
    </svg>
  );
}
