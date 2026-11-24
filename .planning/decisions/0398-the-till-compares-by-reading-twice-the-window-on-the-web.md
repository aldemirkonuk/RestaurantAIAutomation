# 0398 — The till compares by reading twice the window, split on the web

- **Status:** Proposed (2026-11-24)
- **Date:** 2026-11-24
- **Decider:** The founder's delegation of every fork (2026-10-07), applied to the approved panel ruling DD-r104-22 ("web only, no new gateway parameter"). The executor recorded it; the founder may veto.
- **Keywords:** reports, till, compare, prior window, days=2N, house day, withheld, 365
- **Links:** [ADR 0296](0296-a-sale-belongs-to-the-houses-day.md) (house-clock days); [ADR 0348](0348-staff-are-refused-the-table-and-server-takings-and-the-rest-is-withheld-after-617.md) (staff withholding); PR #2027 (gateway `?compare=prior`, left unused), PR #2028 (the web consumer it replaces).

## Context

Laying the till beside the window just before it was ruled web-only with no new gateway parameter (DD-r104-22). r104 built the opposite: #2027 added `?compare=prior` to `pos-revenue` and #2028 read it. No record of the decision existed.

## Decision

1. **One read of 2N days.** With compare on, the web asks `pos-revenue?days=2N` and nothing else. It splits the answer at the house-clock day boundary, by the dates the gateway filed, never by timestamps: the last N days are the window, the N before them the prior.
2. **Totals come from the days kept.** The window's revenue and check count, and the prior's revenue, are summed from the split series. A day the server could not state, or that rang nothing, stays out of the sum and is a gap in the line, never 0.
3. **A year offers no compare.** 2N would pass the gateway's 365-day cap, so at 365 days the toggle is replaced by a line saying no compare is offered. The read stays 365 days and nothing is split.
4. **Staff get nothing extra.** Compare adds no request the staff reader could not already make: a staff read is answered withheld (all figures null, no series; PR #1362 / ADR 0348) whatever `days` says, so there is no window and no prior to split.
5. **#2027 is left alone.** The gateway parameter stays in its PR, tested and unused; it is neither closed nor retargeted. Removing it is the founder's call.

## Rejected

- **`?compare=prior` on the gateway (r104's build).** A second code path for money that the web can derive from one read; it contradicted the approved ruling.
- **Two requests (N and the N before).** Two reads can straddle midnight on the house clock and disagree on where the boundary is; one read cannot.
- **A 365-day compare against a clamped 365 read.** It would draw a prior that is shorter than the window, a comparison of unequal spans.
