Stacked on #1763 (KpiRow.tsx owner).

## What changes
Design need N-11, the KPI strip. Under 640 px the dashboard's five KPI tiles are one scroll-snap row of tiles at least 112 x 72 (was two columns with an orphan and a hole); from 640 px the grid classes are unchanged. The staff desk (#1825) does not use this row.

## Tests
- `KpiRow.strip.test.tsx` (2): the phone css rule and the row's class with the desktop grid classes kept.
- Mutation (caught): class removed; tile min-height 72 to 60.
- `vitest run src/pages/dashboard` 9 files / 173 tests pass; `tsc --noEmit` clean.

## Browser checks owed
Owner `/` at 375: KPI tiles in one row, snap on swipe, labels and sublines readable, no page-level horizontal scroll; 640 and 1440 grids unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
