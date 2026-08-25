---
type: loops
division: advisory
department: red-team
status: provisional
metrics: [rt.finding_return_hours, rt.locked_decision_challenge_rate, rt.reaffirmation_rate, rt.finding_actionability, rt.open_finding_age_days, rt.undeclared_decision_count, rt.self_selected_target_share]
updated: 2026-08-24
links: ["[[red-team-charter]]", "[[red-team-premortem]]", "[[red-team-directive]]", "[[red-team-schedule]]", "[[red-team-agenda-board]]", "[[decision-office-charter]]", "[[architecture-review-charter]]", "[[security-charter]]", "[[LOOP-MAP]]", "[[ORG_STRUCTURE]]"]
loop_count: 6
loop_ids: ["rt-new-lock-attack", "rt-finding-return", "rt-undeclared-decision-sweep", "rt-premortem-reality-check", "rt-self-audit", "rt-aged-finding-escalation"]
loop_close_times: ["per-event", "per-event", "monthly", "quarterly", "quarterly", "per-event"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Red Team — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

**The close-time that matters most here is L-RT-2's: 72 hours from attack complete to the
finding sitting in the decision owner's `questions.md`.** Findings-only authority means
Red Team controls exactly one leg of the cycle — the return leg — and it is measured on
that one. Measuring "time to resolution" instead would be measuring the owner's calendar,
producing a number this function could always explain away, and quietly converting the
only hard commitment it can make into someone else's problem.

The 30-day figure in L-RT-6 is the *other* kind of close-time: not a promise about speed
but a **forced conversion**. A finding that has not closed in 30 days stops being a finding
and becomes a decision the founder is asked to make. That is the mechanical answer to the
risk ADR 0007 names about its own authority model (`0007-org-structure.md:74-76`).

---

## L-RT-1 — New-lock attack, inside the cheap window

```yaml
type: loop
id: rt-new-lock-attack
owner: red-team
measures: [rt.locked_decision_challenge_rate, rt.reaffirmation_rate]
changes: [decisions.review_trail, decisions.status, red_team.attack_queue]
inputs_from: [decision-office, platform, applied-ai, intelligence, product, commercial, corporate]
outputs_to: [decision-office, red-team]
close_time: per-event
close_time_note: "7 days from each new lock — the cheap window"
status: proposed
```

Fires when any `decisions/NNNN-*.md` reaches `Status: Locked`, and closes within **7 days
of the lock date** — not 7 days of noticing. Produces a verdict and a review-trail row on
the target ADR, per [[red-team-directive]] R6.

Seven days is not a service-level convenience; it is the window in which "we should not
have decided that" is still cheap. ADR 0007 locked a structure that 693 documents inherit
— attacked on day 3 that is a conversation, attacked on day 90 it is a migration. All
seven current ADRs locked on 2026-08-24 and are already outside their windows, so the first
run of this loop is a **backlog sweep** rather than a live firing, and it should be recorded
as such rather than counted as a clean 100%.

Baseline `rt.locked_decision_challenge_rate`: **0 of 7**.

---

## L-RT-2 — Finding return to the decision owner

```yaml
type: loop
id: rt-finding-return
owner: red-team
measures: [rt.finding_return_hours, rt.finding_actionability]
changes: [unit.questions_md, red_team.finding_register]
inputs_from: [red-team]
outputs_to: [platform, applied-ai, intelligence, product, commercial, corporate, architecture-review, decision-office]
close_time: per-event
close_time_note: "72h from finding to the decision owner"
status: proposed
```

**The core loop.** Starts the moment a verdict is reached in [[red-team-directive]] phase 2
and closes when the finding is written into the named owner's `questions.md` with an owner
and exactly one next action. Target: **≤72 hours, 100% of findings.**

Three design notes, each of which is the answer to a way this loop could have been faked:

1. **The clock starts at verdict, not at target selection.** Otherwise a slow attack hides
   inside a fast return time, and the metric rewards shallow analysis.
2. **The clock stops at delivery, not at acknowledgement.** Waiting for acknowledgement
   would let an unresponsive owner degrade Red Team's own number, and the function would
   learn to route around difficult owners — which is [[red-team-premortem]] M2 arriving
   through a metric.
3. **A finding failing format is not late, it is rejected** ([[red-team-directive]] R4).
   It never enters this loop. Shipping a formatless finding to stop a clock is the exact
   trade this loop must not incentivise.

**No `questions.md` exists anywhere in the corpus today.** The convention is defined twice
(`ORG_STRUCTURE.md:67`, `0007-org-structure.md:49`) and instantiated zero times. The first
firing of this loop creates the first one. Baseline: **0 findings, unmeasurable**.

---

## L-RT-3 — Undeclared-decision sweep

```yaml
type: loop
id: rt-undeclared-decision-sweep
owner: red-team
measures: [rt.undeclared_decision_count, rt.self_selected_target_share]
changes: [red_team.attack_queue, decisions.open_register]
inputs_from: [knowledge-documentation, decision-office, platform, applied-ai, intelligence, product, commercial, corporate]
outputs_to: [decision-office, red-team]
close_time: monthly
status: proposed
```

Channel C4, made into a job. Sweeps the corpus for **decision-shaped prose carrying no ADR
or OD id** — thresholds chosen, denominators picked, defaults set, scopes narrowed — and
for **local fork IDs that never reached the register**. Each hit is either registered via
[[decision-office-charter]] or explicitly dismissed; a hit that is neither is the loop
failing.

This is the only channel where nothing submits itself, which is exactly why it needs a
schedule rather than an intention ([[red-team-premortem]] M4). The channel is already
demonstrably live: `OD-C1`–`OD-C8` exist only inside Corporate's unit documents and appear
nowhere in `OPEN-DECISIONS.md`, with `OD-C5` referenced **38 times**; `compliance-privacy-agenda-board.md:57`
states in plain text that the NF-B erasability question has *"no `OPEN-DECISIONS.md` entry
yet"*; and OD-30 records the same defect class from the Engineering generator.

Monthly, not weekly: the corpus does not change fast enough for a weekly sweep to find
anything new, and a job producing nothing for 3 consecutive runs is deleted under the org's
anti-sprawl rule (foundation §6). Monthly is the slowest cadence that still catches drift
before it is inherited.

Baseline `rt.undeclared_decision_count`: **≥9 known** (8 × `OD-Cx`, plus the NF-B erasure
question), un-swept.

---

## L-RT-4 — Premortem-vs-reality re-read

```yaml
type: loop
id: rt-premortem-reality-check
owner: red-team
measures: [rt.decisions_attacked_per_quarter, rt.reaffirmation_rate]
changes: [unit.premortem, unit.loops, red_team.attack_queue]
inputs_from: [platform, applied-ai, intelligence, product, commercial, corporate]
outputs_to: [platform, applied-ai, intelligence, product, commercial, corporate, decision-office]
close_time: quarterly
status: proposed
```

The forward half of the mandate. Each quarter, a sample of unit premortems is re-read
against what actually happened, asking three questions: **did the named earliest-observable
signal ever get looked at? did a failure arrive that no mechanism predicted? did a
counter-pressure turn out to be a caution wearing a mechanism's clothes?**

A premortem that was written once and never re-read is a document, not a control. This loop
is the difference — and it is deliberately a *sample*, not a sweep, because 99 units × one
premortem each cannot be re-read quarterly by anyone, and pretending otherwise is how the
job silently stops running.

Quarterly because a mechanism needs a quarter to show up. Baseline: **0 re-reads**; every
premortem in the corpus was written on 2026-08-24 and none has been tested against a day of
reality.

---

## L-RT-5 — Red Team self-audit (the politeness/noise pair)

```yaml
type: loop
id: rt-self-audit
owner: red-team
measures: [rt.reaffirmation_rate, rt.finding_actionability, rt.self_selected_target_share, rt.locked_decision_challenge_rate]
changes: [red_team.attack_queue, red_team.charter, red_team.finding_format]
inputs_from: [red-team]
outputs_to: [decision-office, founder]
close_time: quarterly
status: proposed
```

The loop that watches this function fail. It reports **`rt.reaffirmation_rate` and
`rt.finding_actionability` as a pair, always**, because neither number means anything
alone:

| reaffirmation | actionability | Reading |
|---|---|---|
| High | High | Healthy — the corpus is well-reasoned and the attacks are real |
| High | **Low** | **[[red-team-premortem]] M2 — politeness.** Attacks that could not have failed |
| **Low** | **Low** | **M1 — the objection machine.** Volume without a next step |
| Low | High | Aggressive and useful, or a genuinely weak decision corpus. Read the targets to tell which |

Two further readings in the same run: `rt.self_selected_target_share` below 60% is M4
(service desk); a cycle with zero founder-locked targets is a **filed finding against Red
Team**, per [[red-team-directive]] R8.

Findings from this loop go to the founder, not to Red Team, because
[[red-team-directive]] E5 is explicit that self-review is not review. At the **second**
quarterly run this loop also evaluates the merge condition in [[red-team-charter]] §Entry
and exit triggers and returns a keep-or-fold recommendation to
[[decision-office-charter]].

---

## L-RT-6 — Aged-finding escalation

```yaml
type: loop
id: rt-aged-finding-escalation
owner: red-team
measures: [rt.open_finding_age_days]
changes: [decisions.open_register, red_team.finding_register]
inputs_from: [red-team, platform, applied-ai, intelligence, product, commercial, corporate]
outputs_to: [decision-office, founder]
close_time: per-event
close_time_note: "30 days hard: a finding open at 30 days converts to an OPEN-DECISIONS row"
status: proposed
```

A finding open at **30 days** stops being a finding. It is converted into an
`OPEN-DECISIONS.md` row by [[decision-office-charter]] and addressed to the founder, and it
frees its slot under the 7-item cap either way.

This is the mechanical counter to `0007-org-structure.md:74-76` — *"under deadline,
findings can be acknowledged and deferred indefinitely"* — and it works by removing the
option to defer *silently*. The founder may still answer *"we accept this risk"*; that is a
legitimate resolution and a written one, which is the entire difference.

**Watch the median, not the tail.** `rt.open_finding_age_days` crossing **14 days** is the
warning; 30 days is the conversion. By the time findings are hitting 30, the behaviour is
established.

Precedent, already on disk before this loop exists: OD-20 is marked 🔴 *"Founder call —
urgent"*, its fix exists as PR **#31** (`fix/analytics-endpoint-auth`), and that PR is
**open and unmerged** with `main` still carrying the unguarded controller. Baseline for
this loop is therefore not zero — it is **one known instance of exactly the failure it
exists to prevent**.

---

## Loops Red Team deliberately does not own

| Loop | Owner | Why not us |
|---|---|---|
| Close-time tracking across the org | [[decision-office-charter]] | They keep the books; we are one of the units being timed. A unit that grades its own responsiveness is not being graded |
| Endpoint-guard assertion, §12C checklist, injection-corpus detection rate | [[security-charter]] | Systems, not reasoning ([[red-team-directive]] R1) |
| L0–L6 layer-violation detection | [[architecture-review-charter]] | A layer violation is a build defect |
| Any loop that changes code | The line | Findings-only. Nothing here has a `changes:` entry pointing at an implementation — every `changes:` above points at a **document, a register, or a queue**, which is the honest description of this function's reach |

## Baselines, all of them zero

| Metric | Today | Source |
|---|---|---|
| `rt.finding_return_hours` | **unmeasurable** — no findings, no `questions.md` anywhere | Corpus grep |
| `rt.locked_decision_challenge_rate` | **0 of 7** ADRs | `.planning/decisions/` |
| `rt.reaffirmation_rate` | **n/a** — 0 attacks | — |
| `rt.finding_actionability` | **n/a** — 0 findings | — |
| `rt.open_finding_age_days` | **n/a** for us; **1 known instance** of the failure mode (OD-20 / PR #31) | `gh pr view 31` |
| `rt.undeclared_decision_count` | **≥9 known**, never swept | `OD-C1`–`OD-C8`; `compliance-privacy-agenda-board.md:57` |
| `rt.self_selected_target_share` | **0%** — 82 referrals inbound, 0 targets selected | Corpus grep, 67 units |
