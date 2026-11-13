# fix/menu-photo-is-fitted-before-it-is-sent (r32 onboarding, 2026-11-13)

Every photo the onboarding menu step sends now goes through
`lib/fitPhoto.ts` first. This covers the drop zone, the photo box (camera
and picked file) and the file box. The reader gets bare base64, and the first
proof gets a data URL.

- **The drop zone sent the FileReader data URL whole** (onboarding audit G5).
  The gateway hands `imageBase64` to the model as base64, so the
  `data:image/...;base64,` prefix made a dropped photo unreadable. #762 strips
  it on the gateway; this fixes the sender.
- **A photo past 2048 px on the long edge or 3 MB is redrawn as a JPEG**
  (q 0.85, then 0.7 if still past 3 MB). The model takes at most 5 MB of
  base64 per image, and it scales past ~1568 px anyway.
- **A HEIC the browser can open is redrawn as a JPEG** (Safari). Where the
  browser cannot open it (Chrome), the bytes go as they are, and the gateway
  answers in words (#778).
- **A PDF is never opened.** It gives the proof no image, where it used to
  give a string no <img> draws.

Left open:

- /menu's own upload (`MenuVersions.tsx`, `fileToBase64`) and the inventory
  count sheet still send whole photos. They are on other chains.
- The fit is decided in the browser only: not measured on a real phone, and
  not seen in a browser. jsdom has no canvas, so the redraw is tested through
  an injected codec.
- 2048 px is a call above the model's 1568 px, with room for a model that
  reads larger. Measuring read quality at 1568 vs 2048 on real menus is not
  done.
