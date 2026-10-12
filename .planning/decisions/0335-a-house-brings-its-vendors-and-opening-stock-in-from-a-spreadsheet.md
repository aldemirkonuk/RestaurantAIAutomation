# 0335 — A house brings its vendor list and opening stock in from a spreadsheet

- **Status:** Locked
- **Date:** 2026-10-11
- **Decider:** coordinator under founder delegation 2026-10-11 (industry standard)
- **Keywords:** F-685, vendor import, provider bulk import, opening stock, opening count, CSV, XLSX, onboarding, useBulkImportProviders, POST /providers/bulk-import
- **Links:** `apps/api-gateway/src/providers/providers.controller.ts:426` (`POST /providers/bulk-import`); `apps/web/src/hooks/queries/useProviderQueries.ts:424` (`useBulkImportProviders`, no caller); [ADR 0115](0115-the-house-item-is-the-ledgers-key.md) (a house item exists through an explicit "carry this"); [ADR 0070](0070-a-quantity-states-its-own-unit.md); sim ledger S195

## Context

F-685: a new house cannot bring in its existing vendor list or its opening stock from a file. The gateway has `POST /providers/bulk-import` (`providers.controller.ts:426`) and the web has a hook for it (`useProviderQueries.ts:424`), but nothing calls the hook. The only CSV and XLSX readers in the web app are the menu imports (`MenuCsvUpload`, `MenuVersions`). So a house moving from a spreadsheet or another system types every vendor and every opening count by hand.

### The delegation (verbatim)

The founder, 2026-10-11: *"For the other older ones uh, from F685, 618, 145, 696, 704, 731, 669, 750. Uh, just ask me, just in a one sentence, ask me each of them one by one, or just explain what would you do. If your decision is high industry standard, just do it. Do not ask me. If there is architecture decision to be made, then ask me in simple list form ever."*

## Options considered

1. **Type it in (as built).** No new code. It is the first wall a real house hits, though, and it is where onboarding stalls.
2. **Import through the menu file only.** One import. But a menu is not a vendor list or a stock count, and mixing them would file vendors as wines.
3. **Two imports, each a CSV or XLSX with a column-mapping step and a preview, as every inventory tool offers** (MarketMan, Restaurant365 and Toast all onboard vendors and opening counts this way). **Chosen.**

## Decision

**A house can import its vendor list, and separately its opening stock, from a CSV or XLSX file. Each import has a column-mapping step, a preview that names every row it will refuse and why, and nothing is written until the person confirms.**

1. **Vendors** go through the existing `POST /providers/bulk-import`. A duplicate of a vendor already on the book is shown and skipped, never merged silently.
2. **Opening stock** is one opening count per house item, booked as a count dated on the day the person names. An item that is not yet a house item is created only through the same explicit "carry this", with a kind and a unit (ADR 0115). A quantity is read in the item's own unit (ADR 0070), in the house's decimal mark.
3. **Only an owner or a manager imports.** Each import is recorded in the logs with how many rows went in and how many were refused.
4. **The file is read and then dropped.** Only the rows the person confirmed are kept.

## Consequences

- A house can start from what it already has instead of an empty book.
- Opening counts become the first counts that variance (ADR 0331) is measured from.
- A badly mapped column is caught in the preview, not after the write. The preview has to be honest about every refused row.
- Revisit if houses arrive with exports from a specific system often enough to justify a named preset (the signal is the same column mapping chosen by three houses).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-11 | — | Created under the founder's delegation (sim S195) |
