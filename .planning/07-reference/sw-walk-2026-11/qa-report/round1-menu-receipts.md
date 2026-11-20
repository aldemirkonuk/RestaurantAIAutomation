# QA round 1: Menu upload/updates + Invoice scanning/cost math (code + test walk)

Date 2026-11-07. HEAD `059169a59` (working tree, main). Method: code trace plus pure-function probes. No server, network, DB or production touched; no repo files edited.
Probe scripts (scratch only): `/private/tmp/claude-501/-Users-aldemirkonuk-Projects-restaurant-ai-automation/9fc008a4-7940-4fd4-be39-8e576595de9c/scratchpad/{csvprobe,matchprobe,sig}.js`.
Paths below are under `apps/api-gateway/src/` unless noted. "Known" = already in `../sw-menu-receipts/gap-verdicts.json` (M#/G#) or `.planning/v3.0-TECH-DEBT.md`; "NEW" = not found there.

## Tests run
`npx jest` on invoice-match, verify-receipt, quantity-received-unit, receiving, `src/menus`, `src/procurement/documents`: **32 suites, 632 tests, all pass**. Not run: web vitest, e2e, any DB-backed test. Passing tests do not cover any NEW item below (none of them has a spec).

## Counts
BLOCKER 2 (both known) / BUG 7 (5 NEW) / HARM 2 (1 NEW) / SMOOTH 2 / IMPROVE 3.

## Scenario walk (22)

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Messy/blurry invoice photo | Works as designed: model says unreadable -> nulls + `unreadable`; confidence capped when totals do not tie; stored unread, never empty | `documents/document-extractor.service.ts:468-482`, tie-out `parsed-document.ts:460-530` |
| 2 | iPhone HEIC photo (menu or invoice) | FAILS (unverified at runtime): web accepts `.heic`, server labels the bytes `image/jpeg` | `uploadAccept.ts:21` (web); `menus/parsers/scan-parser.service.ts:564`; `documents/document-extractor.service.ts:527`. Known G3 |
| 3 | Same invoice uploaded twice (same bytes) | Works: sha256 per house, `duplicate:true` | `documents/document-intake.service.ts:494`; index `uq_pd_restaurant_sha256` |
| 4 | Same invoice, different bytes (emailed PDF then phone photo) | FAILS, see B-3 | |
| 5 | Case vs each vs bottle | Works: `case`+no pack size is refused, not guessed; 2 cases = 24 bottles matches | probe: `pack_size_required`; matches `verify-receipt.spec.ts:584` |
| 6 | kg / box / dozen / lb / bag | FAILS, see B-5 | |
| 7 | Partial delivery (3 of 5) | Works: `partial`, backorder 2, order stays open | probe; `procurement.service.ts:5696-5699` |
| 8 | Price changed mid-month (invoice 10.50 vs agreed 10.00) | Works: `price_variance`, `requiresOverride`, 422 unless a reason is given | probe; `procurement.service.ts:5635-5640` |
| 9 | Credit note / negative qty | Weak, see S-1 | |
| 10 | Tax/VAT (KDV) | Header-level only: tax is captured as a breakdown and checked in tie-out; unit cost is ex-tax; no tax-inclusive flag | `parsed-document.ts:488-496`; `invoice-match.ts` has no tax term. See I-2 |
| 11 | Menu price change on re-upload | Works: new draft, plan with fingerprint, atomic RPC, `already_current` idempotent, stale plan -> 409 | `menus/menus.service.ts:1409-1450` |
| 12 | Menu item with sub-recipe / food dish | NOT BUILT, see B-6. Cocktail recipes live in `beverages`, not linked to menu cost | `supabase/migrations/20260817090000_cocktails.sql` |
| 13 | Deleted ingredient used in a recipe | Unverified. `cocktail_ingredients` references `beverages`/`master_wine_library`, not house inventory; no delete path traced | migration above, lines 60-64 |
| 14 | Double-submit verify receipt | FAILS, see H-1 | |
| 15 | Double-submit menu make-current | Works (RPC returns `already_current`) | `menus.service.ts:1450` |
| 16 | Offline at the door | Works honestly: photo is not sent and the screen says so; credit letter claims an attachment only if `documentId` exists | `web/src/pages/receiving/next/DoorNext.tsx:317-325, 366-376` |
| 17 | Wrong tenant | Works by code: `JwtAuthGuard` runs `assertTenantMatch` on body/path restaurantId; menu item routes scope by JWT house; documents filter `restaurant_id`. Exception: body `providerId`/`orderId` unchecked (known G7) | `common/tenant/assert-tenant-match.ts`; `auth/guards/jwt-auth.guard.ts:11` |
| 18 | Empty states (0-item menu, empty file) | FAILS, see B-4 | |
| 19 | Huge file | Client cap 10 MB (`MAX_UPLOAD_BYTES`, menu picker via `validateSelection`); DoorNext has no cap, server 15 MB body, DTO 14M chars; >120-page PDF throws only on the arrival path, otherwise first 120 pages are imported and the rest dropped with only a server log line (`scan-parser.service.ts:510-523`). Anthropic per-image size limit: no downscale anywhere (unverified) |
| 20 | Turkish unit words (KOLİ, ŞİŞE, ADET, KS) | Works: `normalizeUom` folds İ/ı | `documents/document-types.ts:156-212`; probe: `ŞİŞE` -> bottle, `KOLİ` -> case |
| 21 | Turkish names (Kavaklıdere, Kalecik Karası) | FAILS, see B-1 | |
| 22 | Turkish CSV/Excel (decimal comma, `;`, Turkish headers) | FAILS, see B-2 and B-4 | |

## BLOCKER

**BL-1 (known, still live; reproduced) `verifyReceipt` multiplies a door-counted quantity by the pack size twice.**
`procurement.service.ts:5515` reads `quantity_received` as the order's unit, but the door writes bottles (comment `:5471-5524`; register `.planning/v3.0-TECH-DEBT.md:2280`, marked "NOT REPAIRED", a founder fork). Repro: `computeMatch({orderedQtyInOrderedUom:5, orderedUom:'case', orderedBottlesPerUnit:12, invoiceQtyInInvoiceUom:60, invoiceUom:'bottle', acceptedQtyInCountedUom:5, countedUom:'case', stockedQtyInCountedUom:60, poUnitPrice:10, invoiceUnitPrice:10})` returns verdict **matched** with **ledgerDelta -660**. A clean-looking match removes 660 bottles from live stock. Tech-debt says 0 production door receipts existed on 2026-09-02, so exposure is prospective; re-measure before relying on that.

**BL-2 (known M3, re-reproduced) CSV prices with a decimal comma are corrupted silently.**
`menus/parsers/csv-parser.service.ts:131` strips everything except `[0-9.]`. Probe: `"125,50"` -> **12550**, `"12,5"` -> **125**, `"1.250,50"` -> **1.2505**. `Market price` is dropped with no note; `1e3` -> 13. No price-sanity or currency field on menu lines (`menus.service.ts` has no plausibility check; M9). The draft is reviewable, but once made current the wrong number becomes the house price. Blocker for any Turkish/EU house.

## BUG

**B-1 (NEW) The wine-identity normaliser does not fold dotless ı, so Turkish names split or fail to match.**
`wines/wine-signature.ts:139` does NFD then strips marks; U+0131 has no decomposition, so the `[^a-z0-9]+` pass turns it into a space. Probe: `Kavaklıdere` -> `"kavakl dere"` but `KAVAKLIDERE` -> `"kavaklidere"` (not equal); `Kalecik Karası` -> `"kalecik karas"` vs `KALECIK KARASI` -> `"kalecik karasi"`; `İstanbul Şarapları` != `istanbul saraplari`. Menus print mixed case, invoices print caps, so the same Turkish wine gets different signature hashes (duplicate library rows, unmatched invoice lines, broken price history). The unit normaliser already handles this (`document-types.ts:164-166`), the wine one does not. The SQL mirror `wine_normalize_text` is parity-tested against it, so both need the same fix. Same class likely for ß, ø, ł, đ (not probed).

**B-2 (NEW) XLSX rich-text and formula cells come through as garbage.**
`csv-parser.service.ts:88,101` `cellToString` only unwraps `{text}`. Probe: a name cell with partial bold -> `"[object Object]"` saved as the wine name; a price cell that is a formula (`=60+60`) -> price silently dropped. Only worksheet 1 is read (`:82`): a workbook with a cover sheet first yields 0 items.

**B-3 (NEW) Same invoice with different bytes is not deduplicated and can return `documentId: null` with HTTP 200.**
The intake header claims the same invoice by email, photo and EDI is "one row" (`document-intake.service.ts:58-60`); content hashing cannot do that. The `(restaurant, provider, doc_type, doc_number)` unique index exists (`baseline_from_production.sql:11866`) but only bites when `provider_id` is set at insert. If the caller sends `providerId` and the number collides, `persist` catches 23505, looks up by sha256 only, finds nothing, returns `null` (`:1137-1148`); the controller still answers 200 with `documentId:null`, and the photo is already in storage and the model call already paid. If the vendor is resolved afterwards, `applyToDocument` hits the same index on UPDATE and only logs a warning, leaving the copy vendor-less. Repro (unverified at runtime): upload an emailed invoice PDF, then upload a photo of the same page naming the same provider.

**B-4 (NEW detail on known M3/M19) Several accepted menu files silently produce 0 items.**
- Semicolon-delimited CSV (Excel in TR/EU locales): `parseLine` only splits on `,` -> header not recognised -> `[]` (probe).
- Header aliases are exact and underscore-only (`csv-parser.service.ts:5-27`): `Wine Name`, `Bottle Price`, `By The Glass`, Turkish `Ad`/`Fiyat` -> all unmapped -> `[]` (probe).
- The picker accepts `.tsv`, `.json`, `.xls` (`web/src/lib/uploadAccept.ts`, `MenuCsvUpload.tsx:103`); `.tsv`/`.json` are parsed as comma CSV, binary `.xls` fails `xlsx.load` and returns `[]` with only a server warn (`csv-parser.service.ts:73-77`).
- A quoted field containing a line break splits into two rows (probe).
Server answer is a normal 200 with `itemsExtracted: 0`; see B-5.

**B-5 (NEW) A zero-item read still creates a draft and marks onboarding "menu uploaded".**
`menus.service.ts:462` `createVersion` always inserts a draft (named `"Wine List"` even for beer/spirits, `:589`); `:476` `markMenuUploaded` runs unconditionally and can set `completed_at` for everyone in the house (`:2085-2110`). So a blank photo, a food-menu photo, or a mis-parsed CSV completes the checklist with an empty menu. Scan verdict for "0 items" is deliberately `null`/untestable (`menu-scan-verdict.ts:56-60`), so nothing tells the user it failed.

**B-6 Menu scan is beverage-only; food menus and sub-recipes are not supported (partly known G9, M18).**
Prompt is "restaurant beverage menu ... Extract EVERY drink" (`scan-parser.service.ts:77-80`); fields are producer/vintage/region/grape. A dish menu yields 0 items (see B-5) or drinks only; there is no dish, ingredient or recipe cost model. Intended per QUEUE item 6, but today the UI does not say so.

**B-7 (partly known G9) Non-bottle units (kg, lb, box, dozen, bag, can, crate) cannot be received or costed, and the failure is quiet then jargon.**
Extractor: unknown unit is stored as `each` with only a warning (`document-extractor.service.ts:343-349`), so 12.5 kg is stored as 12.5 "each". Verify: `"kg"`, `"Kg"`, `"box"`, `"dz"` throw `unknown_unit` (probe) and the API answers 400 "...not a unit this match can convert to bottles" (`procurement.service.ts:5623-5630`). DTO quantities are `@IsInt` (`dto/procurement.dto.ts:92,114,151`), so 2.5 kg cannot be sent. Order unit vocabulary has no weight units (`order-units.ts` `ORDER_UNIT_TYPES`). Blocker if produce/meat/dry-goods vendors are in launch scope; BUG for a wine-first launch.

**B-8 (NEW) Menu import is not atomic: a failure after the draft is created leaves an orphan draft.**
`importMenu` order: parse (billed) -> keep source -> `createVersion` -> `resolveAndPersistItems`. A library-resolution throw (`menus.service.ts:1660`) leaves a draft with `lines_extracted: N` and no lines; retrying creates another and re-bills the scan. Code-read only.

## HARM

**H-1 (NEW) `POST /procurement/orders/:id/verify-receipt` has no idempotency, status or re-verify guard, so a repeat submit duplicates credit claims.**
No status check anywhere in `procurement.service.ts:5325-5830` (only the new-status assignment at `:5696`), so a retry after a timeout, a second staff member, or a cancelled order all run again. `openCreditClaim` (`:5809`, def `:4928`) inserts with no `document_line_id`; the only unique index is on `(document_line_id, reason)` where `document_line_id IS NOT NULL` (`baseline_from_production.sql:11859`), so order-level claims are never de-duplicated and the claimed amount doubles. Price-history rows are written each time too (`recordPriceHistory`, `:5860` area). The web button has a `submitting` flag, which protects only a single tab. No spec covers a second call (`verify-receipt.spec.ts`). Unverified at runtime.

**H-2 (known G7) Body `providerId` / `orderId` on document upload are not checked against the house.** Not re-verified here beyond the earlier audit; listed because it interacts with B-3.

## SMOOTH

- **S-1 Credit/negative quantities are clamped:** `invoiceQtyInInvoiceUom:-2` with 5 counted gives `qty_over` "5 arrived but only 0 were billed" and unit cost 0 (probe). Credit notes have their own doc type, but the order-side screen words a credit as an overbilling mismatch.
- **S-2 Over-delivery accepted as match:** ordered 5, billed and counted 7 -> `matched`, "All 7 accepted" with no mention that 2 were never ordered (probe). Menu name hardcoded "Wine List" (`menus.service.ts:589`).

## IMPROVE

- **I-1** Downscale or compress photos before sending to the model, and convert HEIC in the browser (see scenario 2/19); DoorNext has no size check at all.
- **I-2** Add a tax-inclusive/exclusive flag per document so KDV-dahil receipts do not rely on the tie-out alone catching them; keep cost ex-tax explicit in `effectiveUnitCost` docs.
- **I-3** Add specs: CSV decimal comma, semicolon, space headers, XLSX rich text/formula, ı folding, verify-receipt called twice, 0-item import. None exists (M19 notes the CSV gap).

## Not verified / limits
Runtime behaviour of B-3, H-1, B-8, HEIC and the 5 MB image limit (code-read only). No browser walk, no DB, no real model call. Whether a later migration added an order-level credit unique index: searched all migrations for `procurement_credits` indexes, found only those above. BL-1 status checked in source at HEAD, not in production data.
