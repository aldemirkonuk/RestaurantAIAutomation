# BUILD keg r80 (2026-11-19) - walk finding 1, owner #1922

PR #1922 (draft), branch feat/taste-a-kind-aware-exports-2-drink-columns, head bae06941e. Diff vs base 25,286 chars (<= 30K).
Commits: 296b44f1c fix (iv-export.ts + tests; its keg fixture was wrong, test failed), bae06941e test fixture fix (plain follow-up commit, no rebase).

## Decision
bottleSizeCell (apps/web/src/pages/inventory/next/iv-export.ts): a drink keeps bottleSizeMl (gateway default 750 allowed) only when uom is empty (reads "bottle" in the Unit column) or matches bottle(s)/btl(s)/can(s). Any other drink unit (keg, case, ...) writes only bottleSizeRecordedMl, so blank unless someone recorded a size. Food/supply blank and unknown-kind recorded-only unchanged.
Rejected: gateway change to stop defaulting 750 (brief says web side; gateway default feeds other pages); blanking every non-bottle drink even if recorded (loses a real keg size); matching only the literal "bottle" (misses can, btl, plural).
Residual: a keg whose gateway row lacks snake `bottle_size_ml` falls to camel bottleSizeMl via toRow and reads as recorded (750). Real gateway rows carry both keys (walk seed); not browser-verified.

## Tests
- vitest src/pages/inventory: 34 files, 708 passed. tsc --noEmit (apps/web): clean.
- New: keg/case blank with gateway 750, recorded keg 30000 kept, can/Bottles/no-uom keep size.
- Mutant (revert to always blank(bottleSizeMl) for drinks): FAILED "expected 750 to be ''" (1 failed | 18 passed); restored.
- Gateway not touched, so gateway tsc/jest not run.

## Browser checks owed
Re-export count sheet in house A: House Lager (keg) Bottle size blank; gin 700, wines 750 unchanged.
