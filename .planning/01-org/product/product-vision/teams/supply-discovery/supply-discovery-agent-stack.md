---
type: agent-stack
division: product
department: product-vision
team: supply-discovery
status: designed
updated: 2026-08-27
metrics: [supply.sku_dual_price_coverage_pct, supply.price_freshness_p50_days, supply.needed_sku_denominator_size]
links: ["[[supply-discovery-charter]]", "[[supply-discovery-schedule]]", "[[supply-discovery-loops]]", "[[supply-discovery-premortem]]", "[[0034-agent-stack-artifact]]", "[[product-vision-agent-stack]]", "[[supplier-distributor-network-charter]]", "[[legal-charter]]", "[[FORK-REGISTRY]]"]
---

# Supply Discovery (Vendor Finder) — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This is the department's only **outbound** team, which changes the shape of its card twice:
> its agent may never contact a counterparty, and it may never expand a crawl on its own
> schedule. Its primary metric has **no denominator**, so coverage is *undefined*, not zero —
> and the card is built around protecting that distinction. Mechanisms stay elsewhere:
> harness → [[harness-runtime-charter]] (**OD-03 open**), crawler code →
> [[engineering-charter]], permission to crawl → [[legal-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `supply-coverage-auditor` | Publish the coverage triple — denominator, coverage, freshness — together or not at all, and keep every crawl target's permission status and every distributor's owning team recorded | NEW; the code it audits is PARTIAL and among the better-tested in the department |

One row. Finding vendors is [[engineering-charter]]'s code and *signing* them is
[[supplier-distributor-network-charter]]'s job; what has never existed is anyone measuring
whether the graph is good enough to trust.

## 2. Agent cards

```yaml
agent: supply-coverage-auditor
unit: supply-discovery
triggers:
  - schedule: "monthly — permission register review"       # mirrored in [[supply-discovery-schedule]]; running today
  - schedule: "monthly — distributor stage reconciliation (joint)"
  - schedule: "weekly — freshness sweep"                   # ⏸ inert until the freshness policy exists
  - topic: crawl_target.added                              # publisher: NONE (gap — targets are added in code, nothing emits)
consumes:
  - "apps/api-gateway/src/distributor-discovery/ — 8 files incl. distributor-query.ts and 3 specs"
  - "apps/api-gateway/src/vendor-intel/ — 10 files incl. vendor-page-extractor.service.ts, vendor-comparison.service.ts, wine-identity.ts + specs"
  - "apps/api-gateway/src/vendor-catalogue/ and common/orchestrator/prospects.service.ts"
  - "[[EXTERNAL_CONNECTIONS]] — the third-party host inventory, as the model for the crawl-target register"
  - "a restaurant's needed-SKU list — publisher: NONE (gap; undefined for every restaurant, see §5)"
emits:
  - "the coverage triple (supply.sku_dual_price_coverage_pct, supply.needed_sku_denominator_size, supply.price_freshness_p50_days) → [[product-vision-agent-stack|pv-orchestrator]]'s board row, always as three numbers"
  - "the zero-price report — needed SKUs with no live price → the only artifact that justifies crawl expansion (gap: its consumer is a purchasing decision with 1 order behind it)"
  - "ambiguous or expired crawl permissions → [[legal-charter]]"
  - "distributors carrying two owners at one stage → [[supplier-distributor-network-charter]]"
  - "nf_a events (task_type: supply_coverage_audit)"
routing_class: extraction        # counting matched SKUs, ageing prices, diffing owner lists; match *quality* is graded on a labelled set, not by this agent's opinion
quality_bar: "coverage is never published without its denominator and its freshness p50 (charter §Metrics). With no denominator the metric reads **undefined** — never 0%, never a percentage of what happened to be crawled (premortem M2). A price shown without an age is a defect, target 0"
autonomy:
  read: autonomous
  propose: autonomous            # reports, registers, and escalations land as PRs
  mutate_stock_money_outbound: confirm   # constant — and outbound is not theoretical here, see the hard rules
memory: supply-discovery
escalates_to: "[[product-vision-charter]]; PROD-F2 (the Vendor Finder boundary) belongs to the founder via [[FORK-REGISTRY]] and stays open"
```

**Three hard rules the card carries in its own right.**

1. **No outreach.** This agent never contacts a distributor — that is
   [[supplier-distributor-network-charter]]'s job, and blurring it would close **PROD-F2 by
   accident rather than by decision** (`teams/product.md:828`).
2. **No self-directed crawl expansion.** A new target is justified only by a needed SKU with
   zero prices; widening the crawl on its own cadence is premortem M1 automated.
3. **Fetching is an outbound act.** Adding or refetching a target is gated on the permission
   register; *ambiguous* and *relationship-in-progress* are not permission (premortem M5).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `needed-sku-derive` | T1 | A restaurant is onboarded, or its par levels / menu change | A dated needed-SKU list with its derivation stated (par / menu / purchase history) — the denominator, with provenance attached | The 2026-08-24 division pass named `supply.sku_dual_price_coverage_pct` this module's primary metric and could not compute it (`teams/product.md` §1.3); no denominator exists anywhere in the repo, so the number has never once been produced | NEW |
| `price-freshness-sweep` | T1 | Weekly | Every matched SKU's newest price carries an age; anything past the stale threshold is queued for refetch in needed-list order | `vendor-comparison.service.ts` compares prices today **with no freshness concept** — three prices of unknown ages are presented as if all three are current (premortem M3) | NEW |
| `crawl-permission-check` | T2 | A crawl target is added or changed | Target carries *allowed* / *ambiguous* / *disallowed* / *relationship-in-progress*; extraction is blocked unless *allowed* | [[EXTERNAL_CONNECTIONS]] exists precisely because nobody had an inventory of third-party hosts before it was written; the same gap is open one layer out, for crawl targets | NEW |
| `distributor-stage-reconcile` | T2 | Monthly, or when either team touches a distributor record | Every distributor has exactly one stage and one owning team; violations list **both** owners by name | Two charters already cite `apps/api-gateway/src/distributor-discovery/`, and the division doc calls this its highest duplication risk (`teams/product.md:828`) | NEW |

Consumed, owned elsewhere: crawl legality ([[legal-charter]] /
[[compliance-privacy-charter]]); the catalogue's own identity rules
([[catalogue-identity-charter]]); whether `/distributors` and `/vendor-prices` should exist
in that shape ([[surface-portfolio-agent-stack]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue, §3.3 gate still applying.
- **Episodic** — nf_a `task_type: supply_coverage_audit` for audit runs; the extraction
  callsites in `vendor-intel/` are the natural second family once graded. Needs
  `context.distributor` and `context.sku` as jsonb keys, so "which distributor's pages went
  stale" is one filter rather than a join invented per sweep.
- **Semantic** — `memory/` beside this file, index `supply-discovery-MEMORY.md`. First facts,
  all already established: the denominator is undefined for every restaurant, so coverage is
  *undefined*; `procurement_orders` = **1**, `pos_checks` = **0**
  ([[AGENT_NATIVE_UI_DECISION]] §2); `/distributors` ([[PAGE_MAP]]:116) and `/vendor-prices`
  (:130) are cold-entry, so this team's comparison cannot be reached by clicking. `source`,
  `confidence`, `last_verified` per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, the permission register, and
  the needed-SKU list. `vendor-intel/` and `distributor-discovery/` are retrieved by
  `path:line`, never preloaded.

**Consolidation** — monthly, mirrored in [[supply-discovery-schedule]]: read the audit slice,
**failures first** — a stale price that reached a comparison becomes a fact naming the
refetch rule that failed, not "prices aged"; a distributor with two owners becomes a fact
naming both teams and the stage; expire facts unverified for 90 days; propose candidates.
One PR. Four of six jobs are suspended today, so a run that only reports *which unblockers
are still missing* is a legitimate outcome and must say exactly that.

## 5. Async contract

Board rows, the zero-price report, permission escalations, memory PRs, NF-A events; loops
with close_times in [[supply-discovery-loops]] (L5 is `status: blocked` and names both
sides). Gap rows:

| Gap | Why it is a gap |
|---|---|
| No needed-SKU denominator for any restaurant | The primary metric's `consumes` has no publisher. Coverage is **undefined, not zero**, and the entry work is defining it for **one** restaurant — a smaller first turn than crawling another distributor |
| The supply graph's consumer barely exists | `procurement_orders` = 1, `pos_checks` = 0; two of three landing surfaces are unreachable in-app ([[PAGE_MAP]]:116, :130). The code is real; the demand pulling on it is not yet (premortem M1) |
| `crawl_target.added` has no publisher | Targets are added in code; the monthly register review bounds the blind spot at one close-time, and until then the register is backfilled by hand |
| **PROD-F2 is open** | Whether this team sits here or merges into [[supplier-distributor-network-charter]] is the founder's call via [[FORK-REGISTRY]]. The reconciliation skill *measures* the overlap monthly; it does not resolve it |

## 6. Evidence today

- **PARTIAL — and more than the docs credit.** `distributor-discovery/` (8 files, 3 specs),
  `vendor-intel/` (10 files, 3 specs incl. `wine-identity.ts`), `vendor-catalogue/`,
  `prospects.service.ts` / `prospects.controller.ts`, and
  `.planning/07-reference/PROSPECTS_ATTRIBUTION_ARCHITECTURE.md`. One of the better-tested
  areas in the department.
- **NEW — the auditor, all four skills, the denominator, the freshness policy, the
  permission register, and every `supply.*` number.** Extraction exists; the standard that
  says when its output is trustworthy does not.
- **EXISTS — the counter-evidence.** `vendor-comparison.service.ts` ships a comparison with
  no freshness concept, which is the single most load-bearing finding on this page.
