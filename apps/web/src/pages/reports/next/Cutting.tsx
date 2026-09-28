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
 */

import { useMemo } from 'react';
import {
  ChartArea,
  ChartColumn,
  ChartLine,
  ChartScatter,
  Grid3x3,
  Hash,
  Table,
} from 'lucide-react';
import {
  BigFigure,
  CatPlot,
  DataTable,
  FigureRow,
  HeatGrid,
  Nothing,
  PointPlot,
  RegisterBody,
  Working,
} from './rp-plot';
import { CATALOGUE, graphOrDefault, type ViewCtx } from './rp-catalogue';
import { Grip, PlacingBar } from './Placing';
import type { ArrangeApi } from './rp-arrange';
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
  area: ChartArea,
  heatmap: Grid3x3,
  scatter: ChartScatter,
  table: Table,
  figure: Hash,
};

function GraphIcon({ graph }: { graph: GraphType }) {
  const Icon = GRAPH_ICON[graph];
  return <Icon size={13} strokeWidth={1.6} color="var(--ink-3)" aria-hidden />;
}

/** Window picker for the till — the only period control on the whole sheet. */
export function TillWindowPicker({
  days,
  onChange,
}: {
  days: number;
  onChange: (d: number) => void;
}) {
  const options = useMemo(() => [7, 30, 90], []);
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
          {d}d
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
}: {
  view: AnalysisView;
  graph: GraphType;
  windowLine: string;
}) {
  if (view.say) return <Nothing>{view.say}</Nothing>;
  switch (graph) {
    case 'line':
    case 'area':
    case 'bars':
      return view.cats ? <CatPlot series={view.cats} kind={graph} /> : <Undrawable graph={graph} />;
    case 'scatter':
      return view.points ? <PointPlot series={view.points} /> : <Undrawable graph={graph} />;
    case 'heatmap':
      return view.matrix ? <HeatGrid series={view.matrix} /> : <Undrawable graph={graph} />;
    case 'figure':
      return view.figures.length > 0 ? (
        <BigFigure fig={view.figures[0]} window={windowLine} />
      ) : (
        <Undrawable graph={graph} />
      );
    case 'table':
    default:
      if (view.node) return <>{view.node}</>;
      return view.table ? <DataTable table={view.table} /> : <Undrawable graph={graph} />;
  }
}

/** The register answered, and this particular answer has nothing of that
 *  shape in it. Said, never drawn as an empty axis. */
function Undrawable({ graph }: { graph: GraphType }) {
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
}: {
  view: AnalysisView;
  graph: GraphType;
  windowLine: string;
}) {
  // With a bespoke table (the reading's sentences, the writing desk) the
  // figures would repeat what the rows already say, so they are left off.
  const figures =
    graph === 'table' && view.node ? [] : graph === 'figure' ? view.figures.slice(1) : view.figures;
  return (
    <>
      <Drawing view={view} graph={graph} windowLine={windowLine} />
      {figures.length > 0 && (
        <dl className="rp-dl">
          {figures.map((f) => (
            <FigureRow key={f.label} label={f.label} value={f.value} note={f.note} />
          ))}
        </dl>
      )}
      {view.notes.map((n, i) => (
        <p key={i} className="rp-cap">
          {n}
        </p>
      ))}
      <Working lines={view.basis} />
    </>
  );
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
  onGraph,
  onSwap,
  onRemove,
  onDays,
}: CuttingProps) {
  const spec = CATALOGUE[id];
  const drawn = graphOrDefault(id, graph);
  const windowLine = spec.window(ctx);

  const body = spec.path ? (
    <RegisterBody
      register={spec.register}
      loading={register?.loading ?? true}
      failure={register?.failure ?? null}
      data={register?.data}
      onRetry={() => register?.refetch()}
    >
      {(data) => <Body view={spec.view(data, ctx)} graph={drawn} windowLine={windowLine} />}
    </RegisterBody>
  ) : (
    <Body view={spec.view(null, ctx)} graph={drawn} windowLine={windowLine} />
  );

  const held = arrange.picked === id;

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
        ) : spec.takesWindow ? (
          <TillWindowPicker days={ctx.days} onChange={onDays} />
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
    </section>
  );
}
