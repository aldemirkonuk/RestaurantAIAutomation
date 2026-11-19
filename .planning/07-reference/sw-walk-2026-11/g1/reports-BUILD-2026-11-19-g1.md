# g1 reports build 2026-11-19: arranging on a phone

PR: #1906 (draft), base feat/r75-reports-reload-cls (#1904 tip 00695f7c4), branch feat/g1-reports-phone-arrange-one-column, commit c809ccce4.
Gap verified real at #1904 tip: the new test showed "column 1 of 2" and the left/right buttons on a 375 stack.

Changed: rp-sheet.ts (isStackedWidth), rp-arrange.ts (colsForWidth=1, StackAt words, stack key help, resize re-measure, sideways no-op), Placing.tsx (bar + help), Sheet.tsx, ReportsNext.tsx (help prop).
Tests: Sheet-stack-arrange.test.tsx (4), rp-arrange.test.ts (+2, 2 updated). vitest src/pages/reports: 22 files 360 passed. tsc --noEmit clean. vite build ok.
Mutation: colsForWidth back to 4/2 -> 5 fail; sideways early return removed -> 1 fails.
Left: not browser-walked; liftCuttings was not changed (cols 1 never scales x/w: sideways and width steps are blocked before it).
Browser checks owed: (1) 375 px arrange, no left/right/Narrower/Wider, Shorter/Taller change height, status says position N of M; (2) Up/Down reorders on screen, rule off, reload at 1280 desktop columns unchanged; (3) rotate 375->800 while holding a card: column buttons return.
