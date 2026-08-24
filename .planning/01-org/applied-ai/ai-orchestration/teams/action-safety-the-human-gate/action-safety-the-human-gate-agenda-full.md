---
type: agenda-full
division: applied-ai
department: ai-orchestration
team: action-safety-the-human-gate
status: provisional
metrics: [safety.unconfirmed_mutation_count, safety.median_time_to_confirm, safety.rejection_rate]
updated: 2026-08-24
links: ["[[action-safety-the-human-gate-charter]]", "[[action-safety-the-human-gate-premortem]]", "[[action-safety-the-human-gate-agenda-board]]", "[[action-safety-the-human-gate-directive]]", "[[action-safety-the-human-gate-loops]]", "[[action-safety-the-human-gate-schedule]]", "[[ai-orchestration-agenda-full]]", "[[harness-runtime-charter]]", "[[design-charter]]", "[[compliance-privacy-charter|compliance-and-privacy-charter]]", "[[product-vision-charter|product-and-vision-charter]]"]
---

# Action Safety & the Human Gate — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

A guarantee upheld **four times independently** and enforced **once nowhere**.

`drift_agent.py:8-12` never auto-applies money or stock. The one-tap action center
records `executed_by` and `executed_at`. Vendor replies never auto-send. The UX
optimizer never auto-applies. Four conventions, four implementations, and nothing that
would object if a fifth code path forgot (`technology.md:441`).

And a measurement problem that is worse than the schema problem: even where the gate
holds, nothing currently distinguishes a **confirmation** from a **reflex**.

## How

### 1. Instrument time-to-confirm — before the volume arrives

This is first, and the ordering is the whole argument.
[[action-safety-the-human-gate-premortem]] #1 is a behavioural failure, and behavioural
failures cannot be measured retroactively: instrumenting after the habit forms measures
the habit, not the gate.

The data already exists. `one-tap-actions.service.ts:245-246` writes `executed_at`;
the row's creation time is the other end. **`safety.median_time_to_confirm` is a query
against existing columns, not a feature.** Same for `safety.rejection_rate` — `@Post(":actionId/cancel")`
(`one-tap-actions.controller.ts:246`) is already the denominator's other half.

Watch the **distribution**, not the median alone. A healthy gate has a long tail: some
confirmations slow, because some were thought about. A spike near zero with no tail is
approval-as-reflex, and it is visible long before an incident.

### 2. Publish `safety.schema_coverage`, and define what counts

Share of mutation entry points behind the single action schema. Today: partial, by
construction. Making it a number turns "four conventions" from a sentence in a team doc
into something that can be driven to 100%.

The definitional work is the real work here, and it should be done before the number is
published rather than argued afterwards: **what is a mutation entry point?** Our
proposal — any code path that writes stock, moves money, or sends to an outbound
channel, regardless of which service it lives in.

### 3. The CI check: is there a confirmation upstream of this mutation?

`scripts/check_no_direct_stock_writes.sh:1-13` proves the pattern works in this repo and
is already wired into `.github/workflows/ci.yml`. It asks *"did this write go through
`apply_stock_movement`"*.

The new check asks a different question about the same code:
**"is there a confirmation record upstream of this mutation?"** Same mechanism,
different invariant, and it is the thing that would have caught
[[action-safety-the-human-gate-premortem]] #2 — a new module writing stock correctly and
unconfirmed.

### 4. Define "confirmation" in writing, before it is contested

Proposed definition: **a confirmation is a human decision about a specific, composed
action.**

A standing approval for a class of future actions is an **autonomy tier**, not a
confirmation. Both can exist and both are legitimate; conflating them is what fails.
This matters concretely and immediately, because `recurring_order_agent.py`'s own
feature list says *"Auto-execution with manager approval"*, and it is genuinely unclear
today which of the two that is.

### 5. Per-family autonomy tiers, from the `FUTURES.md` §8.2 table

Seven families, and five things gated harder: *"mass deletes, changing billing,
granting permissions, sending email without draft review, guest PII exports."* Give
each family a tier, and give the money/stock families a **friction floor**.

The point of tiering is not caution for its own sake — it is **attention budgeting**.
Fifty confirmations a day is the disease. Navigation assist and calendar drafts should
not compete for the same attention as a purchase order.

### 6. Link the confirmation to its proposal snapshot

`drift_agent.py:17` already does the analogous thing: *"Every run and every finding
writes a `decision_log` row."* The confirmation record should link to what the human was
shown — rendered summary, model and prompt version, confidence, retrieved facts. A
confirmation without its context proves a click and reconstructs nothing
([[action-safety-the-human-gate-premortem]] #5), which is the neural footprint's own
definition of failure ([[README]] §4.1).

## Why now

1. **Behavioural instrumentation has a deadline that is not a date — it is a volume.**
   Once the habit forms, the measurement measures the habit. Today's volume is low,
   which makes today the only cheap time to establish a baseline.
2. **Four conventions is a state that decays.** Each is correct and each can be
   forgotten independently by the next feature.
3. **`recurring_order_agent` is an unresolved auto-execution path** sitting in the repo
   with passing tests, outside the harness and outside the action center.

## Next steps

| # | Step | Blocked by |
|---|---|---|
| 1 | `median_time_to_confirm` + `rejection_rate` from existing columns | — |
| 2 | Define "mutation entry point"; publish `schema_coverage` | — |
| 3 | CI check: confirmation upstream of mutation | step 2 |
| 4 | Write down what a confirmation is | — |
| 5 | Per-family autonomy tiers + friction floor | step 4; [[design-charter]] seam |
| 6 | Confirmation → proposal snapshot link | NF-A schema |

Steps 1, 2 and 4 are unblocked and are the ones that stop being cheap if deferred.

## Questions for the founder

1. **Is a standing pre-approval a confirmation?** `recurring_order_agent.py` says
   *"auto-execution with manager approval"*. If that means a flag set once for a class
   of future orders, it is an autonomy tier — legitimate, but not the `FUTURES.md` §8.1
   guarantee, and it should be named as such rather than counted as a gate.
2. **The Design seam.** `FUTURES.md` §8.3 specifies action cards with Confirm / Edit /
   Discard. [[design-charter]] owns that surface. This team's position is that
   **Design owns the surface and this team owns the friction floor on money and stock
   families.** Confirm or overrule — a surface optimised purely for speed produces
   [[action-safety-the-human-gate-premortem]] #1.
3. **How many confirmations per day is acceptable?** This is a real budget, not a
   rhetorical question. It determines how aggressively low-stakes families get tiered
   away from the money and stock ones.
4. **Guest PII exports** are gated hard in `FUTURES.md` §8.2. Does
   [[compliance-privacy-charter|compliance-and-privacy-charter]] own that entry, with this team enforcing it? We
   assume yes and would rather have it stated.
5. **Who may change an autonomy tier?** We propose: moving a family *toward* more
   autonomy requires an ADR; moving it toward less is a PR. Asymmetric on purpose.
