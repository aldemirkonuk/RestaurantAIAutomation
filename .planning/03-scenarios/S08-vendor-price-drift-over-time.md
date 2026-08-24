---
type: scenario
id: S08
slug: vendor-price-drift-over-time
class: problem
actors: [owner-buyer, price-observation-store, consensus-engine, vendor-catalogue, competing-vendors, procurement-system]
modules: ["[[procurement-vendor-network-charter|procurement-vendor-network]]", "[[supply-discovery-charter|supply-discovery]]", "[[catalogue-identity-charter|catalogue-identity]]"]
signals: [vendor-price-observation, price-history, invoice-line-price, quote, scrape]
insights_class: [cogs-drift, price-variance, vendor-vs-market, switch-worthiness]
tier: plus
sim_harness: synthetic-engine
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[S02-vendor-delivery-arrives]]", "[[procurement-vendor-network-charter]]", "[[supply-discovery-charter]]"]
---

# S08 — Vendor price drift over time

Not one delivery — a *series*. The same SKU, bought again and again, creeping up a few
percent a quarter until COGS has moved and nobody decided to let it. This is the Pro-tier
question S02 §6 gestured at ("your flour is up 9% in 6 weeks") walked end to end: how the
drift is measured, when it's the vendor versus the market, and when the honest move is to
switch.

## 1. Trigger
Enough price observations of one product accumulate that a trend can be computed and a
drift crosses a threshold. Bounded: from the Nth observation landing to a rendered
7/30/90-day trend and, if warranted, a **proposed** vendor switch — the switch itself is
always the human's. The machinery exists: `priceTrend` compares the consensus of the most
recent window against the window before it
(`apps/api-gateway/src/analytics/engine/vendor-price-consensus.ts:394-446`), and
`standardTrends` is the 7/30/90-day set the vendor page shows (`:448-454`).

## 2. Actors
Owner/buyer (reads the trend, owns the switch) · the price-observation store
(`vendor_price_observations`) · the consensus engine (pure, DB-free — all the judgement
lives here: `vendor-comparison.service.ts:36-45`) · the vendor catalogue · competing
vendors (external, present only as observations) · procurement, where a switch is executed.

## 3. Signals
- **`vendor_price_observations`** — one immutable row per observed price, from any source,
  every source labelled. Not `price_history`: this records what a price *was observed to
  be*, including places we never bought (`20260805154027_vendor_price_observations.sql:1-18`).
- **Trust tiers 1–7**, never averaged as equals: `invoice` (ground truth) → `quote` →
  `api_catalog` → `website_scrape` → `chat` → `social` → `manual`
  (`…vendor_price_observations.sql:20-30`). Weighting happens at read time so the
  disagreement stays visible.
- **`normalized_unit_price`** — the *only* column the comparison may sort on. A "$240 case of
  12×750ml" and a "$22 bottle" aren't comparable until both are price-per-750ml
  (`…vendor_price_observations.sql:32-38, 90-92`).
- **`price_history`** — the COGS anchor: what we actually *paid*, tied to an order
  (`order_id`, `master_wine_id`, `effective_date` — `20260805000000_baseline_from_production.sql:4274-4287`).
  Drift felt in the P&L is traced here; drift *available in the market* is traced in the
  observation store. Conflating them makes both unanswerable.
- **Scrape hygiene:** `content_hash` discards a re-scrape that found nothing new, so a stale
  price can't masquerade as repeatedly confirmed (`…vendor_price_observations.sql:101-104`;
  dedup index `20260813090000_fix_remaining_upsert_targets.sql:39`).
- **Honest gap — this is wine-shaped today.** Identity is `master_wine_id`; the food case is
  a *spec* match (grade, origin, trim) priced per *usable* unit after yield loss.
  `yield_factor` exists (defaults to 1, so wine is unaffected) but the food ranking path is
  scaffolding, not the live comparison (`…vendor_price_observations.sql:40-48, 87-88`).

## 4. Queries the product must answer
- "Is this vendor's price for X drifting?" — trailing-window consensus vs prior window,
  like compared with like so vendor churn isn't misread as movement
  (`vendor-price-consensus.ts:386-392`).
- "Is it *this vendor* or the *market*?" — the vendor's own series vs the cross-source
  consensus for the same product.
- "What did the drift cost us?" — the window's price delta applied to `price_history`
  quantities: COGS drift in dollars, traced to the invoices that carried it.
- "Is there a cheaper vendor at equal normalized unit, net of switching cost?"

## 5. Outputs (in the moment)
- The vendor page price ladder + 7/30/90 trend chips, each with a plain-language note ("Up
  9.2% over 90 days") or an honest null when observations are too sparse to compute
  (`vendor-price-consensus.ts:418-428, 441-445`).
- A **"show your working" panel** — every observation behind the consensus, with source
  type and parse confidence, so the number is debuggable rather than magical
  (`vendor-comparison.service.ts:25-34`).
- A drift flag when a trailing window crosses the configured threshold — surfaced, not
  acted on.

## 6. Insights the owner sees (the payoff)
- **COGS drift traced to invoices** — "your Sangiovese landed cost is up 11% since spring;
  here are the seven orders," computed off `price_history`, not scraped list prices.
- **Price variance vs consensus** — where you're paying above the market's believable
  middle, with outliers already rejected (`vendor-price-consensus.ts:188-198, 324`).
- **Vendor-vs-market attribution** — the drift is your vendor's margin, not a commodity move.
- **Switch-worthiness** — savings at equal normalized unit, net of an estimated switching
  cost; framed as evidence for a decision, never as an executed one.
- These are procurement/market signals — inside the **25.1% no-POS satisfiable band**
  (SCENARIO-CONTRACT §5). The honest boundary: full-fidelity insight exists for **wine**
  today; the food generalization is gated on the yield-based comparison shipping.

## 7. Decisions
Human decides: absorb the drift, renegotiate, re-quote competitors, or switch vendor. The
system **proposes only** (ask→propose→confirm→execute): flag the drift, surface the alternate
vendor at equal normalized unit, propose a re-quote. It never switches a vendor, never
places the reorder elsewhere, and never picks a winner among disagreeing sources — it shows
the consensus and the spread and lets the buyer read the negotiating position
(`…vendor_price_observations.sql:11-18`).

## 8. Failure modes
- **Reporting vendor churn as price movement** — comparing today's cheapest against last
  month's average. Guarded: both sides of a trend are consensus computed the same way
  (`vendor-price-consensus.ts:386-392`).
- **Averaging a scrape against an invoice** — trust tiers exist precisely so this can't
  happen; a regression that flattens them silently corrupts every comparison.
- **A confident source badly parsed** — `parse_confidence` is separate from trust tier; a
  believable vendor with a broken scrape is still a bad number
  (`…vendor_price_observations.sql:94-96`).
- **Wine-shaped math on food** — ranking raw price without `yield_factor` reliably
  recommends the wrong vendor (a $40 case at 85% yield beats a $36 case at 70%:
  `…vendor_price_observations.sql:40-48`). Today the guard is that food simply isn't ranked.
- **Sparse observations → confident-looking trend** — refused: the trend returns an explicit
  "cannot be computed" null rather than inventing a line
  (`vendor-price-consensus.ts:418-428`).

## 9. Simulation & deploy gate
The synthetic engine generates price *series* per product: flat · gradual drift · step jump ·
vendor churn (cheap newcomer, no real movement) · sparse-and-stale · mixed-tier
disagreement. Gate: a change to the consensus or trend engine ships only when the drift
series produce the correct 7/30/90 verdicts, the churn series produces **no** drift flag and
**no** false switch proposal, and the sparse series returns honest nulls. The engine is
already unit-tested without a database (`vendor-comparison.service.ts:40-44`), so the sim
layer adds the series-over-time dimension.

## 10. Tier cut (OD-48 locked — Core/Plus/Pro; prices open, OD-23)

**The only scenario in the library with an empty Core** — hence `tier: plus`.

- **Core (operate):** **none.** Drift is a *series* question; nothing about it helps you run
  tonight's service. A Core-only subscriber sees the price on today's invoice via S02 and
  nothing longitudinal. Stated plainly so no entitlement page invents a Core feature here.
- **Plus (understand):** the vendor-page price ladder with **7/30/90-day trend chips**, each
  carrying a plain-language note ("Up 9.2% over 90 days") **or an honest null** when
  observations are too sparse to compute; the **"show your working" panel** listing every
  observation behind the consensus with its trust tier and parse confidence; and the drift
  flag when a trailing window crosses threshold. Ships today —
  `vendor-price-consensus.ts` + `vendor-comparison.service.ts`, unit-tested without a DB.
- **Pro (optimize):** the scenario's payoff, and it is the **most genuinely built Pro tier in
  the library** — COGS-drift attribution to specific invoices off `price_history` ("your
  Sangiovese landed cost is up 11% since spring; here are the seven orders"), vendor-vs-market
  decomposition (your vendor's margin vs a commodity move), and switch-worthiness at equal
  `normalized_unit_price` net of estimated switching cost.

No tier here ⛔ needs POS — these are procurement and market signals inside the **25.1%
no-POS band**. The one honest boundary is domain, not data source: **full fidelity is
wine-only.** The food case is a *spec* match priced per *usable* unit after yield loss;
`yield_factor` exists (defaulting to 1, so wine is unaffected) but the food ranking path is
🚧 **scaffolding, not the live comparison**. Selling Pro switch-worthiness to a restaurant
buying produce would recommend the wrong vendor — a $40 case at 85% yield beats a $36 case
at 70%.

## 11. Evolution feedback
Which drift flags the owner acts on versus dismisses tunes both the threshold and the
trust-tier weights. Which "show your working" panels get opened tells us whether the
consensus is trusted or second-guessed. Whether switch proposals are ever taken is the
truest test of whether this Pro tier earns its price.

**Flex points:** window lengths (7/30/90 is a default, not a law) · drift threshold ·
trust-tier weighting · wine identity vs food specification · switching-cost sensitivity in
the switch-worthiness calculation · which sources a given restaurant even permits (some
won't allow scraping).
