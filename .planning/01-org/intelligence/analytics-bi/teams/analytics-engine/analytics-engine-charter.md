---
type: charter
division: intelligence
department: analytics-bi
team: analytics-engine
status: exists
metrics: [analytics.satisfiable_candidate_share, analytics.candidate_type_count, analytics.engine_service_test_ratio, nf_b.checks_dependent_candidate_share]
updated: 2026-08-24
links: ["[[analytics-engine-premortem]]", "[[analytics-engine-agenda-full]]", "[[analytics-engine-agenda-board]]", "[[analytics-engine-directive]]", "[[analytics-engine-loops]]", "[[analytics-engine-schedule]]", "[[analytics-bi-charter]]", "[[insight-narrative-generation-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[data-charter]]", "[[intelligence]]"]
---

# Analytics Engine (Decision Science) — Charter

Department: **Analytics & BI** ([[analytics-bi-charter]]) · Division: **Intelligence**.
Siblings: [[insight-narrative-generation-charter]],
[[metric-contract-truth-assurance-charter]].

**The question this team owns: *is the arithmetic right?***

## Mandate

Own the deterministic math — the pure, DB-free functions that turn operational data into
quantities — and their test suites. This team is accountable for a number being *correct*,
independent of whether anyone wants to read it and independent of whether it is called the
same thing on two screens. It also owns the **candidate space**: the enumerated
`DIMENSION × MEASURE × COMPARATOR` cross-product that defines what this product is capable
of computing at all, and the honest measure of how much of that capability is reachable
with the data that actually exists.

## Boundaries

Owns outright:

- **`apps/api-gateway/src/analytics/engine/`** — 12 modules, **3,679 non-spec lines**,
  **131 exported functions**, plus the barrel at `engine/index.ts`.
- **The spec suite** — 10 engine spec files + `insight-catalog.spec.ts`, **1,680 lines**,
  **149 `it()` cases**.
- **`insights/insight-catalog.ts`** (563 lines) — `DIMENSIONS`, `MEASURES` (`:114`),
  `COMPARATORS` (`:242`), the two validity matrices (`DIMENSION_MEASURES` at `:279`,
  `DIMENSION_COMPARATORS` at `:388`), `buildCandidates()`, `INSIGHT_CANDIDATES` (`:547`)
  and `availableCandidates()` (`:557`).
- **The purity constraint.** The engine takes no NestJS and no database
  (`insight-catalog.ts:14-17`, `engine/index.ts:1-18`). Defending that is this team's job;
  it is what makes the candidate space *countable*, which is what makes
  [[metric-contract-truth-assurance-charter]]'s work possible at all.
- **The compute path inside `insight-generator.service.ts`** — step 2 (COMPUTE) and step 3
  (SCORE) of the pipeline documented at `:16-30`. Steps 4 (VERBALIZE) and 5 (RANK) belong
  to [[insight-narrative-generation-charter]].

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Whether the insight is worth surfacing, how it is ranked, what sentence wraps it | [[insight-narrative-generation-charter]] | An engine can be flawlessly correct and still ship a useless insight (`intelligence.md:365-366`) |
| Whether a shipped number matches its published definition | [[metric-contract-truth-assurance-charter]] | We are an *author* of numbers; AB-3 is the only unit whose job is to say ours is wrong |
| Whether the data exists to compute anything | [[data-charter]] *(Platform)* | We publish the reach gap; Data closes it. `availableCandidates()` is the already-implemented handoff point |
| How a chart renders | [[design-charter]] / [[client-surfaces-charter]] | Rejected explicitly as an A&BI scope (`intelligence.md:506`) |
| Grading nondeterministic model output | [[agent-evaluation-gates-charter]] *(RM-2)* | Our pass condition is exact equality; theirs is a judged threshold |

## Metrics it moves

### Primary — `analytics.satisfiable_candidate_share`

Share of `INSIGHT_CANDIDATES` whose `DataRequirement` set is met for a live restaurant.

**Baseline, measured 2026-08-24 by executing `availableCandidates()`:**

| Available requirements | Satisfiable | Share |
|---|---|---|
| `consumption` only | 38 / 573 | **6.6%** |
| `consumption + orders + inventory` (no POS) | 144 / 573 | **25.1%** |
| All seven (`+ checks, tables, venue, goals`) | 573 / 573 | 100% |

This is the honest measure of engine reach and it **names Data as the constraint rather
than hiding it** (`intelligence.md:382-387`). Three quarters of the catalogue is
unreachable today, and no amount of new math changes that.

> **Corrected 2026-08-25.** The constraint has a demonstrated remedy: the POS bridge is
> built and proven — 66 POS checks moved satisfiable types from **8 (1.4%) to 386
> (67.4%)** ([[POS-BRIDGE-AUDIT]] §A.1). The rows above remain correct *as conditionals*
> for a restaurant with no POS feed; they are no longer the ceiling.

### Secondary

- **`analytics.candidate_type_count` — 573 today.** Never published without the share
  above ([[analytics-bi-directive]] rule 2). The full category breakdown, computed
  2026-08-24: tables 174 · efficiency 108 · sales 82 · staff 50 · risk 40 · inventory 34 ·
  forecast 30 · purchasing 27 · goals 22 · basket 6.
- **`analytics.engine_service_test_ratio`** — 149 cases over 3,679 engine lines, **0 spec
  files** over ~5,600 service lines. The tested half is not the half that ships numbers.

### Neural-footprint tie

`nf_b.checks_dependent_candidate_share` — the `checks`- and `tables`-dependent families
are the guest-side half of the space. `insight-catalog.spec.ts:36-44` already asserts the
with-POS space is strictly larger. Measured today: **429 of 573 types (74.9%) declare a
`checks` requirement**, and 241 (42.1%) declare `tables`. That first number is the best
available readout of NF-B substrate arrival, and it belongs on the same board as Data's
ingestion progress — three quarters of this product's analytic capability is gated on one
integration.

## Evidence today

**EXISTS — substantial, and the strongest existing code base in the Intelligence division.**

### The modules, with line counts (verified 2026-08-24)

| Module | Lines | Exported fns | Spec |
|---|---|---|---|
| `finance.ts` | 512 | 32 | `finance.spec.ts` (17 cases) |
| `statistics.ts` | 477 | 31 | `statistics.spec.ts` (16) |
| `vendor-price-consensus.ts` | 454 | 8 | `vendor-price-consensus.spec.ts` (24) |
| `pricing-agility.ts` | 398 | 4 | `pricing-agility.spec.ts` (23) |
| `inventory-science.ts` | 371 | 15 | `inventory-science.spec.ts` (12) |
| `forecasting.ts` | 284 | 9 | `forecasting.spec.ts` (7) |
| `risk.ts` | 260 | 12 | `risk.spec.ts` (10) |
| `cost-basis.ts` | 253 | 5 | `cost-basis.spec.ts` (15) |
| `regression.ts` | 222 | 3 | `regression.spec.ts` (9) |
| `comparisons.ts` | 214 | 5 | `association-comparisons.spec.ts` (8, shared) |
| `association.ts` | 109 | 2 | *(same shared file)* |
| `linalg.ts` | 82 | 5 | covered inside `regression.spec.ts:14` |

`regression.ts:1-20` documents the ridge/OLS design honestly — *"the ML that adjusts the
weights, done honestly: closed-form ridge/OLS regression with standardized coefficients"* —
and names its three uses: venue-feature hedonic weighting, waiter adjusted ratings via
dummy-encoded ridge, and partial correlation. It rests on `linalg.ts` (`:22`).

### The design intent is stated, not inferred

`insight-catalog.ts:1-17` describes the approach in the file itself: SOTA insight engines
*"do not hand-write N insight formulas — they enumerate a cross-product … and let a
validity matrix prune nonsense combinations."* The pruning is real:
`buildCandidates()` (`:503-540`) carries three explicit residual-nonsense guards at
`:519-524` — `basket_affinity` only on `wine`, `goal_pace` only on `overall`,
`attribute_correlation` only on table/zone/venue dimensions.

### The requirement distribution, measured 2026-08-24

| `DataRequirement` | Candidates requiring it | Share of 573 |
|---|---|---|
| `checks` | 429 | **74.9%** |
| `tables` | 241 | 42.1% |
| `consumption` | 127 | 22.2% |
| `inventory` | 78 | 13.6% |
| `orders` | 33 | 5.8% |
| `venue` | 27 | 4.7% |
| `goals` | **0** | **0.0%** |

**The `goals` requirement is declared and never used.** `insight-catalog.ts:38` defines
`goals` as a `DataRequirement`, and 22 candidates carry `comparator: "goal_pace"` and
`category: "goals"` — but **none of them declares `requires: ["goals"]`**, because
`goal_pace` is pinned to the `overall` dimension (`:520`), whose `requires` is empty
(`:68`), and no `MEASURE` carries the `goals` requirement either. The consequence is
concrete: `availableCandidates()` will report 22 goal-pace types as satisfiable for a
restaurant that has never created a single `analytics_goals` row. It is a small bug with a
large lesson — the availability filter is only as honest as the requirement declarations
feeding it, and nothing tests those.

### The gap that matters most — PARTIAL

**The one statistic that gates a published claim is the least tested arithmetic in the
module.** `insight-generator.service.ts:872` admits a basket insight only when
`p.lift > 1.3 && p.pValue < 0.1`. That `pValue` comes from
`association.ts:89-92` — a χ²(1 df) two-sided p-value computed as `2(1 − Φ(√χ²))`, which
is the correct identity and is documented as such at `:29`.

**`pValue` and `chi2` appear in zero assertions across all 11 spec files.** The chain that
decides whether the product says something to a customer — contingency table → χ² →
normal approximation → threshold — has one tested link (`normalCdf`, at
`statistics.spec.ts:87-89`) and no end-to-end case.

### The three other gaps

- **No multiple-comparison discipline.** 573 candidate types × live entities (tables,
  waiters, wines) is thousands of simultaneous tests per restaurant per run, and the only
  significance gate anywhere in the pipeline is `pValue < 0.1` on one family. At that
  threshold, false discoveries are expected, not exceptional. This is arithmetic, so it is
  ours — the *presentation* consequence belongs to
  [[insight-narrative-generation-charter]].
- **Scoring constants are unnamed and untested.** `scoreOf` (`:192-203`) weights
  effect × significance × support with four magic numbers — `× 5` at `:198`, cap 3 at
  `:199`, `n / 14` at `:200`, and the `0.4 + 0.6·support` blend at `:201`. The docstring
  (`:25-26`) states the intent well: *"a 40% swing on 3 data points doesn't outrank a 12%
  swing on 90."* Nothing tests that it does.
- **`availableCandidates()` is a filter, not a gate.** It runs at query time. Nothing stops
  a new `DIMENSION` entering the catalogue whose requirements no restaurant satisfies —
  which is precisely [[analytics-engine-premortem]] M1.

## Why this team is distinct from its siblings

AB-1 is rewarded for **computing more**; AB-2 is rewarded for **saying less**. Those
metrics point in opposite directions under pressure, and one team holding both resolves
the tension toward volume (`intelligence.md:400-403`). Against AB-3 the separation is the
independence argument: an author cannot be the auditor of their own arithmetic without
making `kpi_ground_truth_agreement` self-reported — the defect class
`v3.0-TECH-DEBT.md:127` already names as live in this repo.
