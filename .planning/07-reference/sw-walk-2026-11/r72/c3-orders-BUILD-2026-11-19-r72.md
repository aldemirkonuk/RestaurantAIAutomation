# r72 c3-orders build (2026-11-19)

PRs (draft):
- #1886 feat/r72-c3-orders-phone (f760247c3), base feat/r61-c2-type-ordersnext (#1855). Need 1: single minmax(0,1fr) grid column, 148x64 snap strip gap 8, 72 px two-line row cards, 20 rows + "Show 20 more" (open/deep-linked row pinned).
- #1887 feat/r72-c3-counter-rail-idle (b87d03993), base feat/r71-c3-p2-counter-pressed (#1878). Need 14: dot column / live-only opening already in #1818/#1878; added the 220 ms slide.

Tests: orders vitest 17 files/259 pass; mudavym vitest 28 files/404 pass; web tsc clean both.
Mutation: orders 4/4 killed (grid col, open-row pin, 72 px, un-sliced map); rail 3/3 killed.
Chunk: OrdersNext js 103.55->104.12 kB (gz 30.34->30.57), css 0.60->1.85; main index 1,965.75->1,966.06 kB.

Left: bulk-select checkbox still 14 px (44 px target); stage badge 9 px until #1857; LedgerRow conflicts possible with #1857/#1860 (class-name additions only); cause of "rail open with seven none-waiting rows" unverified (likely a non-answering register, or pre-#1818 build).

Browser checks owed: see PR bodies (375 scrollWidth == 375, 20/40 rows, deep link past row 20, 1440 idle dots on /orders /receipts /settings, 220 ms slide, reduced motion).
