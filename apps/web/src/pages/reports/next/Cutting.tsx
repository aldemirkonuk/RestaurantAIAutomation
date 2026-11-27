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

import { useEffect, useRef, type ReactNode } from 'react';
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
import { readsRegister } from './rp-spec';
import { Grip, PlacingBar } from './Placing';
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
  return (
    <div role="group" aria-label="Till window" style={{ display: 'flex', gap: 3 }}>
      {options.map((d) => (
        <button
          key={d}
          type="button"
          className="rp-chip rp-ink rp-focus rp-no-drag"
          aria-pressed={days === d}
          onClick={() => onChange(d)}
        >
          {d} days
        </button>
      ))}
    </div>
  );
}

/**
 * True when the reader's drawing needs a shape this view does not carry, so
 * `Drawing` says why instead of plotting. One test, read by `Drawing` (what to
 * show) and `Body` (whether the view's own reason was already said above).
 */
function cannotDraw(view: AnalysisView, graph: GraphType): boolean {
  if (view.say) return false;
  switch (graph) {
    case 'line':
    case 'area':
    case 'bars':
      return !view.cats;
    case 'combo':
      return !view.cats?.measures?.length;
    case 'scatter':
      return !view.points;
    case 'heatmap':
      return !view.matrix;
    case 'figure':
      return view.figures.length === 0;
    case 'table':
    default:
      return !view.node && !view.table;
  }
}

/** The chosen drawing, or — when the register cannot honestly be drawn that
 *  way at all — a sentence saying so rather than an empty frame. */
function Drawing({
  view,
  graph,
  windowLine,
  combo,
}: {
  view: AnalysisView;
  graph: GraphType;
  windowLine: string;
  combo?: ComboControl;
}) {
  if (view.say) return <Nothing>{view.say}</Nothing>;
  if (cannotDraw(view, graph)) return <Undrawable graph={graph} why={view.undrawn} />;
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
function Undrawable({ graph, why }: { graph: GraphType; why?: ReactNode }) {
  if (why != null) return <Nothing>{why}</Nothing>;
  return (
    <Nothing>
      This register answered, and what it returned cannot be drawn as{' '}
      {GRAPH_LABEL[graph].toLowerCase()} — nothing is plotted rather than an empty frame. Pick
      another drawing while arranging the sheet.
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
}: {
  view: AnalysisView;
  graph: GraphType;
  windowLine: string;
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
      <Drawing view={view} graph={graph} windowLine={windowLine} combo={combo} />
      {figures.length > 0 && (
        <dl className="rp-dl">
          {figures.map((f) => (
            <FigureRow key={f.label} label={f.label} value={f.value} note={f.note} />
          ))}
        </dl>
      )}
      {notes.map((n, i) => (
        <p key={i} className="rp-cap">
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

export interface CuttingProps {
  id: AnalysisId;
  graph: GraphType;
  /** Absent only for the writing desk, which has no register to read. */
  register?: Register<unknown>;
  ctx: ViewCtx;
  arranging: boolean;
  /** Every analysis, with the ones already on the sheet marked. */
  swapOptions: Array<{ id: AnalysisId; taken: boolean }>;
  /** The keyboard/button path over the same layout state (`rp-arrange.ts`). */
  arrange: ArrangeApi;
  /** The page's memory of which measure is bars and which is the line, by cutting. */
  comboPick?: Partial<ComboPick>;
  onComboPick?: (p: ComboPick) => void;
  onGraph: (g: GraphType) => void;
  onSwap: (to: AnalysisId) => void;
  onRemove: () => void;
  onDays: (d: number) => void;
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
}: CuttingProps) {
  const spec = CATALOGUE[id];
  const drawn = graphOrDefault(id, graph);
  const windowLine = spec.window(ctx);

  // One body, two places: the sheet, and the flat view (working open).
  // The flat view passes its own bars-and-line choice (view-only, kept across
  // its "Draw as" flips); the sheet passes the page's, keyed by cutting id.
  const sheetCombo: ComboControl = { pick: comboPick, onPick: onComboPick };
  const bodyFor = (g: GraphType, workingOpen = false, combo: ComboControl = sheetCombo) =>
    readsRegister(spec) ? (
      <RegisterBody
        register={spec.register}
        loading={register?.loading ?? true}
        failure={register?.failure ?? null}
        data={register?.data}
        onRetry={() => register?.refetch()}
      >
        {(data) => (
          <Body
            view={spec.view(data, ctx)}
            graph={g}
            windowLine={windowLine}
            workingOpen={workingOpen}
            combo={combo}
          />
        )}
      </RegisterBody>
    ) : (
      <Body
        view={spec.view(null, ctx)}
        graph={g}
        windowLine={windowLine}
        workingOpen={workingOpen}
        combo={combo}
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

  // Focus goes back to the control that opened the view, however it closed.
  const wasFlat = useRef(flat);
  useEffect(() => {
    if (wasFlat.current && !flat) openerRef.current?.focus();
    wasFlat.current = flat;
  }, [flat]);

  return (
    <section className="rp-cut" aria-label={spec.title} data-held={held || undefined}>
      {/* Not a <header>: the section's heading is the h2 below it, and a nested
          banner landmark per cutting would drown the page's own. */}
      <div className="rp-cut__head">
        <div style={{ minWidth: 0 }}>
          <h2 className="rp-cut__title">{spec.title}</h2>
          <p className="rp-cut__window">{windowLine}</p>
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
                  {o.taken && o.id !== id ? ' (already on the sheet)' : ''}
                </option>
              ))}
            </select>
          </label>
          {spec.graphs.length > 0 ? (
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
                {spec.graphs.map((g) => (
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

      {flat && (
        <CuttingFlat
          title={spec.title}
          windowLine={windowLine}
          graphs={spec.graphs}
          initialGraph={drawn}
          initialComboPick={comboPick}
          renderBody={(g, combo) => bodyFor(g, true, combo)}
          windowControl={
            spec.takesWindow ? <TillWindowPicker days={ctx.days} onChange={onDays} /> : undefined
          }
          anchorRef={openerRef}
          onClose={closeFlat}
        />
      )}
    </section>
  );
}
