Stacked on #1831 (house-shell.css owner).

## What changes
Design need N-11, the `100svh` sweep. On a phone `100vh` counts the screen as if the browser toolbars had folded away, so the foot of a full-height page sits under them. Tailwind's `screen` heights (`min-h-screen`, `h-screen`, `max-h-screen`: 83 + 53 uses) now emit `100vh` then `100svh`, and each `100vh` declaration in the shell and nine page stylesheets keeps its vh line and gains the svh twin.

## Not in this PR
Inline `100vh` in `SettingsNext.tsx`, `LogsNext.tsx`, `TemplateLibrary.tsx`, `QRCodeGenerator.tsx` (a print window), `WineRecordsTable`, `DistributorMapPage`, and the two dialog classes `max-h-[min(90vh,calc(100vh-5rem))]` (their tests pin the exact class string); `public-shell.css` and `endpaper.css` already carry `100dvh`.

## Tests
- `src/styles/viewportUnits.test.ts` (10): every 100vh declaration in nine sheets is followed by its svh twin; Tailwind compiles the three screen utilities to the vh/svh pair.
- Mutation (caught): config reverted + house-shell.css reverted fails 2.
- `vitest run` styles, mudavym, askai, admin, team, cellar, documents, promotions, recommendations: 90 files / 1602 tests pass; `tsc --noEmit` clean.

## Browser checks owed
Phone 375x812 (real iOS Safari toolbar if possible): a short page (/team, /reports empty) fills the screen without a scroll bar; the foot of /settings is reachable; 1440 unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
