# 0069 — Derive the cycle service level from real costs; refuse when the costs are unknown

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** newsvendor, critical ratio, service level, safety stock, King formula, lead-time variance, EOQ, case pack, shelf life, inventory science, L5, ADR 0051
- **Links:** [[0048-domain-quant-under-research-math]] (Lane A), [[0051-rebuilt-pages-show-live-data-only]], [[0053-analytics-cost-unknown-not-invented]], [[0054-order-capture-and-unit-arithmetic]], [[FOOD-REASONING-GRAPH]] §3 / §L5, OPEN-DECISIONS OD-100

## Context

[[FOOD-REASONING-GRAPH]] §L5 named two defects in the inventory decision layer:
a `serviceLevel = 0.95` that "asserts `Cu/Co = 19` for every SKU", and per-vendor
lead-time variance "already computed in the repo and never passed to the
safety-stock function that accepts it". Both were re-verified on `origin/main`
before any code was written, and **one premise in §3 was found stale**.

**What was true.**

`apps/api-gateway/src/analytics/analytics.service.ts:517` (pre-fix) read
`const serviceLevel = opts.serviceLevel ?? 0.95;`, and `:518` read
`const leadTime = opts.leadTimeDays ?? 7;`. Neither literal had a comment, an
ADR, or a caller that overrode it: the only route that can pass either is the
`serviceLevel` / `leadTimeDays` query pair on
`GET /analytics/inventory-science/:restaurantId`, and the three internal callers
(`advanced-analytics.service.ts:590`, `consultants.service.ts:122`,
`recommendations.service.ts:80`) all call it with no options at all. A cycle
service level *is* a critical ratio — 0.95 is the claim Cu/(Cu+Co) = 0.95, i.e.
that being one unit short costs exactly 19× what holding one spare unit costs,
for every SKU on the list at once.

The lead-time orphan was worse, because the repo already had the measurement and
said so in its own payload. **Producer:**
`apps/api-gateway/src/analytics/advanced-analytics.service.ts:338` (pre-fix),
`stdev: E.stdev(leadTimes, true)` inside `getVendorScorecard`'s per-vendor
`leadTimeDays` object, shipped with the note at `:358`: *"Lead-time stdev feeds
the King safety-stock formula (leadTimeStdev param on /inventory-science)."*
**Consumer:** `apps/api-gateway/src/analytics/engine/inventory-science.ts:159`
(pre-fix), `leadTimeStdev?: number` on `safetyStock`, reached through
`reorderPoint` at `:180`. **The wire between them did not exist.** The single
call at `analytics.service.ts:546-551` passed `avgLeadTime` and omitted
`leadTimeStdev`, so `sigmaLT` defaulted to 0 and the `d̄²·σ_LT²` term was
structurally absent — in the function whose own docstring calls itself "the
statistically correct safety stock most POS systems get wrong by ignoring
lead-time variance".

Measured on the pre-fix tree with a fixture holding demand, costs and the *mean*
lead time fixed and moving only the dispersion of six deliveries (σ_LT = 0 vs
σ_LT ≈ 5.37 days): safety stock was **3.546962914818218 in both cases**, byte
identical. Post-fix the same fixture returns 3.7735 and 4.4720.

**Both ends, post-fix.** Producer: `advanced-analytics.service.ts:315`
(`E.leadTimeProfile(leadTimes)`) and `analytics.service.ts:634`
(`E.inventory.leadTimeProfile(...)`) — the same pure function, so the scorecard
and the maths cannot diverge. Consumer: `engine/inventory-science.ts:178` and
`:214`, now `leadTimeStdev: number | null`, required. The wire:
`analytics.service.ts:722`, `leadTimeStdev,` inside the `reorderPoint` call —
the line that did not exist.

**What was stale.** §3 recorded L5 inventory as having **zero callers**. It has
four: the HTTP route plus the three services above — 4 of 4 non-test call sites,
0 of them passing a service level or a lead time. The unwired half of §3's claim
is real; the "zero callers" half is not, and the row is corrected in the same
commit as this ADR. **L5 pricing's row is accurate**: `pricing-agility.ts`'s four
exported functions (`analyzePricing`, `estimateElasticity`, `priceForMargin`,
`admissiblePoints`) have **0 callers outside their own spec** — the module is
re-exported by `engine/index.ts:28,41` and consumed by nothing. This ADR does
**not** wire it; see Consequences.

## Options considered

1. **Keep 0.95 and document it as policy.** Free, and dishonest in the specific
   way ADR 0051 names: it is not a policy anyone chose, and calling it one in a
   `basis` string makes an unexamined literal look audited. Rejected.

2. **Derive the cycle service level as the newsvendor critical fractile
   `Cu/(Cu+Co)`, per SKU.** `Cu = menu_price_current − recorded unit cost`
   (contribution margin forgone on a unit of unmet demand);
   `Co = unitCost × holdingRate × cycleDays/365` (cost of carrying one excess
   unit for one replenishment cycle, with the cycle taken from the SKU's own EOQ
   cycle time). Bounded strictly inside (0,1), so `Φ⁻¹` is always finite.
   **Chosen.**

3. **Use the continuous-review form `CSL* = 1 − Co/Cu` (Chopra & Meindl).**
   Defensible and arguably the more exact statement for a continuous-review
   policy, which is what `reorderPoint` implements. Rejected for two reasons:
   it goes **negative** whenever `Co > Cu` (a thin-margin, slow-turning bottle),
   which has no service-level interpretation and needs a clamp — and a clamp is
   an invented number wearing a bound's clothes; and the module's own
   `newsvendorOrder` already states the critical ratio as `Cu/(Cu+Co)`, so two
   different fractiles in one file would be a drift source. Recorded here rather
   than deleted: if the founder prefers the continuous-review form, the change is
   one expression in `serviceLevelFromCosts`.

4. **Fall back to a constant when Cu or Co is unavailable.** This is the option
   the repo would have taken by habit, and it is exactly the failure ADR 0051 and
   ADR 0053 exist to stop. In production it is not a corner case, it is the
   whole table: `last_purchase_price` and `menu_price_current` are NULL on
   **72 of 72** rows, so a fallback would be the *only* path and the derivation
   would never run once. Rejected. (See §Production reality — the "2 of 72
   measured" figure that circulated in `inventory-cost.ts`'s header comment and
   in this ADR's first draft is stale in two directions.)

5. **Clamp the ratio into e.g. [0.5, 0.9999].** Attractive because it never
   returns null. Rejected: the only input that sends the ratio to exactly 1 is
   `Co = 0`, which happens for a *real, invoiced* reason — receiving records
   sample bottles at `unitCost: 0` (`inventory-cost.ts:74-77`) — and a sample
   bottle genuinely has no holding-cost trade-off to optimise. A clamp would
   answer a question the data cannot answer. It returns
   `overage_not_positive` instead.

6. **Do nothing.** Costs: every reorder point in the product continues to be
   computed at an unchosen ratio, understated by the missing σ_LT term, and
   `getVendorScorecard` keeps telling readers that a wire exists which does not.

## Decision

**The cycle service level is derived per SKU as `Cu/(Cu+Co)` from that SKU's own
menu price, recorded cost and holding cost; a SKU that cannot produce all three
reports `serviceLevel: null` with a named reason and loses its reorder point,
rather than borrowing a constant. Lead time and its standard deviation are
measured from delivered `procurement_orders` and both are passed to the King
formula. `leadTimeStdev` is now a required, explicitly nullable parameter.**

The reasoning that carried it, beyond ADR 0051's rule:

- **An optional parameter cannot express "unmeasured".** `leadTimeStdev?: number`
  made σ_LT = 0 (a real measurement: this vendor is perfectly reliable) and σ_LT
  unknown (nobody has measured it) produce the same number while meaning opposite
  things — and gave every caller a silent way to omit it, which all of them took.
  Required-and-nullable makes the omission impossible to write by accident, and
  `reorderPoint` now returns `leadTimeVarianceIncluded` so the *number* is never
  read without the fact of which case produced it.

- **`needsReorder` became tri-state.** It was `rop ? qty <= rop.reorderPoint :
  false` — a `false` standing in for "we could not tell", which is the same
  absence-reported-as-health fault one level down. It is now `true | false |
  null`, and `reorderList` filters on `=== true`.

- **The reorder list is allowed to be empty, and says why.** An earlier draft of
  this decision softened the null by falling back to
  `qty <= restaurant_inventory.threshold_min`, labelled
  `reorderTriggerBasis: "operator_threshold_min"`. **That label was false and the
  fallback is removed.** The argument against it is this ADR's own argument
  about `pack_size`, and it was applied to one column and not the other:

  `threshold_min` is `integer DEFAULT 3 NOT NULL` and every write site in the
  repo is a literal — `5` at `baseline_from_production.sql:1614` (the import
  default), `6` at `inventory.service.ts:815,1088,1327`, `3` at
  `menus.service.ts:18`. Production, measured 2026-09-02 across all five
  tenants: **`count(distinct threshold_min) = 1` for every single one** — 50
  rows at 5, 18 at 10, 2 at 6, 1 at 6, 1 at 10. No operator sets an identical
  reorder trigger for a house pour and a collectible; uniformity within a tenant
  is the signature of a default nobody has touched. Combined with
  `stock_live = 0` on 63 of 64 active rows, `qty <= thresholdMin` was true for
  **100% of rows in 100% of tenants** — the fallback would have made
  `reorderList` the entire cellar, every row carrying a provenance claim that
  was not true, which is a worse failure than the empty list it was avoiding.

  `skus[].thresholdMin` is still reported as a recorded column value so a UI can
  show it; it is never read as a trigger. If the column ever becomes genuinely
  operator-set, the evidence for that is per-tenant variance, and this is the
  place to re-decide.

**Case packs and shelf life are implemented as functions and refused as data.**
`roundUpToPack` and `shelfLifeCap` exist, are tested, and return
`pack_size_unknown` / `shelf_life_unknown` on every production row today:

- **Pack size.** Nothing reachable from `restaurant_inventory` records one. All
  three tables that store one — `vendor_price_observations`
  (`20260805154027_vendor_price_observations.sql:85`), `vendor_portal_listings`
  (`20260805155901_vendor_portal.sql:86`) and `procurement_document_lines`
  (`20260805000000_baseline_from_production.sql:4388`) — declare it
  `integer DEFAULT 1 NOT NULL`, so **an unrecorded pack is stored as a single
  and cannot be distinguished from a real one.** Joining them would report an
  absence as a measurement. The refusal matches
  `procurement/order-units.ts:173-183`, which already refuses a multiplying unit
  with no pack size for the same reason. *(An earlier draft cited a
  `vendor_price_list_items` table; no such table exists.)*
- **Shelf life.** No shelf-life, expiry or best-before column exists on any
  inventory table; the only `valid_until` in the schema is a vendor-promotion end
  date (`supabase/migrations/20260807001252_distributor_geo_foundation.sql:123`).

`skus[].eoq` still carries the unrounded quantity, so nothing regressed; the
rounded `orderQuantity` is null with a named blocker beside it.

## A service level below 0.5 is a real answer, and it is now reachable

The hardcoded 0.95 pinned `z` at +1.645, so safety stock could never be
negative. A **derived** ratio can be under 0.5 whenever `Cu < Co` — a thin
margin on a slow-moving bottle — and then `z < 0`, safety stock is negative, and
the reorder point can be negative too. Measured through the wired chain at
S = $25, h = 0.26: a $22 menu price on a $20 bottle at 0.02/day gives
SL 0.2510, **SS −0.152, ROP −0.052**. The break-even margin scales as 1/√D, so
at cost $20 a wine selling 12/yr needs over **$4.65** of margin before its
safety stock is non-negative. The route also accepts `?serviceLevel=0.4`
directly.

This is not an error — the newsvendor is correctly saying *plan to stock out,
because carrying a spare costs more than missing a sale*. The defect is that
`qty <= negativeReorderPoint` is false for every real quantity, so the SKU
**silently** left the reorder list wearing an otherwise healthy-looking row.
`reorderPoint` now returns `z` and `understockOptimal`, and the SKU carries
`reorderTriggerBasis: "king_reorder_point_understock_optimal"`. Flagged, not
floored: flooring the negative to zero would hide the regime change, which is
the same class of error as the constants this ADR removed.

## Production reality — the endpoint computes nothing today, for three reasons

Measured 2026-09-02 against `Restaurant_Wine_Ops`, and it must be stated plainly
because every number above describes maths that currently has no inputs:

| Input | State | Consequence |
|---|---|---|
| Cost + price | `last_purchase_price` NULL on **72 of 72**; `menu_price_current` NULL on **72 of 72**; both `inventory_lot_rollup` rows have `has_invoice_cost = false` | `serviceLevelCoverage.derived = 0`. No row can produce a critical ratio |
| Deliveries | `procurement_orders` holds **2 rows, 0 with `delivered_at`** (statuses APPROVED, PENDING) | `leadTime` is null, so `reorderPoint`, `safetyStock` **and** `stockoutProbability` are null on every row of every tenant |
| Consumption | `wine_consumption_log` is **empty** | demand is 0 everywhere |

These are three **independent** zeroes: fixing any one of them leaves the other
two blocking. Post-merge the endpoint computes no reorder science at all, for
every tenant — that is the honest state, and it is an improvement on computing
it from an asserted 0.95 and an invented 7-day lead time.

Two consequences follow, and both are handled rather than left implicit:

- `scienceAvailability.missingInputs` names which of the three are absent, so
  `reorderCount: 0` cannot be read as "nothing needs reordering". It is carried
  into `getOverview`'s `inventory` block for the same reason.
- `stockout_imminent` is the only recommendation mapped to the **"Draft PO"**
  action (`apps/web/src/pages/Recommendations.tsx:113`). It fired on `main`
  because the 7-day default made `stockoutProbability` always a number; it can
  no longer fire anywhere, correctly. A capability disappearing in silence is
  indistinguishable from one deciding there is nothing to do, so a
  `reorder_science_unavailable` card takes its place and names the inputs that
  would switch it back on.

## Consequences

**Easier.** The reorder science is now a function of the restaurant's own
economics and its own vendors' reliability: an erratic vendor produces more
safety stock than a steady one at the same mean lead time, and a thin-margin
slow-turning bottle is no longer protected as though it were a fast-turning
high-margin one. The vendor scorecard and the safety-stock path derive lead time
from **one** pure function (`E.inventory.leadTimeProfile`), so they cannot quote
different numbers. Two ordering-cost/holding-rate constants that were duplicated
across services are now one exported pair, surfaced in the payload's `params`.

**Harder / given up.**

- A row with no recorded cost loses `reorderPoint` and `safetyStock`. On
  production's current cost coverage that is most rows. This is the intended
  cost of the decision, not a side effect.
- A restaurant with no delivered orders carrying both `created_at` and
  `delivered_at` gets `leadTimeDays: null` and therefore no reorder point and no
  stockout probability anywhere — where it previously got numbers computed
  against a 7-day literal.
- `ORDERING_COST_PER_PO = 25` was a harmless assumption when it only set the
  EOQ. It is now **load-bearing**: it sets the cycle, the cycle sets Co, and Co
  sets the service level. It is surfaced in `params.orderingCostPerPo`, and the
  fork it opens is recorded below rather than in the register — see "An open
  fork this ADR deliberately did not file".
- One new query per `/inventory-science` call
  (`loadLeadTimeObservations`). It is deliberately separate from
  `loadDeliveredOrders` so that COGS and spend do not start paying for columns
  they never read.

**Not done, and named rather than implied.**

- **L5 pricing is still unwired** (0 callers of its 4 exports, outside its spec).
  Wiring it needs a price-history reader for `menu_price_versions` and a decision
  about cross-tenant pooling, which is **OD-115**, open. It was left alone rather
  than half-wired.
- **Per-SKU lead time is not derived.** `loadLeadTimeObservations` carries
  `inventory_id` so it can be, but choosing a minimum observation count is a
  policy number and this ADR does not invent one; the pooled restaurant-level
  profile is used for every SKU.
- **`unitPrice` still comes from `menu_price_current` coerced with `|| 0`** in
  `loadInventory`, so an absent menu price is indistinguishable from a free
  bottle at the loader. `serviceLevelFromCosts` treats `<= 0` as unknown, which
  is correct for this use; fixing the loader is OD-100's territory.
- **σ_LT has no minimum-n gate above 2.** Two is the definition of a sample
  standard deviation, not a policy; any higher cutoff would be an unchosen
  number. But the King formula *squares* σ_LT and multiplies it by d̄², and at
  n = 2 the estimate carries a **±70.7%** relative standard error. Rather than
  invent a threshold, `leadTimeProfile` reports
  `stdevRelativeStandardError = 1/√(2(n−1))` and the payload's
  `basis.leadTimeVariance` states it. When the founder wants a gate, that is
  the number to set it against — and it should be set before real deliveries
  land, not after.
- **`inventory-cost.ts`'s header comment is stale** and this ADR inherited it:
  it says the measured branch "covered 2 of 72 inventory rows". Both
  `inventory_lot_rollup` rows have `has_invoice_cost = false`, so
  `resolveUnitCost` returns `unknown` for **all 72**. The comment is not
  corrected here because that file is ADR 0053's and is under a CI guard;
  flagged so the next reader does not re-copy the figure.

**Revisit when:** a shelf-life column lands (wire `shelfLifeCap`); a pack size
becomes distinguishable from its `DEFAULT 1` (wire `roundUpToPack`); the fork
below is answered; or the founder prefers the continuous-review fractile in
Option 3.

## An open fork this ADR deliberately did not file

**The fork.** `ORDERING_COST_PER_PO = 25` and `ANNUAL_HOLDING_RATE = 0.26` are
now load-bearing on every reorder point in the product, and nobody chose either.
A restaurant that raises a PO by email and one that runs a three-approver
workflow do not have the same ordering cost; a cellar at 55°F does not have the
same holding rate as a dry-goods shelf. The choices are: keep one platform
constant and say so here; add per-restaurant columns; or derive the ordering cost
from measured procurement effort. Both numbers are surfaced in
`/inventory-science`'s `params` so the input is visible while the fork is open.

**How much they move the answer, measured.** Swept across S $10–$100 × h 15–35%:
on a normal SKU the service level moves **0.9160 → 0.9814** and safety stock
varies by **1.51×**. On a thin-margin SKU it moves **0.353 → 0.725** — which
spans the 0.5 boundary, so **these two constants decide whether that wine has a
reorder point at all**. That is the argument for the fork being real rather than
cosmetic.

**Why it is here and not in `OPEN-DECISIONS.md`, stated plainly per CLAUDE.md
§0.5.** CLAUDE.md §0.1 says an undecided fork goes in the register. It was
written there, and reverted, because the cost was measured rather than assumed:
inserting one row — even appended below the last Open row, the cheapest possible
position — shifted the Resolved table by one line and broke **45 positional
citations across ~30 files**, and `scripts/check_citation_pairing.py` went from
PASS to FAIL. Fixing 45 citations in a branch about inventory maths would sprawl
it across the corpus (CLAUDE.md §2, one operation per branch) and collide with
the sessions holding those files open. `check_adr_numbers_unique.py`'s own
docstring names this exact trade — *"adding a register row re-anchors every
citation below it… that trades a rare renumber for a frequent citation break"* —
and this is the branch on the losing side of it.

So the fork is recorded here, where it costs nothing. **The coordinator is
filing it in `OPEN-DECISIONS` batched with other pending rows** so the citation
re-anchoring is paid once; this section stands until that row exists. Until
then it is open, not decided: this ADR does not claim 25 and 0.26 are right.

## Evidence

Measured in this worktree at `origin/main` + this change, `apps/api-gateway`:

- `npx jest src/analytics` — **290 passed, 20 suites, 0 failed** (was 251/19 at
  `origin/main`).
- `npx jest` (whole gateway) — **1635 passed, 14 skipped, 0 failed**, 129 suites.
- `npx tsc --noEmit -p tsconfig.json` — clean.
- 15 CI guards exit 0, including `check_analytics_cost_honesty.py`,
  `check_decision_claims.sh`, `check_order_status_literals.py`,
  `check_queried_tables_exist.py` and `check_citation_pairing.py`.
- **Proven against the pre-fix tree**: the 4 source files reverted to
  `origin/main` with the new specs kept → **30 of 30 new tests fail**. The two
  load-bearing ones fail on the numbers, not on missing fields: safety stock is
  identical (3.546962914818218) for σ_LT = 0 and σ_LT ≈ 5.37, and identical for
  the derived ratio and 0.95.
- Production figures in §Production reality re-measured independently against
  `Restaurant_Wine_Ops` on 2026-09-02, not copied from the review that raised
  them.

### Independent adversarial verification, 2026-09-02

An adversary re-implemented the maths from scratch rather than re-reading it.
What survived:

- `serviceLevelZ` cross-checked against an Abramowitz–Stegun erf plus bisection
  at 11 probabilities — **max deviation 2.0e-5**.
- King's formula matches a from-scratch `z·√(LT·σ_d² + d̄²·σ_LT²)` to **1e-6**,
  and is strictly increasing across the *whole* σ_LT range, not only at the
  point the spec samples.
- `ROP = LTD + SS` holds exactly.
- The Option-3 rejection was confirmed: `1 − Co/Cu` returns **−41.74** at
  $20.01 menu on $20 cost.
- The σ_LT orphan was real and as described.

Five defects it found are fixed in this ADR's final form: the false
`operator_threshold_min` label (the merge blocker), two flattering coverage
figures, the silenced "Draft PO" recommendation, the unflagged negative safety
stock, and the `vendor_price_list_items` table that does not exist. Every one
of them was at the seam where data meets the maths — none in the maths.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created; awaiting founder lock |
| 2026-09-02 | Independent adversary | Maths verified against a from-scratch implementation; 5 data-seam defects raised, all fixed — see §Evidence. The `threshold_min` fallback was withdrawn as a result |
