---
type: premortem
division: product
department: product-vision
team: supply-discovery
status: provisional
metrics: [supply.sku_dual_price_coverage_pct, supply.price_freshness_p50_days, supply.needed_sku_denominator_size]
updated: 2026-08-24
links: ["[[supply-discovery-charter]]", "[[supply-discovery-loops]]", "[[supply-discovery-directive]]", "[[product-vision-premortem]]", "[[supplier-distributor-network-charter]]", "[[surface-portfolio-charter]]", "[[legal-charter]]", "[[red-team-charter]]", "[[AGENT_NATIVE_UI_DECISION]]"]
---

# Supply Discovery (Vendor Finder) — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

### M1 — A beautiful crawler for a supply graph nobody queries

The team's own named premortem (`teams/product.md:170-174`), and the one the numbers already
predict. `procurement_orders` = **1** ([[AGENT_NATIVE_UI_DECISION]] §2). The comparison
surface is not even reachable by clicking — `/distributors` and `/vendor-prices` are both
cold-entry with no inbound in-app link ([[PAGE_MAP]]:116,130). Meanwhile the crawler is the
most engaging engineering problem in the department, it has real tests, and every week of
work on it produces visible progress. Twelve months later there are thousands of extracted
SKUs, a comparison page nobody navigates to, and the founder's actual distributors were
reachable by phone the whole time.

**Earliest observable signal.** SKU or distributor counts rising for two consecutive
close-times while `supply.needed_sku_denominator_size` stays at **0** — i.e. growth in
supply with no demand-side definition at all. Second signal: `/vendor-prices` still
cold-entry at the second [[PAGE_MAP]] regeneration.

**Counter-pressure.** The primary metric is deliberately a **fraction of a restaurant's
needed SKUs**, and it cannot move without a real denominator. Entry work for this team is
defining "needed SKU" for **one** restaurant — from its par levels or its menu — not
crawling another distributor. And the department's subject rule applies
([[product-vision-directive]]): *name the restaurant this changes*. "The crawler covers more
distributors" does not name one. Pair with [[surface-portfolio-charter]]: if the comparison
page cannot be reached by clicking, coverage is academic.

---

### M2 — Coverage was reported without a denominator, so it always looked good

This is the subtler version of M1 and it is how a team survives M1 for a year. Without a
needed-SKU list, the obvious substitute is *SKUs we have prices for, divided by SKUs we have
seen* — which rises whenever the crawler works and never falls when a restaurant needs
something nobody carries. The metric becomes a measure of crawler throughput wearing the
name of coverage.

**Earliest observable signal.** `supply.sku_dual_price_coverage_pct` being published at all
while `supply.needed_sku_denominator_size` is 0 or unstated. A percentage with no stated
denominator is the tell.

**Counter-pressure.** Coverage is **undefined, not zero**, until a denominator exists, and
undefined is what gets published ([[supply-discovery-directive]]). The denominator's size
appears next to the percentage every time, so a coverage number computed against 12 SKUs
cannot be mistaken for one computed against 400. And the "two live prices" requirement is
part of the definition, not a stretch goal: one price is a quote, two are a comparison, and
comparison is the entire product.

---

### M3 — Prices went stale silently and someone bought on a number from March

A price is a perishable fact. Extraction succeeds, the row lands, and nothing marks it as
aging. Six months later the comparison page shows a confident three-column table where one
column is current, one is from a distributor's cached PDF, and one is from a page that has
since 404'd. The failure is not visible in coverage — coverage is *higher* with stale rows
included — and it surfaces exactly once, at the moment somebody makes a purchasing decision
on it.

**Earliest observable signal.** Any price displayed without an age, anywhere in the product.
Also: `supply.price_freshness_p50_days` rising for two consecutive close-times while
coverage also rises — the signature of coverage being propped up by old rows.

**Counter-pressure.** Freshness is **paired with coverage and published together**, exactly
as acceptance is paired with false-accepts in [[inbound-understanding-charter]]. Beyond a
stated age a price is shown as stale or not shown at all — a policy this team owns and that
is enforced at the display layer, not left to the reader's judgement. Refetch priority is
driven by *which SKUs a restaurant actually needs*, so freshness effort follows demand
rather than crawl convenience.

---

### M4 — Supply Discovery and Supplier Network built the same thing twice

`teams/product.md:828` names this the **single most likely duplication in the division**.
Both teams cite `apps/api-gateway/src/distributor-discovery/`. At v0 one person holds both.
The predictable outcome is not a turf war — it is two half-built things: a discovery
pipeline that stops short of a usable relationship, and a portal built for distributors the
discovery side already knows do not publish prices online. Each team's metric moves
(catalogue coverage; live feeds) and neither produces a distributor a restaurant can
actually order from tomorrow.

**Earliest observable signal.** The same distributor appearing in both teams' work items in
one close-time with no shared record of who owns the next step. Also: a discovery feature
whose acceptance criterion is "the distributor would need to log in", which is the other
team's job written as this team's ticket.

**Counter-pressure.** The fork is **filed and pushed for closure**, not asserted away —
[[supply-discovery-charter]] states the boundary and names it as at-risk. Operationally,
one shared artifact: a **distributor state list** where every distributor has exactly one
current stage (*discovered → extracted → priced → live feed → active relationship*) and one
owning team per stage. A distributor in two teams' backlogs at the same stage is the
finding.

---

### M5 — The crawl outran its permission

The team's targets are third-party commercial websites. Extraction is the product. Nothing
in the current code path asks whether a given target's terms permit it, and the adjacency is
already in the repo's own scan: `EXTERNAL_CONNECTIONS.md` inventories every third-party
host, and placeholder/ngrok domains already appear in source paths (foundation
[[README]]:57-59). The failure is a cease-and-desist against a seed-stage company, or —
quieter and more likely — a distributor discovering their catalogue is being scraped during
the exact conversation [[supplier-distributor-network-charter]] is having about signing them.

**Earliest observable signal.** A crawl target added without a recorded terms check. Also:
the first rate-limit or block response from a target treated as a bug to route around
rather than a signal to escalate.

**Counter-pressure.** Every crawl target carries a **recorded permission status** — allowed
/ ambiguous / disallowed / relationship-in-progress — before extraction begins, and
*relationship-in-progress* is a hard stop until [[supplier-distributor-network-charter]]
says otherwise. Escalation to [[legal-charter]] on *ambiguous* is a decision, not a
judgement call by whoever is writing the extractor that day. Blocks are escalated, never
evaded.

---

## Cross-cutting counter-pressure

- **Never publish coverage without its denominator and its freshness.** One rule that kills
  M2 and M3 together.
- **Entry work is a demand-side definition, not a supply-side expansion** — the specific
  counter to M1.
- **One distributor state list, one owning team per stage** — the operational counter to M4,
  cheaper than resolving the fork.
- **Permission status is recorded before extraction**, and blocks escalate rather than get
  routed around (M5).
- **[[red-team-charter]] should attack the coverage definition** — it is the place where a
  reasonable-sounding denominator quietly turns this team's metric into crawler throughput.
  Findings-only ([[ORG_STRUCTURE]] §3).
- **Anti-sprawl:** unrevisited in 60 days, this document is fiction (foundation §3.3).
