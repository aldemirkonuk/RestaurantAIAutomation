# 0287 — A passed day's panel shows its net takings; the cell stays covers

- **Status:** Locked 2026-10-04 UTC (founder; his answers came between ~00:15Z and ~02:10Z, the evening of 2026-10-03 local) for where the takings are drawn, what they are, and who sees them. His three answers are quoted verbatim under Founder answers. The partial-day rule, the currency shape and the payload keys are this lane's choices under those answers (§Decision 3-5). Fork F1 was answered 2026-10-04 ~02:10Z (§Decision 6, §Forks). [2026-10-07: **F1 is built as (b), not locked.** His F1 answer was free text that picks none of the options; "Read as option (b)" (§Founder answers) is this lane's reading, and no pick of (b) confirming it exists in the lane brief or in this record (audit of #610 at `31c5ec562`). So the lock covers where the takings are drawn and what they are; who sees them is built as (b) and waits on his confirmation (§Forks F1). Decision 8 (a refused register) is, like 3-5, this lane's method under his answers and ADR 0292.]
- **Date:** 2026-10-03 (local; created before the answers, which are stamped in UTC)
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

AskUserQuestion on this lane's plan, 2026-10-04 ~02:10Z. He wrote his own answer rather than pick an option:

- **F1, who sees the day's takings:** *"everyone owners and managers, authorized ones see everything others only see actions, goals dedicated to them"*. Read as option (b) below: owners and managers see the takings; any other role gets no house money. The second half, that other roles see the actions and goals assigned to them, is his stated direction for staff. It is recorded here and is **not built** by this record: it is broader than /calendar, and the staff goals it names belong to the page that owns goals. [2026-10-07: "Read as option (b)" is this lane's reading, not his pick. It is built; his confirmation is owed (§Forks F1).]

## Options considered

Placement and basis are the founder's (above). The options below are the method under them.

1. **Fall back to `total` for a check with no subtotal.** Every day would show a number. But the sum mixes net and gross and is neither, which is the defect AW17 rules out. Rejected.
2. **A silent partial sum.** Sum whatever subtotals exist and say nothing. It understates the day with no notice, the absence-reported-as-health fault. Rejected.
3. **Withhold the whole day when any check lacks a subtotal.** Honest, but it hides a mostly-known figure behind one missing check. The covers rule already in this file sums what is known and names the gap. Rejected.
4. **Sum the subtotals that exist, count the checks they came from, and say so (chosen).** Null, never 0, when no check carried one.

## Decision

1. **Placement.** The takings are drawn in `DayLedger` only: the month's opened day and the Day view. Never in the month cell, and never in the cell's hover title. `reconciliationLine` (the cell's `title`) is unchanged and never names money. The mark is `TakingsMark` in `SkyMark.tsx`, drawn beside `DayRecordMark` (`MonthLedger.tsx`, DayLedger's mark row). `DayRecordMark` stays covers-only.
2. **Basis.** The sum of `pos_checks.subtotal` over the day's non-voided checks. Never `total`, never a fallback to it. `recorded-days.service.ts` no longer reads `total` at all.
3. **Method.** `netSales` is null when no check on the day carried a subtotal, drawn as the em dash and "net sales not recorded", never $0. `netSalesCheckCount` counts the checks that carried one. When it is below `checkCount`, the mark reads "net sales · from N of M checks", and its title says the day took more than this. A day with no checks draws no takings mark: the record mark beside it already reads "covers not recorded" under an em dash, and the line under it "Nothing was recorded on this day." (`reconciliationLine`).
4. **Currency.** `GET /calendar/day-record` sends `currency: {code, readable}` beside the days (to owners and managers; §6), from one `restaurants.currency` read run in parallel with the two registers. `code: null` prints "(currency not recorded)" through `formatMoney` (ADR 0117 Q25). A failed read is `readable: false` and prints "(currency could not be read)". It is logged and never shown as "not recorded". Nothing prints a bare `$`.
5. **Payload and evidence.** `recorded.sales` becomes `netSales` plus `netSalesCheckCount`. The web reads both as optional: a payload without them (a gateway from before this record, during a deploy) draws no takings mark rather than "not recorded". The `prediction_outcomes` row's `actual_value.sales` (gross, on rows written before this) becomes `netSales`, `netSalesCheckCount` and `netSalesCurrency`. The key names the basis, so the two series cannot be read as one. Nothing else reads these rows: `CALENDAR_LEDGER_AGENT` and `PAIRING_TYPE` have no reader outside `day-record.service.ts` and its spec, checked with `git grep` at `8c673db4b`.
6. **Audience (F1, answered).** [2026-10-07: built as (b) on this lane's reading of his words; his confirmation is owed, §Forks F1.] Owners and managers see the takings. `GET /calendar/day-record` computes `roleSatisfies(user.role, "manager")` (`procurement/order-approval-gate.ts`, the function of that name) from the role in the token's house (`jwt.strategy.ts`, re-read from the access row on every request), and passes it to `DayRecordService.windowFor` as a required `{seesHouseMoney}` argument, so no caller gets the money by leaving the viewer out.
   - For any other role, or a session with no role in the house, the payload **omits** `netSales`, `netSalesCheckCount` and `currency`. The keys are left out, never set to null or 0, because null already means "no check carried a net figure" and 0 would read as a quiet day. The window carries `takingsWithheld: true` instead, so the absence is never read as a gateway from before this record or as an empty register.
   - The withheld window is built as an allowlist (`withholdHouseMoney`): each day's covers, check count, exclusion, forecast, observation, score and line, and the window's dates, refusals, `posConnected` and `pairsWritten`, are copied, and nothing else. A field added to a day later stays out of a staff payload until someone decides it belongs there.
   - The web checks `takingsWithheld` too and draws no takings mark at all, not "not recorded", even if a figure reached the page.
   - The evidence pair is written in full whoever opened the page, `netSalesCurrency` included: it is the house's record, not the viewer's. So the `restaurants.currency` read runs for every viewer; only the payload drops it.
   - This closes a leak the API already had: before this record, the gross `sales` went to every role, undrawn.
7. **Known limits, each with an owner, not fixed here:**
   - **UTC business day.** `checkBusinessDate` buckets a check on its UTC date (`recorded-days.service.ts`, the function of that name), so a check that closes after UTC midnight, the booth's among them, shows on the next day's panel. F-086, lane tz.
   - **The 1,000-row read.** The `pos_checks` read has no paging, so a month window past 1,000 checks (Tuzlu: 1,910 and 2,121) sums at most 1,000 rows. C15, lane cap. **Merge cap first**, then rebase this branch; the overlap is the one select line. [2026-10-07: closed for this read. Cap merged first (#609, ADR 0292, main `b270a45b8`); this branch took it by merging origin/main `ca3582988` at `aea170f7c`, not by a rebase. The read is now `readWholeWindow`'s factory selecting `"id, opened_at, closed_at, subtotal, covers", { count: "exact" }`, so a month is summed from every check, or the ledger refuses with ADR 0292's sentence and sends no day. What a refusal does to the takings is Decision 8.]
   - **Adapter subtotal.** The net label is only as true as each POS adapter's `subtotal`. Square maps `o.net_amounts.total_money` (`apps/api-gateway/src/pos-hub/pos-adapters.ts:113`), which Square's docs describe as tax-inclusive; that comes from the docs, not from a measured payload. Clover writes `subtotal: null` (`:159`), so a Clover house reads "net sales not recorded". Generic/simpos (`:65`, `subtotal: num(r.subtotal)`) and Toast (`:203`, `subtotal: num(c.amount)` beside `total: num(c.totalAmount ?? c.amount)`) copy their own subtotal or amount field. Whether that field is pre-tax depends on the sender and on Toast's docs; neither was measured. Lane netsales (AW17) owns the adapters, and should adopt or supersede rule 3 so goals, table analytics and the calendar agree.

8. **A refused register (added 2026-10-07, after #609; this lane's method, not a founder answer).** When the sales register cannot be read whole, `RecordedDaysService` sends no day and its refusal (ADR 0292). Then:
   - **No takings are drawn.** No day carries a `recorded` half, so `TakingsMark` has nothing to draw, and it also returns null when the window carries `recordedRefusal` (`refused`, passed by `DayLedger`), so no "net sales · recorded" can stand over a register that could not be read whole. The page prints the refusal sentence in its own line above the grid (`CalendarNext.tsx`, `recordLine`).
   - **No evidence pair is written for the window.** `keepPairs` writes a day once and never again, so a pair written during a refusal would freeze "0 checks, no net sales" over a day that traded, and the real figure could never land. `fullWindow` therefore calls `keepPairs` only when the ledger's refusal is null; otherwise `pairsWritten` is 0. Nothing is lost: the forecasts are kept in `weather_readings`, so the next whole read pairs those days in full.
   - Rejected: writing the weather half anyway with the trading half marked unreadable (the pair would still be frozen, and the trading half would never land), and rewriting pairs on a later read (an update path on a table `services/self-evolution/main.py` also writes, which Decision 5 already declined to reach across).
   - Not decided here: whether the opened day should also say "net sales could not be read" beside its covers under a refusal, rather than draw no takings mark. The founder's rulings on other refused figures (ADR 0292 fork 3; #619, 2026-10-07 14:41Z) point that way, but none was asked about this panel. See §Forks F3.

## Consequences

- **Easier.** An owner or a manager who opens a day sees what it took, net, in the house's currency, beside its covers. The cell stays the scan of covers that ADR 0111 §2b draws. Until the limits in §Decision 7 land, three things bound that sentence:
  - The figure sits under the UTC day a check closed on. In the month view a late check, the booth's among them (open 19:00Z, closed 01:00Z the next day), is on the NEXT day's panel. In the Day view, a one-day window, it is on neither day: its own day's read files it under the next date, and the next day's read windows on `opened_at` and so never reads it. Lane tz (F-086).
  - A month window past 1,000 checks sums at most 1,000 rows. Lane cap (C15). [2026-10-07: no longer; #609 landed first. A window is summed whole, or it is refused and draws no takings and writes no pair (§Decision 8).]
  - The "net" label is each adapter's `subtotal`, unmeasured for Square, Generic and Toast and null for Clover. Lane netsales.
- **Given up.** A one-glance month of takings on /calendar. The dashboard's sales calendar (lane dash, AW21) is the place for that.
- **Given up, by F1.** Staff no longer receive the day's takings from this route, which they did (gross and undrawn) before this record. What staff see in its place, the actions and goals assigned to them, is his direction and is not built here.
- **Revisit when** lane netsales lands an adapter fix or a different partial-day rule, lane tz lands the house-local business day, or a house-wide rule on who sees house money supersedes F1 (OD-180 fork 3).
- **Merge order.** After lane cap. [2026-10-07: met; #609 merged first, and this branch merged it in.]

## Forks

- **F1 — Who sees the day's takings in the /calendar day panel? ANSWERED 2026-10-04 ~02:10Z: (b), in his own words (§Founder answers), built as §Decision 6.** [2026-10-07: **OPEN for his confirmation; built as (b).** His words pick none of (a)-(c), and "authorized ones" can also be read as a per-person grant, (d) below. The options as they stand now:
  - (b) Confirm as built: owners and managers see the takings; every other role, or none, gets the days with the money keys left out and `takingsWithheld: true`. Costs nothing more.
  - (d) A per-person grant: owners and managers, plus anyone the owner names. Nothing can hold that grant today (the role in a house is `user_restaurant_access.role`, which the CHECK `user_restaurant_access_role_known` holds to `owner`, `manager` and `staff`, `20260902200000_team_access_role_is_a_known_role.sql`), so it is a new permission with its own schema and settings, and it is the house-wide question OD-180 fork 3 already holds.
  - (a) Everyone, staff included ("everyone" read alone). This re-opens the payload leak (b) closed.
  - (c) Staff see a line with no figure, and owners and managers see the figure.
  - **Recommended: (b), as built.** It is the plainest reading of "owners and managers ... others only see actions", it matches his Today-feed ruling, and (d) belongs with OD-180 fork 3 rather than with one route.] /calendar is open to every role: `App.tsx:499` has only a `PageGate` feature gate, and `GET /calendar/day-record` has only the controller's `JwtAuthGuard` (`calendar.controller.ts:66`). So before this record the payload already sent the gross figure to staff, undrawn. Nothing on main decides whether staff see house money: OD-180 (OPEN-DECISIONS.md:268) fork 3 is still open, the founder's Today-feed answer *"Close it to staff (Recommended)"* (ADR 0253 round 2) is on unmerged #566, and the dashboard's "staff see no money" line (ADR 0257, W22) is on paused #579.
  - (a) Everyone who can open /calendar sees the net takings, staff included. This was the state before F1 was answered.
  - (b) Owners and managers only. For any other role, or no role, the gateway omits `netSales`, `netSalesCheckCount` and `currency` from the payload (the keys are left out, not set to null or 0), using `roleSatisfies(role, 'manager')` from `procurement/order-approval-gate.ts:46`. Staff see covers only, and the payload leak closes. The web already draws nothing when the keys are absent (§Decision 5). The evidence pairs are still written in full, because they belong to the house, not to the viewer. **Chosen.**
  - (c) Staff see a line with no figure ("takings recorded; owners and managers see the amount"), and owners and managers see the figure.
  - **Recommended: (b).** It matches his Today-feed ruling and the dashboard's W22 line for the same class of figure (house takings), and it closes a leak the API already has. It does not cut against the direction in which waiters see their own figures once POS floor coverage runs: that concerns a waiter's own figures, not house takings.
  - Recorded here rather than as a new register row (ADR 0240 F3). The question put to him was about this route. His words read broader, but whether they also answer OD-180 fork 3 (money on the bell, for the whole product) is not decided here, and that row is untouched by this record.
- **F2 (coordinator, not founder) — who fixes the Square and Clover subtotal mappings?** Handed to lane netsales, as §Decision 7 says. This lane stays one operation.
- **F3 (added 2026-10-07, OPEN, not asked) — under a sales-register refusal, what does the opened day show for its takings?**
  - (a) Nothing, as built: no takings mark; the page's own line (`recordLine`) says the register could not be read.
  - (b) The em dash and "net sales could not be read" in the takings slot, so the panel itself says it. A small web change (one more `TakingsMark` state) and its test.
  - **Recommended: (b).** It is what he ruled for refused figures elsewhere ("Say 'could not be read'", ADR 0292 fork 3; #619 on 2026-10-07). It is not built because that is his call for this panel.

**Retire-to-write (CLAUDE.md §4).** This file is the one decision record §5 requires. It retires no document; ADR 0111 §2b gains a dated bracket pointing here.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | — | Created (Locked on the founder's AW22 and AW17 picks; F1 open) on `fix/calendar-day-panel-takings` |
| 2026-10-04 | — | F1 answered by the founder (~02:10Z, his own words): owners and managers only. Built: the controller's role check, `withholdHouseMoney`, `takingsWithheld`, and the web's withheld guard; §Decision 6 rewritten, §Consequences updated. The first verify's prose findings fixed: "Easier" now bounded by the UTC day, the row cap and the adapter basis; Generic and Toast hedged like Square; dates stated in UTC; Decision 3 quotes what a no-check day draws |
| 2026-10-07 | fixer, lane caltakings (after the BLOCK of #610 at `31c5ec562`) | Merged origin/main `ca3582988` (#609 whole-or-refuse reads, #649) at `aea170f7c`; one conflict in `recorded-days.service.ts`, resolved by keeping #609's read and naming `subtotal` in it. Built Decision 8: no takings under a refusal (`TakingsMark` `refused`) and no evidence pair from a refused register. Spec double made PostgREST-shaped (cap, count, cursor, projection); claim regex accepts the counted select and checks the whole read, the pair guard and the refusal guard. F1 status corrected to built as (b), confirmation owed; F3 recorded open. Decision 7's row-cap limit, §Consequences and the merge order bracketed as closed |
