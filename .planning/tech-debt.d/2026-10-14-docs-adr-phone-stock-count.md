## Phone stock count (F-076 / F-1544): what ADR 0343's lanes 1–6 leave owed — OPEN — 2026-10-14

[ADR 0343](../decisions/0343-a-stock-take-is-a-walk-of-shelves-that-commits-as-it-syncs.md), locked on the founder's picks of 2026-10-12 (sim-ledger S224: F1 b, F2 a, F3 a, F4 a). Lanes 1–6 are built and committed locally, stacked to `59302df4c` (`feat/count-session-envelope` → `feat/count-open-bottles` → `feat/count-walk-web` → `feat/count-review` → `feat/count-month-period` → `feat/count-sheet-import`); none is pushed or merged. F-076 and F-1544 close **only when those lanes merge**. Each item below is still open:

- ~~**Nothing links to `/count`.** The routes exist (`apps/web/src/App.tsx`, `/count`, `/count/:sessionId`, `/count/:sessionId/review`); only the sync strip links into a walk. A nav entry is owed.~~ [BUILT 2026-10-14, owed-count-ux `6c762112c` (sim ledger S232): "Stock count" is a cellar room with no minimum role (`apps/web/src/lib/mudavym/rooms.ts`), and `/inventory` has a "Stock count" button.]
- ~~**Zone choice is not offered.** The gateway takes `zoneIds` when a count opens; the web opens every leaf shelf of the house.~~ [BUILT 2026-10-14, owed-count-ux `6c762112c` (sim ledger S232): `/count` lists each live top-level place that holds a shelf, and a manager's pick is sent as `zoneIds` (`apps/web/src/pages/count/CountIndex.tsx`).]
- **The count pages are English only.** A Turkish house's bartender reads English on `/count`.
- **Open-ml changes are not listed in "changed after close".** The close sums `variance_open_ml` (lane 5), but a per-count open-ml change after a close is not on the list.
- **Open ml is reconciled per shelf, not per item.** A pour may draw on another shelf's open bottle (ADR 0285); the cross-shelf reconcile is deferred.
- **A bottle found on the wrong shelf lands uncosted.** Carrying the short shelf's cost to it is not built (ADR 0343 Decision 9).
- **"Carry this" is matching only.** Creating an item from a parked line waits on ADR 0115 (Proposed, PR #589).
- **A count-sheet import writes no log entry** (ADR 0335 §3); the opening-stock import does not either.
- **Lane 7, the phone app's count tab, is deferred** until OD-109's first run. The open CLAIMS row `F-1544-L7-PHONE-APP-HAS-NO-COUNT-YET` fails the build the day the app calls a count session, so this line is struck then.
- **ADR 0343's README row** goes in its own PR, a pure append.
- **Not verified:** production was not read; the 6 h window and the ~10% revisit signal are estimates.
