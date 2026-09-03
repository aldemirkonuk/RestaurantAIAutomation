/**
 * The plotting kit — recharts (already a dependency, `apps/web/package.json`)
 * dressed in the İznik/paper tokens so a chart reads on both grounds without a
 * second palette. The seal is the ONE chromatic colour (ADR 0042): every
 * series is `--seal`, every rule and axis is paper or ink. No categorical
 * rainbow, because a rainbow would be nine more brand hues.
 *
 * Two rules the components below enforce rather than document:
 *
 *  1. A register that has not answered draws SKELETONS; a register that
 *     answered "unknown" draws an EM DASH. They are never the same element —
 *     a shimmering bar that means "failed" is the absence-reported-as-health
 *     fault in visual form.
 *  2. A chart with no producer is an honest sentence, not an empty axis. An
 *     empty plot frame reads as "the restaurant did nothing", which is a
 *     claim; `<Nothing>` says which register is empty instead.
 */

import { useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { turn } from '@/lib/mudavym';
import { EM, MONO, SANS, failureLine, type Failure } from './rp-format';

/* ─────────────────────────────────────────────────── shared chrome ─────── */

const AXIS = {
  stroke: 'var(--paper-2)',
  tick: { fill: 'var(--ink-3)', fontSize: 9.5, fontFamily: MONO },
  tickLine: false,
} as const;

const TOOLTIP_STYLE = {
  background: 'var(--paper-0)',
  border: '1px solid var(--paper-2)',
  borderRadius: 8,
  fontFamily: SANS,
  fontSize: 11.5,
  color: 'var(--ink-1)',
} as const;

function Plot({ children }: { children: ReactNode }) {
  return (
    <div className="rp-plot">
      <ResponsiveContainer width="100%" height="100%" debounce={1}>
        {children as never}
      </ResponsiveContainer>
    </div>
  );
}

/* ───────────────────────────────────────────── the four honest states ──── */

/** A register in flight. Bars, because something IS coming. */
export function Waiting({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: 'grid', gap: 6 }} role="status" aria-label="Reading the register">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rp-skel" style={{ height: 10, width: `${94 - i * 13}%` }} />
      ))}
    </div>
  );
}

/** A register that answered and had nothing in it. A real, quiet empty. */
export function Nothing({ children }: { children: ReactNode }) {
  return <p className="rp-quiet">{children}</p>;
}

/** A register that refused or broke. Words, and a retry only when one helps. */
export function Refused({
  register,
  failure,
  onRetry,
}: {
  register: string;
  failure: Failure;
  onRetry: () => void;
}) {
  return (
    <div role="status" style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
      <p className="rp-note">{failureLine(register, failure)}</p>
      {!failure.forbidden && (
        <button type="button" className="rp-mini rp-ink rp-focus" onClick={onRetry}>
          Read it again
        </button>
      )}
    </div>
  );
}

/**
 * One register, four surfaces. Every cutting on the sheet goes through this,
 * so no block can accidentally render a failure as an empty chart.
 */
export function RegisterBody<T>({
  register,
  loading,
  failure,
  data,
  onRetry,
  children,
}: {
  register: string;
  loading: boolean;
  failure: Failure | null;
  data: T | undefined;
  onRetry: () => void;
  children: (value: T) => ReactNode;
}) {
  if (failure) return <Refused register={register} failure={failure} onRetry={onRetry} />;
  if (loading || data === undefined) return <Waiting />;
  return <>{children(data)}</>;
}

/* ─────────────────────────────────────── "show the working" (the basis) ── */

/**
 * The line back to the data — and it is the SERVER'S sentence, not ours.
 * Every analytics endpoint returns a `basis` describing the rows it actually
 * covered (`financial.basis.revenue`, `menuEngineering.basis.margin`), written
 * precisely because a hand-written basis once claimed "on-hand qty × WAC" for
 * a figure computed from WAC on 2 rows in 72. Reprinting it verbatim is the
 * only version of this line that cannot go stale.
 */
export function Working({ lines }: { lines: Array<string | null | undefined> }) {
  const [open, setOpen] = useState(false);
  const real = lines.filter((l): l is string => !!l && l.trim() !== '');
  if (real.length === 0) return null;
  return (
    <div style={{ marginTop: 'auto' }}>
      <button
        type="button"
        className="rp-eyebrow rp-ink rp-focus rp-no-drag"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'transparent', border: 0, padding: '2px 0', cursor: 'pointer' }}
      >
        {open ? 'Hide the working' : 'Show the working'}
      </button>
      <div
        className="rp-working"
        data-open={open}
        style={{ transitionDuration: `${turn.ms}ms`, transitionTimingFunction: turn.easing }}
      >
        <div>
          <ul style={{ margin: '4px 0 0', padding: '0 0 0 14px', display: 'grid', gap: 3 }}>
            {real.map((l) => (
              <li key={l} className="rp-cap">
                {l}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── figures of record ─────── */

/** One labelled figure. Tabular mono; an unknown is the dash, always. */
export function FigureRow({ label, value, note }: { label: string; value: string; note?: string }) {
  const unknown = value === EM;
  return (
    <div className="rp-fig">
      <dt>{label}</dt>
      <dd data-unknown={unknown} title={unknown ? note : undefined}>
        {value}
      </dd>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── the charts ────── */

export interface Point {
  label: string;
  value: number | null;
}

/** A measured series over time. */
export function AreaSeries({ data, unit }: { data: Point[]; unit: string }) {
  return (
    <Plot>
      <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} stroke="var(--paper-2)" />
        <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={28} />
        <YAxis {...AXIS} width={46} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v}`, unit]} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--seal)"
          strokeWidth={1.6}
          fill="var(--seal-tint)"
          isAnimationActive={false}
          connectNulls={false}
          dot={false}
        />
      </AreaChart>
    </Plot>
  );
}

/** Categorical bars — a weekday profile, a pair of periods. */
export function BarSeries({ data, unit }: { data: Point[]; unit: string }) {
  return (
    <Plot>
      <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} stroke="var(--paper-2)" />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} width={46} />
        <Tooltip
          cursor={{ fill: 'var(--seal-tint)' }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(v: number) => [`${v}`, unit]}
        />
        <Bar dataKey="value" fill="var(--seal)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </Plot>
  );
}

/**
 * Measured history and a projection on one line, split at `splitAt`.
 * The projection is drawn DASHED and labelled in the caption — a forecast that
 * looks like a measurement is a lie told with a stroke width.
 */
export function ForecastSeries({
  data,
  splitAt,
  unit,
}: {
  data: Array<{ label: string; measured: number | null; projected: number | null }>;
  splitAt: string | null;
  unit: string;
}) {
  return (
    <Plot>
      <LineChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} stroke="var(--paper-2)" />
        <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={28} />
        <YAxis {...AXIS} width={46} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(v: number, n: string) => [`${v}`, `${n} ${unit}`]}
        />
        {splitAt && <ReferenceLine x={splitAt} stroke="var(--ink-3)" strokeDasharray="2 3" />}
        <Line
          type="monotone"
          dataKey="measured"
          stroke="var(--seal)"
          strokeWidth={1.6}
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="projected"
          stroke="var(--seal-deep)"
          strokeWidth={1.4}
          strokeDasharray="4 3"
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
        />
      </LineChart>
    </Plot>
  );
}

export interface QuadrantPoint {
  x: number;
  y: number;
  name: string;
}

/**
 * Margin against movement, with the engine's own medians as the crosshair.
 * Wines with no recorded cost are NOT plotted — they have no y, and dropping
 * them to y=0 would file every uncosted wine as a "dog" (the server refuses to
 * do that too: `quadrant: null`). The count of them is printed instead.
 */
export function QuadrantPlot({
  points,
  medianX,
  medianY,
}: {
  points: QuadrantPoint[];
  medianX: number | null;
  medianY: number | null;
}) {
  return (
    <Plot>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--paper-2)" />
        <XAxis type="number" dataKey="x" name="bottles/day" {...AXIS} />
        <YAxis type="number" dataKey="y" name="margin/bottle" {...AXIS} width={46} />
        <ZAxis range={[36, 36]} />
        <Tooltip
          cursor={{ stroke: 'var(--seal-ring)' }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(v: number, n: string) => [`${v}`, n]}
          labelFormatter={() => ''}
        />
        {medianX != null && <ReferenceLine x={medianX} stroke="var(--ink-3)" strokeDasharray="2 3" />}
        {medianY != null && <ReferenceLine y={medianY} stroke="var(--ink-3)" strokeDasharray="2 3" />}
        <Scatter data={points} fill="var(--seal)" isAnimationActive={false} />
      </ScatterChart>
    </Plot>
  );
}
