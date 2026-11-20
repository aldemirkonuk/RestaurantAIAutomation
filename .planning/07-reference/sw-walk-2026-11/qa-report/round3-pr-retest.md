# QA round 3: adversarial re-test of fix PRs #761 #773 #774 #775 #776 #777 #778

Date 2026-11-07. Method: `gh pr diff`, each PR head checked out in a throwaway worktree under `/private/tmp/claude-501/qa-wt-<n>` (node_modules symlinked, all removed afterwards), PR's own specs run, plus probe specs written then deleted (nothing left in the repo, nothing pushed or commented). Round-1 ids from `round1-menu-receipts.md`. Paths under `apps/api-gateway/src/` unless noted. Line numbers are PR-head lines.

## Verdicts

| PR | Round-1 target | Verdict |
|---|---|---|
| #761 CSV/Excel reads | BL-2, B-4, B-2 | PARTIAL |
| #773 no orphan version | B-8 | FIXED (B-8 only; retry still re-bills) |
| #774 retire invoice_ocr_service | G12 legacy | FIXED |
| #775 vendor stamp collision | B-3 | PARTIAL |
| #776 read_warnings column | prerequisite for #777 | FIXED (merge-order hazard) |
| #777 partial read names pages | scenario 19, B-5 | PARTIAL |
| #778 HEIC stored unread | scenario 2 / G3 | PARTIAL |

Counts: FIXED 3, PARTIAL 4, NOT FIXED 0, REGRESSION 0.

## #761 PARTIAL

Fixed and probed (jest probe at head 0ca4817d4):
- BL-2: `125,50` -> 125.5, `1.250,50` -> 1250.5, `12,5` -> 12.5, `1.250` / `1,250` -> no amount (`two_readings`, `menu-price.ts:78-80`), `Market price` -> no amount, `1e3` -> no amount, `0,250` -> 0.25. `updateItem` uses the same reader (`menus.service.ts` diff, near line 822).
- B-4: semicolon CSV with Turkish headers (`Ad;Fiyat;Şişe Fiyatı (TL)`), TSV, BOM, quoted comma/newline, `Wine Name`/`Bottle Price`/`By The Glass`, `ŞİŞE FİYATI` header all read. `.xls` (OLE2 magic) and a non-workbook are refused in words (`csv-parser.service.ts` parseExcel) instead of `[]`.
- Tests are new and fail without the fix (124 menu tests pass).

Still breaks:
1. **B-2 not fixed for rich text.** `cellValue` (`csv-parser.service.ts`, ~line 238) unwraps only `result` and `text`. ExcelJS rich text is `{richText:[...]}`, so a partly bold name still saves as `"[object Object]"` (probe: `name:"[object Object]"`). An error-valued formula (`{result:{error}}`) also becomes `"[object Object]"` in `raw_text` and the price is dropped; a Date cell becomes a `Date.toString()` string as a name. Formula cells with a plain result now work (`=60+60` -> 120). The new spec has no xlsx/formula/rich-text case at all (grep for formula/rich/worksheet in `csv-parser.service.spec.ts`: none), so nothing guards it.
2. **Cover-sheet workbook still yields 0 items, silently** (probe: `[]`); only `worksheets[0]` is read.
3. **The "never guess a price" notes are never shown.** `read()` returns `issues`, but `menus.service.ts` still calls `parse()` / `parseExcel()` (lines 453, 457, 510, 511), and `parseExcel` passes `[]` for issues. A price blanked as `1.250` or `Market price`, a missing name column (`no_name_column`) and a bare `Fiyat` / `Price` header (deliberately unmapped, probe: price silently dropped) all end as a normal 200 with the price empty and no word to the user. The refusal is correct, the telling is absent.
4. Small guesses remain in `readMenuPrice`: `-5` -> 5 (sign dropped), `.5` -> 5 (should be 0.5 or refused), `1.5.` -> 1.5, `12,50,` -> 12.5. No currency check (`₺450` -> 450, documented as MU-9).
5. Encoding: web reads CSV with `readAsText` (`web/src/components/onboarding/MenuCsvUpload.tsx:145`), so a Windows-1254 file from Turkish Excel arrives with replacement characters before the server sees it. Not touched.
6. `.json` is still accepted by the picker and parsed as CSV: `[{"name":"A"}]` -> `[]`, no message.
7. B-1 (wine-signature does not fold dotless ı, `wines/wine-signature.ts:139`) is in none of the seven PRs; only the CSV header normaliser folds ı.

Regression risk: low. Header matching is now alias-by-field and exact after normalisation; a header that used to map (`type`, `grape`) still maps. Overlaps `importMenu` with #773 and #777 (merge conflicts likely in `menus.service.ts`).

## #773 FIXED (B-8)

- `importMenu` and `importParsedItems` now resolve the library first (`resolveLibrary`, diff lines ~464-466 and ~536), then create the version, and `persistIntoNewVersion` deletes the just-created version if the line write throws (FK `menu_items_menu_id_fkey ... ON DELETE CASCADE`, baseline line 12726, so lines go with it). A failed delete throws a sentence naming the leftover draft id. Spec (`a failed import leaves no orphan version (M8)`, menus.service.spec.ts:939) passes; 73 tests pass.
- Edge cases checked: cleanup is safe because both callers pass `current=false`, so no inventory or price rows are seeded before the delete; the kept source file is content-addressed and deliberately not deleted; the delete is scoped by `restaurant_id`.
- Residual: the billed scan has already happened, so a retry still re-bills the read (round-1 B-8 said so; not claimed fixed). Wine-submission rows from a partly written import are non-fatal and would remain. B-5 (zero-item draft) is not in this PR; #777 covers half of it. The web change is only a loading sentence.

## #774 FIXED

Pure removal of `services/agent-orchestrator/services/invoice_ocr_service.py` and its own test. Checked: no remaining reference to `invoice_ocr_service`, `InvoiceOCRService`, `EnhancedInvoiceService`, `get_invoice_ocr_service` or `get_enhanced_invoice_service` under services/apps/packages/scripts/.github/supabase at head 2a1f11de5 (only the unrelated `InvoiceOCRStatus` web type and one commented-out TS line remain); the claim's verify command passes in a worktree; `compileall` of `services/` passes; recovery commit `4e4399c05` exists, is an ancestor of origin/main and the file there is 751 lines as stated. Pins for easyocr/surya stay (still imported elsewhere). No test is needed for a deletion; the claims row is the guard. Risk: none found. It does not change any live behaviour.

## #775 PARTIAL (B-3 half)

Fixed: when stamping the resolved vendor onto a document hits 23505 on `uq_pd_restaurant_provider_type_number` (index definition confirmed at baseline_from_production.sql:11866, includes `status <> 'superseded'`, matched by the `.neq("status","superseded")` in the look-up), `applyToDocument` now writes `intake_verdict='duplicate'` (value allowed by `procurement_documents_intake_verdict_check`) with a sentence naming the earlier paper, and leaves the vendor off. Other 23505s and read/write failures return a sentence. 54 vendor-identity tests pass; new specs would fail without the change.

Still breaks:
1. **The ingest caller throws the result away.** `document-intake.service.ts:1233` does `await this.vendorResolution.applyToDocument(...)` and returns `resolution` regardless; the string return is never read. The upload response therefore still says `vendor: {state:"matched", providerId}` and `duplicate:false` while the row holds no vendor and a `duplicate` verdict. The user-facing answer contradicts the database. Then `linkAndMatch` still runs on the extraction door path (`document-intake.service.ts:1584-1587`), so a paper just labelled duplicate is still matched to an order.
2. **The other half of B-3 is untouched.** `persist` still handles a number collision at INSERT (caller sent `providerId`) with a sha256-only look-up and returns `null` (`document-intake.service.ts:1141-1148`); the controller still answers 200 with `documentId:null`, photo stored and model call paid. Round-1 repro (emailed PDF then photo of same page naming the same provider) is unchanged.
3. Different-bytes dedupe without a provider id is still not possible (no vendor yet, so the index does not bite); the PR only covers the stamp-after-read case.
4. The UPDATE overwrites any earlier `intake_verdict` with `duplicate` unconditionally (for instance one set by a blank-page or low-resolution check), though the header write just before clears it on the extraction door.

## #776 FIXED (merge-order hazard)

Adds nullable `restaurant_menus.read_warnings JSONB` plus an `IF NOT EXISTS`-guarded CHECK (`NULL` or array). Idempotent, no default, no backfill, cheap on a small table. Version `20270304100000` is past origin/main's newest (`20270301170000`) and does not collide with open PRs #772 (`20270302100000`), #760 and #758 (both `20270302090000`; those two share a prefix and one file name with each other, which is their problem, not this PR's).
Hazard: #777's `createVersion` inserts `read_warnings` and `VERSION_SELECT` selects it, so if #777 deploys before this migration is applied every menu import insert and every version list fails. Only a CI claim holds the order (it fails until the file is on main); nothing checks the migration has been applied to production first. Do not merge #777 before #776 is applied.

## #777 PARTIAL

Fixed and probed: `parseWithWarnings` names the page range of a chunk that errored (`chunk_failed`) or was still cut off (`truncated`), including the 1-based offset on a re-split (spec checks pages 13-14 and 19-20 of a real 30-page PDF); single image cut off -> `{kind:"truncated", pages:null}`. The warnings are stored on the version and returned as `warnings` on the import reply. As a side effect the PR also moves `markMenuUploaded` behind `items.length > 0` (`menus.service.ts` importMenu step 7), which closes the "blank photo completes the onboarding checklist" half of B-5. 158 menu tests pass.

Still breaks:
1. **Nothing shows the warnings.** `read_warnings` / `readWarnings` appears nowhere in `apps/web/src`. The user still sees a normal import with fewer lines. The data now exists; the sentence to the user does not.
2. **Scenario 19 stays open:** pages past the 120-page cap and an unparseable model reply are explicitly not recorded (the migration comment and interface say so). The very case round 1 named (first 120 pages imported, rest dropped with only a log line) is unchanged.
3. B-5 other half: a zero-item read still creates a draft named "Wine List" and returns 200 with `itemsExtracted: 0` and no message; the verdict stays `null`/untestable.
4. Depends on #776 being applied first (see above). Also conflicts with #773 and #761 on `importMenu` / `createVersion` signature (new `warnings` arg), so a rebase is certain.

## #778 PARTIAL

Fixed and probed (head 654bcabcc): HEIC/HEIF bytes (ftyp brands heic, mif1, etc., any box size) are detected before the declared mime, so a HEIC labelled `image/jpeg` no longer goes to the model as JPEG; the paper is stored unread with a sentence (`PaperFormatRefusal` caught at `document-intake.service.ts:~735`, before the currency rules). Unknown bytes with no usable label (TIFF) now say "not a PDF, JPEG, PNG, WebP or GIF" instead of being filed under "model could not be reached". Data-URL-prefixed HEIC with a heic label also refused. 469 document tests pass; new specs fail without the change.

Still breaks:
1. **The photo is still not read.** Web still accepts `.heic`/`.heif` (`web/src/lib/uploadAccept.ts:21`) and does not convert; the user gets an unread document and a request to resend. Better than a mislabelled read, not a fix of the iPhone path. Round-1 improvement I-1 (convert in the browser) is open.
2. **Menu scan is not covered.** `menus/parsers/scan-parser.service.ts:555-564` still defaults to `image/jpeg` ("safe default"), so a HEIC menu photo is still mislabelled. The PR touches only the document extractor.
3. A HEIC whose label is JPEG and bytes are data-URL-prefixed (`data:image/jpeg;base64,...`) is not detected (header sniff reads the prefix); such input is also malformed for the model, so low risk.
4. `mif1`/`msf1` brands are generic HEIF containers; an AVIF using them is reported as "HEIC" (wording only).
5. Regression check on the removed `return "image/jpeg"` fallback: JPEG with an empty or `application/octet-stream` label still resolves via `/9j/`; a real JPEG cannot reach the new refusal. No regression found.

## Not covered by any of the seven PRs

B-1 (ı/İ in `wine-signature.ts:139` and its SQL mirror), H-1 (verify-receipt double submit / duplicate credit claims), BL-1 (door quantity multiplied twice), B-6, B-7 (kg/box units), S-1, S-2, I-2. I did not re-test those; they are not in these diffs.

## Limits

Code and jest probes only. No server, no DB, no real model call, no browser. #776's apply-order hazard and #775's response contradiction are read from code and specs, not run end to end. Web vitest was not run. Worktrees removed; shared checkout not modified (only `git fetch` of `pull/<n>/head` refs into FETCH_HEAD and the object store).
