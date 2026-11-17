## What
From 12 lines up, /menu offers "Find a line". It narrows the drinks and the kitchen table by name, producer, section, region, grape or year, ignoring case, accents and the Turkish dotless i. It says "Showing N of M lines that match ...", and says when nothing matches and that nothing was changed. The menu's own counts stay those of the whole menu.

## Why
Changing one price on a 300-line menu meant scrolling both tables.

## Tests
vitest src/pages/menu/next: 165 passed. Web tsc clean. Four mutations (any word instead of every word, no dotless i, counts of the shown lines, finding never on) each fail a test.

Stacked on #1667 (newest open PR owning MenuNext.tsx). Browser not run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
