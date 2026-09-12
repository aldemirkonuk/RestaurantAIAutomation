# 0017 — Doneability verdicts are sidecar claims, never edits to the event

- **Status:** Locked
- **Date:** 2026-08-25
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** doneability, nf_verdict, outcome_basis, reconciliation_v1, OD-59, verdict coverage, neural footprint
- **Links:** [[0008-nf-column-contract]], [[0006-neural-footprint-architecture]], [[0016-ledgers-must-express-unknown]], OD-59, `supabase/migrations/20260825180000_nf_verdict.sql`, `.planning/04-specs/OD-59-VERDICT-CENSUS.md`, `.planning/04-specs/OD-59-READOUT-AUDIT.md`, `.planning/04-specs/OD-59-PYTHON-AUDIT.md`

## Context

`neural_footprint_event.outcome` is written on `context.outcome_basis =
'call_level_v0'` (`apps/api-gateway/src/common/model-client/model-client.service.ts:347`),
which asserts exactly one thing: the HTTP call returned 200 and was not
truncated. Seven of fifteen `nf_a.*` keys need a stronger claim — that the agent
did the **job** — and `cost_per_completed_task`, P1's headline, is one of them.

Three facts found while scoping this, each of which changed the shape of the work:

1. **The grader already exists.** `applyTieOut`
   (`apps/api-gateway/src/procurement/documents/parsed-document.ts:104`) has been
   computing a machine-checkable reconciliation on every extracted document
   since before P1 — line items plus charges against the stated total, tolerance
   one cent per line. OD-59 was scoped as "define and build a verdict"; the
   verdict was already running and simply never reached the footprint.
2. **The verdict is not knowable when the row is written.** Emission is
   deliberately fire-and-forget (`model-client.service.ts:285`) so the instrument
   never adds latency to the thing it measures. The tie-out is only computed
   after the response is parsed, which is strictly downstream. Any design that
   writes the verdict into the same row at insert time is impossible without
   making emission blocking.
3. **`nf_a_cost_per_completed_task` has no outcome predicate at all**
   (`supabase/migrations/20260824153600_nf_a_readout.sql:103-108`): `tasks` is a
   bare `count(*)`. Despite its name it reports cost per model **call**, failures
   included. It faithfully reproduces `P1-NF-A-INSTRUMENTATION.md` §2 — the
   defect is in the spec, not the transcription.

## Options considered

1. **Overwrite `outcome` in place, swap the basis string.** Simplest read: no
   join, and `cost_per_completed_task` needs no change. Costs: it destroys the
   call-level reading the moment a better one exists, and neither runtime has an
   update path for an NF row anywhere today (verified across both trees) — so it
   is also the largest new mechanism.
2. **Add `task_outcome` / `task_outcome_basis` columns to the event.** One row,
   both readings, no join. Costs: supports exactly **one** re-grade ever, which
   collides directly with the re-grade OD-59 already promises the `backtests`
   team. The second grader would have to overwrite the first.
3. **A sidecar `nf_verdict` table, one row per (event, basis).** Chosen.
4. *(Do nothing.)* Costs: `cost_per_api_call` stays readable while
   `cost_per_completed_task` stays unreadable, and those two move in **opposite
   directions** when a cheaper model retries more. Routing decisions would keep
   being made on the number that is visible and wrong.

## Decision

**A verdict is a second, later claim about an existing event — never an edit to
it.** Verdicts live in `public.nf_verdict`, keyed `(event_id, basis)`, and the
first task type graded is `document_extraction` where the model classified the
document as an invoice, on `basis = 'reconciliation_v1'`.

The reasoning that carried it: the sidecar is the only shape in which a **second
grader can disagree with the first without destroying it**. That is not a
hypothetical — OD-59's own ownership line already assigns a stricter re-grade to
`backtests`, and options 1 and 2 both make that re-grade an act of deletion.

Three supporting rules, each enforced in the schema rather than by convention:

- **The basis is named in every row.** `reconciliation_v1` proves *arithmetic
  consistency, not correctness*: an extraction can tie out to the cent and still
  carry the wrong vendor, date, or SKU. Naming the grader is what stops a narrow
  verdict from silently becoming the definition of "done", exactly as
  `call_level_v0` does for the call-level reading. The readout **groups** by
  basis and never filters on it, so two graders cannot average into one figure.
- **`outcome NULL` means the grader ran and could not judge** — an invoice with
  no stated total is untestable, not failed. This is distinct from *no row*,
  which means never graded. Collapsing the two makes coverage unreadable.
  Consistent with [[0016-ledgers-must-express-unknown]] and ADR 0008's rule that
  NULL is UNKNOWN, never success.
- **Coverage ships in the same migration as the verdict.** Grading only invoices
  means the ungraded remainder is invisible in the verified figures; a slice can
  post a 100% success rate on 4% coverage and read as solved.
  `nf_a_verdict_coverage` is that guard, and it is also
  `nf_a.doneability_verdict_coverage`, one of the seven blocked keys.

`cost_per_verified_success` divides the cost of the **whole slice** — failures
and untestables included — by the number that succeeded. You pay for the
failures, so they belong in the numerator. Averaging the cost of successful rows
instead would reproduce the exact illusion the metric exists to break.

## Consequences

**Easier.** `cost_per_completed_task` becomes readable for one real slice while
every other slice honestly reports ungraded. A stricter grader lands as a new
basis with no migration and no data loss. The census
(`.planning/04-specs/OD-59-VERDICT-CENSUS.md`) shows six further task types whose
ground truth already exists in code and now need only a basis string.

**Harder / given up.** Readers must join, or use the new views. Two views now
carry similar names with genuinely different meanings —
`nf_a_cost_per_completed_task` (cost per **call**, unfiltered) and
`nf_a_cost_per_verified_task` (cost per **graded** task). The old view is left
untouched rather than silently redefined underneath `scripts/nf_readout.py`,
which unpacks its columns positionally; renaming it is a separate decision.

**Known limits, stated rather than buried.**
- Grading invoices only means failures that never classify as invoices (a model
  returning prose sets `docType: unknown`) are excluded from the denominator,
  which biases the success rate upward. `nf_a_verdict_coverage` makes the bias
  visible; it does not remove it.
- The Python runtime **cannot participate yet**: `insert_event` discards the
  insert result and returns `bool` (`services/agent-orchestrator/services/neural_footprint.py:124`),
  so there is no row id to attach a verdict to. Filed as OD-74 (renumbered from
OD-72 during rebase — a concurrent session landed its own OD-72/OD-73 on main
first, which is the collision `scripts/check_decision_claims.sh` exists to catch).

**Revisit when:** verdict coverage for `document_extraction` exceeds ~30 graded
events and the verified success rate diverges from the call-level success rate
by more than a few points — that gap is the measurement this ADR exists to
produce, and its size determines whether `call_level_v0` was merely incomplete
or actively misleading.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | Aldemir | Chose sidecar table over in-place overwrite and over added columns; chose invoices-only as the opening slice |
| 2026-08-25 | Readout audit | Found `nf_a_cost_per_completed_task` has no outcome predicate; new view added rather than amending it |
| 2026-08-25 | Security review | `nf_verdict` shipped with RLS + revoke in its creating migration, not a follow-up |
