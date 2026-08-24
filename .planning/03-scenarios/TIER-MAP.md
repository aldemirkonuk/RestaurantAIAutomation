---
type: moc
title: Tier Map
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[SCENARIO-MAP]]", "[[analytics-bi-charter]]", "[[analytics-engine-charter]]"]
---

# Tier Map — what a subscriber at each level actually gets

> The entitlement axis runs **through §10 of each scenario**, not through pages (OD-48,
> locked 2026-08-24). **Core = operate** · **Plus = understand** · **Pro = optimize**.
> Price points are **founder-deferred (OD-23)** and appear nowhere in this document.
>
> This is a *satisfiability* map as much as a packaging map. Its job is to answer one
> question honestly: **if someone paid today, what would arrive?**
>
> Retire-to-write: this supersedes the OD-48 bullet in [[SCENARIO-MAP]] §Open, which is
> now resolved and points here.

## Legend

| Mark | Means |
|---|---|
| ✅ | **Ships today** — code and signals both exist in the repo now |
| ⚠️ | **Partial** — real for part of the domain (wine-only, mapped-lines-only, rate-but-not-cost) or half-shipped |
| ⛔ | **Needs POS** — cannot be computed, or cannot be *trusted*, without a connected POS |
| 🚧 | **Signal not built** — the capturing signal does not exist in the repo; a build target, not a deliverable |
| — | Deliberately empty at this tier |

A cell may carry two marks. `⛔` on its own means the capability is built but dark without POS;
`🚧 ⛔` means it needs a signal built *and* a POS behind it.

## The matrix

| # | Scenario | `tier:` | **Core — operate** | **Plus — understand** | **Pro — optimize** |
|---|---|---|---|---|---|
| S01 | Guest dines and rates | core | 🚧 visit + rating + points capture (consumer-side; operator sees nothing) | 🚧 ⛔ dish popularity by k-anon cohort | 🚧 ⛔ par/promote/86 proposals, novel-dish fit |
| S02 | Vendor delivery arrives | core | ✅ PO-prefilled checklist, one-tap accept/short/damaged, 3-way mismatch flag | ✅ vendor scorecard, drafted credit email, per-delivery COGS trace | ⚠️ ⛔ cross-vendor price variance + par proposals ship; stockout delta needs POS depth |
| S03 | Delivery short / wrong / damaged | core | ✅ 9-outcome match verdict, one headline per line, damage photo | ✅ reliability scorecard, credit claim opened-never-sent | ⚠️ 🚧 settled-recovery ledger + ageing ship; cross-tenant benchmark unbuilt |
| S04 | POS order flows to inventory | core | ✅ idempotent depletion, live stock, low-stock edge alert, unresolved queue | ⚠️ pour velocity + yield — **mapped wine only**; food never depletes | ⚠️ 🚧 wine variance vs receiving ships; plate-level needs recipe BOM |
| S05 | Service runs; floor is checked | core | 🚧 ⛔ personal food-up ping, check-in nudge | 🚧 ⛔ check-in coverage, food-up p95 latency | 🚧 ⛔ cross-shift routing intelligence, latency-based staffing |
| S06 | New dish / menu item | core | ⚠️ import + review queue **(wine ✅ / food 🚧 string-only)** | ⚠️ catalogue coverage + extraction accuracy — wine only | 🚧 ⛔ cross-restaurant library, producer normalization, basket affinity |
| S07 | Guest complaint mid-service | core | 🚧 ⛔ individual waiter alert, escalation, one-tap recovery | 🚧 ⛔ recovery rate, complaint by section/shift | 🚧 ⛔ repeat-pattern detection, staffing proposals |
| S08 | Vendor price drift | **plus** | — *(drift is not an operate feature)* | ✅ 7/30/90 trend chips, show-your-working panel, drift flag | ⚠️ COGS attribution, vendor-vs-market, switch-worthiness — **wine only**, food scaffolding |
| S09 | POS webhook drops / desyncs | core | ⚠️ dedupe ✅; 🚧 **missed-webhook alert does not exist**, DLQs don't cover ingress | 🚧 connector-reliability scorecard, drift reconcile (needs a delivery ledger + poller) | 🚧 predictive gap detection, auto-replay — **thinnest Pro in the library** |
| S10 | Stockout risk before a busy night | core | ✅ par/threshold alert, ranked at-risk list, durable notification | ✅ days-of-cover, reorder point, drafted reorder + split-vendor hedge, dead stock | ✅ ⛔ Holt-Winters, King's-formula safety stock, per-SKU stockout probability — **built; POS for depth** |
| S11 | Waste / spoilage logged | core | ✅ one-tap waste log, FIFO lot depletion, on-hand + par re-check | ⚠️ waste **rate** ✅; waste **cost** only where unit cost was attached at log time | ⚠️ ⛔ par-cut + reorder proposals ship; **margin drag needs POS** |
| S12 | Guest food identity over visits | core | 🚧 consent-gated check link (zero application callers today) | 🚧 taste profile, cohort demand with divergence — **wine-only if ever** | 🚧 ⛔ mechanism-level recommendation, k-anon demand proposals |
| S13 | New vendor discovery & onboarding | core | ✅ catalogue search, one-tap add, 409 dedupe, Prospects digest | ⚠️ ⛔ coverage + freshness + category gaps — **denominator flatters without POS** | ⚠️ 🚧 supply-graph gap proposals; discovery is catalogue-first, comparison routes unreachable |
| S14 | Connecting a new POS provider | core | ✅ 27-provider picker w/ honest badges, `generic_webhook` + `csv_import`, status | ✅ catalog auto-map ≥0.9 + review queue, mapping coverage, connection health | 🚧 native OAuth adapters, multi-location — **no native adapter is `available`** |
| S15 | Owner opens the weekly digest | core | ✅ in-app panel of what is reachable **for this restaurant** (144/573, or 38/573) | ⚠️ ranked narrated digest computes ✅; 🚧 **no mailer — scheduled send is feature-flagged** | ⛔ forecasting + `tables` (174) + `efficiency` (108) — **429/573 (74.9%) need `checks`** |
| S16 | Staff misses a table window | core | 🚧 ⛔ missed-window nudge, food-up alert (kitchen-ready **unmodelled**) | 🚧 ⛔ missed-window rate, ready-to-waiter p95 | 🚧 ⛔ staffing/section proposals, slow-pickup sales impact |
| S17 | Same product, two identities | core | ✅ duplicate queue, dry-run preview, non-destructive supersede merge | ✅ ranked candidates w/ match kind + co-occurrence, catalogue health | ⚠️ 🚧 cross-tenant/provider dedupe, producer normalization at scale |

## Tier distribution

| `tier:` value | Count | Scenarios |
|---|---|---|
| `core` | **16** | all except S08 |
| `plus` | **1** | S08 (its Core is deliberately empty — drift is not an operate feature) |
| `pro` | **0** | — |

The distribution is itself a finding: **every scenario but one delivers its first value at
Core.** There is no scenario whose entry point is a premium tier. Whatever the eventual
packaging, Core carries the product.

## Buildable today — the honest summary row

| Tier | ✅ ships today | ⚠️ partial | 🚧 signal not built | Reading |
|---|---|---|---|---|
| **Core** (16 scenarios + 1 empty) | **9** — S02, S03, S04, S10, S11, S13, S14, S15, S17 | **2** — S06 (wine only), S09 (dedupe only) | **5** — S01, S05, S07, S12, S16 | **~10 of 16 real.** Core is the tier we could sell tomorrow — but only for procurement, inventory, catalogue and POS-ingest. Every guest-facing and floor-facing Core capability is unbuilt. |
| **Plus** (17) | **6** — S02, S03, S08, S10, S14, S17 | **5** — S04, S06, S11, S13, S15 | **6** — S01, S05, S07, S09, S12, S16 | **~8 of 17 real.** The understand layer exists wherever procurement and inventory signals exist, and nowhere else. |
| **Pro** (17) | **0 unqualified** | **8** — S02, S03, S04, S08, S10, S11, S13, S17 | **8** — S01, S05, S06, S07, S09, S12, S14, S16 (+ S15 gated purely on POS) | **~2–3 of 17 real.** No Pro tier in the library ships complete. |

### What this means, stated plainly

- **Core is a real product today, for half the library.** Receive a delivery, catch a short,
  log waste, watch stock, add a vendor, import a wine list, connect a POS, merge a duplicate —
  all of that works now, without a POS, on procurement and inventory signals inside the
  **25.1% no-POS satisfiable band**. That is a coherent thing to sell.
- **Plus is real wherever Core is real, and imaginary everywhere else.** The scorecards and
  drafts exist exactly where the operational signal already exists (S02, S03, S08, S10, S14,
  S17). Where Core is unbuilt, Plus is unbuilt by construction — there is no partial version.
- **Pro is mostly aspirational, and that is the headline finding of this document.** Zero of
  seventeen Pro tiers ship complete. Two come close: **S10** (forecasting and safety-stock math
  are built, tested, and degrade to honest nulls — but a thin consumption series without POS
  means the owner mostly sees those nulls) and **S08** (COGS attribution, vendor-vs-market and
  switch-worthiness all ship — **for wine**; the food path is scaffolding and would recommend
  the wrong vendor). Everything else at Pro is either domain-limited, POS-gated, or waiting on
  a signal nobody has built.
- **The single biggest gate is POS.** **429 of 573 insight types (74.9%) require `checks`** and
  241 (42.1%) require `tables`; the two largest categories, `tables` (174) and `efficiency`
  (108), are entirely dark without it. Connecting a POS moves a restaurant from **25.1% to
  100%** of the catalogue. Pro is, almost definitionally, *"you plugged in your POS"* — which
  makes **S14 the true upgrade trigger, and an argument for keeping POS connection in Core and
  frictionless** rather than behind a paywall.
- **The second gate is unbuilt signal, and it clusters.** Three families account for all 8
  fully-unbuilt Pro tiers: **guest** (S01, S12 — no ratings table, no points ledger,
  `guest_check_links` has zero callers, NF-B has never emitted an event, and food identity is a
  *decided defer*), **Floor Checker** (S05, S07, S16 — no floor module at all, `table → server`
  is 0 of 47 rows, and `kitchen-ready` is absent from `CanonicalCheck` entirely), and
  **connector failure capture** (S09 — no delivery ledger, no reconcile poller). None of these
  is a tuning problem; each needs something built before any tier over it is honest.
- **Two boundaries outrank packaging.** Floor Checker (S05/S07/S16) must never be sold as staff
  performance analytics — the moment it is, the floor produces false compliance data and every
  tier above Core measures a fiction. And S17's Pro must never mean auto-merge: a false merge
  is silent, global, and unrecoverable, and un-merge provably does not restore inventory.
- **One labelling rule binds any tier page built from this map.** Never headline a catalogue
  total. The shipped UI prints *"375 insight types"*; the enumerated space is **573** and only
  ~144 are satisfiable without POS. A tier page must show the **reachable-for-this-restaurant**
  count (OD-33) — the same discipline SCENARIO-CONTRACT §5 imposes on every §6.

## Open

- **OD-23 — price points.** Founder-deferred. Nothing in this document assigns or implies one.
- **The Pro-tier question this map raises but cannot answer:** whether Pro ships as a
  POS-gated tier (honest, but means most subscribers can never reach it) or waits until the
  guest and floor signals exist. That is a founder call, not a satisfiability fact.
