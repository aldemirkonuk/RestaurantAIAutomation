## The photo note still says "confident" and shows twice — CLOSED — 2026-11-07

QA round 10b: the gateway's fallback said "confident count"; `SpotCountPanel` showed the note in the toast and beside the photo. Closed on `fix/photo-note-says-plain-house-words`: `NO_COUNT_NOTE` in plain house words (TR for a Türkiye house, else EN), the toast no longer carries the note. The model's own note is asked for in the house language without confidence words; untested against a live model.

## The counted shelf photo is not kept — OPEN — 2026-11-07

G10. `PhotoCountService.estimate` keeps nothing, so a wrong suggestion cannot be re-checked. **Closes with** lane C8.

## The photo count still says "this wine" for an unnamed item — OPEN — 2026-11-07

G22. `estimateCountFromPhoto` falls back to `"this wine"`. **Closes with** lanes I3/I4.

## The legacy spot-count panel sends the raw file, PDFs included — OPEN — 2026-11-07

`SpotCountPanel.tsx` sends the full-size file and accepts PDFs. **Closes with** retiring it or routing it through `lib/photoToJpeg.ts`.

## A browser that cannot decode HEIC cannot count from one — OPEN — 2026-11-07

`photoToJpegBase64` re-encodes what `createImageBitmap` decodes; desktop Chrome/Firefox cannot decode HEIC, so the gateway refuses it. Frequency not measured. **Closes with** a server-side decoder.

## The other /inventory sheets still say "bottles" — OPEN — 2026-11-07

G22. The write-off and transfer sheets in `InventorySheets.tsx` say "Bottles". **Closes with** proposal §3 item 7's wording.
