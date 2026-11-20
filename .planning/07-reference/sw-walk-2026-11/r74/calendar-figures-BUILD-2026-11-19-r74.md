# r74 calendar-figures build (2026-11-19)
PR: #1903 (draft), branch feat/r74-calendar-figures, base feat/r73-c3-p2-calendar-heat (#1890), head 0ea8eceb3.
Change: calendar $ figure 11 px tabular (phone 10 -> 11); squares under 44 px wide or too narrow for the longest figure at 11 px hide figure + "from N checks" and carry the day label in title. SalesCalendar.tsx (figureFits, ResizeObserver, data-fig), dashboard-next.css.
Tests: vitest src/pages/dashboard 163/163; web tsc clean; vite build +595 bytes total. Mutation: hide rule, 44 threshold, title each fail tests.
Left: 9 px words in wide cells ("N orders", "not recorded"); no motion added.
Browser checks owed: see PR #1903 body (1280 counter-open, 375, wide, resize across 44 px, dark).
