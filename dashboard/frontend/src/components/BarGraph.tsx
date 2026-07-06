import type { CSSProperties } from 'react';
import { C, R } from '../theme';

export interface BarSegment {
  value: number;
  color: string;
  label?: string;
}

interface BarGraphProps {
  segments: BarSegment[];
  height?: number;
  trackColor?: string;
  borderRadius?: number;
  gap?: number;
  style?: CSSProperties;
}

export function BarGraph({
  segments,
  height = 6,
  trackColor = C.canvas,
  borderRadius = R.sm,
  gap = 1,
  style,
}: BarGraphProps) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  return (
    <div style={{ ...s.track(trackColor, borderRadius, height, gap), ...style }}>
      {segments.map((seg, i) => {
        if (seg.value === 0) return null;
        return (
          <div
            key={i}
            title={seg.label}
            style={s.segment(seg.color, seg.value, total, borderRadius)}
          />
        );
      })}
    </div>
  );
}

const s = {
  track: (bg: string, radius: number, h: number, gap: number): CSSProperties => ({
    display: 'flex',
    height: h,
    borderRadius: radius,
    overflow: 'hidden',
    backgroundColor: bg,
    gap,
  }),
  segment: (color: string, value: number, total: number, radius: number): CSSProperties => ({
    height: '100%',
    width: `${(value / total) * 100}%`,
    minWidth: 2,
    backgroundColor: color,
    borderRadius: radius > 2 ? 2 : undefined,
    transition: 'width 0.4s ease',
  }),
};
