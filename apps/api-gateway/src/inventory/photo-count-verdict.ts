import { NfVerdict } from "../common/model-client/nf-verdict.service";

export {
  PARSE_BASIS,
  HUMAN_COUNT_BASIS,
} from "../common/model-client/verdict-bases";

/**
 * Two verdicts, minutes apart, on the same photo-count call (OD-59, P3.0).
 *
 * `parse_v1` lands immediately and says only whether a number came back.
 * `human_count_v1` lands when a person commits a real count for the same item
 * and is the only verdict in the gateway graded against ground truth from the
 * world rather than against the model's own output.
 */

/**
 * Suggestion-time verdict.
 *
 * ## Where this departs from the census, and why
 *
 * The census proposed *"`failure` when `suggestedQty === null`, else
 * `outcome: NULL`"*. The first half is wrong and the reason matters: the prompt
 * TELLS the model to answer null —
 *
 *     "Set suggestedQty to null and confidence to low if the photo does not
 *      clearly show countable bottles ... Never guess wildly — a null with a
 *      clear note is better than a confident wrong number."
 *
 * Grading obedience as failure creates pressure toward exactly the confident
 * wrong number the prompt forbids, and a metric that punishes the safe answer
 * will get the unsafe one. So a parsed declination is **`null` — the grader ran
 * and the case is untestable**, which is a real reading and distinct from
 * having no row.
 *
 * The second half is also too weak: when the model DOES return a number, the
 * parse plainly succeeded. Leaving that at `null` would make `parse_v1`
 * unable to report success at all, which is its own kind of blind instrument.
 *
 * A response nothing could parse is the only `failure` here.
 */
export function photoCountParseVerdict(input: {
  parsed: boolean;
  suggestedQty: number | null;
  confidence: string;
}): NfVerdict {
  const evidence: Record<string, unknown> = {
    parsed: input.parsed,
    suggested_qty: input.suggestedQty,
    confidence: input.confidence,
  };

  if (!input.parsed) return { outcome: "failure", evidence };

  if (input.suggestedQty === null) {
    return {
      outcome: null,
      evidence: { ...evidence, untestable: "model_declined_to_count" },
    };
  }

  return { outcome: "success", evidence };
}

/**
 * How far off a suggestion may be and still count as close.
 *
 * **This threshold is a judgement, not a measurement, and is labelled as one.**
 * There is no corpus of photo-count outcomes to fit it to yet — this table is
 * what will produce one. `max(1, 5%)` encodes two things worth keeping until
 * evidence replaces them: a single occluded bottle is the common near-miss and
 * should not read as a failure, and on a sixty-bottle bin an absolute
 * off-by-one is a stricter bar than an off-by-one on a shelf of four.
 *
 * Revisit with data, under a NEW basis (`human_count_v2`), never by editing
 * this number underneath the rows already graded with it.
 */
export function countTolerance(countedQty: number): number {
  return Math.max(1, Math.round(Math.abs(countedQty) * 0.05));
}

/**
 * Re-grade a suggestion against the count a human actually committed.
 *
 * Exact is `success`; within tolerance is `partial`; beyond it is `failure`.
 * A suggestion the model declined to make grades `null` — there is nothing to
 * be right or wrong about, and calling a declination a failure here would
 * double-punish the behaviour the prompt asked for.
 */
export function humanCountVerdict(input: {
  suggestedQty: number | null;
  countedQty: number;
  confidence: string | null;
}): NfVerdict {
  const tolerance = countTolerance(input.countedQty);
  const evidence: Record<string, unknown> = {
    suggested_qty: input.suggestedQty,
    counted_qty: input.countedQty,
    confidence: input.confidence,
    tolerance,
  };

  if (input.suggestedQty === null) {
    return {
      outcome: null,
      evidence: { ...evidence, untestable: "model_declined_to_count" },
    };
  }

  const delta = Math.abs(input.suggestedQty - input.countedQty);
  const graded = { ...evidence, delta };

  if (delta === 0) return { outcome: "success", evidence: graded };
  if (delta <= tolerance) return { outcome: "partial", evidence: graded };
  return { outcome: "failure", evidence: graded };
}
