/**
 * One cutting on the sheet — and the two controls the founder asked for.
 *
 *   "…while we're editing the /reports page for our personalized customized
 *    versions, we should ask them either to change the type of graph or to
 *    change the graph or the data analysis itself."      — the review, 2026-09-03
 *
 * So a cutting has two questions attached to it while the sheet is being
 * arranged, and neither is asked while it is being read:
 *
 *   **Show instead** — which analysis occupies this square of paper. The list
 *   is the catalogue (`rp-catalogue.tsx`), which holds only analyses the
 *   gateway actually serves. An analysis already on the sheet is offered but
 *   disabled, because two cuttings showing the same register is a duplicate,
 *   not a comparison.
 *
 *   **Draw as** — how that analysis is drawn. The options are the ones that are
 *   TRUE of its data, never the full set: the week's shape offers no heat map
 *   because seasonality has one dimension, and figures of record offers no bars
 *   because its eight figures are in four different units. `graphNote` says why
 *   in one line, under the controls, so the missing option is legible rather
 *   than mysterious.
 *
 * Everything else on this component exists to keep the four honest states
 * intact through both switches: a register in flight is a skeleton, a refusal
 * is a sentence naming the register, an unknown is an em dash, and a true
 * answer that must be SAID rather than drawn (`view.say`) suppresses the chart
 * whatever type is selected.
 *
 * While reading, a cutting with a register also offers "full screen"
 * (`CuttingFlat.tsx`, `?flat=<id>`), drawn here over the same register.
 */

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChartArea,
  ChartColumn,
  ChartLine,
  ChartNoAxesCombined,
  ChartScatter,
  Grid3x3,
  Hash,
  Maximize2,
  Table,
} from 'lucide-react';
import {
  BigFigure,
  CatPlot,
  ComboPlot,
  DataTable,
  FigureRow,
  HeatGrid,
  Nothing,
  PointPlot,
  RegisterBody,
  Working,
} from './rp-plot';
import { CATALOGUE, graphOrDefault, type ViewCtx } from './rp-catalogue';
import { DrawKey } from './rp-draw';
import { readsRegister } from './rp-spec';
import { cannotDraw } from './rp-strip';
import { naturalPx } from './rp-fit';
import { Grip, PlacingBar } from './Placing';
import RuledOff from './RuledOff';
import CuttingFlat, { FLAT_PARAM } from './CuttingFlat';
import type { ArrangeApi } from './rp-arrange';
import type { ComboPick } from './rp-combo';
import { GRAPH_LABEL, type AnalysisId, type GraphType } from './rp-sheet';
import type { AnalysisView } from './rp-view';
import type { Register } from './useReportsNextData';

/**
 * The drawing the cutting is currently set to, as a mark rather than a word.
 * Icons come from `lucide-react`, the set this app already ships; they are ink,
 * never the seal, because a control is not a commitment (ADR 0042).
 */
const GRAPH_ICON: Record<GraphType, typeof ChartLine> = {
  line: ChartLine,
  bars: ChartColumn,
  combo: ChartNoAxesCombined,
  area: ChartArea,
  heatmap: Grid3x3,
  scatter: ChartScatter,
  table: Table,
  figure: Hash,
};

function GraphIcon({ graph }: { graph: GraphType }) {
  const Icon = GRAPH_ICON[graph];
  return <Icon size={13} strokeWidth={1.6} color="var(--ink-4)" aria-hidden />;
}

/**
 * The till windows a reader can pick, in house days. The gateway allows any
 * 1–365, but the page offers these four, so a window in the link that is not
 * one of them reads as the default rather than as a picker with no chip held.
 */
export const TILL_WINDOWS = [7, 30, 90, 365] as const;
export const DEFAULT_TILL_DAYS = 30;
/** The page link's name for the till window: `/reports?days=90`. */
export const DAYS_PARAM = 'days';

/** The till window a link names, or the default when it names none we offer. */
export function tillDaysOf(raw: string | null): number {
  const n = Number(raw);
  return (TILL_WINDOWS as readonly number[]).includes(n) ? n : DEFAULT_TILL_DAYS;
}

/**
 * What a cutting says while the window just picked is still being read and the
 * window before it stays drawn (r41 gap 4).
 */
export function standInSentence({ shownDays, readingDays }: { shownDays: number; readingDays: number }): string {
  return `Reading the last ${readingDays} days. Until they arrive, the figures shown are the last ${shownDays} days.`;
}

/** Window picker for the till — the only period control on the whole sheet. */
export function TillWindowPicker({
  days,
  onChange,
}: {
  days: number;
  onChange: (d: number) => void;
}) {
  // A year is the window an owner reads a season against (audit G19); the
  // gateway already allows 1–365 house days (`analytics.controller.ts`).
  const options = TILL_WINDOWS;
  const at = options.findIndex((d) => d === days);
  // One thumb slides under the pressed window (transform only), so the window
  // changes with a movement the reader can follow instead of a hard swap. The
  // segments are equal-width so the thumb needs no measuring.
  return (
    <div
      role="group"
      aria-label="Till window"
      className="rp-seg rp-no-drag"
      style={{ ['--rp-n' as string]: options.length, ['--rp-i' as string]: Math.max(at, 0) }}
    >
      {at >= 0 && <span className="rp-seg__thumb" aria-hidden />}
      {options.map((d) => (
        <button
          key={d}
          type="button"
          className="rp-seg__btn rp-ink rp-focus rp-no-drag"
          aria-pressed={days === d}
          onClick={() => onChange(d)}
        >
          {d} days
        </button>
      ))}
    </div>
  );
}

/** The chosen drawing, or — when the register cannot honestly be drawn that
 *  way at all — a sentence saying so rather than an empty frame. */
function Drawing({
  view,
  graph,
  windowLine,
  combo,
  flat = false,
}: {
  view: AnalysisView;
  graph: GraphType;
  windowLine: string;
  combo?: ComboControl;
  /** The full-screen view, where "Draw as" sits in the head, not on a sheet being arranged. */
  flat?: boolean;
}) {
  if (view.say)
    return (
      <>
        {view.empty && <p className="rp-empty-strip">{view.empty}</p>}
        <Nothing>{view.say}</Nothing>
      </>
    );
  if (cannotDraw(view, graph)) return <Undrawable graph={graph} why={view.undrawn} flat={flat} />;
  switch (graph) {
    case 'line':
    case 'area':
    case 'bars':
      return <CatPlot series={view.cats!} kind={graph} />;
    case 'combo':
      return <ComboPlot series={view.cats!} pick={combo?.pick} onPick={combo?.onPick} />;
    case 'scatter':
      return <PointPlot series={view.points!} />;
    case 'heatmap':
      return <HeatGrid series={view.matrix!} />;
    case 'figure':
      return <BigFigure fig={view.figures[0]} window={windowLine} />;
    case 'table':
    default:
      if (view.node) return <>{view.node}</>;
      return <DataTable table={view.table!} />;
  }
}

/** The register answered, and this particular answer has nothing of that
 *  shape in it. Said, never drawn as an empty axis. When the register knows
 *  WHY (`view.undrawn` — say, no order fell in either window), only that real
 *  reason is said: a generic line above it would only bury it (r56). */
function Undrawable({
  graph,
  why,
  flat = false,
}: {
  graph: GraphType;
  why?: ReactNode;
  flat?: boolean;
}) {
  if (why != null) return <Nothing>{why}</Nothing>;
  return (
    <Nothing>
      This register answered, and what it returned cannot be drawn as{' '}
      {GRAPH_LABEL[graph].toLowerCase()} — nothing is plotted rather than an empty frame.{' '}
      {flat ? 'Pick another drawing above.' : 'Pick another drawing while arranging the sheet.'}
    </Nothing>
  );
}

/**
 * A register that answered, rendered whole: the drawing, then its figures of
 * record, then the caveats, then the server's own working. The view is built
 * exactly once here, so the drawing and the figures below it can never come
 * from two different reads of the same payload.
 */
function Body({
  view,
  graph,
  windowLine,
  workingOpen = false,
  combo,
  flat = false,
}: {
  view: AnalysisView;
  graph: GraphType;
  windowLine: string;
  /** The full-screen view: the drawing sits in a slot whose height does not depend on what is drawn. */
  flat?: boolean;
  /** Which measure is the bars and which the line, when the drawing is `combo`. */
  combo?: ComboControl;
  /** Start with the server's working shown — the flat view has the room. */
  workingOpen?: boolean;
}) {
  // With a bespoke table (the reading's sentences, the writing desk) the
  // figures would repeat what the rows already say, so they are left off.
  const figures =
    graph === 'table' && view.node ? [] : graph === 'figure' ? view.figures.slice(1) : view.figures;
  // The reason the drawing is absent was just said in its place; say it once.
  const notes =
    view.undrawn != null && cannotDraw(view, graph)
      ? view.notes.filter((n) => n !== view.undrawn)
      : view.notes;
  return (
    <>
      {flat ? (
        <div className="rp-flat__slot" data-graph={graph}>
          <Drawing view={view} graph={graph} windowLine={windowLine} combo={combo} flat />
        </div>
      ) : (
        <Drawing view={view} graph={graph} windowLine={windowLine} combo={combo} />
      )}
      {/* On a phone the list keeps its slot across Draw as (r103): a row the drawing does not show is drawn
          hidden, so Table and One figure do not take the list out of the card and Area put it back. */}
      {(flat ? figures.length > 0 : view.figures.length > 0) && (
        <dl className="rp-dl">
          {(flat ? figures : view.figures).map((f) => (
            <FigureRow key={f.label} label={f.label} value={f.value} note={f.note} held={!figures.includes(f)} />
          ))}
        </dl>
      )}
      {notes.map((n, i) => (
        <p key={i} className="rp-cap" title={typeof n === 'string' ? n : undefined}>
          {n}
        </p>
      ))}
      <Working lines={view.basis} defaultOpen={workingOpen} />
    </>
  );
}

/** The bars-and-line choice. With no `onPick` the drawing keeps its own (the full-screen view). */
interface ComboControl {
  pick?: Partial<ComboPick>;
  onPick?: (p: ComboPick) => void;
}

/** Said on a full-screen view opened by a link, for a cutting off the reader's sheet. */
export const NOT_ON_SHEET =
  'It is not on your sheet: this view was opened by a link, and “Arrange the sheet” adds it.';

export interface CuttingProps {
  id: AnalysisId;
  graph: GraphType;
  /** Absent only for the writing desk, which has no register to read. */
  register?: Register<unknown>;
  ctx: ViewCtx;
  arranging: boolean;
  /** Every analysis, with the ones already on the sheet marked. */
  /** `held`: who a held analysis is written for, " (owners and managers)". */
  swapOptions: Array<{ id: AnalysisId; taken: boolean; held?: string }>;
  /** The keyboard/button path over the same layout state (`rp-arrange.ts`). */
  arrange: ArrangeApi;
  /** The page's memory of which measure is bars and which is the line, by cutting. */
  comboPick?: Partial<ComboPick>;
  onComboPick?: (p: ComboPick) => void;
  onGraph: (g: GraphType) => void;
  onSwap: (to: AnalysisId) => void;
  onRemove: () => void;
  onDays: (d: number) => void;
  /**
   * A visit from a full-screen link (`rp-flat-visit.ts`): the analysis is not
   * on the reader's sheet, so only its full-screen view is drawn, and the
   * view's window line says it is not on their sheet.
   */
  flatOnly?: boolean;
  /** Reports the height this card's content needs (`rp-fit.ts`), so the sheet can draw its slot to fit. */
  onFit?: (id: AnalysisId, px: number | null) => void;
  /** While arranging, the height of the controls row, so the sheet adds it to the card (r101). */
  onControls?: (id: AnalysisId, px: number | null) => void;
  /** Folded to a 72 px strip: the register's honest answer is a sentence (`rp-strip.ts`). */
  strip?: boolean;
}

export default function Cutting({
  id,
  graph,
  register,
  ctx,
  arranging,
  swapOptions,
  arrange,
  comboPick,
  onComboPick,
  onGraph,
  onSwap,
  onRemove,
  onDays,
  flatOnly = false,
  strip = false,
  onFit,
  onControls,
}: CuttingProps) {
  const spec = CATALOGUE[id];
  // While a window just picked is still being read, the figures on screen are
  // the window before it (r41 gap 4): they are drawn, and their window line
  // written, over the days they were read for, never the days just picked.
  // The hook keeps them per house (#1670); a register handed in bare (no
  // hook between) falls back to this card's own last drawing (#1976, ADR 0020).
  const lastRead = useRef<{ data: unknown; days: number } | null>(null);
  if (spec.takesWindow && register && !register.loading && !register.failure && register.data !== undefined)
    lastRead.current = { data: register.data, days: register.standIn?.shownDays ?? ctx.days };
  const ownStandIn =
    !register?.standIn &&
    spec.takesWindow &&
    register?.loading &&
    !register.failure &&
    lastRead.current &&
    lastRead.current.days !== ctx.days
      ? lastRead.current
      : null;
  const standIn =
    register?.standIn ?? (ownStandIn ? { shownDays: ownStandIn.days, readingDays: ctx.days } : null);
  const shownCtx: ViewCtx = standIn ? { ...ctx, days: standIn.shownDays } : ctx;
  const windowLine = spec.window(shownCtx);
  const standInLine = standIn ? standInSentence(standIn) : null;
  const answer = ownStandIn ? ownStandIn.data : register?.data;

  // A drawing the answer cannot carry (bars and a line without per-day checks) is not offered.
  const offered = ((): GraphType[] => {
    if (!readsRegister(spec) || answer === undefined) return spec.graphs;
    const v = spec.view(answer, shownCtx);
    if (v.say) return spec.graphs;
    return spec.graphs.filter((g) => !(g === 'combo' && cannotDraw(v, 'combo')));
  })();
  const stored = graphOrDefault(id, graph);
  const drawn: GraphType = offered.includes(stored) ? stored : (offered[0] ?? 'table');

  // One body, two places: the sheet, and the flat view (working open).
  // The flat view passes its own bars-and-line choice (view-only, kept across
  // its "Draw as" flips); the sheet passes the page's, keyed by cutting id.
  const sheetCombo: ComboControl = { pick: comboPick, onPick: onComboPick };
  // Only the till takes a window; other bodies keep their blocks as direct children.
  const framed = (kids: ReactNode) =>
    spec.takesWindow ? (
      <div className="rp-standin" data-stale={standIn ? '' : undefined} aria-busy={standIn ? true : undefined}>
        {kids}
      </div>
    ) : (
      kids
    );
  const bodyFor = (g: GraphType, workingOpen = false, combo: ComboControl = sheetCombo) => (
    <DrawKey.Provider value={`${id}:${g}`}>{bodyOf(g, workingOpen, combo)}</DrawKey.Provider>
  );
  const bodyOf = (g: GraphType, workingOpen = false, combo: ComboControl = sheetCombo) =>
    readsRegister(spec) ? (
      framed(
        <RegisterBody
          register={spec.register}
          loading={ownStandIn ? false : (register?.loading ?? true)}
          failure={register?.failure ?? null}
          data={answer}
          onRetry={() => register?.refetch()}
        >
          {(data) => (
            <Body
              view={spec.view(data, shownCtx)}
              graph={g}
              windowLine={windowLine}
              workingOpen={workingOpen}
              combo={combo}
              flat={workingOpen}
            />
          )}
        </RegisterBody>,
      )
    ) : (
      <Body
        view={spec.view(null, ctx)}
        graph={g}
        windowLine={windowLine}
        workingOpen={workingOpen}
        combo={combo}
        flat={workingOpen}
      />
    );
  const body = bodyFor(drawn);

  const held = arrange.picked === id;

  /* Laid flat: only with a register, only while reading, only for the id
     the URL names (`get` answers the first, so two params open one dialog).
     Opening pushes an entry marked with this id, so close goes back through
     history and Back, Esc and the button agree; a cold `?flat=` has no entry
     of ours, so close removes the param in place. */
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const canLayFlat = readsRegister(spec);
  const flat = canLayFlat && !arranging && params.get(FLAT_PARAM) === id;
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const flatLabel = `Show ${spec.title} full screen`;

  const openFlat = () => {
    const next = new URLSearchParams(params);
    next.set(FLAT_PARAM, id);
    setParams(next, { state: { rpFlat: id } });
  };
  const closeFlat = () => {
    const ours = (location.state as { rpFlat?: unknown } | null)?.rpFlat === id;
    if (ours) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete(FLAT_PARAM);
    setParams(next, { replace: true });
  };

  // A fitted card tells the sheet what its content needs, now and whenever a
  // block inside it changes size. Only while it is read as a table: a chart
  // stretches to whatever room it is given, so it has no natural height.
  const rootRef = useRef<HTMLElement>(null);
  const fits = onFit !== undefined && !arranging && !strip && drawn === 'table';
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!fits || !root) {
      onFit?.(id, null);
      return;
    }
    const report = () => onFit(id, naturalPx(root));
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const body = root.querySelector('.rp-cut__body');
    const ro = new ResizeObserver(report);
    if (body) Array.from(body.children).forEach((k) => ro.observe(k));
    return () => ro.disconnect();
    // `onFit` is stable (a state setter wrapper); the register's arrival is what changes the blocks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fits, id, register?.data]);

  // The arrange controls are room the card gains: tell the sheet how tall they are, now and as they rewrap.
  useEffect(() => {
    const controls = arranging ? rootRef.current?.querySelector<HTMLElement>(':scope > .rp-cut__controls') : null;
    if (!controls) {
      onControls?.(id, null);
      return;
    }
    const report = () => onControls?.(id, Math.ceil(controls.offsetHeight));
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(report);
    ro.observe(controls);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arranging, id, onControls]);

  // Focus goes back to the control that opened the view, however it closed.
  const wasFlat = useRef(flat);
  useEffect(() => {
    if (wasFlat.current && !flat) openerRef.current?.focus();
    wasFlat.current = flat;
  }, [flat]);

  const flatView = flat && (
    <CuttingFlat
      title={spec.title}
      windowLine={[windowLine, flatOnly ? NOT_ON_SHEET : null, standInLine]
        .filter(Boolean)
        .join(' ')}
      graphs={offered}
      initialGraph={drawn}
      initialComboPick={comboPick}
      renderBody={(g, combo) => bodyFor(g, true, combo)}
      windowControl={
        spec.takesWindow ? <TillWindowPicker days={ctx.days} onChange={onDays} /> : undefined
      }
      anchorRef={openerRef}
      onClose={closeFlat}
    />
  );

  // A visit: nothing on the sheet, only the view the link asked for.
  if (flatOnly) return <>{flatView}</>;

  return (
    <section
      ref={rootRef}
      className="rp-cut"
      aria-label={spec.title}
      data-held={held || undefined}
      data-strip={strip || undefined}
    >
      {strip && <RuledOff />}
      {/* Not a <header>: the section's heading is the h2 below it, and a nested
          banner landmark per cutting would drown the page's own. */}
      <div className="rp-cut__head">
        <div style={{ minWidth: 0 }}>
          <h2 className="rp-cut__title">{spec.title}</h2>
          <p className="rp-cut__window">{windowLine}</p>
          {standInLine && (
            <p className="rp-cut__window rp-cut__standin" role="status">
              {standInLine}
            </p>
          )}
        </div>
        {arranging ? (
          <div className="rp-row" style={{ gap: 6 }}>
            {/* The grip comes FIRST in the tab order, before "Take off": the
                common act while arranging is moving, and putting the
                destructive control on the way to it is how a reader loses a
                cutting they meant to nudge. */}
            <Grip id={id} title={spec.title} arrange={arrange} />
            <button type="button" className="rp-mini rp-ink rp-focus" onClick={onRemove}>
              Take off
            </button>
          </div>
        ) : spec.takesWindow || canLayFlat ? (
          <div className="rp-row" style={{ gap: 6 }}>
            {spec.takesWindow && <TillWindowPicker days={ctx.days} onChange={onDays} />}
            {canLayFlat && (
              <button
                ref={openerRef}
                type="button"
                className="rp-flat-open rp-ink rp-focus rp-no-drag"
                aria-label={flatLabel}
                title={flatLabel}
                onClick={openFlat}
              >
                <Maximize2 size={14} strokeWidth={1.6} aria-hidden />
              </button>
            )}
          </div>
        ) : null}
      </div>

      {held && <PlacingBar title={spec.title} arrange={arrange} />}

      {arranging && (
        <div className="rp-cut__controls rp-no-drag">
          <label className="rp-field">
            <span className="rp-eyebrow">Show instead</span>
            <select
              className="rp-select rp-focus"
              aria-label={`Show instead of ${spec.title}`}
              value={id}
              onChange={(e) => onSwap(e.target.value as AnalysisId)}
            >
              {swapOptions.map((o) => (
                <option key={o.id} value={o.id} disabled={o.taken && o.id !== id}>
                  {CATALOGUE[o.id].title}
                  {o.held ?? ''}
                  {o.taken && o.id !== id ? ' (already on the sheet)' : ''}
                </option>
              ))}
            </select>
          </label>
          {offered.length > 0 ? (
            <label className="rp-field">
              <span className="rp-eyebrow">
                <GraphIcon graph={drawn} /> Draw as
              </span>
              <select
                className="rp-select rp-focus"
                aria-label={`Draw ${spec.title} as`}
                value={drawn}
                onChange={(e) => onGraph(e.target.value as GraphType)}
              >
                {offered.map((g) => (
                  <option key={g} value={g}>
                    {GRAPH_LABEL[g]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="rp-cap">Not drawn — this cutting has no register behind it.</p>
          )}
          <p className="rp-cap">
            {spec.answers}. {spec.graphNote}
          </p>
        </div>
      )}

      <div className="rp-cut__body">{body}</div>

      {flatView}
    </section>
  );
}
