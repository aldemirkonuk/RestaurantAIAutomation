# 0186 — A menu upload classifies every drink, not only the wine

- **Status:** Locked
- **Date:** 2026-09-22
- **Decider:** Aldemir (founder) — *"we can show beer as well, use opus 5 to make that change in the pipeline."* Rejected the proposal to ship the post-upload reveal as wine-only with beer left unknown.
- **Keywords:** beverage_kind, cellar registers, menu import, beer, extraction prompt, menu_category, classifier
- **Links:** [[0080-the-app-does-not-invent-cellar-zones]], [[0130-a-generic-name-stays-the-venues-own-wine]], [[0020-no-fabricated-answers]], `.planning/07-reference/deploy/GET-STARTED-REDESIGN-2026-09-22.md`, `.planning/v3.0-TECH-DEBT.md` (menu_import unclassified entry), `supabase/migrations/20260817060000_beverage_kind_classification.sql`

## Context

The post-upload *"what this house pours"* reveal reads
`CellarRegistersService`, which has inferred all seven of the founder's
registers since 2026-09-03 (`apps/api-gateway/src/cellar/cellar-registers.ts:13-21`).
In practice it showed Wines `certain` and Beer `none`/`unknown` on a house
that pours both. The register reader was never the problem — it had no beer
to read.

Three links of the upload chain were wine-shaped, and all three had to break
for the symptom to appear:

1. **Extraction.** `WINE_EXTRACTION_PROMPT`
   (`apps/api-gateway/src/menus/parsers/scan-parser.service.ts`) said "wine
   list or beverage menu" but every field note after it named a winery, a
   vintage, a grape, and its one worked example was a Napa Merlot. `category`
   was documented as `'red' | 'white' | 'sparkling' | 'rosé' | 'dessert' |
   'other'` (`menus/wine-extract-item.interface.ts`) — a wine-style
   vocabulary with no way to say *beer*.
2. **Carriage.** `MenusService.resolveAndPersistItems` handed the library
   resolver five fields — name, producer, vintage, region, grape_variety —
   and `category` was not one of them, so whatever the extraction did decide
   about the kind of drink died at that boundary.
3. **The write.** `beverage_kind` is **not settable by application code**.
   `trg_wine_beverage_kind` recomputes it on every insert and update from
   exactly two inputs: `primary_type`, and
   `data_enrichment->>'menu_category'`
   (`supabase/migrations/20260817060000_beverage_kind_classification.sql:115-143`).
   `resolveLibraryWinesBatch` writes `primary_type: 'unknown'` **by design** —
   it is a vocabulary member meaning *unclassified*, and inventing a wine
   style would be the fabrication ADR 0020 forbids — and wrote no
   `data_enrichment` at all. So the classifier was handed nothing and
   answered `unknown`, correctly, every time.

This is not a new finding. `.planning/v3.0-TECH-DEBT.md` recorded it on
2026-09-05 with the measurement (78 rows `classification_status =
'unclassified'`, all `source = 'menu_import'`, all `beverage_kind =
'unknown'`) and the diagnosis: *"the real fault is upstream: the bulk-add
path writes a library row without ever asking the classifier. Fix the
writer."* This ADR is the founder's call to do that now, and the record of
how.

## Options considered

1. **Copy the register reader's word lists into the extraction, and set
   `beverage_kind` from the gateway.** Appealing because it needs no
   database round trip and reads as the "obvious" fix. Rejected on two
   counts: the trigger overwrites anything application code writes to
   `beverage_kind`, so it does not work at all; and it would put the
   classification rules in a second home, which is the drift the trigger was
   built to prevent.
2. **Add a TypeScript classifier mirroring `wine_classify_beverage_kind()`
   and run it before the write.** Also a second home for one fact, with the
   same drift cost, and it buys nothing the migration's own classifier does
   not already do.
3. **Let `category` carry the menu's printed section heading verbatim.**
   Cheapest possible extraction change. Rejected: the SQL classifier matches
   **whole words** (`\m(...|red|...)\M`), so "Reds by the Glass" classifies
   as `unknown` while "red" classifies as wine. A heading is free text; the
   classifier's input is not.
4. **A closed category vocabulary, carried to the existing classifier.**
   Chosen — see below.
5. **Do nothing (ship wine-only).** Explicitly rejected by the founder. It
   also leaves the tech-debt entry open and the reveal telling a house that
   pours forty beers that it does not carry beer — an ADR 0020 violation on
   the surface the founder is about to put in front of customers.

## Decision

**The extractor emits one member of a closed category vocabulary chosen to
be exactly what the database's own classifier can read, and the import
carries it to the library row as `data_enrichment.menu_category`.** No new
classifier, no new column, no change to `beverage_kind`'s one writer.

The vocabulary (`MENU_CATEGORY_VOCABULARY`,
`menus/wine-extract-item.interface.ts`) is: red, white, rose, sparkling,
orange, dessert, fortified, beer, cider, sake, cocktail, spirit, whiskey,
soft drink, non-alcoholic. Every member but one lands on a branch of
`wine_classify_beverage_kind()`; `soft drink` is the deliberate `unknown`,
because the classifier has no value for it — which is precisely why
`soft_drinks` is a `NAME_ONLY_REGISTER`
(`cellar/cellar-registers.ts:94-104`) and is still reached through the
menu-label reader.

The reasoning that carried it: **the fix belongs at the narrowest point that
was actually wrong.** The register reader was right, the trigger was right,
and the classifier was right. What was missing was an input. Widening
`category` into a closed set the classifier already understands supplies
that input without adding a rule anyone has to keep in sync, and it costs
zero extra output tokens per item — a real constraint on this prompt, where
dropping `raw_text` was worth 37 whole wines on one menu.

Because the mechanism is the classifier and not a beer special case, beer,
cider, sake, cocktails, spirits and non-alcoholic all arrive classified on
the same change. That is the founder's scope note answered: the wider
coverage was free, so it was taken.

## Consequences

- **Easier.** A house that pours beer sees Beer at `certain` after one
  upload, with the same provenance sentence Wines gets. Cocktails, spirits
  and non-alcoholic ride along. Future menu-import rows stop landing
  `classification_status = 'unclassified'`, so
  `scripts/check_beverage_kind_regression.py` can eventually go green.
- **Harder / given up.** `category` is no longer free text — it is a
  contract with a SQL regex in another file. The parity is guarded by
  `menus/a-beer-line-classifies-as-beer.spec.ts`, which **parses the
  migration** and evaluates its branches rather than restating them, so the
  two cannot drift silently. A CSV upload still supplies whatever its
  `category`/`type` column says; free text there classifies only when it
  happens to contain a keyword.
- **Not done here, on purpose.** (a) The 78 existing `menu_import` rows are
  untouched — a backfill is a data operation against a live shared
  catalogue, not part of a pipeline change. (b) `resolveOrCreateLibraryWine`
  (the single-row path used by `inventory.service.ts:1157` for a manual
  inventory add) still writes no `menu_category`; it is not the upload path
  the founder named. (c) `whiskey` classifies as `spirit` — the DB
  classifier has no whiskey value — so the Whiskey register is still reached
  by name, as documented.
- **Revisit when:** the extractor is observed returning categories outside
  the vocabulary at any material rate (the spec guards the vocabulary, not
  the model's obedience to it), or when `soft_drinks` gets a real
  classifier value and stops needing the name-only path.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-22 | Aldemir | Rejected wine-only reveal; directed the pipeline change |
| 2026-09-22 | — | Created; `feat/menu-classify-beer` |
