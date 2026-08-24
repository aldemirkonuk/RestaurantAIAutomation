---
type: loops
division: corporate
department: legal
team: commercial-workforce-agreements
status: provisional
metrics: [legal.clause_library_hit_rate, legal.request_to_executable_draft_days, legal.annex_satisfiability_signoff, legal.named_reviewer_coverage, nf_a.doneability_verdict]
updated: 2026-08-24
links: ["[[commercial-workforce-agreements-charter]]", "[[commercial-workforce-agreements-premortem]]", "[[commercial-workforce-agreements-directive]]", "[[commercial-workforce-agreements-schedule]]", "[[legal-loops]]", "[[regulatory-posture-loops]]", "[[privacy-engineering-charter]]", "[[performance-doneability-charter]]", "[[decision-office-charter]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_count: 5
loop_count: 5
loop_ids: ["cw-library-health", "cw-annex-satisfiability", "cw-redline-ladder", "cw-draft-doneability", "cw-turnaround-ageing"]
loop_close_times: ["monthly", "per_instrument", "per_agreement", "monthly", "weekly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Commercial & Workforce Agreements — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

This team's failures are **drift** failures — twenty reasonable decisions summing to an
unreasonable position. Drift has no event to fire on, so unlike its sibling this team's
loops are mostly **periodic**, and the two event-closed ones exist where the damage is
immediate rather than cumulative.

One shared caveat, stated once: at v0 every reading below is zero or undefined, because no
agreement exists (`corporate.md:104-106`). Zero is an honest reading. What these loops are
actually protecting is the **first twenty** agreements, and they have to exist before the
first one, not after it.

---

## L-CW-1 — Library health: the metric pair

```yaml
type: loop
id: cw-library-health
owner: commercial-workforce-agreements
measures: [legal.clause_library_hit_rate, legal.request_to_executable_draft_days, legal.fresh_write_count, legal.uncited_section_count]
changes: [legal.clause_library, legal.fallback_ladder, skills.legal_doc_draft]
inputs_from: [legal]
outputs_to: [legal, decision-office, red-team]
close_time: monthly
status: proposed
```

Counters [[commercial-workforce-agreements-premortem]] M1, M4 and M5 at once, because all
three are visible in the relationship between two numbers rather than in either one.

The loop reads hit rate (**leading**) against turnaround (**lagging**) and classifies:

| Hit rate | Turnaround | Reading |
|---|---|---|
| Falling | Holding | **M1.** Drift accumulating, not yet surfaced. Act now |
| Flat | Improving | **M4 alarm.** Faster drafts that are not more library-sourced are more *generated*. Escalates as a metric finding, before any incident |
| Rising | Improving | Healthy — the system is working as designed |
| Any | Any, with sections uncited at 6 months | **M5.** Library growing from imagination rather than from executed paper |

Also counts fresh writes: **the second fresh write of the same section escalates**
([[commercial-workforce-agreements-directive]] §Escalation 4). Twice is a pattern at this
volume; waiting for a third is waiting a quarter.

Monthly, because at v0 volume a weekly reading of zero teaches nothing and trains people to
ignore the loop.

---

## L-CW-2 — Annex satisfiability, per data instrument

```yaml
type: loop
id: cw-annex-satisfiability
owner: commercial-workforce-agreements
measures: [legal.annex_satisfiability_signoff, compliance.obligation_coverage, privacy.erasure_completeness]
changes: [legal.execution_gate, compliance.obligation_register, engineering.erasure_path]
inputs_from: [regulatory-posture, privacy-engineering]
outputs_to: [regulatory-posture, privacy-engineering, decision-office, red-team]
close_time: per_instrument
status: proposed
```

The team-side half of [[legal-loops]] L-LEG-2, and the mechanical form of
[[commercial-workforce-agreements-directive]] CW-6. Every DPA and BAA stops at
`in counsel review` until Compliance signs that each Annex commitment maps to implemented,
tested behaviour, with Privacy Engineering naming the test.

**It fires in both directions**, and the reverse direction is the one that gets forgotten:
if a code change later breaks a behaviour an executed Annex depends on, this loop reopens
against the **executed** instrument. Forward-only, it protects the signature; bidirectional,
it protects the promise.

The first firing will fail. Erasure is graded untested end-to-end (`corporate.md:31`,
`:471`), so the gate has no green path today — and knowing that before a DPA arrives is
worth considerably more than discovering it during one.

---

## L-CW-3 — Redline ladder maintenance

```yaml
type: loop
id: cw-redline-ladder
owner: commercial-workforce-agreements
measures: [legal.redlines_outside_ladder, legal.ladder_rung_count, legal.concessions_unlogged]
changes: [legal.fallback_ladder, legal.clause_library]
inputs_from: [legal]
outputs_to: [legal, decision-office]
close_time: per_agreement
status: proposed
```

Event-closed, because a redline is an event and an unrecorded concession is unrecoverable
once the negotiation is over — nobody reconstructs *why* a clause moved three months later.

Per agreement it records: which clause moved, to which rung, and why. A concession inside
the ladder closes the loop immediately. A concession outside it escalates once, the founder
and counsel decide the position, and **the ladder grows by exactly one rung** — which is
then never re-litigated ([[commercial-workforce-agreements-directive]] CW-2).

`legal.concessions_unlogged` should be permanently **0**. It is the only metric in this
team whose non-zero value indicates a process failure rather than a business outcome:
conceding is a legitimate business choice, and failing to write it down is not.

---

## L-CW-4 — Assisted-draft doneability

```yaml
type: loop
id: cw-draft-doneability
owner: commercial-workforce-agreements
measures: [nf_a.doneability_verdict, nf_a.task_success_rate, legal.gap_marker_rate, legal.named_reviewer_coverage]
changes: [skills.legal_doc_draft, legal.review_protocol]
inputs_from: [skills, performance-doneability]
outputs_to: [performance-doneability, skills, red-team]
close_time: monthly
status: proposed
```

The team-side half of [[legal-loops]] L-LEG-4. Per assisted draft it asserts three things:
a **named human reviewer** is recorded (never "AI"), the skill emitted explicit **`[GAP]`
markers** where the library had nothing, and the recorded verdict is *"reviewed"* rather
than *"agent completed"*.

**A run with a `legal.gap_marker_rate` of zero is a defect until proven otherwise.** That
inversion is the loop's whole contribution — everywhere else in the company, an agent
producing complete output is success; here it is the alarm.

Legal is the strictest doneability case in the company, and this loop is the natural hard
test case for [[performance-doneability-charter]]'s NF-A spine, which is currently at
**0% coverage** (`corporate.md:475`). Dormant until the skill exists — `.claude/skills/` is
not present in the repo, so today's reading is "skill does not exist" rather than a number.

---

## L-CW-5 — Turnaround and queue ageing

```yaml
type: loop
id: cw-turnaround-ageing
owner: commercial-workforce-agreements
measures: [legal.request_to_executable_draft_days, legal.round_trips_per_agreement, legal.open_request_age_days]
changes: [legal.queue_order, legal.clause_library]
inputs_from: [legal]
outputs_to: [legal, decision-office]
close_time: weekly
status: proposed
```

The one genuinely weekly loop in the whole department, and it earns that only **once
requests exist** — until then it reports "no open requests" and is honest about it rather
than manufacturing a reading.

It deliberately tracks **round trips per agreement** beside the median, because that pair
is what catches [[commercial-workforce-agreements-premortem]] M2: a median measured at
*sent* can fall while round trips rise, and the team would be celebrating a number while
the counterparty waits longer. Two numbers, never summed.

Ageing is read on **open** requests, not closed ones. A closed-request average hides the
request that has been sitting for five weeks, which is the one anybody outside the team
actually cares about.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-CW-1 library health (metric pair) | monthly | M1 drift, M4 generation, M5 museum |
| L-CW-2 annex satisfiability | per instrument, **both directions** | M3 — promising what the code cannot do |
| L-CW-3 redline ladder maintenance | per agreement | M1 — unrecorded concessions |
| L-CW-4 assisted-draft doneability | monthly (dormant until the skill exists) | M4 — plausible draft, no named reviewer |
| L-CW-5 turnaround and queue ageing | weekly (once requests exist) | M2 — measuring at the wrong point |
