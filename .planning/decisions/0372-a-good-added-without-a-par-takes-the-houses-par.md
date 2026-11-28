# 0372 — A good added without a par takes the house's par, from one reader

- **Status:** Proposed (2026-11-20). The delegate's call (founder delegated every fork on 2026-11-19); a lock is the founder's.
- **Date:** 2026-11-20
- **Decider:** executor (r102 onboarding builder), reading [ADR 0116](0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer.md)'s rule that a default is not an answer.
- **Keywords:** low-stock par, threshold_min, default_threshold_min, house par, inventory, menu import
- **Links:** r102/FUNC-onboarding-r102.md (the finding); PR #801 (the `||` to `??` half, this stacks on it).

## Context

One house-wide low-stock par was written five ways: the `restaurant_inventory.threshold_min` column default is 3, the menu path falls back to 3 when a menu is made current, the inventory add path wrote 6 (`dto.thresholdMin || 6`, and a bulk line `?? 6`), the `import_restaurant_data` SQL function defaults 5, and the one screen that wrote `restaurants.default_threshold_min` (ThresholdStep) has no importer. Worked number: an owner states 12. A wine from a menu import got 12; a wine added from inventory got 6; a house that never stated one got 3 on one path and 6 on the other. Every page that reads `threshold_min` (low stock, below par, the all-clear) therefore disagreed about the same house.

## Decision

1. The inventory add paths (`createInventoryItem`, the bulk receive line) read the house value through the one reader the menu path uses (`readHouseThresholdMin`, `inventory/house-par.ts`) when the caller gave no par. A typed par, including 0, is kept and the house is not asked (PR #801 made `||` into `??`).
2. A house that stated none takes the column's own default, 3, on both paths. 6 is gone from the add paths.
3. The menu path's private fallback constant is removed; it calls the same reader.
4. A read that fails is not "the house stated none". The reader throws a 503 ("The house's par could not be read; nothing was added.") so the add refuses and writes nothing, rather than holding a house that stated 12 to a guessed 3 (r103 review, ADR 0116). "Nothing was added" is true only because the read comes BEFORE the first write on every path (r102 review): the menu path reads it before the `make_menu_current` switch and before a current-menu line is inserted; a bulk receive reads it once, before any line resolves a library row, and only when some line states no par of its own. Paths that write nothing before the read (the single add) are unchanged.

## Rejected

- **Store no par for an unstated house ("not set").** Right in principle, but `threshold_min` is `NOT NULL` and every low-stock reader compares `stock_live < threshold_min`; null would silently mean "never low". It needs a migration plus null-aware readers on every page, a migration this change does not spell out. Left open, see below.
- **Raise the whole default to 6.** Picks a number for a house that never said one, which is the ADR 0116 fault again.
- **Change the SQL function default 5.** A migration; it feeds only data import, not the add paths.

## Still open

- Unstated houses still read as 3 rather than "not set" (needs the nullable column).
- `import_restaurant_data` still defaults 5.
- ThresholdStep is still not mounted; with no screen writing the value, most houses are unstated and read 3.
- Reach (r103 review): this reaches the API add and the scan/receipt bulk lines only. The Add-wine modal always sends its own par (`useState(10)`, and `wine.threshold || 10` turns a 0 into 10) and the auction carry sends 0, so a person adding through those still gets 10 or 0, not the house's par. Seeding the modal from the house par needs the web store to carry `default_threshold_min` and a way to state it (ThresholdStep); that is a product surface this change does not decide.
