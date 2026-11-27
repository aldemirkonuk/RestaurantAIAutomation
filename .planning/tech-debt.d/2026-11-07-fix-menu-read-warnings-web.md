## Read warnings reach the API but no screen yet — CLOSED — 2026-11-07

`MenuVersions` shows one sentence per warning on each kept menu, under a new read's result and under a refused read's error; `HouseMenu` (the first proof) shows them under the reading count (claims row `MENU-1C-WEB-SAYS-WHICH-PAGES`). The words live in `readWarningSentence` (`services/api/menus.ts`).

## Onboarding upload screens do not say the warnings — OPEN — 2026-11-07

`MenuScanUpload`, `MenuCsvUpload` and `MenuManualEntry` hand their result on without rendering warnings; on a refused read they show only the 422's sentence (`response.data.message`). **Closes with** those three rendering `readWarningSentence`.

## `HouseMenu`'s "We couldn't read this file" branch — NOTE — 2026-11-07

Since a read with no line is refused (`fix/menu-empty-read-is-refused`), the `itemsExtracted === 0` branch is reached only by a proof stored before that change.
