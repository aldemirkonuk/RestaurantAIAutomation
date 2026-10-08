Let ADR 0303's waiter-control checks hold on the net-sales basis too, ahead of #615 (ADR 0295). No product code changes.

**Why:** #621 (ADR 0303) merged while #615 was in rework. Re-heading #615 onto it breaks two things #621 added. First, three tests in `tables-learned-from-the-pos.spec.ts`: their check fixture states no `subtotal`, so on the net basis every check reads "not stated". Second, the claim `ADR-0303-THE-WAITER-CONTROL-KEEPS-HIDDEN-TABLES`, whose verify pinned the gross push line verbatim. Fixing both inside #615 would take it over the 15-file cap, so they land first, here.

**What changed**
- The `check()` fixture in `tables-learned-from-the-pos.spec.ts` now states `subtotal`. It follows the test's `total` unless a test sets it, so every reading on main is unchanged.
- The claim row in `claims.d/feat-tables-learned-from-the-pos.jsonl`: the verify now accepts the gross push (main) or the net push (#615), and nothing looser. It reads `getWaiterPerformance` and rejects any added guard, skip, filter, reassignment or second push that would drop hidden-table checks from the control. That control is the founder's 2026-10-05 pick, "Keep them in the control (Recommended)". The claim prose says what the verify does not read: `loadChecks`, `tallySale`, `netSalesOf`, `newSalesTally`, `/* */` comments, and bracketed, cast or compound writes.

**Evidence**
- The first verify was blocked at `69d0cf1fe` (M1 and M2 passed it). The tightened verify exits 1 on 30 mutations, gross and net, and 0 on main and on #615's head.
- The ADR 0090 audit PASSED at `f18ade8c3`, and again on delta re-audit at `7fb476a37` after main's #609 merged clean.
- Decision claims hold 921/921 (Python 3.11). Lane specs pass 72/72 with #609's `read-whole-window.spec.ts`.

**Owed:** a `subtotal` projection assertion in #615's audit, because this spec's stub ignores the selected columns.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
