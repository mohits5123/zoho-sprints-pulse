/**
 * DonutChart - Ring Chart Component for Metric Visualization
 *
 * Displays a donut chart with configurable segments, ideal for visualizing ratios,
 * distributions, or category breakdowns. Supports animated transitions and custom center labels.
 *
 * ## How It Works
 *
 * The component renders SVG circles with `stroke-dasharray` and `stroke-dashoffset`
 * to create individual arc segments. Each segment's arc length is proportional to its
 * value relative to the sum of all segment values. This technique avoids the need for
 * external charting libraries while keeping the bundle size minimal.
 *
 * The background track provides a visual placeholder for the empty state. When segments
 * have zero total, a distinct "no data" ring is shown instead.
 *
 * ## Usage Example
 *
 * ```tsx
 * <DonutChart
 *   segments={[
 *     { value: 40, color: '#3b82f6', label: 'Completed' },
 *     { value: 30, color: '#f59e0b', label: 'Pending' },
 *     { value: 30, color: '#ef4444', label: 'Failed' },
 *   ]}
 *   size={160}
 *   centerLabel="85%"
 *   centerSub="Progress"
 * />
 * ```
 *
 * @module DonutChart
 */

/**
 * A single segment in the donut chart.
 *
 * Each segment represents a portion of the total, with its arc length proportional
 * to `value / totalOfAllSegments`.
 */
export interface DonutSegment {
  /** Numeric value contributing to total (e.g., count, percentage numerator). Must be ≥ 0. */
  value: number;

  /** Color used for this segment's arc (any valid CSS color string). */
  color: string;

  /** Optional tooltip label shown when the user hovers over the segment. */
  label?: string;
}

/**
 * DonutChart Component Props.
 *
 * @property segments - Required array of colored segments that make up the donut.
 * @property size - Diameter of the chart in pixels. Defaults to `120`.
 * @property strokeWidth - Thickness of the ring. Defaults to `12`. Must be less than `size`.
 * @property centerLabel - Primary text displayed at the center of the donut.
 * @property centerSub - Secondary text displayed below the primary label.
 */
export function DonutChart({
  segments,
  size = 120,
  strokeWidth = 12,
  centerLabel,
  centerSub,
}: {
  /** Array of segments with values and colors. If empty or all values are `0`, a "no data" ring is shown. */
  segments: DonutSegment[];

  /** Total diameter of the chart in pixels. Defaults to `120`. */
  size?: number;

  /** Width of the donut ring in pixels. Defaults to `12`. Must be less than `size` to form a valid donut. */
  strokeWidth?: number;

  /** Optional center label (main value) displayed in the middle of the donut. */
  centerLabel?: string;

  /** Optional center sub-label (secondary info) displayed below the primary label. */
  centerSub?: string;
}) {
  /** Center X coordinate of the chart (half of total size). */
  const cx = size / 2;
  /** Center Y coordinate of the chart (half of total size). */
  const cy = size / 2;

  /**
   * Radius of the donut ring.
   *
   * Computed as half the remaining space after subtracting the stroke width from the total size,
   * then reduced by 2px to prevent the stroke from being clipped at the viewBox edge.
   */
  const r = (size - strokeWidth) / 2 - 2;

  /** Full circumference of the circle used to compute arc lengths. */
  const circ = 2 * Math.PI * r;

  /** Sum of all segment values, used to normalize each segment's arc length. */
  const total = segments.reduce((s, seg) => s + seg.value, 0);

  /**
   * Calculate arc lengths and SVG dash properties for each segment.
   *
   * Each segment's arc length is proportional to its value relative to `total`.
   * Segments are stacked sequentially using an accumulated offset so they appear
   * end-to-end around the ring. A `circ / 4` starting offset ensures the first
   * segment begins at the top of the circle (12 o'clock position) rather than
   * the default 3 o'clock position used by SVG arcs.
   *
   * @param seg - The segment to compute arc properties for
   * @returns An object with color, label, arc length, dash array string, and dash offset
   */
  let accumulated = 0;
  const arcs = segments.map((seg) => {
    /** Proportional arc length for this segment (0 when total is 0 to avoid division by zero). */
    const len = total > 0 ? (seg.value / total) * circ : 0;

    /**
     * Dash offset positioning.
     *
     * `circ / 4` rotates the start to 12 o'clock. `accumulated` shifts each
     * subsequent segment so arcs chain together without overlap.
     */
    const dashOffset = circ / 4 - accumulated;

    accumulated += len;

    /**
     * Returns the segment augmented with SVG arc properties.
     *
     * - `dashArray`: `"${len} ${circ - len}"` — draws the arc for `len` pixels, then skips the rest.
     * - `dashOffset`: positions the arc so segments stack sequentially.
     */
    return { ...seg, len, dashArray: `${len} ${circ - len}`, dashOffset };
  });

  /** Font size for the primary center label, scaled proportionally to chart size. */
  const labelSize = size * 0.16;
  /** Font size for the secondary center sub-label, scaled proportionally to chart size. */
  const subSize = size * 0.09;

  /**
   * Render the donut chart as an SVG.
   *
   * Layer order (back to front):
   * 1. Dark background track — always visible as a placeholder ring.
   * 2. "No data" ring (if `total === 0`) — distinct color to signal empty state.
   * 3. Colored segment arcs — stacked sequentially using SVG dash properties.
   * 4. Center text labels — primary and optional secondary, overlaid on top.
   *
   * A CSS transition on `stroke-dasharray` produces a smooth animation when
   * segment values change between re-renders.
   */
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Background track — always visible as a dark placeholder ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#0f172a" strokeWidth={strokeWidth} />

      {/* Empty state ring — shown when there are no segments or all values are zero */}
      {total === 0 ? (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={strokeWidth} />
      ) : (
        /** Render each segment's arc as a dashed circle */
        arcs.map((arc, i) => {
          /** Only render arcs that have a measurable length */
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
                /**
                 * stroke-dasharray: defines the visible arc length and the gap.
                 * Format is `"${arcLength} ${remainingCircumference}"` so only
                 * the computed arc is drawn, and the rest is skipped.
                 */
                strokeDasharray={arc.dashArray}
                /**
                 * stroke-dashoffset: shifts the arc so segments stack end-to-end
                 * around the ring, starting from the top (12 o'clock).
                 */
                strokeDashoffset={arc.dashOffset}
                /** Sharp (non-rounded) arc endpoints to prevent overlap between segments */
                strokeLinecap="butt"
                /** Smooth transition when segment values change */
                style={{ transition: 'stroke-dasharray 0.4s ease' }}
              >
                {/* Native SVG tooltip — appears when hovering over the segment */}
                {arc.label && <title>{arc.label}</title>}
              </circle>
            )
          );
        })
      )}

      {/* Center label — primary value, centered above the horizontal midline */}
      {centerLabel && (
        <text
          x={cx}
          y={cy - subSize * 0.6}
          textAnchor="middle"
          fill="#f1f5f9"
          fontSize={labelSize}
          fontWeight={700}
          dominantBaseline="auto"
        >
          {centerLabel}
        </text>
      )}

      {/* Center sub-label — secondary info, centered below the horizontal midline */}
      {centerSub && (
        <text
          x={cx}
          y={cy + labelSize * 0.6}
          textAnchor="middle"
          fill="#94a3b8"
          fontSize={subSize}
          dominantBaseline="hanging"
        >
          {centerSub}
        </text>
      )}
    </svg>
  );
}
