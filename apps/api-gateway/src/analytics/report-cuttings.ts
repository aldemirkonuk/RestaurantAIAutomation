/**
 * The closed vocabulary a model may choose from when a goal asks the book for
 * an analysis — and the validator that refuses everything else.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * The founder's ask for `/reports` was: *"the Goals section that owners/managers
 * decide … (will be using AI to create the analytics and their wanted feature if
 * not already created)"*.
 *
 * "AI creates the analytics" has two readings, and only one of them is allowed
 * here. The forbidden one is a model writing a sentence or a figure that reaches
 * a chart: the insight engine is deterministic and its sentences are templates
 * over computed arithmetic (`insights/insight-verbalizer.ts`), which is the whole
 * reason a reader can trust them, and ADR 0020 forbids a fabricated answer
 * outright. The allowed one is a model **configuring** that deterministic engine:
 * picking which of the analyses this product already computes answers a goal,
 * how it should be drawn, and over what window. Nothing the model says is
 * rendered as a measurement — its entire output is three enum values, and every
 * one of them is checked against the table below before it leaves this process.
 *
 * So this file is the seam. It is the same lesson `ux-optimizer.service.ts`
 * learned the hard way (`filterProposals`, :330-345): *"the parser used to accept
 * any string, so an invented kind was written straight into `ux_proposals.kind`
 * as though it were real."* An invented analysis id here would render as an empty
 * cutting the reader would read as "there is nothing to show".
 *
 * DRIFT
 * -----
 * The web catalogue (`apps/web/src/pages/reports/next/rp-catalogue.tsx`) is the
 * other half of this vocabulary and cannot be imported across the app boundary.
 * Two defences instead of one import:
 *   1. `report-cuttings.spec.ts` pins this table, so a silent edit here fails.
 *   2. The PAGE refuses an id it does not carry, rather than rendering a blank
 *      square — `rp-registers-goals.tsx`. A drift is therefore visible as a
 *      sentence to the reader, never as an empty chart.
 */

/** A drawing a cutting can take. Mirrors `GRAPH_TYPES` in `rp-sheet.ts`. */
export const CUTTING_GRAPHS = [
  "line",
  "bars",
  "area",
  "heatmap",
  "scatter",
  "table",
  "figure",
] as const;

export type CuttingGraph = (typeof CUTTING_GRAPHS)[number];

export interface CuttingEntry {
  /** What the analysis answers, in the reader's words — this is the prompt. */
  readonly answers: string;
  /** Drawings that are TRUE of this register's data, best first. */
  readonly graphs: readonly CuttingGraph[];
  /** The one register whose endpoint takes a day window. */
  readonly takesWindow?: boolean;
}

/**
 * Every analysis the sheet can lay down and a model may therefore propose.
 *
 * Declared as a keyed map rather than an array of `{ id, … }` objects for the
 * same reason `DEFAULT_SLOTS` is (ADR 0051 / `check_no_seeded_defaults.py` S1):
 * this describes a vocabulary, it does not assert a row about a restaurant.
 *
 * `writing` (the report desk, which has no register behind it) and `goals`
 * (the desk the reader is already standing at) are deliberately absent: neither
 * is a candidate answer to "which analysis shows me this goal".
 */
export const CUTTING_CATALOGUE: Readonly<Record<string, CuttingEntry>> =
  Object.freeze({
    reading: {
      answers: "What the engine has noticed, in its own sentences",
      graphs: ["table", "bars"],
    },
    till: {
      answers: "What guests actually paid, day by day",
      graphs: ["area", "line", "bars", "heatmap", "table", "figure"],
      takesWindow: true,
    },
    pacing: {
      answers:
        "Whether buying is running hot or cold against the month before",
      graphs: ["bars", "table", "figure"],
    },
    week: {
      answers: "Which nights carry the week",
      graphs: ["bars", "line", "area", "table"],
    },
    ahead: {
      answers:
        "What the model expects the next fortnight to take out of the cellar",
      graphs: ["line", "area", "bars", "table", "figure"],
    },
    quadrants: {
      answers:
        "Which wines earn their place: margin against how fast they move",
      graphs: ["scatter", "bars", "table"],
    },
    ledger: {
      answers: "What the cellar is worth, and how hard that capital is working",
      graphs: ["table", "figure"],
    },
    seats: {
      answers: "Which tables earn, and which seats sit idle",
      graphs: ["bars", "scatter", "table"],
    },
    service: {
      answers: "What each server's checks look like",
      graphs: ["bars", "table"],
    },
    restock: {
      answers: "What is about to run out, and how likely it is to run out first",
      graphs: ["table", "bars"],
    },
    bench: {
      answers:
        "This house against its own past: spend this month against last, each weekday against the week, each goal against its own baseline",
      graphs: ["bars", "table", "figure"],
    },
  });

/** The ids a model may name. Nothing outside this list is ever honoured. */
export const CUTTING_IDS: readonly string[] = Object.freeze(
  Object.keys(CUTTING_CATALOGUE),
);

/** The only windows the till cutting accepts, mirroring `TillWindowPicker`. */
export const CUTTING_WINDOWS: readonly number[] = Object.freeze([7, 30, 90]);

/** A spec that survived validation — three enum values and a reason. */
export interface CuttingSpec {
  analysisId: string;
  graph: CuttingGraph;
  /** Present only for the one analysis whose endpoint takes a window. */
  days: number | null;
  /**
   * The model's one sentence about WHY. It is shown to the reader as a
   * proposal, labelled as written by the assistant, and it never reaches a
   * figure, an axis or a caption on a chart — see `rp-registers-goals.tsx`.
   */
  why: string;
}

export type SpecRejection =
  | "not-an-object"
  | "unknown-analysis"
  | "graph-not-true-of-that-analysis"
  | "window-not-offered"
  | "window-on-an-analysis-that-takes-none"
  | "no-reason-given";

export type SpecCheck =
  | { ok: true; spec: CuttingSpec }
  | { ok: false; reason: SpecRejection; detail: string };

/**
 * Validate one proposed spec against the catalogue.
 *
 * Deliberately strict rather than forgiving: a graph type that is not true of
 * an analysis is REFUSED, not silently swapped for that analysis's default.
 * Swapping would hand the reader a chart the assistant did not propose while
 * telling them the assistant proposed it — a small lie that is much harder to
 * notice than a refusal.
 */
export function checkCuttingSpec(raw: unknown): SpecCheck {
  if (!raw || typeof raw !== "object")
    return {
      ok: false,
      reason: "not-an-object",
      detail: "the model returned no object",
    };
  const p = raw as Record<string, unknown>;

  const analysisId = typeof p.analysisId === "string" ? p.analysisId : "";
  const entry = Object.prototype.hasOwnProperty.call(
    CUTTING_CATALOGUE,
    analysisId,
  )
    ? CUTTING_CATALOGUE[analysisId]
    : undefined;
  if (!entry)
    return {
      ok: false,
      reason: "unknown-analysis",
      detail: `'${analysisId}' is not an analysis this sheet carries`,
    };

  const graph = typeof p.graph === "string" ? (p.graph as CuttingGraph) : null;
  if (!graph || !entry.graphs.includes(graph))
    return {
      ok: false,
      reason: "graph-not-true-of-that-analysis",
      detail: `'${String(p.graph)}' is not a drawing that is true of '${analysisId}' (offered: ${entry.graphs.join(", ")})`,
    };

  const rawDays = p.days;
  let days: number | null = null;
  if (rawDays !== null && rawDays !== undefined && rawDays !== "") {
    const n = Number(rawDays);
    if (!entry.takesWindow)
      return {
        ok: false,
        reason: "window-on-an-analysis-that-takes-none",
        detail: `'${analysisId}' is computed over a window the server fixes; it takes no 'days'`,
      };
    if (!CUTTING_WINDOWS.includes(n))
      return {
        ok: false,
        reason: "window-not-offered",
        detail: `'${String(rawDays)}' is not one of the windows this page offers (${CUTTING_WINDOWS.join(", ")})`,
      };
    days = n;
  }

  const why = typeof p.why === "string" ? p.why.trim() : "";
  if (!why)
    return {
      ok: false,
      reason: "no-reason-given",
      detail: "the model proposed a cutting without saying why",
    };

  return {
    ok: true,
    // 400 characters is a sentence or two. The cap is a containment measure,
    // not a style rule: this string is the only free text in the payload.
    spec: { analysisId, graph, days, why: why.slice(0, 400) },
  };
}

/**
 * The catalogue as the model sees it — the only knowledge of this product it is
 * given, so it cannot propose from a memory of some other dashboard.
 */
export function catalogueForPrompt(): string {
  return CUTTING_IDS.map((id) => {
    const e = CUTTING_CATALOGUE[id];
    return `- ${id}: ${e.answers}. Drawings: ${e.graphs.join(" | ")}.${
      e.takesWindow ? ` Takes days: ${CUTTING_WINDOWS.join(" | ")}.` : ""
    }`;
  }).join("\n");
}
