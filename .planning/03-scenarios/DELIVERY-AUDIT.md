---
type: review
title: Scenario Delivery Audit
status: measured 2026-09-01 — four independent audits over all 17 scenarios; grades are point-in-time
updated: 2026-09-01
links: ["[[SCENARIO-MAP]]", "[[SCENARIO-CONTRACT]]", "[[backtests-charter]]", "[[0048-domain-quant-under-research-math]]", "[[0020-no-fabricated-answers]]", "[[v3.0-TECH-DEBT]]"]
---

# Scenario delivery audit — does the backend actually do this?

> The founder asked, plainly: **is the build complete, is the backend superior, does it
> handle real life?** [[SCENARIO-MAP]] already defined the yardstick — 17 rituals walked
> end to end — so this measures the code against them rather than against an impression.
>
> Four independent audits, one per slice, each required to grade
> **DELIVERED / PARTIAL / STUB / ABSENT** with `file:line` evidence and to hunt one
> named defect pattern. Two of them queried production read-only. Three of my own
> briefing claims were **wrong and were corrected by the auditors** — those corrections
> are kept below, because a brief that cannot be contradicted is not an audit.
>
> *Retire-to-write (CLAUDE.md §4): this absorbs four session audit files that exist
> nowhere else; this is their only durable form. It supersedes no document, but it
> **corrects** specific §3/§9/§10 claims in S04, S06, S09, S13, S15 and S17, each
> named in §4 below — those scenario docs are wrong on the points listed and should be
> amended to match.*

## 1. The one-line answer

**The mathematics is superior. The wiring is not, and the surfaces overstate what is
behind them.** Of 17 scenarios: **1 delivered, ~10 partial, 5 absent-by-design, 1
exemplary.** Almost none of the buy-side has ever executed on real data even once.

This is not a bad codebase. It is a codebase whose *pure functions* were built with
unusual rigour and whose *seams* were never closed — and, more seriously, whose failure
modes are systematically invisible.

## 2. Grades

| Slice | Result |
|---|---|
| **Buy-side spine** (S02 · S03 · S04 · S09 · S14) | **5 PARTIAL, 0 DELIVERED** |
| **Inventory & identity** (S06 · S08 · S10 · S11 · S17) | **1 effectively delivered (S17), 4 PARTIAL** — two break at the *first* product hop |
| **Guest & floor** (S01 · S05 · S07 · S12 · S16) | **5 ABSENT — deliberately.** `PROJECT.md:16,38` and `ROADMAP.md:62-69` both put guests and Floor Checker in P4/held (OD-05, OD-07). A deferral, not a gap |
| **Vendor & digest** (S13 · S15) | **2 PARTIAL** |

**Only 1 of the 17 scenarios' §9 simulation gates actually executes** — S17's.

## 3. What is genuinely superior — say this first, it is true

- **S17 identity is the best artifact in the repo, and it was re-run to confirm:**
  732,874 known-distinct pairs, 12 positives, **0 false merges**; fuzzy@0.85 commits
  212 by comparison. Gated in CI. `check_beverage_identity_parity.py` additionally
  proves the SQL `beverage_identity_key()` is byte-identical to the Python rule.
- **The pure engines are correct.** Invoice matching, credit ledger, `resolveSaleVolume`,
  both stock RPCs (idempotent even under concurrency — the auditor could not construct a
  double-deplete), King safety stock, Wilson EOQ, newsvendor, ridge, cost-basis,
  pricing-agility (which handles endogeneity properly).
- **The falsification culture is real** and is the thing worth protecting: ground truth
  taken free from a fact about the world, error types never summed, rejected alternatives
  scored in the same run, guards that fail closed.

## 4. Where the documents are wrong

These are not gaps; they are the corpus asserting things that are untrue. Each needs its
scenario doc amended.

| Claim | Reality |
|---|---|
| S09 §3/§10: `event_dead_letters` is "wired", sold as Core | **It has no writer.** `dlq.process_pending` drains every 60s; nothing ever fills it. 0 rows |
| S04 §5/§10: `pos_unresolved_lines` is "surfaced" | **No reader anywhere**, including `apps/web`. 39 rows sitting in it |
| S06 §9 / S17 §9: `reimport_roundtrip.py` is a shipped harness | **Does not exist in the repo** |
| ADR-0011 comments: "the 92 production mappings" | **`pos_item_mappings` is empty.** They were deleted; the comments were never updated |
| `advanced-analytics.service.ts:306`: "leadTimeStdev param on /inventory-science" | **That param does not exist** — the controller accepts two |
| Insight surfaces: "573 of 573 reachable", "375 types" | Presence, not sufficiency — see §5 |

## 5. The two measurement lies

**a) 67.4% reachability is a presence test.** `insight-generator.service.ts:334-340` sets
availability with `if (bundle.checks.length) availability.add("checks")` — **one row flips
a whole data source to "available"**. The single tenant scores **386/573 = 67.4%** off 66
simulator checks and *zero* consumption rows. That 67.4% is the number circulating as the
POS-bridge win. It measures that a table is non-empty, not that anything can be computed.
~~Related: `requires goals` = **0 of 573**, so the goals dimension is a mirage in code.~~
**CORRECTED 2026-09-01 by executing it: `requires goals` is 22, not 0.** S15 §3's
"22 goal-pace types" was right and this audit's auditor was wrong. The correction came
from `insight-catalog.reach.spec.ts`, which is the first thing that ever ran these
numbers rather than reading them — and it falsified a claim in the document that
commissioned it, on its first run. The goals mirage may still be real, but it is not
this: 22 types do declare the requirement, so the mirage would have to live in how
`availability` is populated, not in the catalogue.

**b) A guard that passes vacuously.** `eval_guest_merge_policies.py` is well-built and
CI-wired, but all six checks are `count(*)` over empty tables — it **passes because there
is nothing to test**, and it guards `superseded_by`, an operation no code performs. This
repo's own rule is that a guard which cannot check must exit 2, never 0.

> **Worked example — this failure caught the author of this document, four hours after
> writing the paragraph above.** It is recorded here rather than as a footnote because a
> demonstration is a better argument than a principle.
>
> To land two PRs I wrote a merge loop that waited until `gh pr checks` reported **no
> pending checks**, then read the required `CI Complete` result and merged. It failed
> nine times, and I twice diagnosed it wrongly as branch contention before actually
> reading the error. The real cause: on a **freshly pushed head SHA the check-runs do not
> exist yet**, so "zero pending" is satisfied *vacuously* — the loop was reading the
> required check's **absence as success**, then merging against a commit CI had not
> finished. Identical shape to the guard above: `count(*)` over an empty set returns a
> passing number.
>
> A second session independently reported the **same latent bug** in its own pollers,
> which happened to return correct answers because the runs were genuinely complete —
> right answers by luck, not by construction. Two sessions, one defect, one of them paid.
>
> The correct form in both cases is the same and is worth stating as a rule: **assert
> that the thing you are checking EXISTS before you interpret its result.** Wait for the
> named check to be present *and* report success on the actual head SHA; count the rows
> you compared and exit 2 when that count is zero. Absence is not a pass.

## 6. The systemic defect: failure is invisible

Four independent auditors hunting the same pattern found **~29 live instances**. The
pattern: a query fails → the error is discarded → `[]` or `null` is returned → the feature
reads as *"nothing to report"* forever.

**The ~29 was a triaged subset, not the population.** A mechanical sweep of `apps/`,
`services/` and `packages/` (995 first-party `.ts`/`.tsx` files, tests excluded) at
`origin/main` 1f4717cc measured the real denominator:

| | Silent reads (`data` bound, `error` discarded) | Files |
|---|---|---|
| At 1f4717cc, before this work | **215** | 47 |
| Fixed on `fix/swallowed-read-errors-and-guard` | 8 | 5 |
| **Remaining, baselined and non-growing** | **193 of 215** | 43 |

> **193 as of 2026-09-04** (`check_read_errors_not_swallowed.py`: 1039 files
> scanned, 193 sites, 193 baselined, 0 allowlisted). ADR 0104 slice 2 removed one
> — `documents.controller.ts`'s `vendor-attachments::signed`, whose `catch {}`
> made "no file was stored" and "the file exists and could not be signed" the
> same answer; the shared `signOriginal` now returns the reason with the null.
> The baseline row was removed rather than lowered, per the shrink-only rule.

> Was 207 across 44 files at adoption. Concurrent sessions fixed 4 of them
> (`scheduled-tasks`/`procurement_orders`, `procurement`/`calendar_events` ×2,
> `recurring-orders`/`calendar_events`) while this branch waited to merge, and
> the guard **failed the build** until the baseline was lowered to match — the
> ratchet working in the good direction. In the same run it caught **2 new**
> swallowed reads that had just landed on `main`
> (`scheduled-tasks.service.ts:434`, `receiving.service.ts:312`); both were
> fixed rather than baselined, per the rule that the baseline only shrinks.
>
> Merging `origin/main` into this branch (PR #246, 2026-09-02) moved the count
> again in both directions: main's #241 rewrote all 7 `scheduled-tasks.service.ts`
> reads through `readRows()`/`interpretRead()`, retiring 6 baseline rows on that
> file (`calendar_events`, `custom_reminders`, `notification_preferences`,
> `procurement_orders` ×2, `providers`) — the ratchet's good direction, caught by
> the ratchet failing the build until removed. The same merge brought in main's
> `procurement.service.ts:902` (`procurement_order_items`, PR #240) and
> `SeatingDensityPanel.tsx:121` (a non-supabase `apiClient.get` swallowed-error
> site, `?::body`, matched only because a missing-semicolon statement absorbs
> `Array.from(` two ASI-joined statements down) — pre-existing debt from main
> that predates this branch's baseline capture, not new code from this branch.
> Both added to the baseline rather than fixed, since fixing them was out of
> this PR's scope; the `SeatingDensityPanel.tsx` false trigger is a known
> detector limitation (ASI/missing-semicolon statement boundaries), separate
> from the comment-stripping fix landed in the same PR.

Plus **37** further sites that bind `data`, discard `error`, and immediately refuse on a
falsy value (`if (!x) throw NotFoundException`). Those report a failed read as a *missing
row* — a 404 for a 503. Wrong, but not silent, and deliberately out of scope: see
[ADR 0067](../decisions/0067-a-failed-read-is-never-an-empty-one.md) §Consequences.

> **2026-09-05, measured, not carried over.** `python3
> scripts/check_read_errors_not_swallowed.py` on `feat/mudavym-design-p4` prints
> **193 found / 193 baselined / 0 allowlisted** — the ratchet has moved on from
> the 199 below and this line is the current number. Four sites that landed on
> this branch the same day were FIXED rather than baselined (the baseline only
> shrinks): `procurement.service.ts` own-paper dedup probe,
> `approval-thresholds.service.ts` and `vendor-terms.service.ts` actor-name
> lookups, `vendor-terms.service.ts` `readStatedOne` before-state. In the same
> run the guard failed on a baseline row that no longer described the tree —
> `team.service.ts::users::users` had been fixed from 2 sites to 1 by a
> concurrent session — and the row was lowered to match.

The 199 are recorded in `scripts/read_error_baseline.json` and held by
`scripts/check_read_errors_not_swallowed.py`, a blocking CI job. A site outside the
baseline fails the build, and a baseline row the tree no longer contains **also** fails it
— so the number above can only shrink, and it cannot rot in prose the way the "~29" did.
Re-measure with `python3 scripts/check_read_errors_not_swallowed.py`; the header line
prints found / baselined / allowlisted.

**Worse than silence — these read as good news or as success:**

| Site | What it does | State |
|---|---|---|
| `providers.service.ts:116-130` | The 409 dedup guard discards `error`, and `maybeSingle()` returns `null` for both "no rows" and "query failed" — so it **fails open and inserts the duplicate**. Exactly what S13's §9 gate exists to prevent | **Fixed**, merged |
| `pos-hub.service.ts:1069-1077` | `loadTables` fails → every check gets `table_id: null` **while the ingest reports success** | **Fixed**, merged |
| `pos-hub.service.ts:950-964` | Upserts `wine_consumption_log` **with no error check at all**; the wrapping `try/catch` is inert because supabase-js resolves rather than throws. The entire "we fixed the demand series" claim rests on a write whose failure is invisible | **Fixed**, merged |
| `vendor-catalogue.service.ts:75-95` | On error runs a silently **different** query that drops every filter — returns **wrong** results, not empty ones. Its stated hypothesis (a missing `listing_tier` column) was also false: the column has existed since `20260807001652_vendor_listing_tier.sql` | **Fixed** — 503 |
| `performance.service.ts:134-144` | Failed benchmark → `percentile([])` → **peer median 0**, so every restaurant renders above average | **Fixed** — median/band null, em dash |
| `pos-hub.service.ts:1098-1128` | "Is my connection live?" returns `0 checks, 0 sources` on query failure | **Fixed** — `unavailable: true` |
| `insight-scheduler.service.ts:58-62` | A failed `restaurants` query silently no-ops the **entire weekly digest for every tenant** | **Fixed** — throws |
| `analytics.service.ts` (`loadInventory`, `loadDeliveredOrders`) | The sibling of `advanced-analytics.service.ts`, same directory and same tables, never hardened; its `allSettled` loaders turn both a rejection and an `{ error }` into an empty inventory | **Fixed** — `logQueryFailure` |
| `receiving.service.ts:321-346` | The manager's money-recovery queue reads `totalAtRisk: 0` forever | **Open** — file owned by PRs #226/#228/#229 |

The correct pattern already exists in-repo (`insight-generator.service.ts:305-315`, and
`advanced-analytics.service.ts:150` `logQueryFailure`) — its sibling `analytics.service.ts`
now follows it too.

## 7. Real-life robustness, where it was tested

- **`AutoPilotAgent` is `IS_STUB` and refused at boot** — S02 §7's reorder/par proposals
  depend on it. The sense→act seam is open.
- **Toast → orchestrator 404s on seven call sites** (`toast.service.ts:697,743,793,849,882,909,929`);
  the orchestrator registers no `/api/v1/toast` router. Five sit behind `mockMode`, which
  **defaults true**, and two return **fabricated mock data** on failure.
- **Cross-runtime envelope mismatch is live**: NestJS publishes flat, Python reads
  `message["payload"]` and bails — so **every manual stock override is consumed, acked and
  dropped**.
- **Close-before-open nulls `closed_at`** with no guard and no test — S09 §3 called it
  "not proven safe"; it is unsafe by construction.
- **S10 "degrades honestly" is defeated**: `holtWintersAdditive` does return null under two
  cycles, but `toDailySeries` zero-fills to exactly 120 points, so the caller can never
  produce a short series. A restaurant with three sales in four months gets a full curve
  and a MASE score.
- **Three disagreeing reorder-point implementations ship simultaneously** — the
  `inventory_analytics` view (`ceil(velocity × 10)`), the engine (King), and a third in the
  insight generator. No ADR reconciles them.
- **S11 waste is unrecoverable, not merely unbuilt.** The one live waste path has **zero
  callers**; operators use spot count, which writes `reconciliation` with the free-text
  reason `"Spot count"`. And because FIFO depletion `DELETE`s lots, waste cost for a
  fully-depleted lot is permanently unreconstructable.
- **S08's ground truth is unwritable**: nothing ever writes the `invoice` tier of
  `vendor_price_observations`. The receiving flow holds the real price and never feeds the
  ladder.

## 8. What production actually contains

Two auditors queried it read-only. This is the context for every grade above.

`pos_item_mappings` **0** · `pour_events` **0** · `wine_consumption_log` **0** ·
`inventory_transactions` with `source='pos'` **0** · `procurement_documents` **0** ·
`procurement_receipt_events` **0** · `procurement_credits` **0** · `price_history` **0** ·
`prediction_outcomes` **0** · `procurement_orders` **2** (none delivered) ·
`pos_checks` **66**, one restaurant, 22 days, all `generic_webhook`.

**S02 and S03 have never executed once. S04's stock half has never executed once.** The
break is a single identifiable hop: the mapping table is empty, so every wine line fails
closed into `pos_unresolved_lines` — which nothing reads.

`prediction_outcomes` has no live writer: its only writer lives in `services/self-evolution`,
which has **no Dockerfile and no railway.toml** and is undeployed.

## 9. Corrections to my own brief, kept on purpose

- `covers` / `table_id` / `server_name` are **66 of 66 populated** across 22 days, not
  "0 of 47" — a hand-seeded P3 fixture, not the committed simulator. `covers` also has more
  readers than I claimed, and table-performance → `SeatingDensityPanel` is genuinely
  **DELIVERED**.
- The `yield_factor ≤ 1` constraint is **correct**, not a defect (purchase/trim yield is
  ≤1 by definition; cooking gain is a different quantity with no column).
- **A test I shipped today is blind to a bug I filed today**: `order-schema-drift.spec.ts`
  fixtures use lowercase `"delivered"` while the product writes `"DELIVERED"`
  (`procurement.dto.ts:22`), so the vendor scorecard is structurally zero and my regression
  test passes anyway. The case fork itself is unresolved — normalise the data or match
  case-insensitively — and needs production evidence.

## 10. What this makes buildable now

Per [[0048-domain-quant-under-research-math]] Lane A and [[backtests-charter]], whose
evidence section still reads *"Nothing exists. No harness, no backtest, no replay."*

**Step one, and it needs no database:** an `insight-catalog.reach.spec.ts` asserting S15
§9's exact baselines (38 / 144 / 573). It runs in CI today, moves `bt.scenario_coverage_pct`
off zero, and books the first `bt.claim_falsification_rate` entry from a *run* rather than
an argument.

**Three traps any harness must design around, all verified in source:**
1. The existing "backtest" scores an in-sample fit — `fitted[i]` is pushed *after* the
   state absorbs `series[i]`, and `mase()` uses the same series as actual *and* denominator.
   Answer: physical truncation, plus a **leak probe** — perturb the future, assert the
   fitted prefix is bit-identical.
2. **Regression to the mean.** The architecture flags outliers, acts on outliers, measures
   outliers — so *random* recommendations report a win. `rolloutBucket()` already splits
   users deterministically and `countEvents` has no bucket parameter, so the control arm
   **exists and is discarded**. Answer: difference-in-differences.
3. **Never select on MASE/MAPE** — minimised by the conditional median, which for
   intermittent demand is zero. Use RMSSE and pinball loss at the shipped τ.

**Constraint worth knowing early:** SimPOS **cannot manufacture history** — it stamps
`opened_at`/`closed_at` at wall-clock now, so it yields a live stream, never a backdated
corpus. Any replay needs rows inserted directly.
