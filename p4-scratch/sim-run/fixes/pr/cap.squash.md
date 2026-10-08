Analytics reads a window whole or refuses it; it never prints a 1,000-row slice as the total (ADR 0292).

**What was wrong:** the Supabase API caps a read at 1,000 rows. A window holding more came back as a 200 with a thousand rows, and the page printed that sample as the total, with no notice (F-131). On the 2026-10-03 read-only walk, the 90-day /reports till counted 1,000 of 3,313 checks ($187,474 against $625,944). "Who served it" ranked the floor on 1,000 of 3,341 checks. The "Tonight" card said a Saturday fell 97%; the feed says about 14.6%.

**What changed**
- **`common/read-whole-window.ts`.** `readWholeWindow` keyset-pages on `id`, and proves the read whole with an exact count on every page. It returns the window whole or throws `WholeReadError`, a 503 that carries a sentence. It refuses on a failed page, a stalled cursor, a malformed page, an unstable count (after one re-read) and a count above 100,000. It never returns a prefix.
- **Every reader in ADR 0292's readers table reads through it:**
  - goals (the till, the ribbon, goal progress, `bottles_sold`);
  - table analytics ("Who served it", tables, basket);
  - the insight generator's two window reads;
  - advanced analytics (menu engineering, seasonality, Wine 360 demand);
  - the till list;
  - `analytics.service.ts` `loadConsumption`, which no longer turns a refused pour read into `[]` (fork 3);
  - the dashboard sales chart;
  - the calendar's recorded days.

  On refusal each says the window could not be read whole, rather than computing from part of it.
- **The insight generator moves to version 6**, so cached insights computed from a slice are refused and recomputed.

**Founder rulings:**
- **2026-10-06:** forks 1–4, including "propagate" for the four lenses.
- **2026-10-07:** *"Whole lens, as built"* and *"Say it couldn't be read"*.

All are quoted in ADR 0292. The second 2026-10-07 answer overturns the coordinator's reading that the insight bundle's silent family is kept. A follow-up PR names that refused read in /recommendations' `sourcesUnread`; this PR does not change it.

**Not in this PR:**
- The guard that blocks a new unranged read (stacked branch, not opened).
- Seven baselined capped reads, and two count-less keyset pagers (`readTillPages`, `readMonthTakings`).
- 500 vs 503 on the four lens routes.
- Latency, which is unmeasured.

**Evidence**
- Lane jest at this head (the final): 76/76 suites, 1,279/1,279 tests.
- Red without the fix: 14 of 44 lane cases.
- Guards all exit 0. Decision claims hold 921/921.
- The ADR 0090 audit PASSED at `c05c41f4c`, again at `bcad327e2`, and on delta re-audit at `5a8bda603`.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
