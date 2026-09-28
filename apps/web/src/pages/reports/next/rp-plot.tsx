/**
 * The plotting kit — recharts (already a dependency, `apps/web/package.json`)
 * dressed in the İznik/paper tokens so a chart reads on both grounds without a
 * second palette. The seal is the ONE chromatic colour (ADR 0042): every
 * series is `--seal`, every rule and axis is paper or ink. No categorical
 * rainbow, because a rainbow would be nine more brand hues.
 *
 * Four rules the components below enforce rather than document:
 *
 *  1. A register that has not answered draws SKELETONS; a register that
 *     answered "unknown" draws an EM DASH. They are never the same element —
 *     a shimmering bar that means "failed" is the absence-reported-as-health
 *     fault in visual form.
 *  2. A chart with no producer is an honest sentence, not an empty axis. An
 *     empty plot frame reads as "the restaurant did nothing", which is a
 *     claim; `<Nothing>` says which register is empty instead.
 *  3. **Every plot names its axes and its unit.** A number with no unit is a
 *     number the reader has to guess at, and a guess about money is expensive.
 *     Both axes carry a label; the tooltip repeats the unit in words.
 *  4. **A reference line is the SERVER's threshold or it does not exist.** The
 *     quadrant crosshair is `menuEngineering.medians`; the forecast seam is
 *     where measurement stops. Nothing on this page draws a rule we invented.
 *
 * The heat map is the one drawing that is not recharts. Recharts 2.x has no
 * heat-map primitive, and the two ways of faking one (a ScatterChart of fat
 * squares, or a stacked bar) both lose the row and column headers that make a
 * calendar readable — and neither can tell a day with no takings apart from a
 * day nobody recorded. It is a real `<table>` instead: headers are headers,
 * every cell states its own date and figure, an unrecorded cell is blank paper
 * rather than the coldest colour on the ramp, and the whole thing is legible to
 * a screen reader without a second description.
 */

import { useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Label,
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
import { EM, MONO, failureLine, type Failure } from './rp-format';
import type { CatSeries, Fig, MatrixSeries, PointSeries, TableSpec } from './rp-view';

/* ─────────────────────────────────────────────────── shared chrome ─────── */

const AXIS = {
  stroke: 'var(--paper-2)',
  tick: { fill: 'var(--ink-3)', fontSize: 9.5, fontFamily: MONO },
  tickLine: false,
} as const;

const AXIS_LABEL = {
  fill: 'var(--ink-3)',
  fontSize: 9,
  fontFamily: MONO,
  letterSpacing: '0.08em',
} as const;

const RULE = { stroke: 'var(--ink-3)', strokeDasharray: '2 3' } as const;

/** Room for the two axis labels. Kept in one place so every plot agrees. */
const MARGIN = { top: 8, right: 8, bottom: 14, left: 2 } as const;

function Plot({ children }: { children: ReactNode }) {
  return (
    <div className="rp-plot">
      <ResponsiveContainer width="100%" height="100%" debounce={1}>
        {children as never}
      </ResponsiveContainer>
    </div>
  );
}

/** One tooltip for the whole page: the label, then each value with its unit. */
function Tip({
  active,
  payload,
  label,
  unit,
  format,
  projectedLabel,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | null; payload?: unknown }>;
  label?: string | number;
  unit: string;
  format: (v: number) => string;
  projectedLabel?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as { full?: string } | undefined;
  const rows = payload.filter((p) => typeof p.value === 'number');
  if (rows.length === 0) return null;
  return (
    <div className="rp-tip">
      <span className="rp-tip__head">{row?.full ?? String(label ?? '')}</span>
      {rows.map((p) => (
        <span key={String(p.dataKey)} className="rp-tip__row">
          <b>{format(p.value as number)}</b> {unit}
          {p.dataKey === 'projected' && projectedLabel ? ` · ${projectedLabel}` : ''}
        </span>
      ))}
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

/**
 * The "one figure" drawing: the analysis reduced to its headline number.
 * An unknown stays an em dash at any size — a big dash is the point.
 */
export function BigFigure({ fig, window }: { fig: Fig; window: string }) {
  const unknown = fig.value === EM;
  return (
    <div className="rp-big">
      <span className="rp-eyebrow">{fig.label}</span>
      <strong className="rp-big__value" data-unknown={unknown} title={unknown ? fig.note : undefined}>
        {fig.value}
      </strong>
      <span className="rp-cap">{window}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── the charts ────── */

/**
 * One categorical or dated series, drawn as a line, an area or bars — the
 * reader's choice, because the same true series is legitimately all three.
 * `projected` is always the dashed/hollow half: a forecast that looks like a
 * measurement is a lie told with a stroke width.
 */
export function CatPlot({ series, kind }: { series: CatSeries; kind: 'line' | 'area' | 'bars' }) {
  const { data, xLabel, yLabel, unit, format, refs, projectedLabel } = series;
  const hasProjection = data.some((d) => d.projected != null);
  const tip = (
    <Tooltip
      cursor={kind === 'bars' ? { fill: 'var(--seal-tint)' } : { stroke: 'var(--seal-ring)' }}
      content={
        <Tip unit={unit} format={format} projectedLabel={projectedLabel} /> as unknown as never
      }
    />
  );
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--paper-2)" />
      <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={26}>
        <Label value={xLabel} position="insideBottom" offset={-11} style={AXIS_LABEL} />
      </XAxis>
      <YAxis {...AXIS} width={52} tickFormatter={(v: number) => format(v)}>
        <Label value={yLabel} angle={-90} position="insideLeft" offset={12} style={AXIS_LABEL} />
      </YAxis>
      {tip}
      {(refs ?? []).map((r) => (
        <ReferenceLine
          key={r.label}
          y={r.y}
          x={r.x}
          {...RULE}
          label={{
            value: r.label,
            position: 'insideTopRight',
            fill: 'var(--ink-3)',
            fontSize: 8.5,
            fontFamily: MONO,
          }}
        />
      ))}
    </>
  );

  if (kind === 'bars')
    return (
      <Plot>
        <BarChart data={data} margin={MARGIN}>
          {axes}
          <Bar dataKey="value" fill="var(--seal)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          {hasProjection && (
            <Bar
              dataKey="projected"
              fill="var(--seal-tint)"
              stroke="var(--seal-deep)"
              strokeDasharray="3 2"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          )}
        </BarChart>
      </Plot>
    );

  if (kind === 'area')
    return (
      <Plot>
        <AreaChart data={data} margin={MARGIN}>
          {axes}
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
          {hasProjection && (
            <Area
              type="monotone"
              dataKey="projected"
              stroke="var(--seal-deep)"
              strokeWidth={1.4}
              strokeDasharray="4 3"
              fill="transparent"
              isAnimationActive={false}
              connectNulls={false}
              dot={false}
            />
          )}
        </AreaChart>
      </Plot>
    );

  return (
    <Plot>
      <LineChart data={data} margin={MARGIN}>
        {axes}
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--seal)"
          strokeWidth={1.6}
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
        />
        {hasProjection && (
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
        )}
      </LineChart>
    </Plot>
  );
}

/**
 * Two measures against each other, with the engine's own medians as the
 * crosshair. A row with no y is NOT plotted — dropping it to y=0 would file
 * every uncosted wine as a "dog" (the server refuses that too: `quadrant:
 * null`), so the count of them is printed beneath instead.
 */
export function PointPlot({ series }: { series: PointSeries }) {
  const { data, xLabel, yLabel, formatX, formatY, refX, refY } = series;
  return (
    <Plot>
      <ScatterChart margin={MARGIN}>
        <CartesianGrid stroke="var(--paper-2)" />
        <XAxis type="number" dataKey="x" {...AXIS} tickFormatter={(v: number) => formatX(v)}>
          <Label value={xLabel} position="insideBottom" offset={-11} style={AXIS_LABEL} />
        </XAxis>
        <YAxis
          type="number"
          dataKey="y"
          {...AXIS}
          width={52}
          tickFormatter={(v: number) => formatY(v)}
        >
          <Label value={yLabel} angle={-90} position="insideLeft" offset={12} style={AXIS_LABEL} />
        </YAxis>
        <ZAxis range={[36, 36]} />
        <Tooltip
          cursor={{ stroke: 'var(--seal-ring)' }}
          content={
            (({
              active,
              payload,
            }: {
              active?: boolean;
              payload?: Array<{ payload?: Point2 }>;
            }) => {
              const p = active ? payload?.[0]?.payload : undefined;
              if (!p) return null;
              return (
                <div className="rp-tip">
                  <span className="rp-tip__head">{p.name}</span>
                  <span className="rp-tip__row">
                    <b>{formatX(p.x)}</b> {xLabel}
                  </span>
                  <span className="rp-tip__row">
                    <b>{formatY(p.y)}</b> {yLabel}
                  </span>
                </div>
              );
            }) as unknown as never
          }
        />
        {refX != null && <ReferenceLine x={refX} {...RULE} />}
        {refY != null && <ReferenceLine y={refY} {...RULE} />}
        <Scatter data={data} fill="var(--seal)" isAnimationActive={false} />
      </ScatterChart>
    </Plot>
  );
}

interface Point2 {
  x: number;
  y: number;
  name: string;
}

/**
 * The heat map — a real table, for the reasons in this file's header.
 *
 * The ramp is one hue: the seal at an opacity proportional to the cell's share
 * of the largest cell. A cell with NO recorded row is left as blank paper with
 * a hairline, because "nobody rang anything up" and "the quietest service of
 * the quarter" must not look like each other.
 */
export function HeatGrid({ series }: { series: MatrixSeries }) {
  const { rows, cols, cells, xLabel, yLabel, unit, format } = series;
  const byKey = new Map(cells.map((c) => [`${c.row}|${c.col}`, c]));
  const known = cells.map((c) => c.value).filter((v): v is number => v != null);
  const max = known.length > 0 ? Math.max(...known) : 0;
  return (
    <div className="rp-heat-wrap">
      <table className="rp-heat">
        <caption className="rp-cap" style={{ textAlign: 'left', paddingBottom: 4 }}>
          {yLabel} against {xLabel}, in {unit}. A blank cell is a day with nothing recorded, not a
          day of nothing.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="rp-heat__corner">
              <span className="rp-eyebrow">{yLabel}</span>
            </th>
            {cols.map((c) => (
              <th key={c} scope="col" className="rp-heat__col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th scope="row" className="rp-heat__row">
                {r}
              </th>
              {cols.map((c) => {
                const cell = byKey.get(`${r}|${c}`);
                const v = cell?.value ?? null;
                const t = v == null || max <= 0 ? 0 : v / max;
                return (
                  <td
                    key={c}
                    className="rp-heat__cell"
                    data-blank={v == null}
                    title={cell ? `${cell.title} — ${format(v as number)} ${unit}` : undefined}
                    aria-label={cell ? `${cell.title}, ${format(v as number)} ${unit}` : undefined}
                  >
                    <span style={{ opacity: v == null ? 0 : 0.1 + 0.9 * t }} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The plain register: rows as they are, already formatted, dashes intact. */
export function DataTable({ table }: { table: TableSpec }) {
  return (
    <div className="rp-table-wrap">
      <table className="rp-table">
        <thead>
          <tr>
            {table.cols.map((c) => (
              <th key={c.key} scope="col" data-numeric={c.numeric}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((cell, i) => (
                <td
                  key={table.cols[i]?.key ?? i}
                  data-numeric={table.cols[i]?.numeric}
                  data-unknown={cell === EM}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.more && <p className="rp-cap">{table.more}</p>}
    </div>
  );
}
