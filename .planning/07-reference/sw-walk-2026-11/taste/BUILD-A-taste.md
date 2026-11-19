# BUILD A - kind-aware exports (2026-11-19)

PR: https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/1919 (DRAFT, base feat/g2-inventory-quantities-carry-their-unit = #1912; merge #1912 first). Head 2ec0afc4d, branch feat/taste-a-kind-aware-exports.
Files (7): iv-export.ts, iv-export.test.ts (new), InventoryNext.tsx, InventoryNext.test.tsx, RowDropdown.tsx, RowDropdown.test.tsx, useInventoryNextData.ts. +473/-58.

## Tests
- vitest run src/pages/inventory: 34 files, 705 passed. tsc --noEmit -p apps/web: clean.
## Mutants (all fail a test; M8 first survived, test added)
Kind column removed (4 fail), dropEmptyDetail no-op (6), comparator keys swapped (2), library kind only (8), bottle fallback dropped (2), bottleSizeMl read for a food (6), staff cost filter off (4), sort on raw zone id (1 after fix).
## Decisions beyond the brief
- forHouse deleted (no caller). Zero rows keeps every column. 'Value' added to COST_HEADERS and costColumnsFor now also runs on count sheet and valuation (they skipped it; brief said staff get no WAC/Value). whiskey maps to word Spirit. Commit trailer is Sonnet 5.5 per session rule (task text said Opus 5.5).
- Test fixtures that made a food carry producer/vintage/glass price were changed to true foods (K3).
## Checks owed (walker)
Brief's five browser checks (count sheet headers; food-only export; Export this row on food; staff login; toast and filename).
## Flag to founder
#1759 commits a real house's count file into a public repo; not touched, nothing copied.
## Not done
allergen/nutrition/taste columns (S4), beverages join (S2), legacy page header, kg/l conversion. Not browser-verified.
