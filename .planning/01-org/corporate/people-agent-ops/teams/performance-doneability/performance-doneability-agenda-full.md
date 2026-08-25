---
type: agenda-full
division: corporate
department: people-agent-ops
team: performance-doneability
status: provisional
metrics: [nf_a.doneability_verdict_coverage, nf_a.cost_per_task, nf_a.cost_per_completed_task, nf_a.verified_task_success_rate, nf_a.agent_attributed_spend_pct]
updated: 2026-08-24
links: ["[[performance-doneability-charter]]", "[[performance-doneability-premortem]]", "[[performance-doneability-agenda-board]]", "[[performance-doneability-directive]]", "[[performance-doneability-loops]]", "[[performance-doneability-schedule]]", "[[people-agent-ops-agenda-full]]", "[[roster-lifecycle-charter]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[research-math-charter]]", "[[agent-evaluation-gates-charter]]", "[[decision-office-charter]]", "[[0006-neural-footprint-architecture]]"]
---

# Performance & Doneability — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Make it possible to say, about any agent, *did the task get done and what did it cost* —
and until it is possible, say so precisely and keep saying it.

**Opening position: 0%.** Not a placeholder. Neither half of the primary metric exists:
there is no doneability verdict anywhere in the repo, and cost cannot be attributed to a
worker.

> **Corrected 2026-08-25.** Both halves now exist, and the number does not move yet.
> A verdict shipped for exactly one task type — `reconciliation_v1` on invoice
> extraction ([[0017-doneability-verdicts-are-sidecar-claims]]) — and cost is
> attributable to a worker since P1 (`subject_id` on `neural_footprint_event`,
> `spend_logger.py:269`). Coverage is still ~0% and every other slice is ungraded, so
> "0%" stands as the opening position; "anywhere" and "cannot" do not.

| Metric | State today | Why |
|---|---|---|
| `nf_a.doneability_verdict_coverage` | **~0%** | Corrected 2026-08-25: one verdict basis exists (`reconciliation_v1`, invoices — ADR 0017); every other slice is ungraded |
| `nf_a.verified_task_success_rate` | **Unmeasurable** | `core/base_agent.py:602` records liveness |
| `nf_a.cost_per_task` | **Not derivable** | `spend_logger.py:41-49` has no `agent` param |
| `nf_a.cost_per_completed_task` | **Not derivable** | Needs both halves |
| `nf_a.agent_attributed_spend_pct` | **0%** | `api_spend` (`…sql:2231`) has no agent column |
| `people.blocked_days` | **0** — starts the day CORP-F5 is filed | The number that will actually move |

The structural fact underneath all of it: **the Python telemetry is two unjoined halves.**
`decision_log` (`…sql:2687`) has `agent_name`, `reasoning`, `confidence` and **no cost**.
`api_spend` (`…sql:2231`) has `provider`, `model`, tokens, `cost_usd` and **no agent, no
verdict**. No key joins them. Performance review of an agent is not currently possible
from what is logged.

## How

Three tracks. One is blocked and stays visible; two are not blocked at all, and running
them is what stops "blocked" from becoming "gone" (premortem M2, M3).

### Track A — File the dependency precisely, then let the clock run

Two asks on Research & Math, in order, and **only** these two:

1. **`SpendLogger.log()` gains an `agent` parameter, and `api_spend` gains the column.**
   Already staged as **CORP-F5** (`corporate.md:496`) and flagged as belonging with OD-11.
   The ask is a signature diff, not a discussion.
2. **A join key between reasoning and cost.** `correlation_id` already exists on
   `decision_log` (written at `core/base_agent.py:743`) and on nothing in `api_spend`. It
   is the obvious candidate, and the decision belongs to
   [[neural-footprint-instrumentation-charter]] — we ask for a join, we do not design the
   table.

**Urgency argument, stated once so it does not need re-arguing:** [[README]] §0 item 5
notes Anthropic and Gemini are called over **raw HTTP, not their SDKs**, so cost accounting
is hand-rolled at every call site. Every month this waits is more call sites to thread an
`agent` argument through. Asking now is a column; asking in a year is a backfill nobody
can do.

Then the clock: `people.blocked_days` increments on its own, and two close-times of no
movement escalates automatically ([[people-agent-ops-directive]] rule 1).

### Track B — Write the criteria specs now (unblocked)

The methodology belongs to [[evaluation-doneability-charter]]. The **statement of what
needs grading** is ours, and nothing about it waits on a schema.

Start with the three task types the fleet already runs in production:

| Task type | What "done" would have to mean | Why it is first |
|---|---|---|
| **Invoice understanding** | Extracted line items and totals reconcile to the document; a wrong total is a failure even when parsing "succeeded" | It is the wedge — *"Restaurants get overbilled… We catch it from a photo of the invoice"* (`YC_WEDGE_PLAN.md` §3) |
| **Inbound email classification** | The classification matches what a human would have routed it to; a confident wrong route is worse than an abstention | `email_intel_agent` / `email_parsing_agent` — and both were dark once (`core/orchestrator.py:200-205`) |
| **Wine enrichment** | Enriched attributes are correct against the source, not merely present | Producer-reputation coverage work is live in this repo's recent history |

Each spec names: the unit of work, the observable that decides it, what an abstention
looks like, and what a **confidently wrong** output looks like — because that last one is
the case `success_rate` cannot see. `L-PD-3` measures criteria-specification coverage: a
number that moves while everything else is blocked.

### Track C — Publish the honest zero (unblocked, weekly)

Every week: `nf_a.doneability_verdict_coverage = 0%`, `people.blocked_days = N`, and the
named blocker. No substitution. When someone asks for per-agent cost, the answer is **not
derivable** — and per department directive rule 5, being asked is itself an escalation
trigger, so the pressure lands on CORP-F5 rather than on this team's integrity.

### The design constraint that governs all three

**A verdict's canonical home is the NF-A event, not a review document** (premortem M5).
[ADR 0006](../../../../decisions/0006-neural-footprint-architecture.md) locked a research
store that is *append-only, deliberately wide, never migrated* — a verdict written there
is training signal forever; a verdict written into a quarterly rubric is a document.
`nf_a.doneability_verdict_coverage` is therefore defined over **task completions on the
spine**, never over *tasks reviewed*, so a rubric with no emission cannot move it.

## Why now

- **Because "cost per task per agent" is already a named field in a locked design**
  ([[README]] §4.2) that no query can return. Either the field is real or the design is
  aspirational, and this team is the one that finds out.
- **Because the schema is open right now.** ADR 0006 locked the architecture and left
  columns to OD-11. This is the cheapest the ask will ever be.
- **Because doneability is the ML asset, not the review.** NF-A records
  `stimulus → internal state → choice → outcome`. Three of the four already emit. The
  missing one is ours, and without it the whole spine is unlabelled data.
- **Because the substitute metric is sitting right there.** `success_rate` is live,
  green-able this week, and wrong. The window to establish the honest number is before
  someone builds the convenient dashboard, not after.

## Next steps

- [ ] File **CORP-F5** into `OPEN-DECISIONS.md` with the exact signature diff for
      `SpendLogger.log()` and the `api_spend` column — [[decision-office-charter]]
- [ ] File the join-key question: what connects `decision_log:2687` to `api_spend:2231`?
      — [[neural-footprint-instrumentation-charter]]
- [ ] Start `people.blocked_days` on the day both are filed; publish it weekly
- [ ] Write criteria specs for invoice understanding, inbound email classification, and
      wine enrichment; hand them to [[evaluation-doneability-charter]]
- [ ] Specify the verdict as a **field on the NF-A spine**, not a review artifact
- [ ] Publish `nf_a.doneability_verdict_coverage = 0%` weekly, with the blocker age
- [ ] Rename the liveness quantity to `nf_a.liveness_rate` in every artifact this team
      touches; never let `success_rate` appear unqualified (premortem M1)
- [ ] Count how many of the 26 modules emit `log_decision()` at all — the floor under
      `nf_a.emission_coverage`, and a number obtainable today
- [ ] Ask [[red-team-charter]] to carry the `success_rate` substitution and the
      cost-by-inference temptation as **standing** findings

## Questions for the founder

1. **CORP-F5 — does `SpendLogger.log()` gain an `agent` parameter?** Everything this team
   does downstream of measurement depends on that one argument. If the answer is no, say
   so plainly and scope per-agent cost out — a team permanently blocked on a decision
   nobody intends to make is worse than a team told the truth.
2. **Where does the verdict live?** This team's position is: on the NF-A spine, with the
   review as a read of it. That is a schema request into
   [[neural-footprint-instrumentation-charter]] and it should be settled before anyone
   builds a review UI.
3. **What happens to an agent that fails its criterion repeatedly?** Demote, retire, or
   hand back to [[ai-orchestration-charter]]? The team proposes: never change the
   criterion to save the worker — an HR function that can rewrite the exam is not one.
4. **Is `get_health()`'s `success_rate >= 0.9` gate at `core/base_agent.py:989` acceptable
   as an availability signal** once a doneability verdict exists — or should health
   incorporate the verdict? Two green lights that mean different things is exactly how M1
   happens.
5. **How much history is worth backfilling?** If CORP-F5 closes in month nine, do we care
   about months one to eight? The team's view: no — and that is the argument for closing
   it in month one.
