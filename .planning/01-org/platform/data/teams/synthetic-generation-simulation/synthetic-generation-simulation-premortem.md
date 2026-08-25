---
type: premortem
division: platform
department: data
team: synthetic-generation-simulation
status: provisional
metrics: [synthetic.backtest_fidelity_gap, synthetic.degrade_profile_coverage, synthetic.namespace_leak_count, synthetic.archetype_representativeness]
updated: 2026-08-24
links: ["[[synthetic-generation-simulation-charter]]", "[[synthetic-generation-simulation-loops]]", "[[synthetic-generation-simulation-directive]]", "[[data-premortem]]", "[[annotation-ground-truth-charter]]", "[[pos-operational-telemetry-ingest-charter]]", "[[state-integrity-invariants-charter]]", "[[red-team-charter]]", "[[technology]]"]
---

# Synthetic Generation & Simulation — Premortem

> Written at founding, before success is assumed.

The team doc gives one line (`technology.md:650-653`): *`degrade.py` models the noise we
imagined (blur, skew, compression) rather than the noise restaurants actually produce (a
photo of a laminated menu under a heat lamp, half-covered by a thumb); scanners score 95% on
synthetic and 60% in the field.*

That is M1 and it is the canonical failure of this discipline. Four more follow.

---

## M1 — `degrade.py` modelled imagined noise, and the field gap opened underneath a green dashboard

Synthetic degradation is written by someone who is imagining what a bad scan looks like.
The imagination reaches for the transformations that are easy to implement and easy to
picture: blur, rotation, JPEG artefacts, contrast, noise. Real restaurant documents fail in
ways nobody implements because nobody pictures them — a laminated menu photographed under a
heat lamp so half the page is a specular blowout; a thumb over the vintage column; a
70-degree perspective from someone standing at the pass; a fold that removes an entire price;
a phone in night mode turning a wine list into an impressionist painting.

The scanner scores 95% on synthetic documents and 60% in the field. And because the synthetic
set is unlimited, it is the set used in CI, so the 95% is the number the team sees every day.

**Earliest observable signal.** `synthetic.backtest_fidelity_gap` non-trivial at its **first
measurement** — this is why taking a baseline is the first item on this team's agenda rather
than the fifth. Cheaper leading indicator: `synthetic.degrade_profile_coverage` computed
against *real* degraded documents from `datasets/annotation_inbox/`, which will show missing
failure classes before any model is trained.

**Counter-pressure.** **Degrade profiles are derived from real documents, not invented.**
Every real document that arrives through annotation intake is classified for its failure
mode, and the profile catalogue is the histogram of what actually arrives — imagination is
allowed to add profiles but never to *define* the set. The fidelity loop
([[synthetic-generation-simulation-loops]] loop 1) closes monthly against the real gold set,
and a widening gap re-weights the degrade mix rather than being logged as a caveat.

---

## M2 — The sim namespace leaked, and fabricated rows landed in a real account

Decision C31 requires sim restaurants to carry a `sim-` slug prefix, and the guard is real
enough to be cited in production code (`agents/drift_agent.py:4-6`). But this team's whole
job is to write large volumes of realistic-looking data into the same database shape the
product uses, and `scripts/synth/write_set.py` and `teardown.py` exist because those writes
are real writes.

The leak arrives through a seam, not through the guard: a query that forgets the prefix
filter, a teardown that half-completes and leaves orphans, a support engineer copying a sim
restaurant as a template for a real one, a migration that backfills across the whole table.
Now a customer's inventory contains bottles that were never delivered, and — worse — the
analytics baselines were fitted over them.

**Earliest observable signal.** `synthetic.namespace_leak_count` non-zero, **any value**.
Concretely: any row whose lineage traces to a sim write set but whose tenant slug lacks the
prefix, or any orphan surviving a `teardown.py` run. Also: sim volume appearing in any
fleet-level number that was supposed to be about customers.

**Counter-pressure.** The guard must be **enforced at write time and asserted after
teardown**, not merely honoured by convention in agent code. Every sim write set is
reconcilable — `write_set.py` records what it created and `teardown.py` must assert the
count returns to zero, with the residue published, not discarded. Cross-check belongs to a
different unit: [[state-integrity-invariants-charter]] runs the leak assertion, because this
team auditing its own namespace is the same author≠auditor failure the department is
organized around. Every fleet metric filters `sim-` explicitly rather than by assumption.

---

## M3 — Synthetic data became the eval set, because it was free and unlimited

Gold examples are expensive and slow ([[annotation-ground-truth-premortem]] M1). Synthetic
examples are free, instant and come with perfect labels. Every individual decision to use
more of them is rational: you need 500 more invoices for a regression suite this afternoon,
and one of your two options exists.

Over a year, the evaluation sets become predominantly synthetic. "Accuracy" now measures how
well the scanner reads documents produced by `scripts/docgen/compose.py`. This is M1 wearing
different clothes — the gap is no longer detectable, because the thing that would detect it
has itself been replaced by synthetic data.

**Earliest observable signal.** Synthetic share of any real-accuracy evaluation set crossing
the cap. **The cap must be a number that exists before the pressure arrives** — after, every
individual increase is defensible and the aggregate is never voted on.

**Counter-pressure.** Synthetic and annotated are different `source_guarantee` values and are
**never summed** ([[data-directive]]). Synthetic is for *volume*: breadth, rare-case coverage,
regression. Human gold is for *calibration*. Both are reported, never pooled. And the
structural point: this team's own primary metric is defined *against the gold set*, so this
team has a direct interest in the gold set staying alive — the incentive is aligned rather
than merely policed.

---

## M4 — The archetypes were a founder's mental model, not a customer distribution

`datasets/sim/archetypes` and `scripts/synth/recipes.py` encode what a restaurant looks
like: bistro, cafe, fine-dining, and so on (`manifest.json`). Those archetypes were written
from experience and intuition — good experience and good intuition — before there were many
real customers to observe.

Everything downstream inherits that shape. Menus, invoices, check patterns, velocity curves,
persona preferences. The product gets tuned to serve a synthetic distribution that is a
plausible, coherent, self-consistent picture of a restaurant market that is not the one it
sells into. Nothing ever contradicts it, because the simulator agrees with itself.

**Earliest observable signal.** `synthetic.archetype_representativeness` unmeasured after the
first real customers exist — the *absence* of the comparison is the signal, since the
comparison becomes possible the moment there are real menus and real check data to compare
against. Second signal: a real customer whose menu size, price distribution or category mix
falls outside the range any archetype generates.

**Counter-pressure.** Archetypes are **re-fitted from real data as it arrives**, on a stated
cadence, and the distance between synthetic and real mix is published. Every real customer
that falls outside the generated range is a finding that mints or amends an archetype, not an
outlier to note. `manifest.json` is already versioned and sha256-pinned — that machinery
makes archetype revisions auditable, which is exactly what re-fitting needs.

---

## M5 — The answer key drifted to match the model

`scripts/docgen/truth.py` is the answer key. When a scanner disagrees with it, one of two
things is wrong, and exactly one of them is cheap to fix. A batch fails; investigation shows
the truth generator emits a field in a slightly different normalisation than the parser
expects; the truth generator is adjusted. Correct, that time.

The habit forms. Over a year, `truth.py` accumulates small accommodations toward what the
current parser does. The answer key is now a description of the model. Backtest fidelity is
excellent and means nothing, because both sides of the comparison have been converging.

**Earliest observable signal.** Any commit to `truth.py` whose motivation is a *failing model
comparison* rather than a *generator change*. This is detectable in the commit message and
nowhere else, which is why the directive requires the motivation to be stated.

**Counter-pressure.** `truth.py` changes require a stated cause from a fixed list —
*generator changed*, *real-world convention changed*, *bug in truth emission* — and
**"model disagreed" is not on the list** ([[synthetic-generation-simulation-directive]]).
A disagreement between truth and model is investigated against the *annotated* gold set,
which is the tiebreaker neither side controls. [[red-team-charter]] attacks this specific
decision, since answer-key drift is a decision failure rather than a code defect.

---

## Cross-cutting

- **M1 and M4 are the same disease in different organs**: the simulator agrees with itself.
  Every counter-pressure here is a forced comparison against something the team does not
  control — the annotated gold set, real intake documents, real customer menus.
- **M2 is the only mechanism with an external victim.** The others waste effort; that one
  puts fabricated rows in a customer's account. It gets an external auditor for that reason.
- **60-day rule** ([[README]] §3.3): un-revisited, this document is fiction.
