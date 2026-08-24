---
type: premortem
division: corporate
department: people-agent-ops
team: performance-doneability
status: provisional
metrics: [nf_a.doneability_verdict_coverage, nf_a.cost_per_completed_task, nf_a.verified_task_success_rate, nf_a.task_success_rate]
updated: 2026-08-24
links: ["[[performance-doneability-charter]]", "[[performance-doneability-loops]]", "[[performance-doneability-directive]]", "[[people-agent-ops-premortem]]", "[[roster-lifecycle-charter]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[research-math-charter]]", "[[ai-orchestration-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Performance & Doneability — Premortem

> Written at founding, before success is assumed.

The division agent's one-line prediction (`corporate.md:407-411`):

> *We keep measuring `success_rate` because it already exists, ship a dashboard that is
> green while agents produce confidently wrong output, and the metric becomes the reason
> nobody looks — the exact failure `IS_STUB` was invented to prevent, reappearing one
> layer up.*

That is M1 below. Four more follow, because the substitution is not the only way a team
that starts at 0% fails.

---

## It is 2027-08. Performance & Doneability has failed. What happened?

### M1 — `success_rate` became the metric, because it was already there

Every ingredient is in place today. `AgentMetrics.success_rate` is live at
`core/base_agent.py:144`. `get_health()` at `:985` already gates on `>= 0.9`. Prometheus
already exports per-agent duration (`core/observability.py:113-118`). A per-agent
dashboard is an afternoon's work and it will be **green**.

Meanwhile a doneability verdict requires a criterion definition owned by
[[evaluation-doneability-charter]], a golden set, an emission path, and a schema change
— none of it ours, all of it slow. So the team ships what it has. And what it has is
`core/base_agent.py:602`, which records `success=True` when `process_message()` did not
raise: **liveness, not correctness.** An agent that returns confidently wrong output —
a mis-parsed invoice total, a wrong wine match, a vendor email classified backwards —
scores 100%.

Then the second-order failure, which is the real one: the green dashboard becomes the
reason nobody looks. This is `IS_STUB`'s exact lesson (`core/orchestrator.py:239-244` —
an enabled no-op *"looks healthy from every dashboard"*) reappearing one layer up, in the
department founded to prevent it.

**Earliest observable signal.** The **first** appearance of `success_rate` in a People &
Agent Ops artifact without the words "liveness, not correctness" beside it. Not the tenth.
Also: the first per-agent health dashboard that does not carry a coverage figure telling
the reader what share of tasks it grades.

**Counter-pressure.** Rename at the point of use, not at the point of embarrassment: in
this team's artifacts the existing quantity is **`nf_a.liveness_rate`**, and
`nf_a.verified_task_success_rate` is a separate field reported as **empty**
([[performance-doneability-directive]] rule 2). A 0% that is honest is publishable; a
number that is misleading is not. [[red-team-charter]] is asked to carry this specific
substitution as a **standing** finding, because the team cannot be trusted to police its
own convenience here — the substitution is always locally reasonable.

---

### M2 — Blocked became quiet, and quiet became gone

The dependency is real: `SpendLogger.log()` has no `agent` parameter
(`services/agent-orchestrator/services/spend_logger.py:41-49`), `api_spend` has no agent
column (`…baseline_from_production.sql:2231`), and nothing joins `decision_log` to
`api_spend`. None of that is this team's to fix.

So the first weekly agenda says "blocked on CORP-F5". The second says the same. By the
sixth, the line is copied forward without being read; by the tenth it is dropped for
tidiness. The team stops appearing in the department's agenda, and
[[roster-lifecycle-charter]] — whose work closes weekly — becomes the department. That is
[[people-agent-ops-premortem]] M1 seen from inside the team it happens to.

The nastiest part: nothing looks wrong. A blocked team with nothing to report is
indistinguishable from a team that does not exist.

**Earliest observable signal.** Two consecutive close-times where this team's agenda line
is textually identical to the previous one and no blocker age is attached. Also: the first
department agenda in which this team has no row at all.

**Counter-pressure.** **The blocked state is itself the measurement.** `L-PD-1` publishes
`nf_a.doneability_verdict_coverage` **weekly whether or not it moved**, next to
`people.blocked_days`, which increments on its own. A frozen zero beside a rising age is a
legible organisational reading, not an excuse — and a blocker older than two close-times
escalates to `OPEN-DECISIONS.md` **automatically**, on the clock rather than by someone
remembering ([[people-agent-ops-directive]] rule 1). The team also has unblocked work
(M3's counter-pressure) so that "blocked" never means "idle".

---

### M3 — The team waited for the schema instead of writing the criteria

CORP-F5 closes in month nine. The `agent` column lands, the join key lands, NF-A can finally
name a worker — and the team has **no doneability criteria to apply**, because writing
them was never scheduled: it looked like it belonged to
[[evaluation-doneability-charter]], whose methodology it is. Six more months go by
defining what "done" means for invoice understanding while the instrumentation sits idle.
The dependency was never the true critical path; it just looked like it.

**Earliest observable signal.** At the end of the first quarter, ask: *for how many of the
task types this fleet actually runs is there a written statement of what "done" means?* If
the answer is zero and the team has been "blocked" all quarter, this is already happening.

**Counter-pressure.** The specification of *what needs grading* is explicitly this team's
([[performance-doneability-charter]], Boundaries) even though the *methodology* is not.
From week one it writes criteria specifications for the task types already running —
invoice understanding, inbound email classification, wine enrichment — and hands them to
[[evaluation-doneability-charter]] to turn into methodology. `L-PD-3` measures
**criteria-specification coverage**, a number that moves while everything else is blocked,
and which is the honest answer to "what did you do this quarter".

---

### M4 — Cost was attributed by inference, and the trend line was worthless

Someone senior asks what the sommelier agent costs. The data cannot answer it, but a
plausible answer is constructible: `api_spend` has `model` and `timestamp`, and the
sommelier agent is roughly the only thing calling that model in that window. A number gets
produced. It gets repeated. A reconciliation spreadsheet appears mapping models to agents.

Nine months later a real `agent` column lands and the historical figures are wrong —
not slightly, but structurally, because a shared model or a retried call breaks the
mapping entirely. The **trend line**, which is the only thing a performance review is
actually for, is worthless: there is no comparable history.

Worse, the inferred numbers will have been defended in public by then, so correcting them
costs credibility that the correct answer — *"not derivable"* — would never have spent.

**Earliest observable signal.** The first per-agent cost figure from a query whose `WHERE`
clause names a **model or a time window** rather than an **agent**. Also: any hand-made
model→agent mapping file appearing anywhere in the repo or `.planning/`.

**Counter-pressure.** **Attribution by inference is prohibited in writing**
([[performance-doneability-directive]] rule 1). Per-agent cost may only be reported from a
field that names an agent. Today the correct output is *not derivable*, stated without
softening, in every artifact — and rule 5 of the department directive means being asked
for the forbidden number is itself an escalation trigger, so the pressure lands on CORP-F5
instead of on the team's integrity.

---

### M5 — Doneability became a rubric instead of training signal

The team gets its criteria, gets its verdicts, and builds a review: a rubric, a quarterly
cycle, per-agent scores. All defensible, all recognisably HR. And it quietly discards the
thing that made doneability worth building — **the verdict is the label that turns agent
work into ML-readable training signal.**

If the verdict is stored as a review artifact rather than emitted onto the NF-A spine, it
never reaches the research store
([ADR 0006](../../../../decisions/0006-neural-footprint-architecture.md): *append-only,
deliberately wide, never migrated*). NF-A's `stimulus → internal state → choice → outcome`
is left permanently without its **outcome**, and the harness-improvement loop it exists to
feed has nothing to learn from. The team optimises a quarterly document and loses the
asset.

**Earliest observable signal.** The first doneability verdict that exists in a review
document, a spreadsheet, or a dashboard **and not as a row on the NF-A spine**. Also: a
verdict schema designed around what a review needs to display rather than around
`neural_footprint_event`'s shape ([[README]] §4.4).

**Counter-pressure.** **The verdict's canonical home is the NF-A event, and the review is
a read of it** — never the reverse. Any verdict this team produces is specified as a field
on the spine owned by [[neural-footprint-instrumentation-charter]], and the review query
reads from there. `nf_a.doneability_verdict_coverage` is deliberately defined over *task
completions on the spine*, not over *tasks reviewed*, so a rubric with no emission cannot
move the metric.

---

## Cross-cutting counter-pressure

- **A published zero is a working measurement.** The team's founding number is **0%** and
  the whole design here is to keep that zero honest and visible rather than replaced.
- **Two halves must both exist before a review runs.** `L-PD-4` is gated: a review on a
  verdict without an attributed cost, or a cost without a verdict, is not a review. The
  team is allowed to report *"cannot review; here is what is missing"* quarterly, and that
  is a valid output.
- **[[red-team-charter]] carries M1 and M4 as standing findings.** Findings-only
  ([[ORG_STRUCTURE]] §3) — they land in `questions.md`, not as a veto.
- **[[decision-office-charter]] owns whether CORP-F5 closes or drifts.** M2 and M4 are both,
  underneath, stories about a decision that drifted — which is the exact failure the
  Decision Office exists to prevent.
- **Anti-sprawl applies here too.** If this premortem has not been revisited in 60 days it
  is fiction ([[ORG_STRUCTURE]] §4).
