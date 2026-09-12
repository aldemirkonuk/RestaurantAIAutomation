---
type: adr
id: 0016
title: A cost ledger must be able to say "unknown", and a rate must carry its date
status: locked
updated: 2026-08-25
links: [[0010-gemini-model-retirement]], [[0008-nf-column-contract]]
---

# 0016 — Ledgers express "unknown"; rates carry a dated source

- **Status:** Locked
- **Date:** 2026-08-25
- **Decider:** Aldemir (founder)
- **Keywords:** api_spend, cost_usd, nullable, unpriced_model, spend_logger, rate table, verification date, calendar_agent, regex fallback, OD-61, OD-62, OD-63
- **Links:** [ADR 0010](0010-gemini-model-retirement.md) · [ADR 0008](0008-nf-column-contract.md) · `OPEN-DECISIONS.md` OD-61/62/63

## Context

Three open items, filed separately, turned out to be one theme: **a measurement
system that cannot distinguish "zero" from "we don't know" will quietly report
the wrong number, and nothing in it will complain.**

- **OD-61** — `api_spend.cost_usd` was `numeric(10,6) NOT NULL DEFAULT 0.0`. An
  unpriced model therefore booked a false `$0.000000` in the **primary** cost
  ledger, while `neural_footprint_event` — fixed by ADR 0010 — correctly recorded
  `NULL` plus `context.cost_basis='unpriced_model'`. The secondary ledger was
  telling the truth and the primary one was not.
- **OD-62** — `gpt-4-turbo` was priced `(10.00, 30.00)` with no source ever
  checked. Its two neighbours had each been found wrong the same way: a
  superseded model's published price frozen in and inherited by its successor
  (Gemini in ADR 0010; then Claude Haiku 3.5's `0.80/4.00` applied to the 4.5
  model this repo actually calls). Both were caught by a human re-reading the
  table months later.
- **OD-63** — `calendar_agent.py:253` passed `prompt` — the *formatted template* —
  into `_regex_date_extraction`. `DATE_EXTRACTION_PROMPT` embeds today's date and
  two literal example dates (`2026-02-15`, `2026-03-01`), so every fallback
  manufactured **at least three** dates at confidence 0.6 and upserted them into
  `provider_important_dates` stamped `source="llm_extraction"` — invented data
  wearing the label of real extraction. Pre-existing, and it mattered more than it
  looked: before ADR 0010 the agent never called `genai.configure()` and named a
  retired model, so the LLM call always threw and **the fallback was the entire
  behaviour**.

## Options considered

**OD-61 — what to do about the false zeros**

1. **Make the column nullable, write NULL on the unpriced path.** Matches NF, and
   makes the primary ledger as honest as the secondary. Costs: every reader must
   be checked, and a migration must be reviewed and applied.
2. *Leave it, document the caveat.* Free, and NF already carries the truth — but
   it leaves the ledger everyone actually queries lying, and the caveat lives only
   in a comment nobody reads before running `SUM()`.
3. *Sentinel value (`-1`).* No migration. Rejected outright: it is the same defect
   with a longer fuse — every reader that does not know the convention gets a
   number that is not merely wrong but wrong in a new direction.

**OD-61 — the backfill**

1. **Backfill nothing; document the gap.** Chosen.
2. *Re-cost the unpriced row from today's table.* Rejected — see Decision.
3. *Null every existing `0.0`.* Rejected: it would destroy the one row whose zero
   is arithmetically true, converting a fact into an unknown.

**OD-62 — how to stop a third recurrence**

1. **Make the dated source a required field of every rate, and test it.** A rate
   without provenance fails at import; a malformed, future-dated, or placeholder
   date fails the build.
2. *Fix the number and add a comment.* What was done the previous two times. It
   is why there was a third time.
3. *A scheduled re-verification job.* Rejected for now: it needs an owner and a
   cadence nobody has picked, and it does not stop the *next* rate from being
   added undated. Revisit if rates start going stale rather than being born wrong.

**OD-63 — how to stop feeding the fallback our own text**

1. **Move prompt construction inside `_call_llm_for_dates`.** The formatted
   template stops existing in the caller's scope, so there is no wrong string
   available to pass.
2. *Add a second parameter for the raw text.* Fixes today's bug and leaves both
   strings in scope at the call site — the exact condition that produced it.
3. *Strip the example dates out of the prompt.* Treats the symptom; today's date
   is still in the template, and the next prompt to gain an example re-opens it.

## Decision

**One `unpriced` determination drives both ledgers; every rate carries the date
and page it was verified against; the regex fallback is structurally unable to
see a prompt.**

- `api_spend.cost_usd` becomes nullable **and loses its `DEFAULT 0.0`**. The
  default was the second door to the same lie: an INSERT that omits the column
  silently asserts "free". With no default, omission yields `NULL` — "nobody
  said" — matching `neural_footprint_event.cost_usd`, which has neither.
  `SpendLogger.log()` now computes `unpriced` **once**, above both writes, so the
  two ledgers cannot disagree about whether a cost is known.

- **No backfill.** Production holds 185 `api_spend` rows, two of them zero-cost,
  and the two kinds are *distinguishable* rather than conflated:
  `7909b29a…` (`claude-haiku-4-5-20251001`, **0 in / 0 out tokens**, 2026-07-01)
  costs zero at any rate — a true zero — and `1d73fe73…`
  (`gemini-3.6-flash`, 146 in / 53 out, 2026-08-24) is the one genuine unpriced
  false zero, worth **$0.000309** at today's rate against a **$0.923359** lifetime
  total. Rewriting it means asserting that today's rate applied on that date,
  which is precisely the "price frozen in and inherited" move OD-62 exists to
  stop; and the token counts sit on the row, so the figure is recomputable by
  anyone who wants it. A documented gap beats a guessed number.

- `gpt-4-turbo` `(10.00, 30.00)` is **verified correct** — OpenAI publishes
  `gpt-4-turbo-2024-04-09` at "$10" input / "$30" output per 1M tokens
  (`developers.openai.com/api/docs/pricing`, checked 2026-08-25, confirmed on the
  model page). The suspicion did not hold. Two things around it did change: the
  "one live call site" OD-62 cites **no longer exists** — `auction_wine_service.py`
  now names `gpt-4o` — so this is a historical row kept to re-cost old spend, and
  it is exactly the kind of row that rots unnoticed.

- `Rate` is a `NamedTuple` whose `verified` and `source` fields have **no
  defaults**. An undated rate is a `TypeError` at import.

## Consequences

**Easier**
- `SUM(cost_usd)` over `api_spend` now means "the spend we can account for", and
  the rows it skipped are findable with `WHERE cost_usd IS NULL`.
- Both ledgers answer the cost question identically; a fix applied to one and not
  the other now fails `test_both_ledgers_agree_on_cost_for_every_shape_of_call`.
- A fourth frozen-price incident breaks the build instead of waiting for a reader.

**Harder / given up**
- Readers must handle `NULL`. Three exist, all summing client-side, none ordering
  or filtering on the column. Two were already NULL-safe (`… or 0.0`).
  **`jobs/research_tasks.py::_budget_available` was not**: `float(r.get("cost_usd", 0))`
  raises `TypeError` on a present-but-`NULL` key, straight into its own fail-open
  handler — a single unpriced call would have **silently switched the research
  daily budget gate off for the rest of the day**. Fixed in the same commit.
- Unpriced spend does not count toward any cap. That was already true (a false
  `0.0` counted for nothing either); it is now *visible* rather than implicit.
- Adding a rate costs one page-read and one date. That is the point.

**Revisit when**
- A reader needs to *distinguish* unknown from free in aggregate — then NF's
  `cost_basis` is the join, or `api_spend` needs its own reason column.
- `gemini-3.7-flash` / `gemini-3.6-flash` double on **2027-01-01** (noted on both
  rows). A staleness assertion on `verified` becomes worth its noise once rates
  start going stale rather than being born wrong.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | Claude (adversarial pass) | Each fix mutation-tested: reverting the OD-63 line fails 3 tests (production-shaped payload: "Saved 3 extracted dates" from a dateless email); restoring the `api_spend` false zero fails 3; a placeholder verification date fails 2 |
| 2026-08-25 | — | Created; migration written but **NOT applied** — founder applies after review |
