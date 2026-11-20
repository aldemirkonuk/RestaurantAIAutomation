# r75 inventory-tour build (2026-11-19)
PRs (draft, pushed onto the owners; no new PR): #1898 e98673b0a (tour anchors on InventoryNext + visible "tour could not start" line); #1896 6e67b85a5 (ring room in .gr-inner, reduced motion unclipped).
Tests: InventoryNext tour-anchors case, announce.test.tsx (2), GroupRail.test (2) all fail with fix reverted. guidance+inventory+layout 29 files 508 passed; mudavym+settings 40 files 598 passed; tsc clean both. Chunk: main +0.73 kB (+0.26 gzip) on #1898; css 231.59 kB unchanged on #1896.
Left: anchors.test.ts still passes /inventory via the command page (InventoryRoute draws both); rail pick scroll overshoot (w2 finding 2) not touched.
Browser checks owed: in both PR bodies.
