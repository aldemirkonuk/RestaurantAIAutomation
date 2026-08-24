---
type: scenario
id: S06
slug: new-dish-or-menu-item-enters-the-system
class: happy-path
actors: [owner, manager, menu-extraction-pipeline, catalogue-identity, inventory-system]
modules: ["[[catalogue-identity-charter|catalogue-identity]]", "[[inventory-ledger-charter|inventory-ledger]]"]
signals: [menu-document, extracted-line, raw_extracted_text, pos-item-string, nf_a]
insights_class: [catalogue-coverage, provisional-cleanup, extraction-accuracy, basket-affinity]
tier: core
sim_harness: synthetic-engine
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[catalogue-identity-charter]]", "[[MENU_EXTRACTION_SCALE_PLAN]]", "[[DISH_IDENTITY_DESIGN]]"]
---

# S06 — New dish/menu item enters the system

## 1. Trigger
A new sellable item appears in the restaurant's world: a menu is imported (photo/PDF
scan, CSV, or hand-entry) or a POS starts ringing a line the catalogue has never seen.
Bounded: from the item first observed to it resolved to an identity and seeded into the
catalogue. Prior art is real but **beverage-only**: `POST /menus/import` →
`menus.service.ts:62 importMenu` → `scanParser.parse()` (`menus.service.ts:76`) →
`resolveAndPersistItems` (`menus.service.ts:294`) → `resolveOrCreateLibraryWine`
(`wine-submissions.service.ts:444`) → the `match_library_wine` RPC
(`wine-submissions.service.ts:453`).

## 2. Actors
Owner/manager (imports the menu, clears the review queue) · the menu-extraction pipeline
(vision/LLM parse) · catalogue-identity (match keys, provisional vs library) · inventory
ledger (an accepted item may seed a stock row). No guest, no vendor.

## 3. Signals
- **Wine (strong):** extracted line — producer, name, vintage, price — plus
  `raw_extracted_text` persisted verbatim to `menu_items.raw_extracted_text`
  (`MENU_EXTRACTION_SCALE_PLAN.md:288`) as the audit substrate. Match keys are backfilled
  and word-similarity is indexable (migrations `20260812000000`, `20260813000000`,
  `20260813010000`), so a line resolves to a library wine or a **tier-3 provisional**
  (`wine-submissions.service.ts:500`).
- **Food/dish (thin — deferred):** only the **raw POS string**, captured unconditionally
  at `pos-hub.service.ts:168/202`. There is **no food menu table** (`menu_items` is
  wine-only, `DISH_IDENTITY_DESIGN.md:41`) and dish identity is a decided defer — a
  policy would be unfalsifiable because no food menu means no same-menu negative-label
  source (commit `b728d25`, `DISH_IDENTITY_DESIGN.md`). A dish "enters the system" as a
  string; nothing is resolved.
- NF-A verdict/cost per extraction call — the known L4 emit gap, as in S02.

## 4. Queries the product must answer
- "Is this item already in the catalogue, or is it new?" — library match vs provisional.
- "Did the extractor read the menu correctly?" — coverage ratio (extracted / priced
  lines), the honest verifier (`MENU_EXTRACTION_SCALE_PLAN.md:135-143`).
- "Did we just create a duplicate of a wine we already carry?" — feeds [[S17-same-product-two-identities-merge|S17]].
- For a dish: **none of the above are answerable** — the string is the identity.

## 5. Outputs (in the moment)
- A **review queue**: each line tagged `library_match` or `provisional_created`
  (`decision_reason`, `menus.service.ts:485`); discrepancy and low-confidence lines
  surfaced for a human glance.
- One-tap: confirm match / accept provisional / correct — the owner clears the queue,
  the system does not silently commit new library identities.
- On accept, an optional seed of a `restaurant_inventory` row for the item.

## 6. Insights the owner sees (the payoff)
- **Catalogue coverage:** how much of the menu resolved to known identities vs
  provisionals awaiting cleanup — a POS-free, consumption-independent count (within the
  25.1% satisfiable-without-POS band, [[analytics-bi-charter]]).
- **Extraction accuracy over time:** where the parser needed correction, per menu.
- **Basket affinity** on raw item strings — `getBasketAffinity()` already runs
  lift-based pairing over POS names with no `is_wine` filter (`table-analytics.service.ts:416`,
  `DISH_IDENTITY_DESIGN.md:22-24`). Honest ceiling: with no dish identity, food pairings
  cannot dedupe or roll up across restaurants — "Ribeye" here ≠ "Ribeye" next door.

## 7. Decisions
Human: confirm/deny each match, accept a provisional, correct an extraction. The system
**proposes** (ask→propose→confirm→execute): the candidate library match, the provisional
identity, an inventory seed. It never promotes a provisional into the shared library
above tier 3 without governance review — and for dishes it proposes **nothing**, by
design.

## 8. Failure modes
- Extraction mis-reads a line → wrong identity seeded → every downstream count wrong
  (silent). The verifier gates on coverage precisely to catch this.
- Same wine imported twice phrased differently → two provisionals → a duplicate that
  [[S17-same-product-two-identities-merge|S17]] must later merge (`MENU_EXTRACTION_SCALE_PLAN.md:397-399`).
- Someone builds a `master_dish_library` on the 37 eyeballable POS strings — fitted to
  noise, passing human review *because* n is small (`DISH_IDENTITY_DESIGN.md:208`).
- The deferral is forgotten and re-derived a year later (`DISH_IDENTITY_DESIGN.md:218`).

## 9. Simulation & deploy gate
Synthetic engine generates menus (clean · dense · scanned-no-text-layer · re-import) and
runs `reimport_roundtrip.py` — extract a menu twice with independent model calls and
confirm the same wine matches itself (`MENU_EXTRACTION_SCALE_PLAN.md:576-592`). Gate:
extraction/matching changes ship only when the re-import round-trip creates zero new
duplicates and coverage stays in band. Food paths ship `none-yet` until a food menu
exists.

## 10. Tier cut (OD-48 locked — Core/Plus/Pro; prices open, OD-23)

**Read every tier below as beverage-only.** The wine path ships (`POST /menus/import` →
`scanParser` → `resolveAndPersistItems` → `match_library_wine`). The food path does not exist:
`menu_items` is wine-only, there is no food menu table, and dish identity is a **decided
defer** (A15) — a dish "enters the system" as a raw POS string and nothing resolves.

- **Core (operate):** import a menu (photo / PDF / CSV / hand-entry), get a **review queue**
  with each line tagged `library_match` or `provisional_created`, and clear it one tap at a
  time — confirm match / accept provisional / correct — optionally seeding a
  `restaurant_inventory` row on accept. Ships today for wine; ⚠️ for food, Core delivers
  capture-as-a-string and no review queue at all.
- **Plus (understand):** the catalogue-coverage scorecard (how much of the menu resolved to
  known identities vs provisionals awaiting cleanup) and the extraction-accuracy trend showing
  where the parser needed correction, per menu. POS-free and consumption-independent — inside
  the **25.1% no-POS band**. Wine only.
- **Pro (optimize):** cross-restaurant library intelligence and producer normalization at
  scale — 🚧 **signal not built**: there is no shared multi-tenant promotion path above tier-3
  provisional. Basket affinity over raw item strings **does run today**
  (`getBasketAffinity()`) but ⛔ **needs POS** — it reads POS item names — and its ceiling is
  hard: with no dish identity, food pairings cannot dedupe or roll up across restaurants
  ("Ribeye" here ≠ "Ribeye" next door). Dish identity itself is 🚧 and **deliberately
  deferred**, so a Pro tier must not imply it is coming next quarter.

## 11. Evolution feedback
Where reviewers override the match tells us where extraction/matching is weak; a wine
that resolves to two provisionals feeds `identity.false_split_count`
(catalogue-identity charter metric). Which items the owner opens after an import tells us
which §6 stories earn the seat.

**Flex points:** menu format (photo/PDF/CSV/hand-entry); beverage vs food (food captured
as string only); whether accepting an item auto-seeds inventory; who clears the review
queue (owner vs manager).
