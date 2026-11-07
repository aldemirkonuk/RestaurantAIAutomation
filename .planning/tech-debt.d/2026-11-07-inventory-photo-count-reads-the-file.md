## The counted shelf photo is not kept — OPEN — 2026-11-07

Filed by `fix/photo-count-reads-the-file-it-got` (inventory walk #7, lane I2; G10's remainder). `PhotoCountService.estimate` sends the photo and keeps nothing, so a wrong suggestion cannot be re-checked against what the model saw. **Closes with** lane C8 (`feat/count-photo-a-shelf`): a private, house-scoped bucket, path on the count line.

## The photo count still says "this wine" for an unnamed item — OPEN — 2026-11-07

Filed with the entry above (G22's remainder). The prompt is now item-neutral, but `InventoryService.estimateCountFromPhoto` (`inventory.service.ts`, fallback near `:660-663`) still falls back to `"this wine"` and reads only wine names. Left alone because lanes I3/I4 own that file. **Closes with** I3/I4 falling back to `"this item"`.

## The legacy spot-count panel sends the raw file, PDFs included — OPEN — 2026-11-07

Filed with the entries above. `SpotCountPanel.tsx` still sends the full-size file and accepts PDFs (only its confidence word went); the gateway now refuses a non-photo in plain words, but a HEIC is never converted there. **Closes with** retiring the panel or routing it through `lib/photoToJpeg.ts` and `IMAGE_ACCEPT`.

## A browser that cannot decode HEIC cannot count from one — OPEN — 2026-11-07

Filed with the entries above. `photoToJpegBase64` re-encodes what `createImageBitmap` decodes: Safari decodes HEIC, desktop Chrome/Firefox do not, and there the gateway refuses the raw bytes in plain words. Frequency not measured. **Closes with** a server-side decoder (its own decision) or evidence it does not occur.

## The other /inventory sheets still say "bottles" — OPEN — 2026-11-07

Filed with the entries above (G22, outside lane I2). The write-off and transfer sheets in `InventorySheets.tsx` still say "Bottles". **Closes with** proposal §3 item 7's all-goods wording.
