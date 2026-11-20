# r73 c3-consent build (2026-11-19)

PR: #1892 (draft) feat/r73-c3-consent-calm, base feat/r71-n20-depth (#1875, owns HoldToApprove.tsx). Worktree wt/r73-c3-consent.
Need: design critic round 3 P1 item 6 (consent dialog = DataTermsAcceptSheet, owner sign-in gate).

## Built
- Summary 16 px DM Sans, three icon lines (Read / Never read / Who sees it), full text under "Read it all" (shared Collapse, grid-template-rows), 520 px panel, 12 px backdrop blur (`:has(.dt-sheet)` scoped, no edit to sheet.css).
- HoldToApprove `ring` prop: 56 px, clip-path ring fill; sheet holds 1200 ms. Off by default.
- DataTermsSignInGate mounts the sheet 2 rAF + 350 ms after paint.
- Accept path untouched: same seal at hold start, same acceptDataTerms(version, digest, challenge).

## Tests
- vitest src/components/settings src/components/mudavym src/components/layout src/pages/settings: 50 files, 650 tests passed (before the css test file); css test 4/4.
- Mutation (mut-consent.sh, mut.out): after-paint gate, hold-ms, ring prop, blur 12, fold always open, bullet label, ring clip-path: each fails 1-2 tests; clean run 39/39.
- web tsc --noEmit -p tsconfig.json: exit 0.
- vite build + chunk delta: see build.out / assets-*.txt in this folder if present (queued behind the heavy slots; baseline = base worktree wt/r73-c3-consent-base).

## Left
- Browser checks owed (listed in the PR body): after-paint timing, blur, 16 px text, fold open, 1.2 s ring, reduced motion, keyboard, Settings Mail reading dismissable path.
- Not measured: whether the summary reads in exactly three lines at 520 px (copy is the existing Jev consequence + "It changes nothing else" sentence).
- Never read / Who sees it lines are scaffolding from existing Jev wording and subprocessor names; flag for the lawyer list (ADR 0207).
