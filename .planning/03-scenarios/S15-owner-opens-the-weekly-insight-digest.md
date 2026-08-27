---
type: scenario
id: S15
slug: owner-opens-the-weekly-insight-digest
class: happy-path
actors: [owner, insight-engine, insight-scheduler, narrative-generator]
modules: ["[[analytics-engine-charter|analytics-engine]]", "[[insight-narrative-generation-charter|insight-narrative-generation]]"]
signals: [consumption-log, orders, inventory, checks, tables, goals, nf_b]
insights_class: [sales, inventory, purchasing, forecast, risk, tables, staff]
tier: core
sim_harness: synthetic-engine
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[analytics-engine-charter]]", "[[analytics-bi-charter]]", "[[SCENARIO-MAP]]"]
---

# S15 — Owner opens the weekly insight digest

> **The commercial scenario.** Every other ritual keeps the restaurant running; this is the
> one where the owner sees *results* and decides the subscription is worth another month. So
> it is graded hardest: a digest that promises insights the signals cannot feed is exactly
> the failure §6 exists to prevent, and the honest ceiling here is low — **25.1%** of the
> catalogue is reachable without POS (`analytics-engine-charter.md:71`).

## 1. Trigger
A weekly cadence tick (Mondays) surfaces a digest of the top insights for the owner to read.
Bounded: from the scheduler's weekly sweep to the owner opening the digest and acting,
dismissing, or ignoring each item. Where the digest is *delivered* (in-app vs emailed) is a
live gap — see §5.

## 2. Actors
Owner (reads it, cold, over coffee — no analyst in the loop) · the insight engine (COMPUTE +
SCORE, `insight-generator.service.ts`) · the scheduler (decides when it refreshes) · the
narrative generator (VERBALIZE + RANK — the sentence and the ordering, a **sibling team's**
job, `analytics-engine-charter.md:46-48`).

## 3. Signals
The digest is a *readout* of already-captured operational signals — it captures nothing new.
Its honesty is entirely inherited from what fed it. The engine's own `availableCandidates()`
gates every type on its `DataRequirement` set (`insight-catalog.ts:557-563`):
- **consumption** (`wine_consumption_log`) · **orders** · **inventory** — the no-POS trio.
- **checks** and **tables** — the POS/guest-side half, and the reason the ceiling is low:
  **429 of 573 types (74.9%) require `checks`**; 241 (42.1%) require `tables`
  (`analytics-engine-charter.md:89-95,134-142`).
- **goals** — *declared but never wired*: 22 goal-pace types report satisfiable even for a
  restaurant with zero goals rows, because `goal_pace` is pinned to the `overall` dimension
  whose `requires` is empty (`analytics-engine-charter.md:144-152`). A real gap to name, not paper over.
- **NF-B** — `checks`/`tables`-dependent share is the truest readout of guest-side substrate
  arrival; the with-POS space is provably larger (`insight-catalog.spec.ts:36-44`).
- **NF-A** — the digest itself makes no agent decision here, so no NF-A row is owed; and none
  would land anyway, since NF-A emits nothing in the gateway today. *Corrected
  2026-08-25: the gateway emits since P1; the "no NF-A row is owed here" half of this
  point still holds on its own.*

## 4. Queries the product must answer
- "What changed this week that I'd want to know?" — ranked by effect × significance × support
  (`scoreOf`, `insight-generator.service.ts:192-203`).
- "Is this a real signal or noise?" — the significance gate (`pValue < 0.1` on the basket
  family, `association.ts:89-92`) — thin today; see §8.
- "How many of the things you *could* tell me can you actually compute for *my* data?" — the
  engine answers this honestly in-band: it returns `candidateTypesAvailable` and
  `candidateTypesTotal` on every run (`insight-generator.service.ts:123-124`).

## 5. Outputs (in the moment)
- A ranked list of the week's top insights, capped per category (`maxPerCategory`,
  `insight-generator.service.ts:107-113`), stored for an instant read (`analytics_insights`).
- **The delivery layer is the honest gap.** The scheduler *refreshes and persists* insights
  on an hourly/daily/**weekly (Mondays)** cadence (`insight-scheduler.service.ts:8-17,97`) —
  it does **not** email them. A digest *preference* row exists (recipient email, hour, toggle)
  but **its scheduled send is feature-flagged** and there is no insight-digest mailer in the
  analytics module (`analytics.controller.ts:799`; only prefs persistence, `recommendation-actions.service.ts:238-280`).
  So "owner opens the *email*" is aspirational; "owner opens the in-app panel" is real.

## 6. Insights the owner sees (the heart — checked against the 25.1% ceiling)
Only the families the engine actually computes sentences for ship: **consumption, orders,
inventory, checks, goals** (`insight-generator.service.ts:94-98`). Against a **no-POS**
restaurant, this is what is genuinely on the table:
- **Sales / consumption** — velocity, week-over-week movement, weekday-baseline gaps.
  *Depth tracks how full `wine_consumption_log` is (§3).*
- **Inventory** — days-of-cover, reorder point vs on-hand, dead-stock capital. Real without POS.
- **Purchasing / forecast** — the smaller reachable slice (`forecast` = 30 types,
  `purchasing` = 27 of 573, `analytics-engine-charter.md:82-83`).
- **What the owner does NOT get without POS:** the two biggest categories are **`tables`
  (174 types)** and **`efficiency` (108)** (`analytics-engine-charter.md:82-83`) — both
  guest-/check-side, both dark. Roughly **three quarters of the catalogue is unreachable**
  and no new math changes that (`analytics-engine-charter.md:74-76`).
- **The mislabel to correct, not inherit:** the shipped UI says *"Browse all 375 insight
  types"* (`commands.ts:78,99`; `InsightCatalog.tsx:2`) while the enumerated space is **573**
  (`insight-catalog.ts:547`) and only ~144 are satisfiable. The digest must show the *reachable*
  count for *this* restaurant, never a headline 375/573 (OD-33; `OPEN-DECISIONS.md:36`).

## 7. Decisions
Human: the owner acts on, snoozes, or dismisses each insight, and sets which categories and
cadence they want (`insight-scheduler.service.ts:153-173`). System **proposes only**: it
computes, scores, ranks, and verbalizes — it never acts on an insight, and it must state its
own reach rather than imply completeness (ask→propose→confirm→execute).

## 8. Failure modes
- **The digest promises what the signals can't feed** — the canonical failure. Guarded only
  if §6's reachable-count discipline holds; broken the moment the UI's 375 headline ships.
- **False discovery at scale** — 573 types × live entities = thousands of simultaneous tests
  per run, with `pValue < 0.1` on one family the only significance gate and **no
  multiple-comparison correction** (`analytics-engine-charter.md:167-174`). A weekly digest
  is precisely where spurious "insights" surface confidently.
- **The gating arithmetic is the least-tested link** — χ²/p-value appear in zero assertions
  across 11 spec files (`analytics-engine-charter.md:154-165`).
- **Goals mirage** — 22 goal-pace types read as satisfiable with no goals set (§3).
- **A stale/empty week** renders an empty digest that reads as "nothing happened" — must say
  *"not enough data"*, not imply calm.

## 9. Simulation & deploy gate
Harness: **synthetic engine**. Generate weeks against varying availability sets — consumption-
only (**expect ~6.6%**, 38/573), consumption+orders+inventory (**expect ~25.1%**, 144/573),
and full seven (**100%**, `analytics-engine-charter.md:66-72`) — plus a quiet week and a
false-spike week. Gate: no digest/engine change ships until the reachable counts match those
baselines exactly and the empty/false-spike weeks produce honest copy, not fabricated
insights. `simulated` before `live`, locked — no exception, including this one.

## 10. Tier cut (OD-48 locked — Core/Plus/Pro; prices open, OD-23) — sharpest here

The entitlement story is clearest in this scenario, because **the tiers map directly onto the
satisfiability ladder** — Core/Plus/Pro is, here, literally a data-availability ladder wearing
a pricing name.

- **Core (operate):** the in-app insight panel showing **only what is currently reachable for
  this restaurant**, with `candidateTypesAvailable / candidateTypesTotal` stated in-band on
  every run. For a no-POS restaurant that is the consumption / orders / inventory basics —
  **144 of 573 types (25.1%)**, dropping to **38 / 573 (6.6%)** if only `wine_consumption_log`
  is populated. Short, unglamorous, and honest. Ships today.
- **Plus (understand):** the assembled weekly digest — ranked by effect × significance ×
  support, capped per category, narrated, with drafted recommendations across the reachable
  families. The compute and persistence ship (Monday cadence,
  `insight-scheduler.service.ts`). **Delivery is the honest gap:** the scheduler refreshes and
  persists but does **not** email; a digest-preference row exists (recipient, hour, toggle) and
  **its scheduled send is feature-flagged**, with no insight-digest mailer in the analytics
  module. 🚧 "Owner opens the *email*" is aspirational; "owner opens the in-app panel" is real.
- **Pro (optimize):** Holt-Winters forecasting plus the guest-side families — and this is
  **the biggest single POS gate in the library**. ⛔ **needs POS: 429 of 573 types (74.9%)
  declare a `checks` requirement and 241 (42.1%) declare `tables`.** The two largest categories
  in the whole catalogue, **`tables` (174 types)** and **`efficiency` (108)**, are entirely
  dark without POS. Roughly three quarters of Pro's promised surface is unreachable and **no
  amount of new math changes that**.

**The labelling rule that binds every tier page:** never headline "375 insight types" (the
number the shipped UI prints) — the enumerated space is **573**, only ~144 are satisfiable
without POS, and the count shown must be *reachable-for-this-restaurant* (OD-33). A tier page
advertising a catalogue total is the canonical failure §6 exists to prevent.

**Guard before any of this is sold:** 573 types × live entities produces thousands of
simultaneous tests per run, with `pValue < 0.1` on one family as the only significance gate and
**no multiple-comparison correction** — and χ²/p-value appear in **zero assertions across 11
spec files**. A weekly digest is exactly where spurious "insights" surface confidently. Pro
sells statistical claims the pipeline cannot yet defend.

## 11. Evolution feedback
Which insights the owner opens, acts on, or dismisses is the single best signal of which §6
stories earn the subscription — and it feeds directly back into `scoreOf`'s weighting and the
narrative team's ranking. The gap between `candidateTypesAvailable` and `candidateTypesTotal`,
shown weekly, is also the most honest possible upsell: it *names POS as the constraint* rather
than hiding it (`analytics-engine-charter.md:74-76`).

**Flex points:** cadence (weekly vs daily), category subscription (which families a given
owner cares about), delivery channel (in-app vs email, once the mailer exists), and the
reach-count framing (reachable-for-me vs catalogue-total — the OD-33 call).
