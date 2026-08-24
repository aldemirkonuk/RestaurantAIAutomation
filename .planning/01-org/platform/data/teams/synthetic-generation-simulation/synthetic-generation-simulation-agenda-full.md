---
type: agenda-full
division: platform
department: data
team: synthetic-generation-simulation
status: provisional
metrics: [synthetic.backtest_fidelity_gap, synthetic.degrade_profile_coverage, synthetic.namespace_leak_count, synthetic.archetype_representativeness]
updated: 2026-08-24
links: ["[[synthetic-generation-simulation-charter]]", "[[synthetic-generation-simulation-premortem]]", "[[synthetic-generation-simulation-agenda-board]]", "[[synthetic-generation-simulation-loops]]", "[[synthetic-generation-simulation-directive]]", "[[synthetic-generation-simulation-schedule]]", "[[data-agenda-full]]", "[[annotation-ground-truth-charter]]", "[[state-integrity-invariants-charter]]"]
---

# Synthetic Generation & Simulation — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. The generators are built
> and run; the *measurement of whether they resemble reality* does not exist yet.

## What

Produce data that is true by construction — restaurants, invoices, menus, personas,
simulated POS traffic — **and prove, on a cadence, that it resembles the world**.

The build is unusually complete: 27 modules across `scripts/{synth,docgen,simulate}/`, a
versioned sha256-pinned sim pack, 11 SimPOS routes, a namespace guard cited in production
code. What is missing is one number: **the fidelity gap**. `scripts/docgen/backtest.py`
exists and no baseline has been published.

Until that number exists, this team's output is unfalsifiable. That is the agenda.

## How

**The answer key comes first.** `scripts/docgen/truth.py` is written before the document is
composed. That ordering is the team's entire truth guarantee and it is protected by a rule:
truth may not be edited because a model disagreed
([[synthetic-generation-simulation-directive]]).

**Compare against things we do not control.** Every counter-pressure in
[[synthetic-generation-simulation-premortem]] has the same shape — force a comparison
against the annotated gold set, against real intake documents, against real customer menus.
A simulator left alone will always agree with itself.

**Degrade from observation, not imagination.** Real documents arrive through
`datasets/annotation_inbox/` every week. Their failure modes are the catalogue; `degrade.py`
implements the histogram rather than a brainstorm.

**Keep the namespace absolutely clean.** Decision C31 (`sim-` prefix,
`agents/drift_agent.py:4-6`) is the one boundary here with an external victim. It gets
write-time enforcement, post-teardown assertion, and an **external** auditor
([[state-integrity-invariants-charter]]).

**Volume, not calibration.** Synthetic data earns its place on breadth and rare-case
coverage. Calibration belongs to [[annotation-ground-truth-charter]], and this team's own
primary metric is defined against their gold set — so this team's interests are aligned with
keeping that oracle alive rather than replacing it.

## Why now

- **No fidelity baseline exists.** Every additional month of synthetic-backed confidence is
  a month of unmeasured risk, and the measurement is one script run away.
- **The scanners are being trained now** (`training/train_{invoice,label,menu}_scanner.py`,
  Research & Math). Whatever the synthetic/real gap is, it is being baked into models today.
- **`manifest.json` was last updated 2026-07-27** at `pack_version 1.0.0`. The pack is
  versioned and pinned — good hygiene, and it also means a re-fit is a clean, auditable
  operation whenever archetypes need to change.
- **Real customers are arriving.** Archetype representativeness (M4) is measurable the moment
  there are real menus to measure against, and unmeasurable in retrospect once the product
  has been tuned to the synthetic distribution.

## Next steps

| # | Move | Blocks | Notes |
|---|---|---|---|
| 1 | **Publish a fidelity baseline** — run `backtest.py` against the real gold set, record the gap | M1, M3 | One run. Everything else on this page is downstream of this number existing |
| 2 | Build the degrade-profile catalogue from real `annotation_inbox` documents | M1 | Classify what actually arrives; the histogram is the spec |
| 3 | Post-teardown leak assertion, owned by [[state-integrity-invariants-charter]] | M2 | External auditor, not self-audit |
| 4 | Filter `sim-` explicitly in every fleet-level metric | M2 | Assumption → assertion |
| 5 | Set the synthetic-share cap for real-accuracy eval sets | M3 | Must exist **before** the pressure arrives |
| 6 | Measure archetype distance against real customer menus | M4 | Possible today; impossible to reconstruct later |
| 7 | Require a stated cause on every `truth.py` change; "model disagreed" not permitted | M5 | Convention enforced in review |
| 8 | Tag synthetic `nf_b.*` persona events with `subject_type` provenance ([[README]] §4.4) | M3 | Before personalization work consumes them |

## Questions for the founder

1. **What is the fidelity gap you would accept?** If synthetic scores 95% and real scores
   85%, is that usable? The number is a policy, and it needs to be set before the first
   measurement, not calibrated to it.
2. **Where did the archetypes come from?** If they are experience-derived — which is
   legitimate and probably good — say so, so [[synthetic-generation-simulation-premortem]] M4
   is a known bias to re-fit rather than an assumed ground truth.
3. **Is SimPOS a test fixture or a product surface?** It has 11 routes and a schema
   migration. If a customer or a demo can ever reach it, the namespace guard is a security
   boundary and should be reviewed as one.
4. **Synthetic personas and NF-B.** Are we willing to tune personalization on invented
   preference distributions before real guest signal exists? Useful, and it manufactures
   confidence in exactly the way this team is most prone to.
