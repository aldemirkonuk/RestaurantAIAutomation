# g2 units build, 2026-11-19
- PR #1912 (draft), base feat/r72-c3-inventory-phone-filter (#1888 tip 80807296f), branch feat/g2-inventory-quantities-carry-their-unit, head 63fe7cc14.
- Gap verified real: InvRow had no uom; InventoryTable/PhoneRows used bare fmtCount.
- Change: toRow carries uom; ItemCards listFigure/listUnitTail/listPace; table, phone card, Vel/day.
- Tests: iv-list-units.test.tsx (11). Mutation: 5 mutants all killed. vitest src/pages/inventory 33 files/683 pass. tsc clean. vite build ok.
- Left: drawer fmtQty 'each' still bare; Runway; CSV export; #1898 also edits InventoryNext.tsx (no overlap with this PR).
- Browser checks owed: see PR #1912 body (5 checks: desktop weighed/poured, wine bottles/each items, phone card at 375 px, unread dashes, Vel/day kg).
- Worktree wt/g2-units removed after push.
