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
 *     Both axes are named in ONE caption above the plot (never a rotated
 *     title on the axis, which sat on the tick labels); the tooltip repeats
 *     the unit in words.
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

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { tipMotion, useAfterPaint, useDrawIn } from './rp-draw';
import { EM, MONO } from './rp-format';
import { choose, planCombo, type ComboPick, type ComboPlan, type ComboRow } from './rp-combo';
import type { CatSeries, PointSeries } from './rp-view';
import { NO_STRETCH, stretchSpan, stretchStep } from './rp-stretch';

// Re-exported so `./rp-plot` still names everything; the chart-free parts live
// in `rp-plot-chrome.tsx`, which the page loads without recharts.
export * from './rp-plot-chrome';

/* ─────────────────────────────────────────────────── shared chrome ─────── */

/** The smallest type on a plot: a tick, a reference label (N-03, 11 px floor). */
const TICK_PX = 11;

const AXIS = {
  stroke: 'transparent',
  tick: { fill: 'var(--ink-4)', fontSize: TICK_PX, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' },
  tickLine: false,
  axisLine: false,
} as const;

/**
 * Room for the first x label on a line or an area. Its centre sits on the
 * plot's left edge, so half of "Oct 20" used to print over the "$0" of the
 * value axis. Twenty pixels clears half of a six-glyph label at tick size.
 * The right is for the last label, centred on the plot's right edge, whose
 * second half used to run out of the svg ("Sat" ended a pixel past the plot).
 * Bars keep their band padding and need none.
 */
export const X_ORIGIN_PAD = { left: 20, right: 14 } as const;

/** A hairline at 6% ink: the grid is there to be read against, not looked at. */
const GRID = { stroke: 'var(--ink-1)', strokeOpacity: 0.06 } as const;

/** The hover crosshair: one 1 px hairline in ink, not a second colour. */
const CROSSHAIR = { stroke: 'var(--ink-3)', strokeWidth: 1 } as const;

/** Where measurement stops: a solid 1 px divider (the dashed rule is for thresholds the server sent). */
const SEAM = { stroke: 'var(--ink-3)', strokeWidth: 1 } as const;

const RULE = { stroke: 'var(--ink-3)', strokeDasharray: '2 3' } as const;

/** One mono glyph at tick size, kept a touch generous: jsdom and a server render cannot measure text. */
const TICK_GLYPH_PX = TICK_PX * 0.62;

/**
 * A value axis's width, from its widest tick label (N-03), so a long figure
 * never runs under the plot's edge and a short one does not waste the left
 * gutter. `labels` are the tick strings the axis will print: the extremes of
 * the data run through the same formatter the axis uses.
 */
export function gutterFor(labels: ReadonlyArray<string>): number {
  const longest = labels.reduce((n, l) => Math.max(n, l.length), 0);
  return Math.max(32, Math.ceil(longest * TICK_GLYPH_PX) + 8);
}

/** The ticks a value axis is likely to print: zero, the extremes, and one step past the top. */
function tickLabels(values: ReadonlyArray<number | null | undefined>, format: (v: number) => string): string[] {
  const real = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (real.length === 0) return [format(0)];
  const hi = Math.max(...real);
  const lo = Math.min(...real);
  return [format(0), format(lo), format(hi), format(Math.ceil(hi * 1.2))];
}

/** Room above and beside the drawing; the titles live in the caption now, so the bottom is tight. */
const MARGIN = { top: 8, right: 8, bottom: 4, left: 2 } as const;

/**
 * The hover detail never runs past the plot's edge, where `.rp-plot` clips it
 * (audit G16, r28 gap 18). recharts keeps a tooltip at or right of the plotting
 * area's left edge (the margin and the value axis) and flips it left when it
 * would pass the right edge; a tooltip wider than the room right of that edge
 * still ran out of the box and lost its end. Bounding its width to that room,
 * and letting a long name wrap (`.rp-tip`), keeps the whole of it on the plot
 * at any cutting width. The room depends on the axis's own gutter.
 */
export function tipWrapper(gutter: number): CSSProperties {
  return { maxWidth: `calc(100% - ${MARGIN.left + gutter}px)`, zIndex: 2 };
}

/** "taken" and "₺ a day" read as "Taken, ₺ a day"; a unit that only repeats the name is left out. */
function titled(name: string, unit?: string): string {
  const head = name.charAt(0).toUpperCase() + name.slice(1);
  const u = (unit ?? '').trim();
  if (!u || u.toLowerCase() === name.trim().toLowerCase()) return head;
  return `${head}, ${u}`;
}

/**
 * What a plot is drawing, said once above it (N-03). It replaces the rotated
 * title on each value axis, which sat on the tick labels: one caption in the
 * reader's reading order, 11 px, never in the way of a figure.
 */
function PlotCaption({ children }: { children: ReactNode }) {
  return <p className="rp-plot-cap">{children}</p>;
}

/** The one-sentence reading a screen reader gets in place of the picture: the high and the low. */
export function readingOf(
  rows: ReadonlyArray<{ label: string; v: number | null | undefined }>,
  format: (v: number) => string,
  unit: string,
): string {
  const real = rows.filter((r): r is { label: string; v: number } => typeof r.v === 'number');
  if (real.length < 2) return '';
  let hi = real[0];
  let lo = real[0];
  for (const r of real) {
    if (r.v > hi.v) hi = r;
    if (r.v < lo.v) lo = r;
  }
  if (hi.v === lo.v) return `. Every point is ${format(hi.v)} ${unit}`.trimEnd();
  return `. Highest ${hi.label}, ${format(hi.v)} ${unit}; lowest ${lo.label}, ${format(lo.v)} ${unit}`.trimEnd();
}

/**
 * What the keyboard and a screen reader are told about the point the tooltip is on (r108 g2). A tooltip
 * reports its sentence here (`useSpoken`); `Plot` speaks it in one polite line, and Escape hides the tip.
 */
const PlotTip = createContext<{ say: (sentence: string) => void; hidden: boolean } | null>(null);

/** One line of a tooltip: a measure's figure, or `null` for a day that is not stated (never 0). */
export interface TipLine {
  name?: string;
  value: string | null;
  tail: string;
  /** What a null value says when it is a stated absence (a day with no check), not an unstated figure. */
  absent?: string;
}
export interface TipModel {
  head: string;
  lines: TipLine[];
}

/** The tip as words, in the order the eye reads it. The visible tooltip and the live line both come from the model. */
export function tipSentence(m: TipModel): string {
  const lines = m.lines.map(
    (l) => `${l.name ? `${l.name}: ` : ''}${l.value === null ? (l.absent ?? 'Not stated').toLowerCase() : `${l.value}${l.tail}`}`,
  );
  return `${m.head}. ${lines.join('; ')}`;
}

/** A tooltip's sentence to the plot's live line, and gone when the tip is. Returns whether Escape has hidden it. */
function useSpoken(model: TipModel | null): boolean {
  const k = useContext(PlotTip);
  const say = k?.say;
  const sentence = model ? tipSentence(model) : '';
  useEffect(() => {
    say?.(sentence);
  }, [say, sentence]);
  return k?.hidden ?? false;
}

/**
 * The frame every recharts drawing sits in. It names itself for a screen
 * reader in words (`label`), and a drawing that can be walked by keyboard
 * (`keys`) is a group the reader can arrow through: the chart's own surface is
 * the one tab stop (recharts' `accessibilityLayer`), the tooltip follows
 * Left and Right, one polite line says what it shows, and Escape hides it. A
 * scatter has no order to walk, so it stays a picture with its table as the
 * keyboard path.
 */
function Plot({
  children,
  label,
  caption,
  held = false,
  stretch,
  keys = true,
}: {
  children: ReactNode;
  label: string;
  /** The slot is drawn, the drawing is not yet (`useAfterPaint`): a heavy plot's first frame. */
  held?: boolean;
  /** What is drawn, said once above the plot (N-03). */
  caption?: ReactNode;
  /** The till's "Read a stretch" (r108 g3): its readout slot, always reserved when offered. */
  stretch?: Stretch;
  /** Arrow keys walk the points; false for a scatter. */
  keys?: boolean;
}) {
  const { ref, state } = useDrawIn();
  const [said, setSaid] = useState('');
  const [hidden, setHidden] = useState(false);
  const tip = useMemo(() => ({ say: setSaid, hidden }), [hidden]);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setHidden(false);
    else if (e.key === 'Escape' && said !== '' && !hidden) {
      // The tip was showing: this Escape is for it. The full-screen view reads `defaultPrevented`, so it stays up.
      e.preventDefault();
      setHidden(true);
    }
  };
  const stretchAttrs = stretch ? { 'data-stretch-id': stretch.id, 'data-stretching': stretch.span ? 'true' : 'false' } : {};
  const drawing = !held && (
    <ResponsiveContainer width="100%" height="100%" debounce={1}>
      {children as never}
    </ResponsiveContainer>
  );
  return (
    <>
      {caption != null && <PlotCaption>{caption}</PlotCaption>}
      {keys ? (
        <div
          className="rp-plot"
          role="group"
          aria-roledescription="chart"
          aria-label={label}
          ref={ref}
          data-draw={state}
          data-tip-hidden={hidden || undefined}
          onKeyDown={onKeyDown}
          onKeyDownCapture={stretch?.keyCapture}
          onPointerMove={hidden ? () => setHidden(false) : undefined}
          {...stretchAttrs}
        >
          <PlotTip.Provider value={tip}>{drawing}</PlotTip.Provider>
          <p className="rp-sr-only" aria-live="polite" data-testid="rp-plot-live">
            {hidden ? '' : said}
          </p>
        </div>
      ) : (
        <div className="rp-plot" role="img" aria-label={label} ref={ref} data-draw={state} {...stretchAttrs}>
          {drawing}
        </div>
      )}
      {stretch && (
        <p className="rp-stretch" data-stretch-id={stretch.id} data-state={stretch.state} aria-live="polite" title={stretch.words}>
          {stretch.words}
        </p>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────── read a stretch (g3) ───── */

/** Said in the reserved slot before anything is marked. */
export const STRETCH_HINT = 'Drag across days, tap a first and a last day, or hold Shift with the arrow keys, to read a stretch.';

interface Stretch {
  id: string;
  /** The marked slots of the drawing's rows, low to high. */
  span: [number, number] | null;
  words: string;
  state: 'hint' | 'half' | 'read';
  /** The chart's pointer handlers; empty when the drawing offers no stretch. */
  on: Record<string, (st: { activeTooltipIndex?: number } | null, e?: { target?: unknown }) => void>;
  /**
   * Shift+Left and Shift+Right mark the stretch from the keyboard (DD-r108-41).
   * It runs in the capture phase, before recharts' own arrow handler moves the
   * point; the move then lands in `onMouseMove`, which extends the stretch.
   */
  keyCapture: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
}

/**
 * The stretch on one drawing. Indices are slots of `series.data` (the whole
 * window, never the thinned rows); `slotOf` maps a drawn row back to its slot.
 * Escape, or a press outside this drawing, clears it. A press on a sheet being
 * arranged is the cutting's drag, never a stretch.
 */
function useStretch(series: CatSeries, slotOf: (drawn: number) => number | undefined): Stretch | undefined {
  const [s, send] = useReducer(stretchStep, NO_STRETCH);
  const id = useId();
  // The slot the keyboard (or pointer) is on, and a Shift+Arrow waiting for
  // recharts to move off it: recharts walks its points by spoofing a mouse
  // move, so the new slot arrives in `onMouseMove`.
  const onSlot = useRef<number | undefined>(undefined);
  const keyFrom = useRef<number | undefined>(undefined);
  const offered = series.stretch != null;
  const marked = s.anchor != null;
  useEffect(() => {
    if (!offered || !marked) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') send({ type: 'clear' });
    };
    const press = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest?.(`[data-stretch-id="${CSS.escape(id)}"]`)) send({ type: 'clear' });
    };
    // A release outside the drawing still ends the press.
    const release = () => send({ type: 'up' });
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', press);
    document.addEventListener('pointerup', release);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('pointerup', release);
    };
  }, [offered, marked, id]);
  if (!series.stretch) return undefined;
  const at = (st: { activeTooltipIndex?: number } | null) => {
    const i = st?.activeTooltipIndex;
    return typeof i === 'number' ? slotOf(i) : undefined;
  };
  const span = stretchSpan(s);
  const half = span != null && !s.settled && !s.down;
  const words = span == null
    ? STRETCH_HINT
    : half
      ? (series.stretchFrom?.(span[0]) ?? STRETCH_HINT)
      : (series.stretch(span[0], span[1]) ?? STRETCH_HINT);
  return {
    id,
    span,
    words,
    state: span == null ? 'hint' : half ? 'half' : 'read',
    on: {
      onMouseDown: (st, e) => {
        const t = e?.target as Element | undefined;
        if (t?.closest?.('[data-arranging="true"]')) return;
        const i = at(st);
        if (i != null) send({ type: 'down', at: i });
      },
      onMouseMove: (st) => {
        const i = at(st);
        if (i != null) onSlot.current = i;
        const from = keyFrom.current;
        keyFrom.current = undefined;
        if (from != null && i != null) {
          send({ type: 'key', from, to: i });
          return;
        }
        if (!s.down) return;
        if (i != null) send({ type: 'move', at: i });
      },
      onMouseUp: (st) => send({ type: 'up', at: at(st) }),
    },
    keyCapture: (e) => {
      if (!e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      if (onSlot.current != null) keyFrom.current = onSlot.current;
    },
  };
}

/** The marked days as a band behind the drawing: the house's tint, no animation (it follows the pointer 1:1). */
function stretchBand(stretch: Stretch | undefined, all: ReadonlyArray<{ label: string }>, yAxisId?: string) {
  if (!stretch?.span) return null;
  const x1 = all[stretch.span[0]]?.label;
  const x2 = all[stretch.span[1]]?.label;
  if (x1 == null || x2 == null) return null;
  return (
    <ReferenceArea
      x1={x1}
      x2={x2}
      {...(yAxisId ? { yAxisId } : {})}
      fill="var(--seal-tint)"
      fillOpacity={1}
      stroke="none"
      ifOverflow="hidden"
      className="rp-stretch-band"
    />
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
  priorLabel,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | null; payload?: unknown }>;
  label?: string | number;
  unit: string;
  format: (v: number) => string;
  projectedLabel?: string;
  priorLabel?: string;
}) {
  const row = payload?.[0]?.payload as { full?: string; isProjected?: boolean; noCheck?: boolean } | undefined;
  const numeric = (payload ?? []).filter((p) => typeof p.value === 'number');
  const model: TipModel | null =
    !active || !payload || payload.length === 0
      ? null
      : {
          head: row?.full ?? String(label ?? ''),
          // A day with no figure says so; it is never drawn as 0 (ADR 0020).
          lines:
            numeric.length === 0
              ? [{ value: null, tail: '', ...(row?.noCheck ? { absent: 'No check' } : {}) }]
              : numeric.map((p) => {
                  // A bar drawing carries one series, so a projected bar says so itself.
                  const projected =
                    p.dataKey === 'projected' || (p.dataKey === 'shown' && row?.isProjected === true);
                  return {
                    value: format(p.value as number),
                    tail: ` ${unit}${projected && projectedLabel ? ` · ${projectedLabel}` : ''}${
                      p.dataKey === 'prior' && priorLabel ? ` · ${priorLabel}` : ''
                    }`,
                  };
                }),
        };
  const hidden = useSpoken(model);
  if (!model || hidden) return null;
  return (
    <div className="rp-tip">
      <span className="rp-tip__head">{model.head}</span>
      {model.lines.map((l, i) =>
        l.value === null ? (
          <span key={i} className="rp-tip__row">
            {l.absent ?? 'Not stated'}
          </span>
        ) : (
          <span key={i} className="rp-tip__row">
            <b>{l.value}</b>
            {l.tail}
          </span>
        ),
      )}
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

/** One bar's place in the rise: `--rp-i` of `--rp-n` fixes its delay inside the 160 ms sweep (reports-next.css, `rp-grow`). */
const stagger = (i: number, n: number): CSSProperties =>
  ({ ['--rp-i' as string]: i, ['--rp-n' as string]: n }) as CSSProperties;

/** Value labels over bars hold when the bars are few enough that they cannot touch. */
export const LABEL_BARS_MAX = 8;

/** A bar's figure in tabular mono over it (N-15); the formatter is the axis's own. */
function valueLabels(dataKey: string, format: (v: number) => string) {
  return (
    <LabelList
      dataKey={dataKey}
      position="top"
      className="rp-bar-value"
      formatter={(v: unknown) => (typeof v === 'number' ? format(v) : '')}
      style={{ fontFamily: MONO, fontSize: TICK_PX, fontVariantNumeric: 'tabular-nums', fill: 'var(--ink-2)' }}
    />
  );
}

const KIND_WORDS = { line: 'A line', area: 'An area', bars: 'Bars' } as const;

/** The most points a drawing carries; the table keeps every one (r102 M7: 365 days drew 365 recharts nodes and froze a frame). */
export const MAX_DRAWN = 150;

/**
 * At most `max` of the rows, in order: the first and last, the seam where
 * measurement stops (and any row a reference line names), and the highest row
 * of each stretch between. A row kept is a real row, never an average, so a
 * tooltip still tells a day that happened.
 */
export function thinCats<T extends { label: string; value?: number | null; projected?: number | null }>(
  data: readonly T[],
  refs: ReadonlyArray<{ x?: string | number | null }> = [],
  max: number = MAX_DRAWN,
): T[] {
  if (data.length <= max) return data as T[];
  const must = new Set<number>([0, data.length - 1]);
  const named = new Set(refs.map((r) => r.x).filter((x) => x != null).map(String));
  data.forEach((d, i) => {
    // Only the seam where measurement hands over to the projection is a must-row. A plain closed day is an
    // ordinary row: counting every null/non-null edge made a house closed on Mondays carry 2 rows a week
    // and overrun the cap the drawing is held to (r104 review).
    const seam =
      i > 0 && (data[i - 1].value == null) !== (d.value == null) && (d.projected != null || data[i - 1].projected != null);
    if (seam || named.has(d.label)) must.add(i);
  });
  const rest = data.map((_, i) => i).filter((i) => !must.has(i));
  const buckets = Math.max(max - must.size, 1);
  const size = Math.ceil(rest.length / buckets);
  for (let at = 0; at < rest.length; at += size) {
    const chunk = rest.slice(at, at + size);
    const top = (i: number) => data[i].value ?? data[i].projected ?? -Infinity;
    must.add(chunk.reduce((best, i) => (top(i) > top(best) ? i : best), chunk[0]));
  }
  return [...must].sort((a, b) => a - b).map((i) => data[i]);
}

/** More drawn points than this (a 365-day till: 124 bars) mount a frame after the tap, not in it. */
export const HOLD_OVER = 100;

/** A phone cannot tell 124 bars on 375 px apart (about 2.5 px each), so it draws at most this many: under HOLD_OVER, so a 365-day switch is as light as the 90-day one (r104). */
export const PHONE_DRAWN = 90;
const PHONE_QUERY = '(max-width: 767px)';

/** The phone width, following a rotation. A browser that cannot say is read as a desk. */
function usePhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      try {
        const m = window.matchMedia(PHONE_QUERY);
        m.addEventListener('change', notify);
        return () => m.removeEventListener('change', notify);
      } catch {
        return () => {};
      }
    },
    () => {
      try {
        return window.matchMedia(PHONE_QUERY).matches;
      } catch {
        return false;
      }
    },
    () => false,
  );
}

export function CatPlot({ series, kind }: { series: CatSeries; kind: 'line' | 'area' | 'bars' }) {
  const { data: all, xLabel, yLabel, unit, format, refs, projectedLabel, priorLabel } = series;
  const phone = usePhone();
  const data = thinCats(all, refs, phone ? PHONE_DRAWN : MAX_DRAWN);
  const slots = new Map(all.map((d, i) => [d as object, i]));
  const stretch = useStretch(series, (i) => (data[i] ? slots.get(data[i]) : undefined));
  const band = stretchBand(stretch, all);
  const heavy = data.length > HOLD_OVER;
  const painted = useAfterPaint(heavy ? `${kind}:${data.length}` : null);
  const held = heavy && !painted;
  const thinned = data.length < all.length;
  const hasProjection = all.some((d) => d.projected != null);
  // The window just before, dashed beside the measured one. Drawn only when
  // some day of it is known; a day that is not stays a gap, never a zero.
  const hasPrior = all.some((d) => d.prior != null);
  const label = `${KIND_WORDS[kind]} of ${yLabel} by ${xLabel}${
    hasProjection ? `, the ${projectedLabel ?? 'projected'} part dashed` : ''
  }${hasPrior ? `, ${priorLabel ?? 'the prior window'} dashed beside it` : ''}${readingOf(
    all.map((d) => ({ label: d.full ?? d.label, v: d.value ?? d.projected })),
    format,
    unit,
  )}`;
  const captionText = `${titled(yLabel, unit)} · by ${xLabel}${
    thinned ? ` · ${data.length} of ${all.length}, the highest of each stretch; the table has every one` : ''
  }`;
  // The dashed drawing is named beside a swatch of itself: "Taken · by day, dashed: prior 30 days".
  const caption = hasPrior ? (
    <>
      {captionText}, dashed: <span className="rp-plot-key" data-kind={kind} aria-hidden="true" />
      {(priorLabel ?? 'the prior window').replace(/^the /, '')}
    </>
  ) : (
    captionText
  );
  const gutter = gutterFor(
    tickLabels(
      [...all.map((d) => d.value), ...all.map((d) => d.projected), ...all.map((d) => d.prior), ...(refs ?? []).map((r) => r.y)],
      format,
    ),
  );
  const tip = (
    <Tooltip
      wrapperStyle={tipWrapper(gutter)}
      {...tipMotion()}
      filterNull={false}
      cursor={kind === 'bars' ? { fill: 'var(--seal-tint)' } : CROSSHAIR}
      content={
        <Tip unit={unit} format={format} projectedLabel={projectedLabel} priorLabel={priorLabel} /> as unknown as never
      }
    />
  );
  const axes = (
    <>
      <CartesianGrid vertical={false} {...GRID} />
      <XAxis
        dataKey="label"
        {...AXIS}
        interval={tickInterval(data)}
        minTickGap={26}
        padding={kind === 'bars' ? undefined : X_ORIGIN_PAD}
      />
      <YAxis {...AXIS} width={gutter} tickFormatter={(v: number) => format(v)} />
      {band}
      {tip}
      {(refs ?? []).map((r) => (
        <ReferenceLine
          key={r.label}
          y={r.y}
          x={r.x}
          {...(r.x != null ? SEAM : RULE)}
          label={{
            value: r.label,
            position: 'insideTopRight',
            fill: 'var(--ink-4)',
            fontSize: TICK_PX,
            fontFamily: MONO,
          }}
        />
      ))}
      {(refs ?? []).flatMap((r) => {
        // The seam where measurement stops: a 4 px dot on the line where it crosses.
        const at = r.x != null ? data.find((d) => d.label === r.x) : undefined;
        const y = at ? (at.value ?? at.projected) : null;
        return typeof y === 'number'
          ? [<ReferenceDot key={`${r.label}:dot`} x={r.x} y={y} r={4} fill="var(--seal)" stroke="var(--paper-0)" strokeWidth={1.5} className="rp-seam-dot" />]
          : [];
      })}
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
    const labelled = rows.length <= LABEL_BARS_MAX;
    return (
      <Plot label={label} caption={caption} held={held} stretch={stretch}>
        <BarChart accessibilityLayer data={rows} margin={labelled ? { ...MARGIN, top: 20 } : MARGIN} {...stretch?.on}>
          {axes}
          <Bar dataKey="shown" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {labelled && valueLabels('shown', format)}
            {rows.map((r, i) =>
              r.isProjected ? (
                <Cell
                  key={`${i}:${r.label}`}
                  fill="var(--seal-tint)"
                  stroke="var(--seal-deep)"
                  strokeDasharray="3 2"
                  data-projected="true"
                  style={stagger(i, rows.length)}
                />
              ) : (
                <Cell key={`${i}:${r.label}`} fill="var(--seal)" data-projected="false" style={stagger(i, rows.length)} />
              ),
            )}
          </Bar>
          {hasPrior && (
            <Bar
              dataKey="prior"
              fill="transparent"
              stroke="var(--seal-deep)"
              strokeDasharray="3 2"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
              data-prior="true"
            />
          )}
        </BarChart>
      </Plot>
    );
  }

  if (kind === 'area')
    return (
      <Plot label={label} caption={caption} held={held} stretch={stretch}>
        <AreaChart accessibilityLayer data={data} margin={MARGIN} {...stretch?.on}>
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
          {hasPrior && (
            <Area
              type="monotone"
              dataKey="prior"
              className="rp-prior"
              stroke="var(--ink-3)"
              strokeWidth={1.2}
              strokeDasharray="2 3"
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
    <Plot label={label} caption={caption} held={held} stretch={stretch}>
      <LineChart accessibilityLayer data={data} margin={MARGIN} {...stretch?.on}>
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
        {hasPrior && (
          <Line
            type="monotone"
            dataKey="prior"
            className="rp-prior"
            stroke="var(--ink-3)"
            strokeWidth={1.2}
            strokeDasharray="2 3"
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
  // Rows are the series' slots one for one (rp-combo.ts), so a row is its slot.
  const stretch = useStretch(series, (i) => (i >= 0 && i < series.data.length ? i : undefined));
  if (!plan) return null;
  const set = (side: keyof ComboPick, key: string) => {
    const next = choose(plan.pick, side, key);
    if (onPick) onPick(next);
    else setOwn(next);
  };
  const { bars, line, split, rows } = plan;
  const shared = split ? null : bars.unit;
  const barGutter = gutterFor(tickLabels(rows.map((r) => r.bar), bars.format));
  const lineGutter = split ? gutterFor(tickLabels(rows.map((r) => r.line), line.format)) : 0;
  const caption = split
    ? `${titled(bars.label, bars.unit)} (bars, left) · ${titled(line.label, line.unit)} (line, right) · by ${series.xLabel}`
    : `${titled(bars.label, shared ?? undefined)} · by ${series.xLabel}`;
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
      <Plot
        label={`Bars of ${bars.label} and a line of ${line.label} by ${series.xLabel}${readingOf(
          rows.map((r) => ({ label: r.full ?? r.label, v: r.bar })),
          bars.format,
          bars.unit,
        )}`}
        caption={caption}
        stretch={stretch}
      >
        <ComposedChart
          accessibilityLayer
          data={rows}
          margin={{ ...MARGIN, ...(split ? { right: 2 } : {}), ...(rows.length <= LABEL_BARS_MAX ? { top: 20 } : {}) }}
          {...stretch?.on}
        >
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey="label" {...AXIS} interval={tickInterval(rows)} minTickGap={26} />
          <YAxis
            yAxisId="bars"
            {...AXIS}
            width={barGutter}
            tickFormatter={(v: number) => bars.format(v)}
          />
          {split && (
            <YAxis
              yAxisId="line"
              orientation="right"
              {...AXIS}
              width={lineGutter}
              tickFormatter={(v: number) => line.format(v)}
            />
          )}
          {stretchBand(stretch, rows, 'bars')}
          <Tooltip
            wrapperStyle={tipWrapper(barGutter)}
            {...tipMotion()}
            filterNull={false}
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
          >
            {rows.length <= LABEL_BARS_MAX && valueLabels('bar', bars.format)}
            {rows.map((r, i) => (
              <Cell key={`${i}:${r.label}`} fill="var(--seal)" style={stagger(i, rows.length)} />
            ))}
          </Bar>
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
      {[bars, line].map((m) =>
        m.note ? (
          <p key={m.key} className="rp-cap">
            {m.note}
          </p>
        ) : null,
      )}
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
  payload?: Array<{ payload?: ComboRow }>;
  plan: ComboPlan;
}) {
  const row = active ? payload?.[0]?.payload : undefined;
  const model: TipModel | null = row
    ? {
        head: row.full ?? '',
        lines: (
          [
            [row.bar, plan.bars, row.barTip],
            [row.line, plan.line, row.lineTip],
          ] as Array<[number | null, ComboPlan['bars'], string | null | undefined]>
        ).map(([v, m, tip]) => ({
          name: m.label,
          value: v == null ? null : m.format(v),
          // A measure's own words after its figure (#2394: "over 5 trading days").
          tail: `${v == null ? '' : ` ${m.unit}`}${tip ? ` ${tip}` : ''}`,
        })),
      }
    : null;
  const hidden = useSpoken(model);
  if (!model || hidden) return null;
  return (
    <div className="rp-tip">
      <span className="rp-tip__head">{model.head}</span>
      {model.lines.map((l) => (
        <span key={l.name} className="rp-tip__row">
          {l.name}: {l.value === null ? <b>{EM}</b> : <b>{l.value}</b>}
          {l.tail}
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
  const gutter = gutterFor(tickLabels(data.map((d) => d.y), formatY));
  return (
    <Plot
      label={`${yLabel} against ${xLabel}, one point each`}
      caption={`${titled(yLabel)} · against ${xLabel}`}
      keys={false}
    >
      <ScatterChart margin={MARGIN}>
        <CartesianGrid {...GRID} />
        <XAxis type="number" dataKey="x" {...AXIS} tickFormatter={(v: number) => formatX(v)} />
        <YAxis
          type="number"
          dataKey="y"
          {...AXIS}
          width={gutter}
          tickFormatter={(v: number) => formatY(v)}
        />
        <ZAxis range={[36, 36]} />
        <Tooltip
          wrapperStyle={tipWrapper(gutter)}
      {...tipMotion()}
          cursor={CROSSHAIR}
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
