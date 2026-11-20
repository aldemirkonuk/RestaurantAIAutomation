# r71 n17-palette build (2026-11-19)

PR: #1882 (DRAFT), branch feat/r71-n17-palette, base feat/r58-d-tokens-dark-and-motion (#1819 owns CommandPalette.tsx).
Overlap: Sheet.tsx / motion.ts also in #1833, Sheet.tsx in #1836 (small hunks).

Built (app-shell path only): blur 14px/saturate 1.2 over 55% scrim; `lift` spring token (520/34) via Panel enter="lift"; 14 ms row stagger; one clip-path pill; fieldless input with hairline, sticky; 2-line name clamp; recents tile; Tab actions (new tab, copy link; failed copy says so); no-match "Ask Mudavym" row; preview pane behind flag (VITE_PALETTE_PREVIEW or localStorage mudavym.palette.preview=1), off by default.

Tests: CommandPalette.signature.test.tsx 19 cases; housePolicy token list + lift. tsc clean. vitest command+mudavym+lib/mudavym+styles: 47 files / 775 tests pass.
Mutation: 15 mutants (blur x3, scrim, stagger, pill top, enter, tab, no-match, flag, thumb, transition-all, stopPropagation, Sheet lift branch); all fail the suite (after tightening the blur assertion, which first let two mutants through).
Build delta vs #1819 tip (ccc18a297 local ref): JS +3459 B raw (+1109 gz), CSS +4284 B raw (+619 gz).

Left: real page thumbnails (tile holds the icon); preview shows the row's own words not a vendor card / order sheet; Ask row does not pre-fill the typed text (Ask panel has no such detail).

Browser checks owed: see the PR body (10 checks: blur/scrim paper+charcoal, entrance, pill glide incl. two-line row, no glide on first paint, Tab actions, no-match Ask row, reduced motion, 375px, preview flag, backdrop-filter cost on a low-end phone).
