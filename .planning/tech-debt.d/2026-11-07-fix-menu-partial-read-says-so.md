## Read warnings are not stored or shown yet — OPEN — 2026-11-07

On this branch `parseWithWarnings` is called only by its specs; `importMenu` still calls `parse()`. The PR was split to keep each piece under the 30K audit-gate size. Storing the warnings on `restaurant_menus.read_warnings` and refusing a read with no line is `fix/menu-empty-read-is-refused`, stacked on this branch and waiting on #776's column. The screens that say the warnings are `fix/menu-read-warnings-web`, stacked on that. **Closes with** both merged.

## Pages past the 120-page cap get no warning — CLOSED — 2026-11-07

`splitPdfIfLarge` now adds `page_cap` with the dropped range; spec "names the pages past the 120-page cap". Arrival still refuses such a file (413).

## An unparseable reply counts as a page with no lines — CLOSED — 2026-11-07

`parseOne` returns `unreadable` (`parseStatus` `unparseable` or `parsed_not_array`); the parser adds `unreadable_reply` with the chunk's pages, or null on a one-shot read. Arrival keeps no warnings, so it refuses a PDF read with an unreadable range, as it refuses a truncated or failed one (spec "arrival refuses a PDF read with one unreadable range").

## `warnings: []` is not a whole read for an image — OPEN — 2026-11-07

`[]` means none of the four kinds happened. A photo of half a menu, read cleanly, is still `[]`: nothing knows how many lines the paper had.
