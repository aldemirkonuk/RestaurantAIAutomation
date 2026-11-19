# r73 c3-banner-empties build (2026-11-19)

PRs (draft): #1898 tour line (feat/r73-c3-tour-line, base feat/r61-c2-staff-shift-strip = #1867, head bbee165d4); #1897 reports strips (feat/r73-c3-reports-empty-strips, base feat/r61-c2-reports-bento = #1863, head dcf2ac036).

Need 9: TourLine.tsx, one 44 px line "Take the tour . Later", hides after 3 views (localStorage per page), Later folds by grid rows 200 ms. Need 11: isStrip folds the week-at-zero and can't-draw cuttings; RuledOff drawing 96 grid at 40 px; till stays a full card (window picker).
Tests: reports 19 files/344 pass; guidance+layout+HouseShell+dashboard 18 files/285 pass; src/__tests__ 123 pass; tsc clean. Mutations: 3 (reports) + 4 (banner) all caught.
Build: ReportsNext js 181.66->182.14 kB (gz 59.36->59.57), css +0.65 kB; main index 1965.71->1967.57 kB (gz +0.55).
Left: till empty stays full; "Don't show again" removed from tip line; view count per browser; #1863/#1883 conflict in rp-plot.tsx (not mine); #1819 GuidanceStrip untouched.
Browser checks owed: listed in both PR bodies (375 /inventory + /reports row = 44 px, 4th visit hidden, Later fold, week strip 72 px with 40 px drawing, arrange restores card, reduced motion, dark).
