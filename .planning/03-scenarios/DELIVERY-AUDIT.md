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

## 6. The systemic defect: failure is invisible

Four independent auditors hunting the same pattern found **~29 live instances**. The
pattern: a query fails → the error is discarded → `[]` or `null` is returned → the feature
reads as *"nothing to report"* forever. Two were fixed today; the population is far larger.

**Worse than silence — these read as good news or as success:**

| Site | What it does |
|---|---|
| `providers.service.ts:116-130` | The 409 dedup guard discards `error`, and `maybeSingle()` returns `null` for both "no rows" and "query failed" — so it **fails open and inserts the duplicate**. Exactly what S13's §9 gate exists to prevent |
| `vendor-catalogue.service.ts:75-95` | On error runs a silently **different** query that drops every filter — returns **wrong** results, not empty ones |
| `performance.service.ts:134-144` | Failed benchmark → `percentile([])` → **peer median 0**, so every restaurant renders above average |
| `pos-hub.service.ts:1069-1077` | `loadTables` fails → every check gets `table_id: null` **while the ingest reports success** |
| `pos-hub.service.ts:950-964` | Upserts `wine_consumption_log` **with no error check at all**; the wrapping `try/catch` is inert because supabase-js resolves rather than throws. The entire "we fixed the demand series" claim rests on a write whose failure is invisible |
| `pos-hub.service.ts:1098-1128` | "Is my connection live?" returns `0 checks, 0 sources` on query failure |
| `receiving.service.ts:321-346` | The manager's money-recovery queue reads `totalAtRisk: 0` forever |
| `insight-scheduler.service.ts:58-62` | A failed `restaurants` query silently no-ops the **entire weekly digest for every tenant** |

The correct pattern already exists in-repo (`insight-generator.service.ts:276-300`, and
`advanced-analytics.service.ts` was hardened with `logQueryFailure`) — while its sibling
`analytics.service.ts`, same directory, same tables, was not.

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
