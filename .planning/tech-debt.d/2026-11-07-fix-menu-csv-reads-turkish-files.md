## A spreadsheet read's row issues reach no one — PARTLY CLOSED — 2026-11-07

Filed by `fix/menu-csv-reads-turkish-files` (gap M3, menu upload step 1b).

**What is true.** `CsvParserService.read` returns the rows it could not take whole (`no_name`, `no_name_column`, `two_readings`, `unreadable`, with row and cell), but `importMenu` and `previewArrivalMenu` call `parse`, which returns items only, and `parseExcel` keeps no issues. A price with two readings is kept blank and takes the existing blank-price flag, whose note says the line "shows no price" although it shows one that reads two ways. A file with no name column still reads as zero lines (gap M4).

**Wave 2 (2026-11-07).** `importMenu` now calls `read` / `readExcel` and returns their issues as `notes` on its reply; `readExcel` notes an error cell (`cell_error`, `#N/A`) and a bare price header (`price_column_not_read`). The web shows them as a short list under the read's result (`MenuReadNotes`, on `MenuVersions` and the first proof, `HouseMenu`). Still open: `previewArrivalMenu` (Arrival) still calls `parse` / `parseExcel` and drops them; the notes are on the reply only, not stored on the version, so they are gone after a reload; the blank-price flag's note is unchanged.

**What closes it.** The plan's `read_warnings` column fed from `read` and `readExcel`; Arrival's preview returning the same notes; MU-9 (step 1m) for the note's words.

## A bare "Price" / "Fiyat" header is not read — OPEN — 2026-11-07

**What is true.** `ALIASES` (`apps/api-gateway/src/menus/parsers/csv-parser.service.ts`) maps no bare `price` or `fiyat`, as on main: the plan lists `fiyat` as an alias but names no field for it, and no ADR does. Such a column's prices are not read; since wave 2 that is said (`price_column_not_read` on the import reply), not silent. An XLSX line now keeps `raw_text` (every cell) as a CSV line does, so `2026-10-08-fix-a-menu-line-carries-its-raw-line.md:19,25` ("a workbook keeps none") no longer hold and its entries ii-iii cover XLSX.

**What closes it.** A decision on which price a bare price column is.

## The web upload still offers .xls and sends .tsv to the scan read — OPEN — 2026-11-07

**What is true.** The gateway now refuses an .xls workbook with a sentence (400, before the source is kept or a version made). `apps/web/src/pages/menu/next/MenuVersions.tsx` still lists `.xls` in `accept`, and sends only `.csv` as text, so a `.tsv` goes to the scan read and never meets the tab sniff. Web PRs wait on PR #656 (plan, Sequencing).

**What closes it.** A web PR after #656: `.xls` out of `accept`, `.tsv` sent as text.
