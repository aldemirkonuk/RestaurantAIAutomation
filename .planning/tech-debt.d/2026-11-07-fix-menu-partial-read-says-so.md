## Read warnings reach the API but no screen yet — OPEN — 2026-11-07

`fix/menu-partial-read-says-so` (step 1c, gateway half): `POST /menus/import` returns `warnings`, the versions list `readWarnings`; no web file reads them, and `MenuVersions` still says "Read 0 lines and kept this menu". **Closes with** the 1c web PR ("Read nothing from this file", the pages), which waits on the PR #656 decision.

## Pages past the 120-page cap get no warning — OPEN — 2026-11-07

`splitPdfIfLarge` (`MAX_PAGES`) only logs them. **Closes with** a warning for that range and a 121-page spec.

## An unparseable reply counts as a page with no lines — OPEN — 2026-11-07

`parseJsonResponseGraded` returns `items: []`; its `parseStatus` reaches only the NF verdict. **Closes with** `parseOne` returning it and a warning.

## Column before gateway — OPEN — 2026-11-07

`createVersion` writes and `listVersions` selects `read_warnings`; both fail until migration `restaurant_menus_read_warnings` (branch `fix/menu-read-warnings-column`, its own PR) is applied. This PR's claims row `MENU-1C-EMPTY-READ-KEPT-NOT-UPLOADED` fails until that file is on main, so CI holds the merge order; nothing checks that the Supabase integration has *applied* it before this merges. **Closes with** this PR merged after the column is seen in production.

## `warnings: []` covers two kinds only — OPEN — 2026-11-07

`[]` means no page range errored and no reply was cut off. It does not cover the two entries above (120-page cap, unparseable reply), so no reader may treat `[]` as a whole read until both close.
