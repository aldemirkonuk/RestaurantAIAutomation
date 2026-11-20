# r72 c3-menu-error build (2026-11-19)
PR: #1889 DRAFT, branch fix/r72-menu-read-failure-in-words, base feat/r61-c2-menu-rhythm (#1852). Head 59e25c894.
Cause: read_warnings column is added by open PR #776 (fix/menu-read-warnings-column, migration only). The menu stack's gateway (#1837/#1841/#1852) names it in VERSION_SELECT.
Done: gateway reads without read_warnings when only it is missing (null notes); other failures say "The menus could not be read just now. Try again." with cause in `detail`; page shows sentence + 48px Retry + Details fold; reduced-motion honoured.
Tests: jest src/menus 210 pass; vitest src/pages/menu + src/components/mudavym 522 pass; web+gateway tsc clean; 8 mutants killed (2 needed tighter tests); vite build ok, CSS +0.28kB, MenuNext chunk unchanged.
Left: other gateway messages that interpolate error.message (e.g. current-menu read, plan) still carry database words; #776 must still merge for read warnings to show.
Browser checks owed: see PR #1889 body (5 checks).
