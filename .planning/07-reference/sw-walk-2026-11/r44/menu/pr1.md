## What
The price history under a menu line says each change's day on the house's clock (from Settings, Time zone), not the UTC day. With no zone set, or a failed zone read, it says the days are UTC days. A saved price change re-reads the open history.

## Why
A change at 01:30 on 2 Nov in Antalya read "since 2026-11-01". An open history stayed on the old price after Change price.

## Tests
vitest src/pages/menu/next: 9 files, 163 passed. Web tsc clean. Two mutations (ignore the zone; drop the history refresh) each fail a test.

Stacked on #1681 (the newest open PR owning PriceHistory.tsx). Browser not run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
