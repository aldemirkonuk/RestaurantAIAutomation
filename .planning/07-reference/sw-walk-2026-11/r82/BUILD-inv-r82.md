# BUILD inv-fix r82 (2026-11-19) - w2 findings 1-3

Worktree: wt/inv-r82 (one, all branches). Source: r81/WALK-w2-2026-11-19-r81.md.

## Finding 1: stale #1912 - FIXED
Plain merge of origin/feat/g2-inventory-quantities-carry-their-unit (6b13f7dce) up the chain; no conflicts, no rebase. Each tip: `tsc --noEmit -p tsconfig.json` exit 0 and `vitest run src/pages/inventory` green.
| PR | branch | sha after merge | diff vs base (chars) | vitest |
|---|---|---|---|---|
| #1921 | feat/taste-a-kind-aware-exports-1-columns | 00bb4fe27 | 29047 | 34 files / 701 |
| #1922 | ...-2-drink-columns | 6ab390fe4 | 25286 | 34 / 710 |
| #1923 | feat/taste-c-card-s1-client | 79041d58a | 17032 | 33 / 685 |
| #1924 | ...-s2-words | 81431b10d | 22362 | 34 / 713 |
| #1925 | ...-s3-card | 69799bc64 | 28829 | 35 / 736 |
| #1926 | ...-s4-mount | d5d7eaf96 | 6829 | 35 / 739 |
| #1939 | ...-s5-kind-words | aa6f4aa93 | 18114 | 36 / 769 |
| #1940 | ...-s6-summary | ba9ebe576 (after finding 2) | 27766 | 37 / 789 |
Tests: no new test (the 1912 tip carries its own: normalizeInventoryItem keeps stockLive null). Mutants: none (a merge, no new logic).

## Finding 2: taste line on a phone - FIXED on #1940 (ba9ebe576)
Decision: on a phone (max-width 640) the taste line sits under the "kind · size" line, above the cards; a one-line 44 px slot is held while the read is pending; collapses when the read answers "no profile"/off; a cached answer collapses before first paint (no pending state then). Desktop unchanged.
Build: TasteSummary takes `placement` ('head' | 'foot'). ItemDrawer renders a head copy above ItemCards and keeps the foot copy; CSS shows exactly one (head <= 640, foot above), the other is display:none, so tab/reading order always match. Both copies share one query key, one read. Head copy uses testids taste-line-head(-open/-marks/-hold) so existing taste-line tests are untouched.
Rejected: CSS `order` on a flex body (focus order != reading order, desktop spacing risk); a matchMedia hook (none in the app; SSR/test flicker); moving the foot copy for all widths (desktop would change).
Known limit: a sentence long enough to wrap to two lines at 375 grows the slot past 44 px once it answers (one-line reservation only).
Tests: ItemDrawer.test.tsx (head sits right after ivd-head and before .ivd-cards; hold while pending then collapses on no profile; supply holds no slot), TasteSummary.test.tsx (CSS shows head/hides foot at <= 640). Mutants (all killed): head moved below cards (2 fail); hold disabled (1 fail); media breakpoint 640->480 (1 fail).

## Finding 3: 44 px taps at <= 640 - FIXED on #1947 (stacked DRAFT on #1940), 062c7eb11
git log -S: the .iv-drawer 44 rule and .ivc-pick came from fe8a023aa (phone cards PR), ivd-evbar from 3362d8496 (drawer), Close lives in shared Sheet, "Read again" in RowDropdown + ItemUsedIn: ambiguous owner, and #1940 is already 27766 chars, so a stacked PR. Diff vs base 2567 chars.
Build (inventory-next.css): `.iv-drawer .mdv-ovl__close, .iv-drawer .iv-linkish` inline-flex min-height 44 (Close min-width 44); `.ivc-pick` min 44 x 44 (label is the hit area, box keeps its look). Select-all label already had min-height 44.
Tests: PhoneRows.test.tsx (2 CSS-source tests). Mutants (killed): drawer min-height 30; ivc-pick min-height 24.
tsc exit 0; vitest src/pages/inventory 37 files, 791 tests pass.

## Browser checks owed (not run; told not to start stack/browser)
- 375: taste line under header on first screen, no card shift when profile arrives, no shift with cached profile.
- 375: measure Close, All the evidence, Read again, row checkbox label at >= 44.
- 641-767 and desktop: foot copy shows, head copy hidden, unchanged.
- Unread stock reads "unread" not 0 / "4 are out" on the #1940 + #1922 build.

## NOT done / notes
- Findings 4 (seed vendor book) and 5 belong to another lane; untouched.
- #1921 diff is 29047 chars: under 30K but within 1K of the wall.
