## Column before gateway — OPEN — 2026-11-07

`createVersion` writes and `listVersions` selects `read_warnings`; both fail until migration `restaurant_menus_read_warnings` (#776, `fix/menu-read-warnings-column`) is applied. Claims row `MENU-1C-EMPTY-READ-REFUSED-NOTHING-KEPT` and `scripts/check_read_columns_exist.py` (ADR-0098) fail until that file is on main, so CI holds the merge order; nothing checks that the Supabase integration has *applied* it before this merges. **Closes with** this PR merged after the column is seen in production.

## A read with no line is refused, not kept — CLOSED — 2026-11-07

QA B-5: `POST /menus/import` answers 422 with a sentence (and the warnings) when the read has no line, before the source is kept or a version made, for scan, CSV and manual. ADR 0193 item 7 now carries a dated amendment: every read *with a line* is a new row.

## Arrival's kept version stores `[]` — NOTE — 2026-11-07

`importParsedItems` writes `read_warnings: []`. That is true only because arrival refuses every kind it cannot record (truncated, failed, unreadable ranges, and the 120-page cap); a new arrival path that lets one through must store it or `null`.
