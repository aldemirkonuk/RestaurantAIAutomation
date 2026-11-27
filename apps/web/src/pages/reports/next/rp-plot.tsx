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

import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
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
import { choose, planCombo, type ComboPick, type ComboPlan } from './rp-combo';
import type { CatSeries, Fig, MatrixSeries, PointSeries, TableSpec } from './rp-view';

/* ─────────────────────────────────────────────────── shared chrome ─────── */

const AXIS = {
  stroke: 'var(--paper-2)',
  tick: { fill: 'var(--ink-4)', fontSize: 9.5, fontFamily: MONO },
  tickLine: false,
} as const;

const AXIS_LABEL = {
  fill: 'var(--ink-4)',
  fontSize: 9,
  fontFamily: MONO,
  letterSpacing: '0.08em',
} as const;

const RULE = { stroke: 'var(--ink-3)', strokeDasharray: '2 3' } as const;

/**
 * One glyph of an axis title: the mono face is about 0.6em wide, plus the
 * 0.08em tracking (`AXIS_LABEL`). An estimate, kept generous, since jsdom and
 * a server render cannot measure text.
 */
const TITLE_GLYPH_PX = AXIS_LABEL.fontSize * 0.68;
/** How far a value axis's title stands in from the axis's outer edge. */
const TITLE_INSET = 12;

/**
 * An axis title cut to the room it has, by the glyph estimate above: whole
 * when it fits, else shortened with an ellipsis, and nothing at all when not
 * even two glyphs fit (an ellipsis alone names nothing).
 */
export function fitTitle(text: string, room: number): string {
  const max = Math.floor(room / TITLE_GLYPH_PX);
  if (text.length <= max) return text;
  if (max < 2) return '';
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A value axis's title, standing on the middle of its axis (r33 walk R-F1).
 * recharts anchors a rotated `insideLeft` / `insideRight` title at one END
 * (`textAnchor` start or end, which a `textAnchor` prop cannot override), so
 * the title ran from the axis's middle up past the plot's top edge, where
 * `.rp-plot` clips it: on the till's bars and a line, "Average check" read
 * "ge check". Here it is centred on the axis, and a title longer than the
 * room is shortened, with the whole name in a `<title>` for a pointer; the
 * plot's own words (`Plot` label, the combo caption) carry it for a screen
 * reader.
 */
export function SideTitle({
  viewBox,
  text,
  side,
}: {
  /** The axis's box, which recharts' `Label` passes in. */
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
  text: string;
  side: 'left' | 'right';
}) {
  if (!viewBox) return null;
  const { x = 0, y = 0, width = 0, height = 0 } = viewBox;
  const cx = side === 'left' ? x + TITLE_INSET : x + width - TITLE_INSET;
  const cy = y + height / 2;
  // Centred, the title may use the plot's margins above and below its axis
  // as well as the axis itself, but no more than the room above its middle
  // allows on both sides: the drawing's top edge is y = 0.
  const shown = fitTitle(text, 2 * cy - 4);
  if (!shown) return null;
  return (
    <text
      x={cx}
      y={cy}
      transform={`rotate(${side === 'left' ? -90 : 90}, ${cx}, ${cy})`}
      textAnchor="middle"
      dominantBaseline="central"
      className="recharts-label rp-axis-title"
      data-side={side}
      style={AXIS_LABEL}
    >
      {shown !== text && <title>{text}</title>}
      {shown}
    </text>
  );
}

/**
 * `SideTitle` as a recharts `Label` content element: `Label` clones it with
 * the axis's `viewBox` (an element, not a function, so React keeps one
 * component type across renders).
 */
const sideTitle = (text: string, side: 'left' | 'right') => (
  <SideTitle text={text} side={side} />
);

/** Room for the two axis labels. Kept in one place so every plot agrees. */
const MARGIN = { top: 8, right: 8, bottom: 14, left: 2 } as const;
/** Every value axis on this page is this wide, left or right. */
const Y_AXIS_W = 52;

/**
 * The hover detail never runs past the plot's edge, where `.rp-plot` clips it
 * (audit G16, r28 gap 18). recharts keeps a tooltip at or right of the
 * plotting area's left edge (the margin and the value axis) and flips it left
 * when it would pass the right edge; a tooltip wider than the room right of
 * that edge still ran out of the box and lost its end. Bounding its width to
 * that room, and letting a long name wrap (`.rp-tip`), keeps the whole of it
 * on the plot at any cutting width.
 */
export const TIP_WRAPPER: CSSProperties = {
  maxWidth: `calc(100% - ${MARGIN.left + Y_AXIS_W}px)`,
  zIndex: 2,
};

/**
 * The frame every recharts drawing sits in. It names itself for a screen
 * reader in words (`label`), because the SVG inside is a picture: the same
 * register's table drawing is the readable form, one "Draw as" away.
 */
function Plot({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="rp-plot" role="img" aria-label={label}>
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
  const row = payload[0]?.payload as { full?: string; isProjected?: boolean } | undefined;
  const rows = payload.filter((p) => typeof p.value === 'number');
  if (rows.length === 0) return null;
  return (
    <div className="rp-tip">
      <span className="rp-tip__head">{row?.full ?? String(label ?? '')}</span>
      {rows.map((p) => {
        // A bar drawing carries one series, so a projected bar says so itself.
        const projected =
          p.dataKey === 'projected' || (p.dataKey === 'shown' && row?.isProjected === true);
        return (
          <span key={String(p.dataKey)} className="rp-tip__row">
            <b>{format(p.value as number)}</b> {unit}
            {projected && projectedLabel ? ` · ${projectedLabel}` : ''}
          </span>
        );
      })}
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
export function Working({
  lines,
  defaultOpen = false,
}: {
  lines: Array<string | null | undefined>;
  /** Open on first paint. The flat view starts open: it has the room. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
            {/* Keyed by position AND text: a server can return the same
                sentence twice, and a text-only key collapsed the pair into one. */}
            {real.map((l, i) => (
              <li key={`${i}:${l}`} className="rp-cap">
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
/**
 * Which category ticks to draw. A week (seven short names) always fits, so it
 * shows every day: `preserveStartEnd` with a 26px gap dropped Mon, Wed and Sat
 * from "The week's shape" on a 340px plot. Longer runs keep the first and last
 * and thin the middle rather than overprint.
 */
export function tickInterval(rows: ReadonlyArray<{ label: string }>): 0 | 'preserveStartEnd' {
  return rows.length <= 7 && rows.every((r) => r.label.length <= 5) ? 0 : 'preserveStartEnd';
}

const KIND_WORDS = { line: 'A line', area: 'An area', bars: 'Bars' } as const;

export function CatPlot({ series, kind }: { series: CatSeries; kind: 'line' | 'area' | 'bars' }) {
  const { data, xLabel, yLabel, unit, format, refs, projectedLabel } = series;
  const hasProjection = data.some((d) => d.projected != null);
  const label = `${KIND_WORDS[kind]} of ${yLabel} by ${xLabel}${
    hasProjection ? `, the ${projectedLabel ?? 'projected'} part dashed` : ''
  }`;
  const tip = (
    <Tooltip
      wrapperStyle={TIP_WRAPPER}
      cursor={kind === 'bars' ? { fill: 'var(--seal-tint)' } : { stroke: 'var(--seal-ring)' }}
      content={
        <Tip unit={unit} format={format} projectedLabel={projectedLabel} /> as unknown as never
      }
    />
  );
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--paper-2)" />
      <XAxis dataKey="label" {...AXIS} interval={tickInterval(data)} minTickGap={26}>
        <Label value={xLabel} position="insideBottom" offset={-11} style={AXIS_LABEL} />
      </XAxis>
      <YAxis {...AXIS} width={Y_AXIS_W} tickFormatter={(v: number) => format(v)}>
        <Label content={sideTitle(yLabel, 'left')} />
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
            fill: 'var(--ink-4)',
            fontSize: 8.5,
            fontFamily: MONO,
          }}
        />
      ))}
    </>
  );

  if (kind === 'bars') {
    // ONE bar series, so every day keeps a full-width slot. A day that was
    // measured is drawn measured, including the seam day the line drawings
    // share between both halves; a day that is only expected is the hollow,
    // dashed bar in the same slot. Two grouped series put a measured and a
    // projected bar side by side at half width, and drew the seam twice.
    const rows = data.map((d) => ({
      ...d,
      shown: d.value ?? d.projected ?? null,
      isProjected: d.value == null && d.projected != null,
    }));
    return (
      <Plot label={label}>
        <BarChart data={rows} margin={MARGIN}>
          {axes}
          <Bar dataKey="shown" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {rows.map((r, i) =>
              r.isProjected ? (
                <Cell
                  key={`${i}:${r.label}`}
                  fill="var(--seal-tint)"
                  stroke="var(--seal-deep)"
                  strokeDasharray="3 2"
                  data-projected="true"
                />
              ) : (
                <Cell key={`${i}:${r.label}`} fill="var(--seal)" data-projected="false" />
              ),
            )}
          </Bar>
        </BarChart>
      </Plot>
    );
  }

  if (kind === 'area')
    return (
      <Plot label={label}>
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
    <Plot label={label}>
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
 * A measure named for the caption: "Label (unit)", and just "Label" when the
 * unit only repeats the label ("Checks" in checks, "Taken" in taken), which
 * would read as "Checks, in checks".
 */
function named(m: { label: string; unit: string }): string {
  const same = m.unit.trim().toLowerCase() === m.label.trim().toLowerCase();
  return same ? m.label : `${m.label} (${m.unit})`;
}

/**
 * Bars for one measure and a line for another, on the same points — see
 * `rp-combo.ts` for the three rules (one axis per unit, a gap is a gap, the
 * picker never names a measure twice).
 *
 * The picker is shown only when the register offers more than two measures; with
 * exactly two there is nothing to choose. `pick`/`onPick` make it controlled
 * (the sheet keeps the choice above the cutting, keyed by its id, so moving the
 * cutting never loses it). The full-screen view holds its own choice the same
 * way, one level up in `CuttingFlat`, so it survives a "Draw as" flip there and
 * is never written to the sheet. With no `onPick` at all it keeps its own.
 */
export function ComboPlot({
  series,
  pick,
  onPick,
}: {
  series: CatSeries;
  pick?: Partial<ComboPick>;
  onPick?: (p: ComboPick) => void;
}) {
  const [own, setOwn] = useState<Partial<ComboPick> | undefined>(pick);
  const plan = planCombo(series, onPick ? pick : own);
  if (!plan) return null;
  const set = (side: keyof ComboPick, key: string) => {
    const next = choose(plan.pick, side, key);
    if (onPick) onPick(next);
    else setOwn(next);
  };
  const { bars, line, split, rows } = plan;
  const shared = split ? null : bars.unit;
  const words = split
    ? `Bars: ${named(bars)}, on the left scale. Line: ${named(line)}, on the right scale.`
    : `Bars: ${bars.label}. Line: ${line.label}. Both are in ${bars.unit}, so they share one scale.`;
  return (
    <>
      {plan.measures.length > 2 && (
        <div className="rp-row rp-no-drag" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="rp-field">
            <span className="rp-eyebrow">Bars show</span>
            <select
              className="rp-select rp-focus"
              aria-label="Bars show"
              value={plan.pick.bars}
              onChange={(e) => set('bars', e.target.value)}
            >
              {plan.measures.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="rp-field">
            <span className="rp-eyebrow">Line shows</span>
            <select
              className="rp-select rp-focus"
              aria-label="Line shows"
              value={plan.pick.line}
              onChange={(e) => set('line', e.target.value)}
            >
              {plan.measures.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <Plot label={`Bars of ${bars.label} and a line of ${line.label} by ${series.xLabel}`}>
        <ComposedChart
          data={rows}
          margin={split ? { ...MARGIN, right: 2 } : MARGIN}
        >
          <CartesianGrid vertical={false} stroke="var(--paper-2)" />
          <XAxis dataKey="label" {...AXIS} interval={tickInterval(rows)} minTickGap={26}>
            <Label value={series.xLabel} position="insideBottom" offset={-11} style={AXIS_LABEL} />
          </XAxis>
          <YAxis
            yAxisId="bars"
            {...AXIS}
            width={Y_AXIS_W}
            tickFormatter={(v: number) => bars.format(v)}
          >
            <Label content={sideTitle(shared ?? bars.label, 'left')} />
          </YAxis>
          {split && (
            <YAxis
              yAxisId="line"
              orientation="right"
              {...AXIS}
              width={Y_AXIS_W}
              tickFormatter={(v: number) => line.format(v)}
            >
              <Label content={sideTitle(line.label, 'right')} />
            </YAxis>
          )}
          <Tooltip
            wrapperStyle={TIP_WRAPPER}
            cursor={{ fill: 'var(--seal-tint)' }}
            content={<ComboTip plan={plan} /> as unknown as never}
          />
          <Bar
            yAxisId="bars"
            dataKey="bar"
            name={bars.label}
            fill="var(--seal)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          <Line
            yAxisId={split ? 'line' : 'bars'}
            dataKey="line"
            name={line.label}
            type="monotone"
            stroke="var(--ink-2)"
            strokeWidth={1.8}
            dot={{ r: 2.4, fill: 'var(--ink-2)', stroke: 'var(--ink-2)' }}
            isAnimationActive={false}
            connectNulls={false}
          />
        </ComposedChart>
      </Plot>
      <p className="rp-cap">{words}</p>
    </>
  );
}

/** The tooltip for the combination: each measure in its OWN unit, in words. */
function ComboTip({
  active,
  payload,
  plan,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { full?: string; bar: number | null; line: number | null } }>;
  plan: ComboPlan;
}) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const lines: Array<[string, number | null, ComboPlan['bars']]> = [
    ['Bars', row.bar, plan.bars],
    ['Line', row.line, plan.line],
  ];
  return (
    <div className="rp-tip">
      <span className="rp-tip__head">{row.full}</span>
      {lines.map(([side, v, m]) => (
        <span key={side} className="rp-tip__row">
          {m.label}: {v == null ? <b>{EM}</b> : <b>{m.format(v)}</b>} {v == null ? '' : m.unit}
        </span>
      ))}
    </div>
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
    <Plot label={`${yLabel} against ${xLabel}, one point each`}>
      <ScatterChart margin={MARGIN}>
        <CartesianGrid stroke="var(--paper-2)" />
        <XAxis type="number" dataKey="x" {...AXIS} tickFormatter={(v: number) => formatX(v)}>
          <Label value={xLabel} position="insideBottom" offset={-11} style={AXIS_LABEL} />
        </XAxis>
        <YAxis
          type="number"
          dataKey="y"
          {...AXIS}
          width={Y_AXIS_W}
          tickFormatter={(v: number) => formatY(v)}
        >
          <Label content={sideTitle(yLabel, 'left')} />
        </YAxis>
        <ZAxis range={[36, 36]} />
        <Tooltip
          wrapperStyle={TIP_WRAPPER}
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
                    title={cell ? `${cell.title} — ${heatWords(v, format, unit)}` : undefined}
                    aria-label={cell ? `${cell.title}, ${heatWords(v, format, unit)}` : undefined}
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

/** A heat cell's figure in words; a cell with no value is "nothing recorded", never a formatted null. */
function heatWords(v: number | null, format: (n: number) => string, unit: string): string {
  return v == null ? 'nothing recorded' : `${format(v)} ${unit}`;
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
