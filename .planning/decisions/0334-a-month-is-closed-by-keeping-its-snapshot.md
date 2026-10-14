# 0334 — A month is closed by keeping its snapshot, and later changes are listed against it

- **Status:** Locked
- **Date:** 2026-10-11
- **Decider:** founder (2026-10-11 chat)
- **Keywords:** F-1013, F-128, month close, month-end, period lock, snapshot close, report_exports, window_month, till month export, later changes, reopen
- **Links:** migration `20270104700000_a_till_export_can_hold_a_month.sql` (the till-month export, prerequisite); `apps/api-gateway/src/reports/exports/report-exports.service.ts`; [ADR 0286](0286-a-sent-time-is-the-facts-time-for-72-hours-older-needs-a-manager.md) (late facts need a manager); [ADR 0296](0296-a-sale-belongs-to-the-houses-day.md) (a sale belongs to the house's day); sim ledger S149, S150 and S195

## Context

F-1013 (sim 36, a rehit of F-128) found that the owner could read the till's month but could neither export it nor close it. The export half was built in wave 73: `report_exports.window_month` (`20270104700000`), threaded through `report-exports.service.ts`.

The close itself was a founder fork (S150), with three options set out by the lane:

- (A) a soft close stamp;
- (B) a hard lock on writes dated in a closed month, with an owner reopen;
- (C) a snapshot close: the month-end exports become the record, live data stays editable, and later changes are listed against the snapshot.

The founder, 2026-10-11, verbatim: *"Then option C it is for F of 1013."*

## Options considered

1. **(A) Soft close stamp.** Cheap. But it freezes nothing, so the "closed" figures can drift with no trace.
2. **(B) Hard lock with an owner reopen.** This is the accounting-system model. But every write path (counts, deliveries, the till, late facts under ADR 0286) would need a lock check. A missed check is silent, and an overloaded house would keep reopening.
3. **(C) Snapshot close.** Closing a month keeps its month-end exports as the fixed record. Live data stays editable, and any later change dated inside the month is listed against the snapshot. **Chosen.**

## Decision

**Closing a month stores that month's exports as an unchangeable snapshot, with who closed it and when. Nothing stops a later write. A change dated inside a closed month is listed against the snapshot as "changed after close", with who, when and by how much.**

1. **The snapshot is the month-end exports** (the till month and the existing report cuttings for that `window_month`), stored once and never rewritten. Closing twice keeps the first snapshot and says the month is already closed.
2. **Only an owner or a manager closes a month.** The close is recorded in the house's logs.
3. **Later changes are read, not blocked.** A row dated inside the closed month and written after the close shows up on that month's "changed after close" list, next to the snapshot figure and today's figure. [Amended 2026-10-12 by ADR 0343: a stock-take count is filed in the month its count session states when it was made within 6 hours after that month ended (the founder's pick F1 b, sim-ledger S224), so such a count is "inside" that month for this list and for the close's sums; its counted moment is never moved. Every other row, spot counts included, is dated as before. Nothing locks.]
4. **No reopen is needed.** Because nothing is locked, there is nothing to reopen. A new snapshot of the same month may be taken as a re-close, and it is listed beside the first, never replacing it.

## Consequences

- The owner gets a fixed month-end record to hand to an accountant, and the floor keeps working without a lock.
- No write path has to learn a lock, so nothing can be silently blocked or silently let through.
- The figures in the app and the snapshot can differ. The "changed after close" list is the explanation, so it must always be shown with the snapshot.
- Revisit if an accountant or a tax rule needs writes to be refused after close (the signal is a house asking for a lock). That would be option B on top of C.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-11 | — | Created from the founder's chat ruling (sim S195) |
