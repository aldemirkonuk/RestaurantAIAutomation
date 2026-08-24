---
type: loops
division: corporate
department: legal
status: provisional
metrics: [legal.instrument_chain_integrity, legal.request_to_executable_draft_days, legal.clause_library_hit_rate, legal.counsel_gate_compliance, legal.annex_satisfiability_signoff]
updated: 2026-08-24
links: ["[[legal-charter]]", "[[legal-premortem]]", "[[legal-directive]]", "[[legal-schedule]]", "[[instruments-equity-loops]]", "[[commercial-workforce-agreements-loops]]", "[[regulatory-posture-loops]]", "[[positioning-fundraise-readiness-loops]]", "[[decision-office-charter]]", "[[LOOP-MAP]]"]
---

# Legal — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Legal's honest problem is that a department with **zero instruments has no natural
cadence**. Weekly loops over an empty register are theatre, and the 60-day staleness rule
would correctly mark them fiction. So the close-times below are deliberately mixed:
two loops are **event-closed** (they fire per instrument and are silent otherwise), and
the periodic ones are set at the slowest cadence that still catches their failure.
A quarter with nothing to report is a valid, recorded outcome for the periodic loops —
they are allowed to be boring, and "no instruments this quarter" is a real reading.

---

## L-LEG-1 — Chain integrity, per instrument

```yaml
type: loop
id: leg-chain-integrity
owner: legal
measures: [legal.instrument_chain_integrity, legal.counsel_gate_compliance]
changes: [legal.instrument_register, legal.execution_gate]
inputs_from: [instruments-equity, commercial-workforce-agreements]
outputs_to: [positioning-fundraise-readiness, decision-office]
close_time: per_instrument
status: proposed
```

Fires on every execution and closes before the instrument is marked `executed`. Asserts
the three-part chain: **signed original + authorising consent or stated founder terms +
the downstream record it ties out to** (cap table, roster, vendor file). A missing leg
does not produce a warning — it holds the state transition. Baseline **0 of 0**; only
100% passes (`corporate.md:80-83`).

Event-closed rather than periodic on purpose: a monthly chain review discovers the break
up to a month after the signature, which is up to a month after it stopped being fixable.

---

## L-LEG-2 — Annex satisfiability, per data instrument

```yaml
type: loop
id: leg-annex-satisfiability
owner: legal
measures: [legal.annex_satisfiability_signoff, compliance.obligation_coverage, privacy.erasure_completeness]
changes: [legal.execution_gate, compliance.obligation_register, engineering.erasure_path]
inputs_from: [commercial-workforce-agreements, regulatory-posture, privacy-engineering]
outputs_to: [regulatory-posture, decision-office, red-team]
close_time: per_instrument
status: proposed
```

The two-signature rule made mechanical (`corporate.md:99-103`). Every DPA and BAA stops at
`in counsel review` until [[regulatory-posture-charter]] signs that each Annex commitment
maps to implemented, tested behaviour and [[privacy-engineering-charter]] names the test.
Counters [[legal-premortem]] M4.

It re-fires **on the other side too**: if a code change later breaks a behaviour an
executed Annex depends on, this loop reopens against the executed instrument. That
direction is the one everyone forgets, and it is the one that turns a signed promise into
a live breach. Erasure is graded untested end-to-end today (`corporate.md:31`, `:471`), so
the first firing of this loop will fail — which is the correct and useful outcome.

---

## L-LEG-3 — Clause-library health

```yaml
type: loop
id: leg-clause-library-health
owner: legal
measures: [legal.clause_library_hit_rate, legal.fresh_write_count, legal.request_to_executable_draft_days]
changes: [legal.clause_library, legal.fallback_ladder]
inputs_from: [commercial-workforce-agreements]
outputs_to: [legal, decision-office]
close_time: monthly
status: proposed
```

Counters [[legal-premortem]] M3. Reads the **leading** indicator (hit rate) against the
**lagging** one (turnaround), because hit rate moves first (`corporate.md:107-110`). Two
patterns are alarms, not observations:

- Hit rate falling while turnaround holds → drift is accumulating and has not surfaced yet.
- Turnaround improving while hit rate does **not** → text is being generated rather than
  assembled. That is [[legal-premortem]] M5, visible as a metric pair before it is visible
  as an incident.

Any section written fresh twice becomes a library candidate that month. Monthly rather
than weekly because the underlying volume at v0 is zero and a weekly reading of zero
teaches nothing.

---

## L-LEG-4 — Doneability of assisted drafts

```yaml
type: loop
id: leg-draft-doneability
owner: legal
measures: [nf_a.doneability_verdict, nf_a.task_success_rate, legal.gap_marker_rate, legal.named_reviewer_coverage]
changes: [skills.legal_doc_draft, legal.review_protocol]
inputs_from: [commercial-workforce-agreements, performance-doneability, skills]
outputs_to: [performance-doneability, skills, red-team]
close_time: monthly
status: proposed
```

Legal is the strictest doneability case in the company: *plausible output is the failure,
not the success*. This loop asserts, per assisted draft, that (a) a named human reviewer
is recorded, (b) the skill emitted explicit `[GAP]` markers where the library had no
reviewed clause, and (c) the verdict recorded is "reviewed", never "agent completed".

**A `legal-doc-draft` run with zero `[GAP]` markers is treated as a defect** until proven
otherwise — a library that covers everything on a novel counterparty's paper is far less
likely than a model writing over the holes. Dormant until the skill exists;
`.claude/skills/` is not present in the repo today, so this loop's current reading is
"skill does not exist" rather than a number.

---

## L-LEG-5 — Does this department still need two teams?

```yaml
type: loop
id: leg-team-shape-review
owner: legal
measures: [legal.instruments_issued_count, legal.agreements_executed_count, legal.agenda_content_diff_days]
changes: [legal.team_structure, legal.charter]
inputs_from: [instruments-equity, commercial-workforce-agreements]
outputs_to: [decision-office, red-team]
close_time: quarterly
status: proposed
```

The **merge** loop, and the reason it exists is that this org names split triggers
everywhere (`corporate.md:126`, `:398`, `:457`) and merge triggers nowhere — so structures
only ratchet up. Legal was flagged as the trim candidate (`corporate.md:116-121`), so it is
the right department to carry the reverse rule.

**Merge condition, decided now rather than argued later:** at the **second** quarterly
review, if [[instruments-equity-charter]] has issued **zero** instruments *and*
[[commercial-workforce-agreements-charter]] has executed **fewer than five** agreements,
Legal runs as one team and [[legal-charter]] is rewritten to say so. The loop also reads
`legal.agenda_content_diff_days` — a date-bumped agenda with no content change is counted
as untouched, because that is [[legal-premortem]] M1's disguise.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-LEG-1 chain integrity | per instrument | Broken chains found at diligence instead of at signature |
| L-LEG-2 annex satisfiability | per instrument (both directions) | M4 — promising what the code cannot do |
| L-LEG-3 clause-library health | monthly | M3 — redline drift; early warning for M5 |
| L-LEG-4 assisted-draft doneability | monthly (dormant until the skill exists) | M5 — plausible draft, no named reviewer |
| L-LEG-5 team-shape review | quarterly | M1 — the trim that was right and went unnoticed |

Team-level loops live in [[instruments-equity-loops]] and
[[commercial-workforce-agreements-loops]]. The five here exist because they **cross** the
two teams or cross out of the department entirely — L-LEG-2 is a Compliance loop as much
as a Legal one, and L-LEG-4 belongs half to [[performance-doneability-charter]].
