## What changes
Staff's rooms list (the desktop rail and the phone's Rooms sheet) opens to the seven rooms a shift uses: Dashboard, Notifications, Calendar, Orders, Receiving, Inventory, Team. Every other room staff may enter folds behind one "More rooms" row, which opens by itself when staff stand in a folded room. No room is removed; the palette still lists all of them. Owner and manager are unchanged. Design need N-11 (staff nav), left open in #1825.

## Tests
- `HouseRail.staff.test.tsx` (5): daily list and order, fold closed, nothing lost (daily + folded = visible), fold opens on a folded room, owner/manager have no fold.
- Mutation (caught): staff gate flipped (2 fail), fold-open logic disabled (1 fail).
- `vitest run src/components/mudavym src/lib/mudavym` 17 files / 335 tests pass; web `tsc --noEmit` clean.

## Browser checks owed
1. Staff at 1440: rail shows "Your shift" with seven rooms, "More rooms +" closed, Settings and Help below.
2. Staff at 375: Rooms sheet, same; "More rooms" row is 44 px; opening shows the other groups.
3. Staff on /reports: the fold is open and Reports is marked current. Owner/manager rail unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
