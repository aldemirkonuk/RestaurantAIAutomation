**Branch** `fix/a-menu-line-carries-its-raw-line`, from origin/main `214779a76`. 3 files. Gateway only: no web file, no migration.

## Why

The menu import keeps each line as the reading saw it, in `menu_items.raw_extracted_text` (`menus.service.ts`, the insert's `raw_extracted_text: item.raw_text ?? null`). `LINE_SELECT` left the column out, so every line read came back without it: the active menu (`GET /menus/:restaurantId`), a kept version (`GET /menu-versions/:menuId`), and the plan and make-current reads.

The web's `/house` and `/house/menu` now read the first proof back from the house (ADR 0309, PR for `fix/the-first-menu-reads-from-the-house`). Without the raw line, a tab that did not do the reading loses the raw-text half of the kitchen-line test (`isKitchenLine`). `/house` could then print two pencilled counts for one menu: one in the tab that read it, another everywhere else. The verifier's pass on that branch found this. Its fifteen-file budget is spent, so the gateway half is this PR.

**Where it bites.** A menu read from a CSV: the CSV reader keeps each row as the raw line (`csv-parser.service.ts:55`), and the import stores it and returns it to the reading tab. The scan reader no longer asks for a raw line (`scan-parser.service.ts:35`, set by an A/B that found it cost whole wines), so a scanned menu has none in either place, and its two counts never differed. A line added by hand writes none (`addMenuItem`, `menus.service.ts:681-690`).

**Decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation, not by the founder.** ADR 0309 option 1c, which lands with the web branch, records the reasons. The option rejected was to correct the ADR and leave the raw line owed: that keeps two counts for one menu.

## What changes

- `apps/api-gateway/src/menus/menus.service.ts`: `LINE_SELECT` adds `raw_extracted_text`, with a comment that says why.
- `apps/api-gateway/src/menus/menus.service.spec.ts`: one new `getMenu` case. The fake ignores the column list, so the case records every `menu_items` select and asserts that each one asks for `raw_extracted_text`, then that the line comes back with it.
- `.planning/decisions/claims.d/fix-a-menu-line-carries-its-raw-line.jsonl`: one resolved static row on `LINE_SELECT`.

**Merge order.** Either can merge first. The web branch reads `line.raw_extracted_text ?? read?.rawText ?? null`, so until this PR merges it falls back to the tab's reading, as it did before. The code comment cites ADR 0309, which lands with the web branch.

**Staff and money.** The raw line is the menu's own text: a line's name and its sale prices, which the same reads already serve to any member. It adds no cost, margin or revenue.

## Evidence

- `cd apps/api-gateway && npx jest src/menus/menus.service.spec.ts` → **53 passed** (1 new).
- Mutation: dropping the column from `LINE_SELECT` fails the new case (1 failed, 52 passed) and makes the claims row exit 1. Restored with `cp -p` and `cmp`.
- `npx jest src/menus` → 9 suites, **125 passed**.
- Gateway `tsc --noEmit` → 2 errors, both `src/passkeys/passkeys.service.ts` *Cannot find module '@simplewebauthn/server'*: an untouched file whose package is absent from the shared `node_modules`.
- `lanecheck.sh wt-fix-rawline`: the six fast guards exit 0, files=3, ownership `[]`. Decision claims **937/937** (Python 3.11).

## Not done

- **Not verified against a database or in a browser.** The column exists (it is written by the import on main), but no local gateway served a menu here, and production was not read.
- **Lines with no raw line.** A scanned line and a line added by hand have `raw_extracted_text` null (above). The web then falls back to the tab's reading, which is also null for them. This PR does not bring the raw line back to the scan reader: dropping it was a measured choice (above).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
