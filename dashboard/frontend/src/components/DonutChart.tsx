/**
 * DonutChart - Ring Chart Component for Metric Visualization
 * 
 * Displays a donut chart with configurable segments, ideal for visualizing ratios,
 * distributions, or category breakdowns. Supports animated transitions and custom center labels.
 */

/**
 * A single segment in the donut chart
 */
export interface DonutSegment {
  /** Numeric value contributing to total (e.g., count, percentage numerator) */
  value: number;
  
  /** Color used for this segment's arc */
  color: string;
  
  /** Optional tooltip label when hovering over the segment */
  label?: string;
}

/**
 * DonutChart Component Props
 */
export function DonutChart({
  segments,
  size = 120,
  strokeWidth = 12,
  centerLabel,
  centerSub,
}: {
  /** Array of segments with values and colors */
  segments: DonutSegment[];
  
  /** Total diameter of the chart in pixels */
  size?: number;
  
  /** Width of the donut ring */
  strokeWidth?: number;
  
  /** Optional center label (main value) */
  centerLabel?: string;
  
  /** Optional center sub-label (secondary info) */
  centerSub?: string;
}) {
  /** Chart center coordinates */
  const cx   = size / 2;
  const cy   = size / 2;
  
  /** Radius of the inner circle (size - stroke creates donut effect) */
  const r    = (size - strokeWidth) / 2 - 2;
  
  /** Circumference of the circle */
  const circ = 2 * Math.PI * r;
  
  /** Sum of all segment values */
  const total = segments.reduce((s, seg) => s + seg.value, 0);

  /**
   * Calculate arc lengths and SVG dash properties for each segment
   */
  let accumulated = 0;
  const arcs = segments.map((seg) => {
    /** Length of this segment's arc */
    const len        = total > 0 ? (seg.value / total) * circ : 0;
    
    /** Offset for progressive rendering (creates animation effect) */
    const dashOffset = circ / 4 - accumulated;
    
    /** SVG stroke-dasharray: arc length + remaining circumference */
    accumulated += len;
    
    return { ...seg, len, dashArray: `${len} ${circ - len}`, dashOffset };
  });

  /** Font sizes for center labels */
  const labelSize = size * 0.16;
  const subSize   = size * 0.09;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Background track (empty state) */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#0f172a" strokeWidth={strokeWidth} />
      
      {/* Empty state ring when no segments */}
      {total === 0 ? (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={strokeWidth} />
      ) : (
        /** Render each segment's arc */
        arcs.map((arc, i) => {
          const hasLength = arc.len > 0;
          /** Skip rendering segments with zero length */
          return (hasLength && (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={arc.color}
              strokeWidth={strokeWidth}
              /** SVG stroke-dasharray: creates the arc */
              strokeDasharray={arc.dashArray}
              /** SVG stroke-dashoffset: positioning for segmented arcs */
              strokeDashoffset={arc.dashOffset}
              strokeLinecap="butt"
              style={{ transition: 'stroke-dasharray 0.4s ease' }}
            >
              {arc.label && <title>{arc.label}</title>}
            </circle>
          ));
        })
      )}
      
      {/* Center label (primary value) */}
      {centerLabel && (
        <text x={cx} y={cy - subSize * 0.6} textAnchor="middle" fill="#f1f5f9"
          fontSize={labelSize} fontWeight={700} dominantBaseline="auto">
          {centerLabel}
        </text>
      )}
      
      {/* Center sub-label (secondary info) */}
      {centerSub && (
        <text x={cx} y={cy + labelSize * 0.6} textAnchor="middle" fill="#94a3b8"
          fontSize={subSize} dominantBaseline="hanging">
          {centerSub}
        </text>
      )}
    </svg>
  );
}
