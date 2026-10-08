## The kept source file of a menu reaches every member, every CSV column included — OPEN — 2026-10-08

Entry (i) of this branch. Filed by `fix/a-menu-line-carries-its-raw-line` (#655). Claim: `../decisions/claims.d/fix-a-menu-line-carries-its-raw-line.jsonl:4` (status open).

**What is true at this branch's head.** `GET /menu-versions/:menuId/source` (`apps/api-gateway/src/menus/menus.controller.ts:202`, the route's `@Get` just above it) has no role check: `JwtAuthGuard` and `TenantGuard` only. It calls `MenusService.sourceUrl` (`menus.service.ts:1157`), which hands back a five-minute signed link to the kept file. An import keeps a CSV as `text/csv` and a workbook as its own bytes (`menus.service.ts:450-459`, `keepSource` at `:561`), for every upload since 92ea9cecc (2026-09-22). On the web, the "Open file" link is drawn for every member (`apps/web/src/pages/menu/next/MenuVersions.tsx:296-301`); only make-current is gated (`:310`).

So this branch's line read withholds the raw line, but the kept file still reaches any member until this entry's lane lands. Menus read before 2026-09-22 have no kept file (`menus.service.ts:1162-1168` answers 404).

**The rule for that lane, decided now by the coordinator under the founder's 2026-10-07T20:04:10Z delegation (not the founder's pick).** Refuse every kept source to a viewer whose ROLE_POLICY row does not see both `money` and `suppliers` (`seesRawLine` in `apps/api-gateway/src/menus/menu-line-view.ts`), whatever the file is: the gateway cannot tell a printed menu PDF from a costed list. Hide "Open file" when `!canManage`. It is its own lane, next, because it needs the web change too, and it is the same class as the money-policy synthesis M1 items (`p4-scratch/sim-run/fixes/audits/money-policy-2026-10-07.md`, "Build order").

## A dessert wine counts as a kitchen line — OPEN — 2026-10-08

Entry (ii) of this branch. Filed by `fix/a-menu-line-carries-its-raw-line` (#655). Claim: `../decisions/claims.d/fix-a-menu-line-carries-its-raw-line.jsonl:5` (status open).

'dessert' is both a drink section (the web's `VOCABULARY`, `apps/web/src/lib/firstProof.ts:13`; the gateway's `wine-extract-item.interface.ts:26`) and a kitchen hint (`firstProof.ts:25`; `KITCHEN_HINTS` in `menu-line-view.ts`). So every line in a 'dessert' section is set aside as kitchen. The whole-row test also sets aside a wine whose supplier or note names a hint ("Dish Imports", "great with pasta"). This branch keeps both lists identical on purpose (claim row 2 pins it), so one fix moves both.

**Proposed fix, for its own lane.** A known drink section wins: when the line's section is in the drink vocabulary, it is not a kitchen line; the hints decide only when the section is unknown. Whether a 'dessert' section is food or wine is genuinely ambiguous, so that lane needs its own tests and record.

A related limit, not a defect of this branch: a workbook (XLSX) import keeps no raw line (`parsers/csv-parser.service.ts:97-105` never sets `raw_text`), so the same menu splits by section alone as XLSX and by section plus row as CSV.

## The import's reply sends each CSV row back to whoever uploaded the file — OPEN — 2026-10-08

Entry (iii) of this branch. Filed by `fix/a-menu-line-carries-its-raw-line` (#655).

`POST /menus/import` (`menus.controller.ts:62`) has no manage check, and its reply carries `rawText: r.item.raw_text` for every line (`menus.service.ts:1804`): for a CSV, the whole row. It is the uploader's own file, so nothing reaches a person who did not already hold it, but a staff uploader gets back cost and supplier cells the line reads now withhold. It is the same class as the money-policy synthesis M1 #3 (`documents.controller.ts` echoing `result.parsed`). Scans carry no raw line (`parsers/scan-parser.service.ts:35`) and a workbook keeps none, so today it is a CSV text upload that receives the row: `/menu`'s read form sends one (`apps/web/src/pages/menu/next/MenuVersions.tsx:153`).

## A manual import stores whatever raw line a client sends — OPEN — 2026-10-08

Entry (iv) of this branch. Filed by `fix/a-menu-line-carries-its-raw-line` (#655).

`ImportMenuDto.data.items` is `WineExtractItem[]` (`apps/api-gateway/src/menus/dto/import-menu.dto.ts:13-18`), and `WineExtractItem` has `raw_text?` (`wine-extract-item.interface.ts:50`). The insert writes `raw_extracted_text: item.raw_text ?? null` for every method (`menus.service.ts:1717`), so a manual import keeps a raw line if a client sends one. The web's forms send none. Since this branch, that stored text leaves the gateway only through `GET /menu-versions/:menuId` to a holder (and the import reply, entry above), so this is about what is stored, not who reads it.
