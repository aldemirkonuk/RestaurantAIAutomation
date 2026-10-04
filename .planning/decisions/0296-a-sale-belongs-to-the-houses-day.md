# 0296 — A sale belongs to the house's day

- **Status:** The **ruling** is Locked: the founder's pick of 2026-10-04, quoted below. The **method** is Proposed, built on `fix/sales-belong-to-the-house-day` (PR-1 of lane tz). PR-2 and PR-3 amend this ADR.
- **Date:** 2026-10-04
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** house day, business day, time zone, pos_checks, closed_at, opened_at, till, goals, pos-revenue, scenario verifier, F-086, A-027, DASH-G2, sales
- **Links:** [[0016-ledgers-must-express-unknown]] (null means "not known"), [[0020-no-fabricated-answers]], [[0067-a-failed-read-is-never-an-empty-one]], [[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]] (an unset value reads as unknown, :181), [[0207-a-vendor-is-scored-on-what-it-did-from-the-houses-own-records]] (question 6, the house's local midnight; `house-frame.ts`), 0290 (`fix/dashboard-tells-the-day-true`, Proposed: the dashboard month on the same day rule), analytics walk `p4-scratch/sim-run/analytics/FINDINGS.md` (A-027 → C02 → F-086), lane plan `p4-scratch/sim-run/fixes/cont/tz-plan.json`

## Context

Every POS reader in the gateway filed a check on the UTC date of its timestamp, using `(c.closed_at || c.opened_at || "").substring(0, 10)` (at `origin/main` e2cbe426a: `goals.service.ts:915`, `:920` and `:955`; the window was set at `:850-851` and `:1009-1013`). Tuzlu Rüzgar keeps Los Angeles time (UTC−7 in summer), so every check that closes after 17:00 there falls on the next UTC day. The owner-quarter analytics walk measured what that does (A-027, F-086):

- Jul 1, opening day: 52 checks, 136 covers, $10,945. The /reports till showed $1,636.50 (9 lunch checks). The dinners went to Jul 2.
- Wed Jul 22: the house was shut, 0 checks. The till showed $6,950.40 (Tuesday's dinner).
- The street-fair booth check ($4,201.10) closed at 18:00 on Aug 22 and showed on Aug 23.
- The read filtered on `opened_at` but filed by `closed_at`, so one day's figure moved with the window: Aug 23 read $26,564.91 in a 43-day window and $22,363.81 in a 42-day one.
- The heat map called Sunday the busiest day; in the house's days it is Saturday.

The same UTC cut fed `GET /analytics/pos-revenue` (the till, its export, the recommendations ribbon), goal progress and pace, the per-wine consumption breakdown beside the till, and the scenario verifier. The verifier noticed the split and reported it as "unverifiable … two UTC day buckets" rather than as a mismatch.

## Rulings this rests on (verbatim)

- **House day** (founder, 2026-10-04, lane tz fork): *"Midnight, by close (Recommended)"*. The day ends at midnight on the house's clock. Each check is filed by when it closed, else when it opened. One function, `houseDayOf`, holds the rule.
- **DASH-G2** (founder, R1b /dashboard walk-through; quoted in ADR 0290): *"Follow rule, follow-up PR (Recommended)"*. A house with no zone reads as unknown, never as UTC. The rule it follows is the founder's 2026-09-03 call, *"an unset value reads as unknown"* (ADR 0116 :181; migration `a_default_is_not_an_answer`). That call cleared `restaurants.timezone`'s old `America/Los_Angeles` default.

## Decision

1. **One rule, one file.** `apps/api-gateway/src/common/house-day.ts` holds it:
   - `houseDayOf(instant, zone)` gives the house date, using a formatter cached per zone.
   - `checkInstant(row)` returns `closed_at || opened_at`.
   - `houseToday(zone)` gives today on the house's clock.
   - `houseDayBounds(from, to, zone)` gives the DST-correct midnights, using `service-day.ts` `localMidnight`.
   - `readHouseZone(client, id)` reads the zone, and `HOUSE_ZONE_UNSET` is the one sentence for a house without one.

   A reader that files a sale on a day calls these and nothing else. A later change (a 04:00 close-out, service windows) is a change to this file.
2. **The zone** is the house's own `restaurants.timezone`, else its country's only zone (ADR 0207 q6, `houseFrame`), else none. It is read by primary key. A read error throws. It is never folded into "no zone", because that would make a database fault look like a settings gap.
3. **A window is a range of house dates `[from, to]`.** The read takes `opened_at` from 24 h before the midnight that opens `from` (`HOUSE_DAY_LOOKBACK_MS`), so a check opened the night before and closed after midnight is found. It reads up to the midnight that ends `to`. The fold then drops every row whose house day is outside the range, so one day reads the same in every window that holds it (A-027). `to` is the house's today.
4. **The readers moved in this PR:**
   - `GoalsService.computeMetricWithSeries`: all six windowed metrics. Checks are filed by `checkInstant`, orders by `delivered_at || created_at`, and the consumption log by `created_at`. Each check is filed on its day once, and the count, average and attach rate are taken over in-window rows.
   - `getPosRevenueWindow`: its payload gains `timezone` and `zoneUnset`.
   - Goal progress: a goal opens on the house date it was created, and its pace runs between house midnights.
   - `periodStart`, on the house calendar.
   - `getPosConsumptionBreakdown`: `[startIso, endIso)` on the same house days as the till.
   - The till export and the web till: the basis names the zone.
   - `ScenarioVerifyService.checkPosRevenue`: one spare day, so a house ahead of UTC still covers `service_date`. Its split message now says the two clocks differ.
5. **No zone states nothing.**
   - `getPosRevenueWindow` answers `posConnected` as before, plus `zoneUnset: true`, `timezone: null`, `from`/`to` `null`, `revenue`/`checkCount` `null` and `dailySeries: []`, and reads no window. "No POS" still takes precedence.
   - The controller does not read consumption and answers `consumption: null`. That means not known, which is different from `[]`, an empty cellar.
   - The till page says the sentence and links `/settings?tab=time-zone`. The export withholds all three figures, with the sentence as the reason. The verifier reports `unverifiable` with the sentence.
   - A windowed goal throws `HOUSE_ZONE_UNSET` outside the metric's catch, so it can never read as 0. The goal list therefore shows "could not be scored (reason)", and `createGoal` refuses. A days-of-stock goal needs no zone: it is what is on the shelf now.
6. **The payload change is additive.** A gateway older than this ADR sends neither key, and the page and the export read that payload exactly as before.

## Options considered (rejected)

1. **UTC days, labelled as UTC.** This is true, but it is useless to a house in UTC−7, and DASH-G2 rules it out ("unknown", not UTC).
2. **The browser's zone.** It files one house's checks differently for each reader. An owner travelling in Istanbul would see a different Jul 1 than the manager in Los Angeles.
3. **Bucketing in SQL** (`date_trunc` at the house zone in a view or RPC). That is a second copy of the rule, in a language CI does not run (`supabase/tests` is not a CI job). It also needs a migration that applies on merge, and the budget is 15 files.
4. **`resolveZone(restaurants.timezone)` only** (ADR 0290's choice for the dashboard). That would leave a TR house with no recorded zone stating nothing, although its country has one zone. `houseFrame` already answers that (ADR 0207 q6), so this ADR uses it. ADR 0290 can move to `readHouseZone` when the two meet.
5. **Filing by `opened_at`** (the open timestamp the read filters on). A check opened at 23:30 and closed at 00:20 is the next day's sale for every till the house uses, so the founder chose close.
6. **A helper per reader** (the dashboard's `localDateIn`, recorded-days' own fold, this file). That is how F-086 happened: four readers, four cuts. One file is the point.

## Consequences

- **The real tenant reads "time zone not set"** on the till, its export and new goals until the owner sets a zone. Its zone was cleared on 2026-09-03 and its country is the US, which keeps many zones. That is the ruled behaviour, not a regression. Existing windowed goals there read "could not be scored", with the sentence as the reason.
- **A check opened more than 24 h before the window and closed inside it is missed.** This is stated, as ADR 0290 states it for the dashboard. Widen `HOUSE_DAY_LOOKBACK_MS` if a house runs such checks.
- **A goal's deadline now ends at the house's midnight** rather than UTC's. In Los Angeles that is 7–8 h later, so `daysLeft` can read one more than before on the same instant.
- **The recommendations ribbon** reads every day as `unknown` for a house with no zone, because `from`/`to` are null (`rec-days.ts:202`). That is honest, but it gives no reason. With a zone, the ribbon still keys its own "today" on the UTC date (`rec-days.ts:153`) while the gateway's days are now house days. PR-2 moves it.
- **Two files called house-day.** `src/house/house-day.*` (the house's day line, a Nest module) and `src/common/house-day.ts` (this rule) are unrelated. The names were kept as the lane plan named them.
- Revisit when a house asks for a business day that ends at another hour, or when ADR 0290 lands and the two zone reads can be made one.

## Owed

- **PR-2** (lane tz):
  - the insight engine's day keys (`toDaily`, bundle dates) and `day-record` `checkBusinessDate` on house days, with a no-zone refusal;
  - `sale-record.producer.ts`, which anchors on `opened_at`;
  - the recommendations ribbon (`rec-days.ts`) keyed on the house's today, with the reason shown when there is no zone.
- **PR-3** (lane tz): `/logs` day headings on the house's clock (`lg-format.ts`). The walk's Jul 22 reads 0 checks in Los Angeles and 25 in Detroit.
- **Other UTC readers, not in this lane's plan:**
  - `advanced-analytics.service.ts` :128, :203, :513, :600;
  - `analytics.service.ts` `loadConsumption` / `toDailySeries`;
  - `inventory.service.ts` :755-785;
  - the dashboard's `getSalesChart`;
  - `recorded-days.service.ts`, which belongs to the caltakings lane;
  - the dashboard month, which is ADR 0290's (it uses `resolveZone`).
- **Out of this lane:** the Tuzlu consumption backfill (F-129) and A-057, A-058, A-059 and A-061.
- The plan's `house-day.spec.ts` was folded into `pos-revenue.spec.ts` (`describe("house-day — the one rule (ADR 0296)")`). Moving `createGoal` onto the zone broke `goal-source-rule.spec.ts`, and fixing it took the plan's 15th file.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | — | Created with PR-1 (`fix/sales-belong-to-the-house-day`), cut at `origin/main` e2cbe426a |
