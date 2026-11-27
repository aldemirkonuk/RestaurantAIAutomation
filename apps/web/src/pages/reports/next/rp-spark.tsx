/**
 * A 160 x 48 line under the opening sentence: the shape of one real series,
 * with its name and its last figure in words beside it. Not a chart to read
 * values off (the cutting below does that), a glance at which way it is going.
 *
 * Drawn only from `sparkOf` (>= 2 recorded points); the line is revealed left
 * to right once with `clip-path` (reports-next.css `rp-spark-draw`), and not
 * at all under `prefers-reduced-motion`.
 */

import type { SparkSeries } from "./rp-strip";

export const SPARK_W = 160;
export const SPARK_H = 48;
const PAD = 4;

/** SVG path of the series scaled into the box, first point left, last right. */
export function sparkPath(values: number[]): string {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = (SPARK_W - PAD * 2) / (values.length - 1);
  return values
    .map((v, i) => {
      const x = PAD + i * step;
      const y = PAD + (SPARK_H - PAD * 2) * (1 - (v - lo) / span);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function Spark({ series }: { series: SparkSeries }) {
  const d = sparkPath(series.values);
  const last = d.split(" ").slice(-2);
  const cx = Number(last[0].replace("L", ""));
  const cy = Number(last[1]);
  return (
    <figure className="rp-spark" data-testid={`rp-spark-${series.id}`}>
      <figcaption className="rp-spark__cap">
        <span>{series.title}</span>
        <span className="rp-spark__last">{series.last}</span>
      </figcaption>
      <svg
        role="img"
        aria-label={`${series.title}: ${series.values.length} readings of ${series.of}, the last ${series.last}`}
        width={SPARK_W}
        height={SPARK_H}
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      >
        <path
          className="rp-spark__line"
          d={d}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle className="rp-spark__dot" cx={cx} cy={cy} r={3} />
      </svg>
    </figure>
  );
}
