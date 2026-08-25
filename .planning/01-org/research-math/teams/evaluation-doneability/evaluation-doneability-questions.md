---
type: questions
division: research-math
department: research-math
team: evaluation-doneability
status: open
updated: 2026-08-24
open_questions: 1
links: ["[[evaluation-doneability-charter]]", "[[evaluation-doneability-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Evaluation & Doneability — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| EVA-Q1 | P1 build (Research & Math) | 2026-08-24 | **This team is now the critical path.** P1 closed and moved the bottleneck here — see below for the measured scope and a proposed first task type. | Founder answers OD-59; this team defines doneability for **one** task type, not all of them | 2026-09-24 |

---

## EVA-Q1 — Doneability is the bottleneck, and it does not need a universal answer

**What P1 left.** `neural_footprint_event.outcome` is written on
`outcome_basis: call_level_v0`, which asserts exactly one thing: *the HTTP call to the
model returned 200*. It is not naive — the first live verification recorded `partial`
rather than `success` because `stop_reason` was `max_tokens`, so it already declines to
call a truncated completion done. But *"the API answered"* and *"the agent did the job"*
are different claims, and only the first is measurable today.

**Measured scope, from `00-index/loops.json` and [[METRICS]]:**

| | |
|---|---|
| `nf_a.*` keys needing a verdict | **7 of 15** — `cost_per_completed_task`, `task_success_rate`, `verified_task_success_rate`, `doneability_verdict`, `doneability_verdict_coverage`, `verdict_coverage`, `outcome` |
| Loops measuring at least one | **24** |
| Distinct units owning those loops | **14** |
| Their statuses | 22 `proposed`, 2 `gated` |

**Why it is sharp rather than academic.** `cost_per_api_call` is readable today;
`cost_per_completed_task` is not — and the two move in **opposite directions** when a
cheaper model retries more. Routing a task to a cheaper model therefore looks like a win
on the number that can be seen and may be a loss on the number that cannot. This is
exactly the trap [[inference-cost-premortem]] M4 names, and it is why
[[inference-cost-loops]] L-IC-4 and [[finance-pricing-loops]] L-FIN-3 read `gated` rather
than `active`: the mechanism is built, and closing them on cost per *attempted* task
would produce confidently wrong routing decisions with a real number attached.

### The scoping claim: one task type, not a definition of "done"

A universal doneability standard is the version of this problem that never ships. The
column is per-row and `context.task_type` already partitions it, so a verdict defined for
**one** task type is immediately useful: `cost_per_completed_task` becomes readable for
that slice while every other slice honestly reports `outcome_unknown`.

**Proposed opener: `invoice_extraction`.** Three reasons, in order of weight:

1. **It has a machine-checkable ground truth.** Extracted line items either reconcile to
   the invoice total or they do not. No human grader, no rubric, no inter-rater problem —
   which is what makes it a *verdict* rather than another opinion.
2. **It is the dominant real path.** Email-sourced extraction runs on a `@Cron */5`
   sweep; manual upload is the exception. Volume arrives without anyone generating it —
   and below 30 events the readout labels the figure `INSUFFICIENT VOLUME` (OD-58).
   *Corrected 2026-08-25: it prints the figure under that banner and exits 0 — it does
   not withhold it (`scripts/nf_readout.py:271,308,339`).*
3. **Its failure mode is already the business risk.** [[PROJECT]] names data credibility
   as the blocker; an invoice that extracts *plausibly but wrongly* is worse than one that
   fails loudly, and only a reconciliation check tells those apart.

**The counter-argument, stated rather than buried:** reconciliation proves arithmetic
consistency, not correctness — an extraction can balance and still attach the wrong
vendor, date, or SKU. So `invoice_extraction` should ship as
`outcome_basis: reconciliation_v1`, explicitly narrower than "done", with
[[backtests-charter]] re-grading it against scenario truth. **Naming the basis in the row
is what stops a narrow verdict from silently becoming the definition** — the same
mechanism that keeps `call_level_v0` honest today.

### What this team owes, and what it does not

**Owed:** a verdict definition for one task type, its `outcome_basis` string, and the
check that produces it. **Not owed:** a definition covering all 35 call sites, or a
verdict for task types whose ground truth is a human judgement — those wait for a rubric
this team has not been asked for yet.

**Not this team's call:** whether `invoice_extraction` is the right opener. That is
OD-59, and a doneability standard chosen by the thing being graded is worth very little.

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `EVA-Q<n>` for this unit's own questions; advisory keeps its own
prefix (`AR-`, `RT-`, `DO-`) so provenance survives a copy-paste.

**Escalation.** A finding still Open after **42 days** must resolve to a binary — fix it,
or accept it in writing with a named owner and a date. *Accepting is an honourable close.*
Anything implying a decision also gets a row in
[`OPEN-DECISIONS.md`](../../../decisions/OPEN-DECISIONS.md); this file is not a decision log.

**Why this file exists.** The advisory layer was specified with `questions.md` as its
delivery target and then built without one — so all three functions were inert on arrival
(OD-41). Created 2026-08-24 by `scripts/build_questions_files.py`.

```dataview
TABLE open_questions, updated
FROM "01-org" OR "02-advisory"
WHERE type = "questions" AND open_questions > 0
SORT open_questions DESC
```
