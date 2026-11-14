## A spreadsheet read's row issues reach no one — PARTLY CLOSED — 2026-11-07

Filed by `fix/menu-csv-reads-turkish-files` (gap M3, menu upload step 1b).

**What is true.** `CsvParserService.read` and `readExcel` return the rows they could not take whole (`no_name`, `no_name_column`, `two_readings`, `unreadable`, `cell_error`, `price_column_not_read`, with row and cell). `importMenu` calls them and returns those issues as `notes` on its reply; the web shows them as a short list under the read's result (`MenuReadNotes`, on `MenuVersions` and the first proof, `HouseMenu`). Still open: `previewArrivalMenu` (Arrival) calls `parse` / `parseExcel`, which return items only, so Arrival drops the notes; the notes are on the reply only, not stored on the version, so they are gone after a reload; a price with two readings is kept blank and takes the existing blank-price flag, whose note still says the line "shows no price" although it shows one that reads two ways.

**History.** Filed in wave 1 with every caller on `parse` (items only) and no issues kept by `parseExcel`; wave 2 (2026-11-07) moved `importMenu` to `read` / `readExcel`, added `cell_error` and `price_column_not_read`, and added `MenuReadNotes`. On the import, a file with no name column now says so (`no_name_column`) instead of reading as zero lines in silence (gap M4); on Arrival it still reads as zero lines.

**What closes it.** The plan's `read_warnings` column fed from `read` and `readExcel`; Arrival's preview returning the same notes; MU-9 (step 1m) for the note's words.

## A bare "Price" / "Fiyat" header is not read — RESOLVED — 2026-11-13

**What is true.** The first bare `price` / `fiyat` / `fiyati` column is read as the bottle price (`CsvParserService.barePriceRead`), but only when the file names no bottle column. That is the one price a dish line keeps (#1261) and the price a single-price drink is sold at. A glass column beside it stays the glass price. The read says it once, on the header (`price_column_read_as_bottle`), and the web words it with how to read the column as glass prices instead (`MenuReadNotes`). A bare column that is not read (a bottle column is named, or an earlier bare column was read) is still said (`price_column_not_read`). An XLSX line keeps `raw_text` (every cell), as a CSV line does, so `2026-10-08-fix-a-menu-line-carries-its-raw-line.md:19,25` ("a workbook keeps none") no longer hold, and its entries ii-iii cover XLSX.

**History.** OPEN from 2026-11-07, because the plan named no field for `fiyat`. On 2026-11-13 it was decided as the session's call under the founder's 2026-11-07 /goal (r28 /menu audit G8).

## The web upload still offers .xls and sends .tsv to the scan read — OPEN — 2026-11-07

**What is true.** The gateway now refuses an .xls workbook with a sentence (400, before the source is kept or a version made). `apps/web/src/pages/menu/next/MenuVersions.tsx` still lists `.xls` in `accept`, and sends only `.csv` as text, so a `.tsv` goes to the scan read and never meets the tab sniff. Web PRs wait on PR #656 (plan, Sequencing).

**What closes it.** A web PR after #656: `.xls` out of `accept`, `.tsv` sent as text.
