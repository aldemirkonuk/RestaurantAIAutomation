# g2 reports-strip build, 2026-11-19
- PR #1911 (draft), base feat/g1-reports-phone-arrange-one-column (#1906), branch feat/g2-reports-strip-flows-full-width, commit e6cd7038f.
- Gap verified real at the #1906 tip: reading mode is static, strip h=2 keeps x/w, nothing rises; house sheet till strip leaves 8 cols x 6 rows blank.
- Fix: flowStrips in rp-arrange.ts, called from sheetLayouts (lg/md, not arranging). Strip flag from ReportsNext through SheetCutting.
- Tests: rp-arrange-strips.test.tsx (7). Mutation: flow call removed -> 4 fail. vitest src/pages/reports 23 files/367 pass; tsc clean; vite build ok.
- Left: nothing known. Narrower rulings (sm/xs) unchanged by design.
- Browser checks owed: /reports 1280/1024/800 with a strip: no blank block; 375 unchanged; arrange restores real slots and leaving re-flows; reload shift.
