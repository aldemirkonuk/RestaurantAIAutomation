---
type: premortem
division: platform
department: data
team: substrate-quality-coverage
status: provisional
metrics: [substrate.quarantine_rate, substrate.confidence_threshold_value, substrate.rows_without_source_guarantee, substrate.governance_tier_distribution]
updated: 2026-08-24
links: ["[[substrate-quality-coverage-charter]]", "[[substrate-quality-coverage-loops]]", "[[substrate-quality-coverage-directive]]", "[[data-premortem]]", "[[corpora-enrichment-charter]]", "[[annotation-ground-truth-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[architecture-review-charter]]", "[[technology]]"]
---

# Substrate Quality & Coverage — Premortem

> Written at founding, before success is assumed.

The team doc gives one line (`technology.md:705-708`): *confidence thresholds are relaxed to
unblock a coverage milestone — defensibly, once — and the quality dashboard stays green while
the substrate quietly degrades, because the metric and the knob are held by the same hand.*

That is M1, and unusually for a premortem, **the first instance has already happened and was
correct**. Four more mechanisms follow.

---

## M1 — The knob moved, and the dial reported the knob

`…20260814000000_data_quality_rescale.sql:1-15` is the worked example, in this repo, written
honestly by the person who did it: a rule authored against a 195-row library over-fired at
2,443 rows, flagging 104 rows that were *almost all correct data* — Domaine de la
Romanée-Conti genuinely has eight wines under one producer name. The recalibration was right.
It was documented. It should have happened.

The mechanism is what happens on the third and fourth occasions. A coverage milestone is two
weeks out. A confidence cut-off is demonstrably slightly strict on a class of rows that are
*obviously* fine. The precedent exists and is a good one. The threshold moves.
`substrate.quarantine_rate` falls, coverage rises, both charts are green, and the substrate
underneath is worse than it was in month three. Nobody was dishonest at any step.

**Earliest observable signal.** A threshold change, tier-boundary change
(`governance.py:107`) or quarantine-rule change landing **in the same close-time as a
coverage milestone**. The co-occurrence is the signal; the change itself may be entirely
correct — which is exactly why co-occurrence, not correctness, is what gets flagged.

**Counter-pressure.** Threshold values are **decisions, not configuration**: recorded in
`OPEN-DECISIONS.md` with an owner and a close-time, never a silent edit
([[substrate-quality-coverage-directive]] Gate 1). The rate is **always published beside the
threshold value that produced it**, so the two kinds of fall are visually distinguishable.
This team does not set its own bar ([[substrate-quality-coverage-charter]] non-goals), and it
is never measured on whether producers hit their milestones. Backstop:
[[red-team-charter]] attacks threshold-change decisions specifically.

---

## M2 — The gate was advisory, and the team became a dashboard

This is the reservation the charter already carries, arriving as a failure. Quarantine is a
finding. Findings do not block. A producer team ships a coverage milestone that includes
quarantined rows because the alternative is missing the milestone, and the quarantine flag
travels with the row as metadata nobody downstream reads.

Within two quarters this team's entire output is a chart. It is an accurate chart. It changes
nothing. Five teams' worth of upkeep buys one dashboard, and — worse — the *existence* of the
quality team makes everyone else feel the quality problem is handled.

**Earliest observable signal.** The first quarantined row that reaches a product surface, or
the first coverage number published that includes `PROVISIONAL`/`UNRESOLVED` tier rows without
saying so. Also the softer tell: this team's findings appearing in a report but never in
anyone's `questions.md`.

**Counter-pressure.** The gate must be **structural, not social** — publication is a state
transition a quarantined row cannot make, enforced where the row is read rather than where it
is written. Coverage figures are reported **by governance tier**
(`governance.py:20-27`), so "we have 900 enriched wines" cannot be said without also saying
how many are tier 0–1 versus tier 3–4. And the honest escape hatch stays on the table: if
after two quarters the gate has never blocked anything, this team is overhead and merges back
into the producers with the audit role handed to an advisory function
([[substrate-quality-coverage-charter]] §reservation). **Better to disband correctly than to
persist as theatre.**

---

## M3 — The auditor started producing, and audited its own repairs

Quarantine finds under-identified rows. The team that finds them is the team that best
understands why they failed. It is enormously tempting — and locally efficient — to just fix
them: a normalization tweak here, a producer field populated there, a repair batch run because
`wine_repair_log` already exists and the team owns it.

Six months later this team is a producer with an audit function attached, grading rows it
wrote. The department's founding split (`technology.md:32-34`) has quietly closed, and nobody
made the decision to close it.

**Earliest observable signal.** The first `wine_repair_log` entry whose repair was authored by
this team rather than routed to [[corpora-enrichment-charter]]. Also: any commit from this
team touching row *values* rather than row *scores*.

**Counter-pressure.** Bright line, stated in the charter: **we quarantine and log; they
repair.** The repair ledger records who repaired, and this team's name appearing in that
column is itself a finding. The team's contribution to repair is the *class* — the rule,
normalization or prompt change that stops the failure recurring — routed to the producer, not
executed here. The measurement is `substrate.repair_class_closure_rate`: repairs that produced
a rule change rather than a one-off fix.

---

## M4 — Identification was defined once, and the definition stopped matching reality

`governance.py:29-39` defines Layer 1 as name, producer, vintage, country, region, grape
variety, wine type. Sensible, and it is a **wine** definition. The `under_identified` rule
(`…20260817030000_under_identified_quarantine.sql:37`) is sharper still: a row whose
normalized producer equals its normalized name is not identified — an excellent heuristic that
is specifically about wine naming conventions.

Then dishes arrive, or beer, or spirits, or a non-vintage sparkling wine, or a house pour with
no producer at all. The Layer-1 cap (`governance.py:53`) rejects legitimate rows for missing
fields their category does not have, or — worse — passes them because the check simply does not
apply, and unidentified non-wine rows flow through ungated. The quality system silently covers
one category of a four-category mandate.

**Earliest observable signal.** The first non-wine row assessed by `assign_governance_tier`.
That is a single observable event and it is the moment the definition needs a category
dimension. Second signal: quarantine rate by category diverging sharply — a category with a
suspiciously low rate is usually ungated, not clean.

**Counter-pressure.** Quarantine rate and tier distribution are reported **per category**, so
an ungated category shows up as an anomalously good one rather than disappearing into an
aggregate. The Layer-1 field set is explicitly **wine's** field set, and a new category does
not enter the substrate until its own identification definition is written — enforced at
intake, alongside `source_guarantee` ([[substrate-quality-coverage-directive]] Gate 2).

---

## M5 — Nobody above L0 was checked, and consumers routed around the gate

L0 exists to serve L1–L6, and this team's gate is a constraint on what those layers receive.
A constraint that is inconvenient gets routed around: a product feature needs producer data
the gate quarantined, so a service reads the raw table directly; an analytics job needs volume,
so it queries pre-gate; someone caches a snapshot taken before a threshold tightened.

Now there are two substrates — the gated one this team reports on, and the one the product
actually uses. This team's numbers remain entirely accurate about a dataset nobody consumes.

**Earliest observable signal.** Any read of a substrate table that bypasses the published,
gated view. Concretely: a consumer above L0 maintaining its own copy, cache or snapshot of
substrate rows — which is a **layer-dependency violation** and therefore
[[architecture-review-charter]]'s finding to make, not something this team can see from
inside its own metrics.

**Counter-pressure.** **One published read path**, with the gate applied at read, so bypassing
it requires a visible change rather than a default. [[architecture-review-charter]] owns the
L0–L6 dependency rule ([[ORG_STRUCTURE]] §3) and a private corpus above L0 is exactly the
violation it exists to catch — the counter-pressure is deliberately placed *outside* this team,
because a team cannot detect the consumers who quietly stopped using it.

---

## Cross-cutting

- **M1 and M2 are opposites and both are fatal.** M1 is the gate bending; M2 is the gate never
  mattering. The design that prevents one invites the other, and the only thing holding the
  middle is that threshold changes are decisions and the gate is structural.
- **This team's failure mode is uniquely quiet.** The other four teams fail by producing less
  or worse. This one fails by continuing to publish accurate-looking numbers about a substrate
  that is degrading, ungated, or unused. Every mechanism above has that shape.
- **[[decision-office-charter]] owns that threshold decisions actually close.**
  [[red-team-charter]] attacks them. Both backstops sit outside the line, deliberately.
- **60-day rule** ([[README]] §3.3): un-revisited, this document is fiction.
