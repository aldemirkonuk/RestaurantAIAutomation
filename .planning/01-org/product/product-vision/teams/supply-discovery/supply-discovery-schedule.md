---
type: schedule
division: product
department: product-vision
team: supply-discovery
status: provisional
metrics: [supply.price_freshness_p50_days, supply.needed_sku_denominator_size]
updated: 2026-08-24
links: ["[[supply-discovery-charter]]", "[[supply-discovery-loops]]", "[[supply-discovery-agenda-board]]", "[[product-vision-schedule]]", "[[supplier-distributor-network-charter]]", "[[legal-charter]]"]
---

# Supply Discovery (Vendor Finder) — Schedule & Skills

## Recurring work

| Cadence | Job | Emits | State |
|---|---|---|---|
| **Weekly** | **Freshness sweep** — price age distribution across matched SKUs; count of prices displayed without an age (target 0); refetch queue ordered by needed-list position | `supply.price_freshness_p50_days`, `supply.prices_beyond_stale_threshold` | ⏸ **Suspended** — unblocked by the freshness policy artifact |
| **Monthly** | **Coverage triple** — coverage %, denominator size, freshness p50, published together or not at all | `supply.sku_dual_price_coverage_pct` | ⏸ **Suspended** — unblocked by one restaurant's needed-SKU list |
| **Monthly** | **Zero-price report** — needed SKUs with no live price. The only list that justifies crawl expansion | `supply.skus_with_zero_prices` | ⏸ **Suspended** — same unblocker |
| **Monthly** | **Permission register review** — every crawl target has a recorded status; ambiguous ones older than one close-time escalate to [[legal-charter]]; blocks received are reviewed as signals | `supply.targets_with_recorded_permission`, `supply.blocks_received` | **Running** — the register can be backfilled today |
| **Monthly** | **Distributor stage reconciliation** — jointly with [[supplier-distributor-network-charter]]; any distributor with two owners at one stage is a finding | `supply.distributors_with_two_owners_at_one_stage` | **Running** once the state list exists (target: this close-time) |
| **Monthly** | **Match-precision read** on a labelled set, reported next to unmatched-line count | `supply.match_precision_on_labelled_set` | ⏸ **Suspended** — unblocked by a labelled set |

**Anti-sprawl rule:** a scheduled job producing no action for **3 consecutive runs** is
downgraded or deleted. Four of six jobs above are suspended with named unblockers rather
than scheduled to run empty — with `procurement_orders` = 1 and no denominator, running them
would generate three clean-looking reports about nothing, which is how a schedule becomes
fiction (foundation §6).

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion. Per
foundation §3.3 each names a trigger, doneability criteria, a **real past instance**, and an
owner. The repo has exactly one project skill today
(`.agents/skills/railway-config/SKILL.md`) — everything below is **proposed, not built**.

| Skill (proposed) | Tier | Trigger | Doneability | Past instance that justifies it |
|---|---|---|---|---|
| `needed-sku-derive` | T1 | A restaurant is onboarded, or its par levels / menu change | Produces a dated needed-SKU list with a stated derivation (par / menu / purchase history) — the denominator, with its provenance attached | Coverage has been the stated metric for this module since the team doc, and nobody has ever been able to compute it because no denominator exists anywhere in the repo |
| `price-freshness-sweep` | T1 | Weekly | Every matched SKU's newest price has an age; anything past the stale threshold is queued for refetch in needed-list order | `vendor-comparison.service.ts` compares prices today with no freshness concept — a comparison of three prices of unknown ages is presented as if all three are current |
| `crawl-permission-check` | T2 | A crawl target is added or changed | Target carries *allowed* / *ambiguous* / *disallowed* / *relationship-in-progress*; extraction is blocked unless *allowed* | `EXTERNAL_CONNECTIONS.md` inventories every third-party host precisely because nobody had a list before; the same gap exists for crawl targets, one layer out |
| `distributor-stage-reconcile` | T2 | Monthly, or when either team touches a distributor record | Every distributor has exactly one stage and one owning team; violations are listed with both owners named | Two teams already cite `apps/api-gateway/src/distributor-discovery/` in their charters, and the division doc calls this its highest duplication risk (`teams/product.md:828`) |

**Deliberately not proposed:**

- **No "crawl more distributors" skill.** Supply expansion is only justified by a needed SKU
  with zero prices, which the zero-price report already produces. A skill that expands crawl
  coverage on its own schedule is [[supply-discovery-premortem]] M1 automated.
- **No vendor-outreach skill.** Contacting a distributor is
  [[supplier-distributor-network-charter]]'s job, and a skill that blurs it would resolve the
  division's open boundary fork by accident rather than by decision.
