## Read warnings reach the API but no screen yet — CLOSED — 2026-11-07

Closed in wave 2 of `fix/menu-partial-read-says-so`: `MenuVersions` shows one sentence per warning on each kept menu and under a new read's result, and `HouseMenu` (the first proof) shows them under the reading count (claims row `MENU-1C-WEB-SAYS-WHICH-PAGES`). Not shown: the onboarding upload components (`MenuScanUpload`, `MenuCsvUpload`, `MenuManualEntry`) hand their result on without rendering warnings.

## Pages past the 120-page cap get no warning — CLOSED — 2026-11-07

`splitPdfIfLarge` now adds `page_cap` with the dropped range; spec "names the pages past the 120-page cap".

## An unparseable reply counts as a page with no lines — CLOSED — 2026-11-07

`parseOne` returns `unreadable` (`parseStatus` `unparseable` or `parsed_not_array`); the parser adds `unreadable_reply` with the chunk's pages, or null on a one-shot read.

## Column before gateway — OPEN — 2026-11-07

`createVersion` writes and `listVersions` selects `read_warnings`; both fail until migration `restaurant_menus_read_warnings` (branch `fix/menu-read-warnings-column`, its own PR) is applied. This PR's claims row `MENU-1C-EMPTY-READ-REFUSED-NOTHING-KEPT` fails until that file is on main, so CI holds the merge order; nothing checks that the Supabase integration has *applied* it before this merges. **Closes with** this PR merged after the column is seen in production.

## A read with no line is refused, not kept — OPEN — 2026-11-07

QA B-5: `POST /menus/import` now answers 422 with a sentence (and the warnings) when the read has no line, before the source is kept or a version made, for scan, CSV and manual. ADR 0193 item 7 says "every read is a NEW row"; this narrows it to every read with a line. The session's call under the 2026-11-07 /goal; ADR 0193 has no amendment line for it yet. **Closes with** that amendment. `HouseMenu`'s "We couldn't read this file" branch (`itemsExtracted === 0`) is now reached only by a proof stored before this change.

## `warnings: []` is not a whole read for an image — OPEN — 2026-11-07

`[]` now means none of the four kinds happened. A photo of half a menu, read cleanly, is still `[]`: nothing knows how many lines the paper had.
