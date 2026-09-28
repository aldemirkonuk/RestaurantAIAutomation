import { NfVerdict } from "../common/model-client/nf-verdict.service";
import type { SpecRejection } from "./report-cuttings";

export { SCHEMA_BASIS } from "../common/model-client/verdict-bases";

/**
 * Did the assistant configure the sheet within the vocabulary it was given?
 *
 * WHY THIS EXISTS
 * ---------------
 * `goal_cutting_spec` emitted a `neural_footprint_event` row carrying
 * `call_level_v0` and nothing else, which asserts only *"the HTTP request
 * returned 200 and was not truncated"*. ADR 0029's P3.0 exit criterion is that
 * every emitting task type carries a basis better than that, or is named in
 * `check_task_types_are_graded.py`'s EXEMPT list with the reason it cannot be.
 * This one has a natural outcome and therefore no claim on an exemption: the
 * call's whole product is three enum values and a sentence, and
 * `checkCuttingSpec` (`report-cuttings.ts`) already decides, deterministically,
 * whether they were inside the catalogue.
 *
 * WHY `schema_v1` AND NOT A NEW BASIS
 * -----------------------------------
 * `verdict-bases.ts` describes `schema_v1` as *"the output satisfied a declared
 * schema — enumerated fields, required keys, a stated count range"*, and says
 * two graders MAY share a basis when they run over different `task_type`s and
 * make the same kind of claim, because `(task_type, basis)` identifies the
 * grader. That is exactly this check: an analysis id from a closed list, a
 * drawing from that analysis's own list, a window from the three the page
 * offers or none at all, and a non-empty reason. Minting a fourth near-synonym
 * would make coverage harder to read, not more precise.
 *
 * It is deliberately NOT a correctness claim, and the basis name says so. That
 * the assistant named a real analysis does not mean it named the RIGHT one for
 * the goal; the only judge of that is the owner, who sees the proposal
 * labelled as a proposal and presses "Put it on the sheet" or does not
 * (`rp-registers-goals.tsx`). A `placed_v1` deferred verdict on that press is
 * the honest correctness grader, and it is filed rather than faked.
 *
 * THE THREE READINGS
 * ------------------
 *   accepted          success — the spec survived `checkCuttingSpec`.
 *   refused_by_check  failure — the model named something the sheet does not
 *                     carry. This is the real failure mode, and it is the one
 *                     the whole seam exists to catch: an invented analysis id
 *                     would render as a blank square the reader reads as
 *                     "there is nothing to show".
 *   degraded          outcome NULL — the grader ran and the case is untestable.
 *
 * WHY `degraded` IS NULL AND NOT `failure`
 * ----------------------------------------
 * The same argument `photo-count-verdict.ts` makes for a declined count. When
 * the book could not be reached, or its answer was not readable as JSON at all,
 * the model never answered the question this grader asks, so there is nothing
 * to grade. Recording it as `failure` would let a flaky network — or an
 * unconfigured key — move a score that is supposed to say how well the model
 * configures the sheet. `NfVerdictService` documents `outcome: null` as a real
 * answer meaning exactly this: the grader ran and found the case untestable,
 * which stays distinguishable from never having graded it (no row at all).
 *
 * A provider that is not configured at all produces NO verdict, because it
 * produces no event: `proposeCuttingSpec` returns before the model client is
 * called, so there is no row to grade and an orphan verdict would inflate
 * coverage with rows that grade nothing.
 */
export type CuttingSpecReading =
  | { status: "accepted"; analysisId: string; graph: string; days: number | null }
  | { status: "refused_by_check"; reason: SpecRejection; detail: string }
  | { status: "degraded"; why: "model_unreachable" | "answer_not_json"; detail: string };

export function cuttingSpecVerdict(input: {
  reading: CuttingSpecReading;
  /** The model the routing chose, and which rule chose it (ADR 0120). */
  model: string;
  taskClass: string;
  routedBy: string;
}): NfVerdict {
  const base = {
    model: input.model,
    task_class: input.taskClass,
    model_routed_by: input.routedBy,
    status: input.reading.status,
  };

  if (input.reading.status === "accepted") {
    return {
      outcome: "success",
      evidence: {
        ...base,
        analysis_id: input.reading.analysisId,
        graph: input.reading.graph,
        days: input.reading.days,
      },
    };
  }

  if (input.reading.status === "refused_by_check") {
    return {
      outcome: "failure",
      evidence: {
        ...base,
        rejection: input.reading.reason,
        detail: input.reading.detail.slice(0, 300),
      },
    };
  }

  return {
    outcome: null,
    evidence: {
      ...base,
      untestable: input.reading.why,
      detail: input.reading.detail.slice(0, 300),
    },
  };
}
