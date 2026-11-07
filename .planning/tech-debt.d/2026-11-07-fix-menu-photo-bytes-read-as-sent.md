## A menu scan of no known file kind is still sent to the model as image/jpeg — OPEN — 2026-11-07

Filed by `fix/menu-photo-bytes-read-as-sent` (menu upload Phase 1A step 1a, gap M6, server half).

**What is true.** `ScanParserService.detectMediaType` (`apps/api-gateway/src/menus/parsers/scan-parser.service.ts`) now takes the type from the decoded leading bytes through `readableMenuMediaOrRefuse` (`parsers/upload-base64.ts`): PDF, JPEG, PNG, WebP and GIF are sent as themselves, and HEIC, HEIF, AVIF, TIFF and BMP are refused with a 415. Bytes that match none of these still fall through to `image/jpeg`, as on `main` before this branch. That fallback was kept because existing specs feed the parser placeholder strings (`scan-parser.arrival.spec.ts` passes `"image"`), and because refusing unknown bytes is a behaviour change nobody has decided. The kept source of such a file is stored as `application/octet-stream` (`sniffMime`, `menus.service.ts`), so the kept file and the model's label can disagree for it.

**What closes it.** A refusal in words for bytes of no known kind, before the model call, with the placeholder specs moved to real magic bytes.

## The web half of M6 is not on this branch — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** This branch is gateway-only. `/get-started`'s drop zone still sends the FileReader data URL (`apps/web/src/pages/GetStarted.tsx`, `ingestDroppedImage`); the gateway now strips it, so the read and the kept file no longer depend on the client stripping. `SCAN_EXTENSION_RE` in `apps/web/src/components/onboarding/MenuCsvUpload.tsx` still accepts `.heic`, `.heif`, `.tif(f)`, `.bmp` and `.avif`, and `IMAGE_ACCEPT` in `apps/web/src/lib/uploadAccept.ts` still lists `.heic` and `.heif`; the gateway now refuses those kinds with a 415. Those files belong to PR #656, so the plan's web PR for step 1a waits on it. HEIC-to-JPEG conversion is step 2a, not built here.

**What closes it.** The step 1a web PR: the drop zone strips the prefix client-side and the accept lists drop what the gateway refuses.

## Arrival's spreadsheet path strips a data-URL prefix with no test — OPEN — 2026-11-07

Filed with the entries above.

**What is true.** `previewArrivalMenu` passes `stripDataUrlPrefix(content)` to `csvParser.parseExcel` for a binary upload, and `importMenu` decodes `fileBase64` with `decodeUploadBase64`, but no spec sends an `.xlsx` as a data URL; only the scan paths are proven (`upload-base64.spec.ts`, `menus.service.spec.ts`). Whether any client sends an `.xlsx` as a data URL was not checked.

**What closes it.** A spec that sends a real `.xlsx` as a data URL through both paths and asserts the kept bytes equal the decoded file.
