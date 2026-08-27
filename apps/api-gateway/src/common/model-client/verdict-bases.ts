/**
 * Every doneability basis string the gateway writes, in one place (OD-59, P3.0).
 *
 * A basis names THE GRADER inside the verdict row. That is the whole mechanism
 * that stops a narrow check from quietly becoming the definition of "done":
 * `reconciliation_v1` says "the arithmetic balanced", `schema_v1` says "the
 * output was the right shape", and a reader can tell which claim they are
 * looking at without archaeology.
 *
 * They live together because the failure they guard against is a TYPO. A basis
 * misspelled at one call site does not break anything — it writes a row nobody
 * queries, and coverage silently reads as a gap forever. Constants make that a
 * compile error instead.
 *
 * ## The rule when adding one
 *
 * A new grader takes a NEW basis and lands BESIDE the old rows; it never
 * reuses an existing string to mean something stricter, and it never edits
 * rows written under the old one. `(event_id, basis)` is the verdict table's
 * key precisely so a re-grade is additive.
 *
 * Two graders MAY share a basis when they run over different `task_type`s and
 * make the same kind of claim — `(task_type, basis)` identifies the grader.
 * Two graders of the SAME task type may not; that is what the `_v1` suffix is
 * for.
 */

/** Arithmetic consistency: extracted lines and charges reconcile to the stated total. */
export const RECONCILIATION_BASIS = "reconciliation_v1";

/**
 * The response parsed into the shape the caller requires.
 *
 * Deliberately weak, and named so. It proves the model produced a usable
 * artifact — nothing about whether the artifact is RIGHT. Its whole value is
 * being strictly stronger than `call_level_v0`, which only proves the HTTP
 * request returned 200.
 */
export const PARSE_BASIS = "parse_v1";

/**
 * Parsed AND yielded a plausible number of valid rows.
 *
 * For extractions where "parsed fine, produced nothing" is a real and common
 * failure that a parse check alone reads as success.
 */
export const PARSE_YIELD_BASIS = "parse_yield_v1";

/**
 * The output satisfied a declared schema — enumerated fields, required keys,
 * a stated count range.
 *
 * Used where correctness genuinely needs a human rubric and shape is the only
 * honest machine claim available. Recording it as `schema_v1` rather than
 * leaving the row at call level is the point: it says out loud that the
 * instrument checked the form and not the substance.
 */
export const SCHEMA_BASIS = "schema_v1";

/**
 * Shape, plus the model's own declared references resolving against evidence
 * that was actually supplied.
 *
 * Stronger than `schema_v1` because a claim citing evidence nobody gave it is
 * machine-detectably wrong — a grounding check, still not a correctness one.
 */
export const GROUNDING_BASIS = "grounding_v1";

/**
 * A human's committed number, compared against what the model suggested.
 *
 * The only basis in the gateway that grades against ground truth from the
 * world rather than against the model's own output. Necessarily deferred: the
 * verdict is knowable only once a person acts.
 */
export const HUMAN_COUNT_BASIS = "human_count_v1";

/**
 * The model proposed a VALID, allowlisted action from ids it was actually given.
 *
 * Ask AI's grader (P3.C). Two things have to hold, and the second is the one
 * that matters: the proposal validated against the action contract, AND every
 * id in it came from the candidate set the prompt supplied. A uuid the model
 * invented is well-formed and points at nothing — or worse, at another
 * restaurant's row.
 *
 * Still not correctness: it does not prove the operator meant this action. That
 * is what the confirm gate is for, and `confirmation_v1` — whether a human
 * accepted the proposal — is the honest deferred verdict on this task type.
 */
export const PROPOSAL_BASIS = "proposal_v1";

/**
 * A human accepted the proposal and it executed.
 *
 * Deferred: knowable only when someone acts. This is the real measure of
 * whether Ask AI is useful — a proposal stream nobody confirms is a feature
 * that is running, not working.
 */
export const CONFIRMATION_BASIS = "confirmation_v1";
