---
type: agenda-full
division: product
department: product-vision
team: supply-discovery
status: provisional
metrics: [supply.needed_sku_denominator_size, supply.sku_dual_price_coverage_pct, supply.price_freshness_p50_days]
updated: 2026-08-24
links: ["[[supply-discovery-charter]]", "[[supply-discovery-premortem]]", "[[supply-discovery-agenda-board]]", "[[supply-discovery-directive]]", "[[supply-discovery-loops]]", "[[supply-discovery-schedule]]", "[[product-vision-agenda-full]]", "[[supplier-distributor-network-charter]]", "[[surface-portfolio-charter]]", "[[legal-charter]]"]
---

# Supply Discovery (Vendor Finder) — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Give the team's primary metric a denominator, then make the two numbers that matter
publishable together. Nothing here is a crawler improvement, and that is deliberate — the
crawler is the strongest part of this team's evidence and the weakest use of its next
quarter.

| Deliverable | Why it is first |
|---|---|
| **"Needed SKU" defined for one restaurant** | `supply.sku_dual_price_coverage_pct` has **no denominator**. Coverage is currently *undefined*, not zero |
| **Freshness policy** | Beyond what age is a price shown as stale, hidden, or refetched. Owned here because a price is a perishable fact |
| **Distributor state list** | One stage per distributor (*discovered → extracted → priced → live feed → active relationship*), one owning team per stage. The operational answer to the duplication risk with [[supplier-distributor-network-charter]] |
| **Crawl permission register** | Every target carries allowed / ambiguous / disallowed / relationship-in-progress **before** extraction |
| **Route verdict input** | `/distributors` and `/vendor-prices` are both cold-entry ([[PAGE_MAP]]:116,130). Jointly with [[surface-portfolio-charter]] |

## How

**Demand first, supply second.** The whole sequencing argument for this team is that it has
the most code and the least pull. `procurement_orders` = **1**. Adding supply to a system
with no demand produces a bigger version of the same problem.

- **Start from one restaurant's par levels or menu.** That list is the denominator. It will
  be small and unimpressive — twenty, forty SKUs — and that is exactly why it is useful: a
  coverage percentage over 40 real needs is a fact, and one over "SKUs we happen to have
  seen" is crawler throughput wearing a product name
  ([[supply-discovery-premortem]] M2).
- **Publish coverage, denominator size, and freshness p50 as one triple, always.** A
  percentage with no denominator is not published. This is the same pairing discipline
  [[inbound-understanding-charter]] applies to acceptance and false-accepts, for the same
  reason.
- **"Two live prices" is part of the definition, not a stretch target.** One price is a
  quote; two are a comparison; comparison is the product.
- **Let refetch priority follow the needed list**, not crawl convenience. Freshness effort
  spent on SKUs nobody buys is invisible work.
- **Record permission before extraction.** Ambiguous escalates to [[legal-charter]]; a
  distributor in an active conversation with [[supplier-distributor-network-charter]] is a
  hard stop, not a judgement call by whoever writes the extractor that day.
- **Do not extend the crawler this quarter** unless a needed SKU has zero prices and the gap
  is traceable to a missing source. That is the only crawl expansion that can name a
  restaurant.

## Why now

- **The code is real and better tested than the docs credit** —
  `apps/api-gateway/src/distributor-discovery/` (8 files, 3 specs) and
  `apps/api-gateway/src/vendor-intel/` (10 files, 3 specs, including `wine-identity.ts`).
  This team is not starting from nothing; it is starting from something aimed slightly wrong.
- **The duplication risk is live right now.** `teams/product.md:828` calls
  Supply Discovery + [[supplier-distributor-network-charter]] the single most likely
  duplication in the division, and both cite `distributor-discovery/`. A shared distributor
  state list costs a day and prevents a quarter of parallel half-builds.
- **Two of three surfaces are unreachable by clicking.** Whatever the graph's quality, a
  user cannot navigate to the comparison. That is a route verdict waiting to be made, and
  it is cheap.
- **Wine identity is in flight** (`wine-identity.ts` + spec; enrichment commits `f7e0ea1`,
  `ef19b81` — 144 of 1,448 wines). Matching a vendor line to our catalogue gets easier as
  that lands, so defining match confidence now is well-timed.

## Next steps

- [ ] Define "needed SKU" for exactly one restaurant; publish
      `supply.needed_sku_denominator_size` · [[supply-discovery-loops]]
- [ ] Write the freshness policy (stale threshold, hide threshold, refetch priority rule) ·
      [[supply-discovery-directive]]
- [ ] Stand up the distributor state list with one owning team per stage — jointly with
      [[supplier-distributor-network-charter]]
- [ ] Create the crawl permission register; backfill every existing target ·
      [[legal-charter]] for the ambiguous ones
- [ ] Publish the first coverage triple (coverage %, denominator size, freshness p50) — or a
      written statement of why it cannot yet be read
- [ ] Feed `/distributors` and `/vendor-prices` into the route verdict sheet ·
      [[surface-portfolio-charter]]
- [ ] Define match confidence: what must be true before a vendor line is shown as *this*
      SKU · [[catalogue-identity-charter]] for the identity rules it inherits
- [ ] Push the Vendor Finder boundary fork for closure (proposed ID collides with a live
      OD number) · [[decision-office-charter]]

## Questions for the founder

1. **Where does this team live?** `teams/product.md:828` flags the Supply Discovery ↔
   [[supplier-distributor-network-charter]] boundary as the division's highest duplication
   risk. Finding a vendor and signing one are genuinely different jobs with different
   metrics — but one person will hold both at v0. Merge, or keep split with a shared
   distributor state list?
2. **What is a "needed SKU"?** Par levels give a stock-driven list; the menu gives a
   demand-driven one; recent purchase history gives a behavioural one. They produce
   different denominators and therefore different coverage numbers. Pick one, or the metric
   is unstable by construction.
3. **How stale is too stale?** A wine price that is 30 days old is usually fine; a produce
   price that is 3 days old may not be. Is freshness policy per-category, and if so who
   sets the category boundaries?
4. **Crawl permission posture.** Conservative (only clearly-permitted targets) shrinks
   coverage substantially. Permissive raises a real risk during exactly the period
   Partnerships is trying to sign the same distributors. Which posture, and who signs off on
   *ambiguous*?
5. **Is this team even v0?** It has the most built code and the least demand
   (`procurement_orders` = 1, comparison page unreachable). A defensible answer is "define
   the denominator, then pause" — but it should be a decision, not a drift.
