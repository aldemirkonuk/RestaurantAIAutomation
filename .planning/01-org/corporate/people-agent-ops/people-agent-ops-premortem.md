---
type: premortem
division: corporate
department: people-agent-ops
status: provisional
metrics: [roster.truth_pct, nf_a.doneability_verdict_coverage, nf_a.cost_per_completed_task, nf_a.task_success_rate]
updated: 2026-08-24
links: ["[[people-agent-ops-charter]]", "[[people-agent-ops-loops]]", "[[people-agent-ops-directive]]", "[[roster-lifecycle-premortem]]", "[[performance-doneability-premortem]]", "[[research-math-charter]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[ai-orchestration-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# People & Agent Ops — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. People & Agent Ops has failed. What happened?

Five mechanisms, most likely first. The first two are not hypothetical — the repo
already contains one instance of each, which is why they lead.

---

### M1 — Roster hygiene ate the year, and doneability never started

The department's own charter predicted this (`corporate.md:331-334`): roster work is
**cheap, visible and structural**; doneability work is **expensive, invisible and
statistical**. Given one backlog, the cheap visible work wins every week. Twelve months
in, `roster.truth_pct` is 100%, every module is registered with a declared spec, the board
is green — and `nf_a.doneability_verdict_coverage` is still **0%**, because it was blocked
on someone else's schema change and blocked work does not compete well against work that
closes.

The failure is not that roster hygiene is wrong. It is that a department with two teams
and one person becomes a department with one team.

**Earliest observable signal.** Three consecutive close-times where
[[roster-lifecycle-charter]]'s metric moves and [[performance-doneability-charter]]'s does
not — and the reason given for the second is a dependency rather than a decision. Also:
the first weekly agenda in which the doneability line item is copied forward unchanged
from the previous week.

**Counter-pressure.** [[performance-doneability-charter]]'s standing output when blocked
is **not silence — it is a published number and a named blocker**. `L-PAO-3` in
[[people-agent-ops-loops]] measures *blocked days*, not just coverage, and a blocker older
than two close-times escalates to `OPEN-DECISIONS.md` automatically rather than by
someone remembering. The two teams are never reviewed in the same agenda slot; the board
shows both metrics side by side and the department reallocates if only one moves.

---

### M2 — A dark agent shipped and consumed nothing, again

Three modules are registered nowhere today (`book_scraper_agent`, `dataset_creator_agent`,
`recurring_order_agent`), and two of them extend `BaseAgent` fully. The repo has already
paid for this once, and wrote the receipt into the code —
`services/agent-orchestrator/core/orchestrator.py:200-205`: *"Both were fully implemented
and absent from this registry, so nothing consumed inbound vendor email at all…the missing
registration hid the other two."*

So the failure mode is not "we might not notice". It is: **we noticed once, fixed the two
instances, and never built the check.** A year later a fourth agent is written, tested,
merged, and silently never wired in — and because the department now exists, its absence
is *someone's fault* in a way it was not before, which makes it likelier to be quietly
patched than recorded.

**Earliest observable signal.** A new module lands in `services/agent-orchestrator/agents/`
in a PR whose diff does not touch `core/orchestrator.py`. That is a one-line CI condition
and it is checkable before the agent ever runs.

**Counter-pressure.** The **roster census is a scheduled job, not a review habit**
(`L-PAO-1`, daily). It diffs three sources — filesystem, `orchestrator.py` class map,
`DEFAULT_AGENT_SPECS` — and any non-empty diff is a defect with an owner, including the
deliberate exclusions, which must be *declared* rather than merely true. A deliberate
non-agent (like `recurring_order_agent`, whose docstring at `:17-21` says so) gets an
explicit register entry recording that it is out of scope; "correctly absent" and
"forgotten" must not look the same. That symmetry is the whole lesson of `IS_STUB`.

---

### M3 — `success_rate` became the metric because it already existed

This is the team doc's own premortem for §4.2 (`corporate.md:407-411`) and it generalizes
to the department. `AgentMetrics.success_rate` is live today at
`core/base_agent.py:144`. `get_health()` at `:985` already gates on it at 0.9. A
dashboard can be green **this week**. A doneability verdict requires a definition from
[[evaluation-doneability-charter]], a golden set, an emission path, and a schema change —
none of which are ours and all of which are slow.

So the department ships the number it has. `core/base_agent.py:602` records
`success=True` when `process_message()` did not raise, so an agent producing confidently
wrong output scores 100%, the board is green, and the green becomes the reason nobody
looks. **This is the exact failure `IS_STUB` was invented to prevent, reappearing one
layer up** — a healthy-looking dashboard over a worker that does nothing useful.

**Earliest observable signal.** The first artifact — slide, README, board, investor note —
in which `success_rate` appears **without** the words "liveness, not correctness" next to
it. Not the tenth. The first.

**Counter-pressure.** Rename at the source of use, not at the point of embarrassment: in
every People & Agent Ops artifact the existing number is
`nf_a.liveness_rate`, and `nf_a.verified_task_success_rate` is a **separate, currently
empty** field that is reported as empty. A metric that is 0% is publishable; a metric that
is misleading is not. [[red-team-charter]] is asked to attack this specific substitution
as a standing finding, because the department cannot be trusted to police its own
convenience here.

---

### M4 — The department reviewed workers on data that could not name a worker

`SpendLogger.log()` takes `provider`, `model`, tokens, `cost_usd`, `restaurant_id`
(`services/agent-orchestrator/services/spend_logger.py:41-49`) and **no agent**.
`api_spend` has no agent column
(`supabase/migrations/20260805000000_baseline_from_production.sql:2231`). `decision_log`
has `agent_name` and **no cost** (`:2687`). Nothing joins them.

The failure: rather than treating this as a blocking dependency, the department builds a
review anyway — attributing cost by *inference* ("the sommelier agent is the only thing
calling Haiku on Tuesdays"), publishes per-agent cost numbers derived from a heuristic,
and then defends them. Twelve months later a real join key lands and the historical
numbers are wrong, so the trend line — the only thing a review is actually for — is
worthless.

**Earliest observable signal.** The first per-agent cost figure produced by a query whose
`WHERE` clause names a *model or a time window* rather than an *agent*. Also: any
reconciliation spreadsheet in `.planning/` that maps models to agents by hand.

**Counter-pressure.** **Attribution by inference is prohibited, in writing, in
[[people-agent-ops-directive]].** The department's stated position is that per-agent cost
is *not derivable today* — and it says so in every artifact until CORP-F5 closes. The
dependency is filed once, escalated on a clock, and reported as blocked-with-a-date rather
than worked around. A number we cannot compute is a better artifact than a number we
guessed.

---

### M5 — The HR frame outran the workforce, and the department wrote policy for nobody

The department is called People & Agent Ops. HR is a genre with strong gravity — ladders,
rubrics, review cycles, calibration, competency matrices, onboarding checklists. All of it
is writable in a weekend and none of it is falsifiable against 26 Python modules and zero
employees. The Human Ops team was correctly rejected (`corporate.md:412-419`); the *idea*
of Human Ops is harder to reject, and it comes back as documents.

Twelve months on there is a five-level maturity rubric with behavioural descriptors, a
quarterly review cadence, and an onboarding template — and three agents are still
unregistered.

**Earliest observable signal.** Any artifact in this department that describes a process
with no current subject: a review cadence with nothing to review, a ladder level with no
agent at it, an onboarding gate no agent has passed through. Concretely: the first
document here whose word count exceeds its citation count by more than an order of
magnitude.

**Counter-pressure.** **Every level of the maturity ladder must be defined by a
machine-checkable predicate** over the repo, not a prose descriptor — "registered with a
declared spec" is a level; "operates with autonomy and judgement" is not. The ladder is
built by *classifying the 26 modules that exist* and stops at the number of levels the
evidence supports, which may be three. Anti-sprawl applies to this department's own
output: [[ORG_STRUCTURE]] §4 — an agenda untouched in 60 days is finished or fiction.

---

## Cross-cutting counter-pressure

- **Two metrics, never summed.** Roster truth and doneability coverage measure
  non-commensurable failures. A weighted blend would let M1 hide inside a healthy average,
  which is precisely M1.
- **The department publishes zeroes.** `nf_a.doneability_verdict_coverage` is **0%** and
  that zero is the honest number for a department whose charter names NF-A as its primary
  input (`corporate.md:404-406`). A published zero is a working measurement.
- **Advisory is findings-only** ([[ORG_STRUCTURE]] §3). [[red-team-charter]] attacks M3's
  substitution and M4's inference temptation; [[decision-office-charter]] owns whether
  CORP-F5 closes or drifts — and M4 is entirely a story about a decision that drifted.
- **This document is subject to its own M5.** If nothing here has been revisited in 60
  days it is fiction.
