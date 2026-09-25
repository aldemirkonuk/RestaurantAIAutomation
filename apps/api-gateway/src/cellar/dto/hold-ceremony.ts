/**
 * The two order-hold ceremonies (ADR 0160 sec110 item 6), shared between the
 * DTO's validator and the service so the vocabulary lives in exactly one
 * place.
 *
 * FIXED 2026-09-19 (cellar re-verification, blocking). This used to be three
 * values — `["hold", "confirm", "auto"]` — built from the founder's
 * PRE-correction dictation ("straight through on a hold, a confirm step
 * ('are you sure'), or auto-approve"). ADR 0160 sec110 item 6 itself marks
 * that line wrong ("correction 9: the original line gave three modes ... his
 * words give two") and, once the open question on what "auto" means was
 * answered, settles the two real modes: the hold is the one deliberate act in
 * BOTH of them, and they differ only in what happens right after it —
 *
 *   hold — DEFAULT. The press-and-hold gesture, then one more question
 *          ("are you sure?") before the write fires.
 *   auto — the SAME press-and-hold gesture, but the write fires the moment
 *          the hold completes — no follow-up question.
 *
 * There is no ceremony that skips the hold itself: a plain click with no
 * physical gesture at all — what the old `confirm` and `auto` shapes both
 * did — is exactly the design the founder's correction rules out ("an order
 * with no human hold at all, which would bypass ADR 0112's seal on a money
 * act"). See `OrderCeremony.tsx` for the two shapes this renders as.
 */
export const HOLD_CEREMONIES = ["hold", "auto"] as const;
export type HoldCeremony = (typeof HOLD_CEREMONIES)[number];

export function isHoldCeremony(value: unknown): value is HoldCeremony {
  return (
    typeof value === "string" &&
    (HOLD_CEREMONIES as readonly string[]).includes(value)
  );
}

/**
 * The measure ids "In the building tonight" can draw — the gateway's own
 * vocabulary for `gazetteer_measures` (ADR 0160 sec110 item 2). The first four
 * are the page's long-standing default (`Registers.tsx`); the last two are
 * the "one or two more" the founder asked for, both computed from data the
 * page already reads for every house (no new endpoint, nothing invented):
 *
 *   parUnset   — cellar rows with no `threshold_min` recorded at all. A
 *                different fact from `par` (at-or-under the par they DO
 *                record): this one is coverage, not stock health.
 *   registers  — how many of the seven registers this house carries, off the
 *                same readout the register cards already render from.
 */
export const GAZETTEER_MEASURE_IDS = [
  "bottles",
  "titles",
  "par",
  "offbook",
  "parUnset",
  "registers",
] as const;
export type GazetteerMeasureId = (typeof GAZETTEER_MEASURE_IDS)[number];

export const DEFAULT_GAZETTEER_MEASURES: GazetteerMeasureId[] = [
  "bottles",
  "titles",
  "par",
  "offbook",
];
