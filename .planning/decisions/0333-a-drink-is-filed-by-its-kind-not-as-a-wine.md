# 0333 — A drink is filed by its kind, not as a wine, and the rows already stored are re-filed

- **Status:** Locked
- **Date:** 2026-10-11
- **Decider:** founder (2026-10-11 chat)
- **Keywords:** F-1314, F-1293, F-738, F-1317, beverage_kind, menu_category, Turkish section, unknown, wine default, house item kind, data migration, refile
- **Links:** [ADR 0115](0115-the-house-item-is-the-ledgers-key.md) (a house item states its kind); migration `20260817060000_beverage_kind_classification.sql` (`wine_classify_beverage_kind`); migration `20270103900000_a_house_item_takes_its_kind_from_the_library.sql` (F-738); sim ledger S183 residual F-1314 and S195

## Context

Until F-1293, the menu import stored a Turkish section as it was written ("Rakı", "Bira", "Kırmızı Şaraplar") in `master_wine_library.data_enrichment.menu_category`. The classifier `wine_classify_beverage_kind()` reads English words only, so those rows got `beverage_kind = 'unknown'`. Then `set_house_item_identity()` filed every unknown row as a **wine** house item (`20270103900000`, header: "'wine' and 'unknown' stay 'wine'").

F-1293 fixed new imports. Rows stored before it are still wrong: a rakı or a beer is counted, valued and reported as wine. Fixing them means rewriting stored production rows, which needs the founder's word.

The founder, 2026-10-11, verbatim: *"Yeah, we have to refile drinks as per, per day or category, not as wines."* ("per day" is a speech-to-text slip for "per kind".)

## Options considered

1. **Leave stored rows, fix only new imports (as built).** No data is touched. But every house that imported a Turkish menu before F-1293 keeps beers and spirits in its wine figures.
2. **Re-file every unknown row as 'other'.** This is quick. But it still misfiles a rakı, and it moves real wines out of wine.
3. **Re-file each stored row by the kind its own section names, only where the section is unambiguous, and keep the heading as written.** **Chosen.**

## Decision

**A drink is filed by its real kind (wine, beer, spirit and so on), read from its menu section with the same vocabulary the import uses. Rows stored before F-1293 are re-filed by a data migration, which applies on merge (approved by the founder).**

1. **Only unambiguous rows move.** A row moves only if it is still `unknown`, its section names no food, and every drink word in the section names the same kind. A section like "Beyaz ve Roze" (two kinds) or "Kırmızı Et" (meat) is left alone and counted in the migration's notice.
2. **The heading is kept.** The section as written is kept beside the new category, so nothing a person typed is lost.
3. **A kind a person declared is never overwritten.** Only kinds that the trigger or the backfill chose (`wine_library`, `backfill`) follow the library row's new kind.
4. **One vocabulary.** The migration's word lists are the gateway's `DRINK_WORD_KINDS` and `FOOD_NOUNS` (`apps/api-gateway/src/menus/menu-line-view.ts`), and a test holds them equal.
5. **Nothing is deleted, and the migration can run again.** A row it has re-filed is no longer `unknown`, so a second run changes nothing.

## Consequences

- Wine figures (stock value, pour cost, reports) stop counting beer and spirits for houses that imported Turkish menus early.
- Ambiguous rows stay `unknown`→wine until a person files them. The notice says how many there are.
- A library row reclassified after its house item was added still does not carry the new kind to that item, as `20270103900000` records. That is not changed here.
- Revisit if the notice shows many ambiguous rows (the signal is a house with more ambiguous rows than re-filed ones).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-11 | — | Created from the founder's chat ruling (sim S195) |
