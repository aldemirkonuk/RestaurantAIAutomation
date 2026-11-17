## What
Coming back to the /menu tab (for example from a kept menu's file, opened by its Source link) no longer plans the menu again, nor re-reads the kept menus, unless a minute has passed. A choice, a lock or a refresh still re-reads at once.

## Why
The app re-reads every query on focus after 5 s. The plan costs 8 or more trips, and checking a plan against its file is the very reason to leave the tab.

## Tests
vitest src/pages/menu: 9 files, 157 passed. Web tsc clean. Two mutations (drop the plan's, drop the list's fresh time) each fail a test.

Not covered here: the current menu's own read in MenuNext.tsx (another chain). Stacked on #1668. Browser not run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
