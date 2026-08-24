---
type: premortem
division: research-math
department: research-math
status: provisional
metrics: [nf_a.event_completeness, nf_a.cost_per_completed_task, nf_a.verified_task_success_rate, nf_a.harness_overhead_ms]
updated: 2026-08-24
links: ["[[research-math-charter]]", "[[research-math-loops]]", "[[research-math-directive]]", "[[research-math-schedule]]", "[[harness-model-routing-premortem]]", "[[evaluation-doneability-premortem]]", "[[neural-footprint-instrumentation-premortem]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[0001-mudavym-single-entity]]", "[[agent-evaluation-gates-charter|aio-evaluation-gates]]", "[[harness-model-routing-charter|aio-model-routing]]"]
---

# Research & Math — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. Research & Math has failed. What happened?

Five mechanisms, most likely first. Four of them are ways the department stays busy while
producing nothing falsifiable; the fifth is the one where the protection clause is
revoked without anyone announcing it.

---

### M1 — The compensation clause was revoked in practice, not on paper

Nobody rescinded anything. What happened is smaller and harder to see: a launch date
moved, the OD-03 bake-off was "paused for one sprint," the golden sets were postponed
until the extraction code stabilized, and [[evaluation-doneability-charter]]'s auditors
were lent to [[harness-model-routing-charter]] to help ship the wrapper. Six months later
the department's output is a wrapper, a routing config, and no verdict — which is to say
it became an engineering team with a research name. The exact outcome the founder's
separate-company proposal was trying to prevent, arrived by drift rather than by decision
([[0001-mudavym-single-entity]] review trail).

**Earliest observable signal.** Not the third deferral — the **first**. One entry in
[[research-math-schedule]]'s long-horizon lane that slips with a product reason attached
to it. Also: the first week `nf_a.verified_task_success_rate` is not published because
the person who publishes it was working on the wrapper.

**Counter-pressure.** The long-horizon lane in [[research-math-schedule]] is marked
**non-preemptible**, and preemption is not a scheduling act — it is a **founder decision
recorded in `OPEN-DECISIONS.md`**. Anyone may propose it; nobody inside the department may
grant it. [[decision-office-charter]] owns noticing that a slip happened without a record.
Second pressure: RM-2's headcount and RM-1's are never fungible in the same close-time;
if RM-2 is lent out, `verified_task_success_rate` publishes as **"not measured this week —
auditors reassigned"**, in those words, on [[research-math-agenda-board]]. Make the
revocation visible and it stops being free.

---

### M2 — Four metrics, all unmeasurable, and a year of proxies

Every primary metric this department owns starts at *unmeasurable* —
`cost_per_completed_task` (no cost events on NestJS, no verdict anywhere),
`harness_overhead_ms` (no instrument), `verified_task_success_rate` (no criteria),
`event_completeness` (0% on the NestJS surface). Under pressure to report *something*,
each team substitutes the nearest thing it can read: API calls made, tokens spent, evals
written, tables created. Those numbers go up. None of them is the metric. At the end of
the year the department can show a chart of its own activity and cannot answer "did a task
get cheaper or better."

**Earliest observable signal.** A number on [[research-math-agenda-board]] that is not one
of the four, presented without the four beside it. Concretely: the first time
"model calls instrumented" appears as a headline figure while `nf_a.event_completeness`
is still blank.

**Counter-pressure.** The board carries the four metrics as **standing rows that always
render**, showing `unmeasured` when unmeasured — a blank is a status, not an absence.
Proxies are allowed but must be indented **under** the metric they proxy for, never beside
it. And the department's stated first goal is not to improve any of the four; it is to get
a **first reading** of each (`[[research-math-agenda-full]]` §How). Measure → then move.
A department whose first quarter produces four honest baselines and no improvements has
succeeded.

---

### M3 — OD-03 was settled by reputation, and the seven callsites never migrated

A harness is picked because it has stars, a community, and a good README. No latency table
is produced, because producing one required `harness_overhead_ms`, which required an
instrument nobody built. The chosen harness governs the Python side. The seven raw-HTTP
NestJS callsites — the **majority of production model traffic** — are never migrated,
because migrating them is [[engineering-charter]]'s work and no deprecation date was ever
set. The org now maintains two harnesses and measures neither, and the wrapper this
department built becomes the **eighth** local convention next to the five that already
exist.

**Earliest observable signal.** A decision record for OD-03 that cites GitHub stars and
contains no latency table (`intelligence.md:96-99`). A second, earlier tell: the OD-03
session is scheduled before `harness_overhead_ms` has a first reading.

**Counter-pressure.** Three, in order. (1) `OPEN-DECISIONS.md:14` already carries the rule
— *"A scoped bake-off on this repo's actual workloads. No pick from repute."* — so the
counter-pressure is enforcement, not invention: [[decision-office-charter]] rejects an
OD-03 ADR whose evidence section has no measurements from this repo. (2) The bake-off
**cannot be scheduled** until `nf_a.harness_overhead_ms` has a first reading; that
dependency is a loop with a close-time in [[research-math-loops]], not an intention.
(3) The wrapper ships **with a deprecation date for the old callsites written into the
same PR**, and `share_of_model_calls_through_wrapper` is published weekly. A wrapper with
no deprecation date is an eighth convention by construction (`intelligence.md:487`).

---

### M4 — The golden sets were written by the author of the code they grade

RM-2 stands up quickly by reusing what exists, and what exists was written by the sessions
that wrote the features. The probes encode the author's imagination rather than reality —
precisely the failure `scripts/eval_guest_merge_policies.py:10` names in one line:
*a policy self-graded against probes its own author imagined*. `verified_task_success_rate`
rises to look like the self-reported rate, the gap between them closes, and everyone
reads that as convergence on truth when it is convergence on a shared blind spot.

**Earliest observable signal.** The gap between `nf_a.verified_task_success_rate` and
`base_agent.py:144`'s self-reported `success_rate` narrowing for two consecutive
close-times **without** a change to either the harness or the criteria. A closing gap with
no cause is not progress; it is the auditor drifting toward the author.

**Counter-pressure.** The repo already contains the correct pattern and it is a cultural
asset worth naming: the beverage identity key was falsified against **732,874
known-distinct pairs that were free** — a label nobody authored — and that test killed
three designs including one committing 212 false merges
(`scripts/eval_guest_merge_policies.py:4-9`). So: **every golden set must name its source
of free negatives** — labels that fall out of the world rather than out of a session — or
be marked `imagination-only` in its manifest and excluded from any gate that blocks a
merge. Second pressure: adversarial negatives are authored by whoever did **not** write
the feature, and RM-2 publishes the provenance of each set beside its pass rate.

---

### M5 — The instrumentation contract stalled, and five private footprints appeared

OD-11 does not close, because the column-level contract needs a schema session and every
week has something more urgent. Each team instruments "temporarily" against its own table
so it can see *something*. By the time the real schema lands there are five private
footprints, each with a consumer, and no appetite to migrate any of them. NF-A becomes a
directory of dashboards rather than one object — the exact thing
[[0006-neural-footprint-architecture]] and [[README]] §4.1 were written to prevent. A
second tell arrives alongside it: `subject_type` ships with only `agent` and `guest`, and
the first operator-behaviour question (Analytics & BI's recommendation act/dismiss signal,
fork INTEL-F3) has nowhere to land.

**Earliest observable signal.** The **second** table in the repo holding token counts.
There is currently one (`api_spend`). The moment a third appears the migration will not
happen. Also: a PR adding a column that duplicates a field already in `decision_log`.

**Counter-pressure.** A **freeze with an escape hatch**, not a ban: no new telemetry table
lands without a line in [[neural-footprint-instrumentation-loops]] naming the date it is
folded into the NF contract. Temporary is allowed; *undated* temporary is not. And the
contract does not wait on the full schema — the **join key** ships first
(`correlation_id`, already present at `base_agent.py:743-784`), because two tables that
can be joined are one footprint with a bad shape, while two tables that cannot be joined
are two footprints. Fold INTEL-F3 into the OD-11 session rather than after it: adding a fourth
`subject_type` is free before launch and a migration afterward.

---

## Cross-cutting counter-pressure

- **Author ≠ auditor is a charter rule, not a norm** ([[research-math-charter]]
  §"The independence rule"). Its suspension is the M1 tell, and its dilution is the M4
  tell. It is the single mechanism this premortem leans on twice.
- **[[red-team-charter]] attacks the decisions here** — especially M3's bake-off design
  and M4's set provenance — findings-only, into `questions.md` and `OPEN-DECISIONS.md`
  ([[ORG_STRUCTURE]] §3). This department is unusually exposed to Red Team because its
  output *is* decisions.
- **[[decision-office-charter]] owns close-times.** Every counter-pressure above names one
  in [[research-math-loops]]. A premortem whose counter-pressures have no close-time is
  M2 one level up.
- **The evaluation seam is a live merge candidate, not a border to defend.** If
  [[agent-evaluation-gates-charter|aio-evaluation-gates]] and [[evaluation-doneability-charter]] duplicate work,
  `technology.md:406` already prescribes the merge. Defending scope there is a sixth
  failure mechanism we are choosing not to have.
- **Anti-sprawl applies to this document.** Nothing revisited in 60 days is fiction
  ([[README]] §3.3, §6).
