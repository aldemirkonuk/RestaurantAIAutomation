# 0287 — A passed day's panel shows its net takings; the cell stays covers

- **Status:** Locked 2026-10-04 (founder) for where the takings are drawn and what they are. His two picks are quoted verbatim under Founder answers. The partial-day rule, the currency shape and the payload keys are this lane's choices under those picks (§Decision 3-5). **Fork F1, who sees the figure, is OPEN and blocks the merge** (§Forks).
- **Date:** 2026-10-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** /calendar, day panel, DayLedger, TakingsMark, DayRecordMark, month cell, net sales, takings, pos_checks.subtotal, pos_checks.total, netSales, netSalesCheckCount, currency, prediction_outcomes actual_value, AW22, AW17, A-049, street-fair booth
- **Links:** [[0111-the-calendar-is-the-houses-day-book]] §2b (the cell; bracket of 2026-10-03); [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] Q25 (money names its currency); [[0240-register-entries-are-fragments]] F3 (a fork recorded in its ADR, not as a new register row); `claims.d/fix-calendar-day-panel-takings.jsonl:1`; `.planning/06-pages/calendar.md` §1a; the analytics walk's findings `p4-scratch/sim-run/analytics/FINDINGS.md` (outside the repo), AW22 and AW17

## Context

The analytics walk on Tuzlu Rüzgar (2026-10-03, read-only, production) found that /calendar drops the takings its own API returns (AW22, A-049). Cited at origin/main `8c673db4b`:

- The gateway summed `pos_checks.total` into `recorded.sales` (`apps/api-gateway/src/calendar/recorded-days.service.ts:129-130`, select at `:165`) and passed it through (`day-record.service.ts:265-272`).
- The page drew only covers. `DayRecordMark` (`apps/web/src/pages/calendar/next/SkyMark.tsx:150-177`) prints covers, a covers tag and the forecast line, in the day panel (`MonthLedger.tsx:158`) and in the month cell (`:314`). No web file read `recorded.sales`; the only hit was its type (`useCalendarNextData.ts:200-201`).
- So a $7,709.52 street-fair booth (Aug 22-23, covers null on both checks) changed nothing on /calendar.
- The feature list said "Covers and sales" (`.planning/06-pages/calendar.md:172`, `:421`). ADR 0111 §2b, still Proposed, draws a covers-only cell (`0111:305-306`). Where the takings go was therefore the founder's call.
- `total` is gross. The walk measured it as net plus 8.63% tax plus a 4% surcharge (AW17). That was not re-measured here, because production is off-limits to this lane.

## Founder answers

AskUserQuestion, 2026-10-04 ~00:15Z and ~00:30Z, verbatim picks:

- **AW22:** *"Day panel only (Recommended)"*. The month cell stays covers-only, as ADR 0111 §2b draws it. Opening a day shows takings beside covers.
- **AW17:** *"Net sales (Recommended)"*. Owner sales figures use the subtotal, before tax and surcharge, and are labelled "net". The lane brief applies it here: if `recorded.sales` was gross, switch the server to the subtotal in the same PR.

## Options considered

Placement and basis are the founder's (above). The options below are the method under them.

1. **Fall back to `total` for a check with no subtotal.** Every day would show a number. But the sum mixes net and gross and is neither, which is the defect AW17 rules out. Rejected.
2. **A silent partial sum.** Sum whatever subtotals exist and say nothing. It understates the day with no notice, the absence-reported-as-health fault. Rejected.
3. **Withhold the whole day when any check lacks a subtotal.** Honest, but it hides a mostly-known figure behind one missing check. The covers rule already in this file sums what is known and names the gap. Rejected.
4. **Sum the subtotals that exist, count the checks they came from, and say so (chosen).** Null, never 0, when no check carried one.

## Decision

1. **Placement.** The takings are drawn in `DayLedger` only: the month's opened day and the Day view. Never in the month cell, and never in the cell's hover title. `reconciliationLine` (the cell's `title`) is unchanged and never names money. The mark is `TakingsMark` in `SkyMark.tsx`, drawn beside `DayRecordMark` (`MonthLedger.tsx`, DayLedger's mark row). `DayRecordMark` stays covers-only.
2. **Basis.** The sum of `pos_checks.subtotal` over the day's non-voided checks. Never `total`, never a fallback to it. `recorded-days.service.ts` no longer reads `total` at all.
3. **Method.** `netSales` is null when no check on the day carried a subtotal, drawn as the em dash and "net sales not recorded", never $0. `netSalesCheckCount` counts the checks that carried one. When it is below `checkCount`, the mark reads "net sales · from N of M checks", and its title says the day took more than this. A day with no checks draws no takings mark; the record mark already says nothing was recorded.
4. **Currency.** `GET /calendar/day-record` sends `currency: {code, readable}` beside the days, from one `restaurants.currency` read run in parallel with the two registers. `code: null` prints "(currency not recorded)" through `formatMoney` (ADR 0117 Q25). A failed read is `readable: false` and prints "(currency could not be read)". It is logged and never shown as "not recorded". Nothing prints a bare `$`.
5. **Payload and evidence.** `recorded.sales` becomes `netSales` plus `netSalesCheckCount`. The web reads both as optional: a payload without them (a gateway from before this record, during a deploy) draws no takings mark rather than "not recorded". The `prediction_outcomes` row's `actual_value.sales` (gross, on rows written before this) becomes `netSales`, `netSalesCheckCount` and `netSalesCurrency`. The key names the basis, so the two series cannot be read as one. Nothing else reads these rows: `CALENDAR_LEDGER_AGENT` and `PAIRING_TYPE` have no reader outside `day-record.service.ts` and its spec, checked with `git grep` at `8c673db4b`.
6. **Audience.** Not decided here; see F1. As built, every role that can open /calendar sees the figure, which is also what the API already sent before this record (option (a) of F1).
7. **Known limits, each with an owner, not fixed here:**
   - **UTC business day.** `checkBusinessDate` buckets a check on its UTC date (`recorded-days.service.ts`, the function of that name), so a check that closes after UTC midnight, the booth's among them, shows on the next day's panel. F-086, lane tz.
   - **The 1,000-row read.** The `pos_checks` read has no paging, so a month window past 1,000 checks (Tuzlu: 1,910 and 2,121) sums at most 1,000 rows. C15, lane cap. **Merge cap first**, then rebase this branch; the overlap is the one select line.
   - **Adapter subtotal.** The net label is only as true as each POS adapter's `subtotal`. Square maps `o.net_amounts.total_money` (`apps/api-gateway/src/pos-hub/pos-adapters.ts:113`), which Square's docs describe as tax-inclusive; that comes from the docs, not from a measured payload. Clover writes `subtotal: null` (`:159`), so a Clover house reads "net sales not recorded". Generic/simpos (`:65`) and Toast (`:203`) map a pre-tax figure. Lane netsales (AW17) owns the adapters, and should adopt or supersede rule 3 so goals, table analytics and the calendar agree.

## Consequences

- **Easier.** The booth's money, and every other day's, is visible in the opened day, in the house's currency, labelled net. The cell stays the scan of covers that ADR 0111 §2b draws.
- **Given up.** A one-glance month of takings on /calendar. The dashboard's sales calendar (lane dash, AW21) is the place for that.
- **Revisit when** lane netsales lands an adapter fix or a different partial-day rule, lane tz lands the house-local business day, or the founder answers F1.
- **Merge order.** After lane cap. After F1 is answered and, if (b) or (c), built. ADR 0090's audit before merging.

## Forks

- **F1 — Who sees the day's takings in the /calendar day panel? OPEN, blocks the merge.** /calendar is open to every role: `App.tsx:499` has only a `PageGate` feature gate, and `GET /calendar/day-record` has only the controller's `JwtAuthGuard` (`calendar.controller.ts:66`). So before this record the payload already sent the gross figure to staff, undrawn. Nothing on main decides whether staff see house money: OD-180 (OPEN-DECISIONS.md:268) fork 3 is still open, the founder's Today-feed answer *"Close it to staff (Recommended)"* (ADR 0253 round 2) is on unmerged #566, and the dashboard's "staff see no money" line (ADR 0257, W22) is on paused #579.
  - (a) Everyone who can open /calendar sees the net takings, staff included. This is what is built.
  - (b) Owners and managers only. For any other role, or no role, the gateway omits `netSales`, `netSalesCheckCount` and `currency` from the payload (the keys are left out, not set to null or 0), using `roleSatisfies(role, 'manager')` from `procurement/order-approval-gate.ts:46`. Staff see covers only, and the payload leak closes. The web already draws nothing when the keys are absent (§Decision 5). The evidence pairs are still written in full, because they belong to the house, not to the viewer.
  - (c) Staff see a line with no figure ("takings recorded; owners and managers see the amount"), and owners and managers see the figure.
  - **Recommended: (b).** It matches his Today-feed ruling and the dashboard's W22 line for the same class of figure (house takings), and it closes a leak the API already has. It does not cut against the direction in which waiters see their own figures once POS floor coverage runs: that concerns a waiter's own figures, not house takings.
  - Recorded here rather than as a new register row (ADR 0240 F3).
- **F2 (coordinator, not founder) — who fixes the Square and Clover subtotal mappings?** Handed to lane netsales, as §Decision 7 says. This lane stays one operation.

**Retire-to-write (CLAUDE.md §4).** This file is the one decision record §5 requires. It retires no document; ADR 0111 §2b gains a dated bracket pointing here.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | — | Created (Locked on the founder's AW22 and AW17 picks; F1 open) on `fix/calendar-day-panel-takings` |
