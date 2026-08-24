---
type: agenda-full
division: platform
department: data
team: substrate-quality-coverage
status: provisional
metrics: [substrate.quarantine_rate, substrate.confidence_threshold_value, substrate.rows_without_source_guarantee, substrate.governance_tier_distribution]
updated: 2026-08-24
links: ["[[substrate-quality-coverage-charter]]", "[[substrate-quality-coverage-premortem]]", "[[substrate-quality-coverage-agenda-board]]", "[[substrate-quality-coverage-loops]]", "[[substrate-quality-coverage-directive]]", "[[substrate-quality-coverage-schedule]]", "[[data-agenda-full]]", "[[decision-office-charter]]", "[[architecture-review-charter]]", "[[corpora-enrichment-charter]]"]
---

# Substrate Quality & Coverage — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. The scoring, tiering and
> quarantine machinery exists; the *governance* around it — who may move a threshold, and
> whether the gate can stop anything — does not.

## What

Measure the substrate, publish its true state, and hold the one invariant the department
cannot survive losing: **every row knows what kind of truth it is**.

Four concrete jobs:

1. **Score and tier** — `governance.py` (`CANONICAL` → `UNRESOLVED`), `field_confidence.py`,
   `quality_scorer.py`.
2. **Quarantine** — under-identified rows do not publish
   (`…20260817030000_under_identified_quarantine.sql`).
3. **The daily substrate report** ([[README]] §6) — including the three-number rule and the
   denominator rule, which are department counter-pressures this team executes.
4. **The provenance audit** — `substrate.rows_without_source_guarantee`, as an absolute count.

## How

**Author ≠ auditor, applied to ourselves.** We measure and do not produce. When quarantine
finds a broken row, the row goes to [[corpora-enrichment-charter]] and the *class* comes back
to us as a rule change ([[substrate-quality-coverage-premortem]] M3).

**The knob is published next to the dial.** `substrate.quarantine_rate` is never shown
without `substrate.confidence_threshold_value`. Falling quarantine on rising volume is
progress; falling quarantine because the bar moved is not, and the two must be
distinguishable at a glance (M1).

**A threshold is a decision.** Owner, close-time, `OPEN-DECISIONS.md` entry. The repo already
contains one perfectly-argued recalibration
(`…20260814000000_data_quality_rescale.sql:1-15`) — the point is not that it was wrong, it is
that the third and fourth ones need a record too.

**The gate is structural or it is nothing.** A quarantined row must be unable to make the
publication state transition, enforced at read. If after two quarters the gate has never
blocked anything, this team's honest recommendation is to merge itself back into the
producers (M2).

**Coverage is always reported by tier.** "900 enriched wines" is not a statement until it says
how many are `CANONICAL`/`AUTO_VALIDATED` versus `PROVISIONAL`/`UNRESOLVED`.

## Why now

- **Enrichment is running today** (`ef19b81`, `8bbcde6`). Rows are being written *now* without
  `source_guarantee`, and every one of them is a row that will have to be back-filled or
  distrusted later.
- **The rescale precedent is set** (`…20260814000000_data_quality_rescale.sql`). The
  governance rule needs to exist before the milestone-driven third instance, not after.
- **The Layer-1 definition is wine-shaped** (`governance.py:29-39`) and the mandate covers four
  corpora. The first non-wine row to hit `assign_governance_tier` is a design event, and it is
  cheaper to anticipate than to discover.
- **The department's only unsurvivable failure is provenance collapse** ([[data-premortem]]
  M2), and this team holds that invariant.

## Next steps

| # | Move | Blocks | Notes |
|---|---|---|---|
| 1 | Add `source_guarantee` to the intake contract; publish the absolute count of rows lacking it | [[data-premortem]] M2 | Highest value item in the department, not just this team |
| 2 | Write the threshold-change protocol: decision, owner, close-time, `OPEN-DECISIONS.md` | M1 | Must exist **before** the first milestone squeeze |
| 3 | Publish rate and threshold value as one line, permanently | M1 | Reporting change; costs a day |
| 4 | Make the gate structural — quarantined rows cannot make the publish transition at read | M2 | The difference between a gate and a dashboard |
| 5 | Report coverage and quarantine **by governance tier and by category** | M2, M4 | An ungated category shows up as a suspiciously clean one |
| 6 | Bright-line the repair boundary; audit `wine_repair_log` for this team's own name | M3 | Self-check, published |
| 7 | Write the category dimension for identification before any non-wine row is tiered | M4 | `governance.py:29-39` is wine's field set and should say so |
| 8 | Ask [[architecture-review-charter]] to check for private corpora above L0 | M5 | We structurally cannot see this from inside |

## Questions for the founder

1. **Can this team's quarantine actually stop a publish?** If the answer is no, the honest
   move is to merge it into the producers and give the audit role to an advisory function.
   This is the question the charter's reservation turns on, and it should be answered
   deliberately rather than discovered in month six.
2. **Who may move a threshold?** Proposal: this team measures and proposes, the department
   decides, [[decision-office-charter]] records. Never the producing team; never this team
   alone.
3. **What quarantine rate is acceptable** at the current stage? Zero is wrong — a zero
   quarantine rate means the gate is not gating.
4. **Do we publish tier-3/4 rows to customers with a confidence label, or withhold them?**
   Both are defensible; the current default — publishing without a label — is the one option
   nobody chose.
5. **Non-wine categories.** When beer, spirits or dishes arrive, who writes their
   identification definition? Doing it in the moment, under delivery pressure, is
   [[substrate-quality-coverage-premortem]] M4.
