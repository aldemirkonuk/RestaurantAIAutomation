# 0296 — A sale belongs to the house's day

- **Status:** The **ruling** is Locked: the founder's pick of 2026-10-04, quoted below. The **method** is Proposed, built on `fix/sales-belong-to-the-house-day` (PR-1 of lane tz). [2026-10-06: the no-zone pace rule in §5 is Locked by the founder's pick quoted there.] [2026-10-07: re-locked on his second pick, quoted in §5, after the audit found the first was put to him with a Settings link the goal card did not draw.] PR-2 and PR-3 amend this ADR.
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

1. **One rule, one function, one file.** `apps/api-gateway/src/common/house-day.ts` holds it:
   - `houseDayOf(subject, zone)` is the rule. Handed a check (`{ closed_at, opened_at }`), it files the check by when it closed, else when it opened. Handed an instant (an order's delivery, a consumption line, a goal's creation), it files that instant. Either way the day ends at midnight on the house's clock, using a formatter cached per zone.
   - The closed-else-opened half (`checkInstant`) is not exported. So a reader cannot file a check by one of its timestamps without visibly going around the rule.
   - `houseToday(zone)` gives today on the house's clock.
   - `houseDayBounds(from, to, zone)` gives the DST-correct midnights, using `service-day.ts` `localMidnight`. [Narrowed 2026-10-05: correct where the clock change misses midnight, as measured for Los Angeles (2026-03-08, a 23-hour day; 2026-11-01, 25 hours), Berlin (2026-03-29) and Santiago's autumn change (2026-04-05). Where the change happens at midnight, so the day has no 00:00, `localMidnight` (`service-day.ts:90-93`, older than this ADR) answers 23:00 the evening before, an hour early: Santiago on 2026-09-06 gets `2026-09-06T03:00Z`, which `houseDayOf` files on Sep 5, and São Paulo on 2018-11-04 gets `02:00Z`, filed on Nov 3. What that changes is under Consequences.]
   - `readHouseZone(client, id)` reads the zone. `HOUSE_ZONE_UNSET` is the sentence a reader gives when it withholds a figure because the house has no zone, and `HOUSE_ZONE_UNSET_PACE` is the one a goal's pace gives (§5).

   A reader that files a sale on a day uses these and cuts no day of its own, and a reader that files a check hands `houseDayOf` the whole check. A later change (a 04:00 close-out, service windows) is a change to `houseDayOf`.
2. **The zone** is the house's own `restaurants.timezone`, else its country's only zone (ADR 0207 q6, `houseFrame`), else none. It is read by primary key. A read error throws. It is never folded into "no zone", because that would make a database fault look like a settings gap.
3. **A window is a range of house dates `[from, to]`.** The read takes `opened_at` from 24 h before the midnight that opens `from` (`HOUSE_DAY_LOOKBACK_MS`), so a check opened the night before and closed after midnight is found. It reads up to the midnight that ends `to`. The fold then drops every row whose house day is outside the range, so one day reads the same in every window that holds it (A-027). `to` is the house's today.
4. **The readers moved in this PR:**
   - `GoalsService.computeMetricWithSeries`: all six windowed metrics. Each check is handed to `houseDayOf` whole, orders are filed by `delivered_at || created_at`, and the consumption log by `created_at`. Each check is filed on its day once, and the count, average and attach rate are taken over in-window rows.
   - `getPosRevenueWindow`: its payload gains `timezone` and `zoneUnset`.
   - Goal progress: a goal opens on the house date it was created, and its pace runs between house midnights. With no zone a goal with a deadline has no pace, and says why (§5).
   - `periodStart`, on the house calendar.
   - `getPosConsumptionBreakdown`: `[startIso, endIso)` on the same house days as the till.
   - The till export and the web till: the basis names the zone.
   - `ScenarioVerifyService.checkPosRevenue`: one spare day, so a house ahead of UTC still covers `service_date`. Its split message now says the two clocks differ.
5. **No zone states nothing that is filed on a day.**
   - `getPosRevenueWindow` answers `posConnected` as before, plus `zoneUnset: true`, `timezone: null`, `from`/`to` `null`, `revenue`/`checkCount` `null` and `dailySeries: []`, and reads no window. "No POS" still takes precedence.
   - The controller does not read consumption and answers `consumption: null`. That means not known, which is different from `[]`, an empty cellar.
   - The till page says the sentence and links `/settings?tab=time-zone`. The export withholds all three figures, with the sentence as the reason. The verifier reports `unverifiable` with the sentence.
   - A windowed goal throws `HOUSE_ZONE_UNSET` outside the metric's catch, so it can never read as 0. The goal list therefore shows "could not be scored (reason)", and `createGoal` refuses. A days-of-stock goal needs no zone: it is what is on the shelf now. [Narrowed 2026-10-05: its number needs no zone; its pace against a deadline does, because the deadline is a house date with no midnight until the house has a clock.]
   - A days-of-stock goal with a deadline, in a house with no zone, states its number and not its pace. Goal progress answers `onTrack`, `daysLeft`, `expectedByNow` and `projectedAtDeadline` as `null`, and `paceUnread` as `HOUSE_ZONE_UNSET_PACE`, a sentence that names the missing zone and points to Settings. The reports goals desk prints that sentence on the goal's card [2026-10-07: with the till's time-zone link beside it, built at `a9320bc4a`; at `ae079c377` the card printed the sentence as plain text with no link], the goals export withholds the goal's pace with it as the reason, and the recommendations margin says "Pace unknown". "No deadline" is said only of a goal that has none. **[Founder ruling 2026-10-06 ~16:55Z (AskUserQuestion), verbatim pick: *"Say why, as built (Recommended)"*. The option, as put to him: keep "pace not judged: set the house's time zone" with the Settings link, which follows DASH-G2 ("no zone reads as unknown, never UTC"), with #620 making a house with no zone rare. Rejected with it: judging the pace only when every possible zone agrees (more code and tests), and a pace computed in UTC marked approximate (breaks DASH-G2). This bullet is Locked on that pick.]**
   - **[Founder ruling, answered 2026-10-07 (recorded 12:04:50Z) (AskUserQuestion), after the ADR 0090 audit overturned #616 at `ae079c377`. Two corrections to the 2026-10-06 question were put to him: at `ae079c377` the goal card printed the pace reason as plain text, with no Settings link (`rp-registers-goals.tsx:705`; in /reports only the till's no-zone notice, `rp-registers-trade.tsx:189`, linked to `/settings?tab=time-zone`), so the option above described a link the card did not have; and that question said Tuzlu has no zone, when the analytics walk read Tuzlu's `restaurants.timezone` as `America/Los_Angeles` on 2026-10-03 (ADR 0290 Consequences) and the house with no zone is Meyhouse Palo Alto (inferred, not re-read). Question, verbatim: *"#616 (house day) was blocked by its audit. Your 'Say why, as built' pick was put to you as: a goal with a deadline in a house with no zone says 'pace not judged: set the house's time zone' WITH the Settings link. But the goal card prints that reason as plain text with no link (only the till's no-zone notice has one). The question also wrongly said Tuzlu has no zone; it is Meyhouse Palo Alto. Which way?"* Picked, verbatim: *"Add the link (Recommended)"*: *"Show a Settings → Time zone link beside the pace reason on the goal card, so the build matches what you picked. Same 15 files, a test that fails today, one more audit."* Rejected, verbatim: *"Keep text, fix records"*: *"The sentence already says 'set it in Settings, under Time zone'. Narrow the ADR and PR body to say there is no link. No code change."* Built at `a9320bc4a`: when the goal card's caption is the gateway's `paceUnread` reason, the card draws the till's link beside it (same target, `/settings?tab=time-zone`, and same words, "Set the time zone in Settings"). The "not computed" and "No deadline" captions draw no link. The recommendations margin still says "Pace unknown", with no reason and no Settings link, and the goals export still gives the sentence as its reason. This bullet is Locked on this pick, which replaces the 2026-10-06 pick as its basis.]**
6. **The payload change: two new keys, and three keys that can now be null.**
   - New: `timezone` and `zoneUnset`.
   - Widened, for a house with no zone only: `from` and `to` can be `null` (they were always strings), and the controller's `consumption` can be `null` (it was always an array).
   - Every reader was checked on 2026-10-04 (`git grep pos-revenue` / `getPosRevenueWindow`): the web till, the recommendations ribbon (`rec-days.ts` reads null `from`/`to` as `unknown`), the till export and the scenario verifier cope with all three, and the hourly notification sweep reads only `posConnected`. That sweep now also reads the house's zone, so a failed read of the `restaurants` row stops it for that tenant, as a failed `pos_checks` probe already did. No `apps/mobile`, `services` or `packages` code reads the route.
   - A gateway older than this ADR sends neither new key, and the page and the export read that payload exactly as before.
   - Goal progress (`GET /analytics/goals/:rid/progress` and `/:rid/:goalId/progress`) gains `paceUnread`: a sentence when a goal with a deadline has no pace, else `null`. Its readers, checked on 2026-10-05: the reports goals desk (`rp-registers-goals.tsx`), the recommendations margin (`rec-masthead.ts`, which also reads the goal's `deadline` now) and the goals export (`report-export-cuttings.ts`) say why; the mobile insights tab prints no pace word for a `null` `onTrack`, so it says nothing false. A payload without the key reads as `null`; a goal with a deadline and no pace then reads "The pace against this deadline was not computed." on the desk and "Pace unknown" in the margin.

## Options considered (rejected)

1. **UTC days, labelled as UTC.** This is true, but it is useless to a house in UTC−7, and DASH-G2 rules it out ("unknown", not UTC).
2. **The browser's zone.** It files one house's checks differently for each reader. An owner travelling in Istanbul would see a different Jul 1 than the manager in Los Angeles.
3. **Bucketing in SQL** (`date_trunc` at the house zone in a view or RPC). That is a second copy of the rule, in a language CI does not run (`supabase/tests` is not a CI job). It also needs a migration that applies on merge, and the budget is 15 files.
4. **`resolveZone(restaurants.timezone)` only** (ADR 0290's choice for the dashboard). That would leave a TR house with no recorded zone stating nothing, although its country has one zone. `houseFrame` already answers that (ADR 0207 q6), so this ADR uses it. ADR 0290 can move to `readHouseZone` when the two meet.
5. **Filing by `opened_at`** (the open timestamp the read filters on). A check opened at 23:30 and closed at 00:20 is the next day's sale for every till the house uses, so the founder chose close.
6. **A helper per reader** (the dashboard's `localDateIn`, recorded-days' own fold, this file). That is how F-086 happened: four readers, four cuts. One file is the point.

## Consequences

- **The real tenant reads "time zone not set" until the owner sets a zone.** Its zone was cleared on 2026-09-03 and its country is the US, which keeps many zones (ADR 0207 q10). This is the ruled behaviour (the 2026-09-03 "an unset value reads as unknown" call and DASH-G2), not a regression, but the founder sees it before merge:
  - the /reports till and its export state no figure and name the reason;
  - `createGoal` refuses (400, with the zone sentence) all six windowed goal metrics: the four that read `pos_checks` (`wine_revenue`, `checks`, `avg_check`, `wine_attach_rate`), and also `purchase_spend` and `bottles_sold`, which do not read `pos_checks` but are filed on house days too. Only a days-of-stock goal (`days_of_inventory`) can be created;
  - its existing windowed goals read "could not be scored", with the sentence as the reason, and a days-of-stock goal with a deadline shows its number and says its pace is not judged until the zone is set [2026-10-07: on the /reports goal card, with the till's time-zone link beside the sentence];
  - the recommendations ribbon reads every day as `unknown` and gives no reason (PR-2 adds it);
  - the hourly goal-reached and ceiling-held notification producers count each windowed goal they would judge (an "at least" goal; a closed "at most" period) as `failed`, and log `GOAL_PROGRESS_UNREADABLE` or `CEILING_PROGRESS_UNREADABLE` with the zone sentence on every tick (`goal-reached.producer.ts:127-136`, `ceiling-held.producer.ts:149-158`). No note is sent for those goals. Each of their `getGoalProgress` calls reads the `restaurants` row again, once per goal.

  Where the zone will come from is the zoneaddr lane's: the founder's later answers for a house with no zone take it from the house's address, with the owner's device as the fallback. That lane's ADR is owed and records them.
- **A check opened more than 24 h before the window and closed inside it is missed.** This is stated, as ADR 0290 states it for the dashboard. Widen `HOUSE_DAY_LOOKBACK_MS` if a house runs such checks.
- **On a day whose clock change happens at midnight** (Santiago's spring change, 2026-09-06; §1), the bounds are an hour early. Every check is still filed by `houseDayOf`, so the fold drops the extra hour from the day's figure. But a read whose window ends on the day before stops at 23:00 that evening (`computeMetricWithSeries` given an end date, as `getPosRevenueWindow` gives it); the consumption breakdown, which keeps `[startIso, endIso)` with no fold (`analytics.service.ts:291-301`), counts that hour on the change day; and a goal's pace that starts or ends on such a day is measured from or to 23:00 the evening before. Fixing it is a change to `localMidnight`, which the notification producers share, and is not in this PR.
- **A goal's deadline now ends at the house's midnight** rather than UTC's. In Los Angeles that is 7–8 h later, so `daysLeft` can read one more than before on the same instant.
- **The recommendations ribbon** reads every day as `unknown` for a house with no zone, because `from`/`to` are null (`rec-days.ts:202`). That is honest, but it gives no reason. With a zone, the ribbon still keys its own "today" and its window length on the UTC date (`rec-days.ts:153`, `posDaysFor` from `RecommendationsNext.tsx` `utcToday`) while the gateway's days are now house days, and two cells read `unknown` that read before:
  - a Los Angeles house, from 17:00 local (16:00 in winter) to midnight: the cell marked today is the UTC date, a day past the gateway's `to`;
  - an Istanbul house, after 21:00 UTC: the window counts back from the house's today, a day ahead of UTC, so the 1st of the month on screen falls before `from`.

  PR-2 moves the ribbon onto the house's today.
- **Until PR-2 and PR-3 land, the surfaces disagree about a check's day.** The till, goals, the till export and the verifier file on house days, while /calendar (`recorded-days.service.ts`), the insight series and the ribbon still file on UTC and /logs on the browser's day. Before this PR the till, goals, the verifier and /calendar agreed, all on UTC and all wrong; for a house in Los Angeles they now differ for every check that closes after 17:00 local (16:00 in winter). `recorded-days.service.ts`:91-93 says it quotes the rule so that "the calendar and goal progress can never disagree", and that sentence is false until PR-2 moves it onto `houseDayOf`.
- **Two files called house-day.** `src/house/house-day.*` (the house's day line, a Nest module) and `src/common/house-day.ts` (this rule) are unrelated. The names were kept as the lane plan named them.
- Revisit when a house asks for a business day that ends at another hour, or when ADR 0290 lands and the two zone reads can be made one.

## Owed

- **PR-2** (lane tz; builds after lane caltakings, ADR 0287, which edits the same calendar files, and after lane cap):
  - /calendar (A-026): `calendar/recorded-days.service.ts` `checkBusinessDate`, `foldChecksToDays` and `windowFor` on house days through `houseDayOf`, with a no-zone refusal in its own sentence; `day-record.service.ts` and `calendar.controller.ts` take "today" as the house's today, not the UTC date;
  - the insight engine's day keys (`toDaily`, bundle dates) on house days, with a no-zone refusal (A-060);
  - `sale-record.producer.ts`, which anchors on `opened_at`;
  - the recommendations ribbon (`rec-days.ts`) keyed on the house's today, with the reason shown when there is no zone.
- **PR-3** (lane tz): `/logs` day headings on the house's clock (`lg-format.ts`). The walk's Jul 22 reads 0 checks in Los Angeles and 25 in Detroit.
- **Other UTC readers, not in this lane's plan:**
  - `advanced-analytics.service.ts` :128, :203, :513, :600;
  - `analytics.service.ts` `loadConsumption` / `toDailySeries`;
  - `inventory.service.ts` :755-785;
  - the dashboard's `getSalesChart`;
  - the dashboard month, which is ADR 0290's (it uses `resolveZone`).
- **Out of this lane:** the Tuzlu consumption backfill (F-129) and A-057, A-058, A-059 and A-061.
- The plan's `house-day.spec.ts` was folded into `pos-revenue.spec.ts` (`describe("house-day — the one rule (ADR 0296)")`). Moving `createGoal` onto the zone broke `goal-source-rule.spec.ts`, and fixing it took the plan's 15th file. [2026-10-05: to fit the pace fix into the same 15 files, the till-export cases moved from `report-export-cuttings.spec.ts` into `pos-revenue.spec.ts` beside the new goal-export and pace cases, the web pace cases sit in `rp-registers-trade.test.tsx`, and this lane's three claims rows were dropped; each row's anchors are held by those behaviour tests.]

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | — | Created with PR-1 (`fix/sales-belong-to-the-house-day`), cut at `origin/main` e2cbe426a |
| 2026-10-04 | Independent verifier, round 1 | 1 major, 6 minor. Fixed: PR-2 owns /calendar (`recorded-days.service.ts`, A-026), which the ADR had also handed to caltakings; `houseDayOf` now takes the check itself, and `checkInstant` is no longer exported; the payload line names the three widened keys; Consequences add the interim disagreement between surfaces, the ribbon's two `unknown` cells with a zone, and the real tenant's refused goals |
| 2026-10-05 | Independent review at 18c19a002 | A days-of-stock goal with a deadline in a house with no zone read "No deadline". Fixed: goal progress sends `paceUnread`, and the desk, the margin and the goals export say why; §1 and §5 narrowed (the midnight-DST case, and the pace needing a zone); the zoneaddr pointer added |
| 2026-10-06 | Last call, lane tz | Narrowed: `HOUSE_ZONE_UNSET` is no longer called the one sentence for a house with no zone (the pace has its own); §5's heading says what no zone withholds; Consequences name the goal producers' hourly `failed` count for such a house |
| 2026-10-06 | founder (AskUserQuestion) | A goal's pace with no zone: "Say why, as built (Recommended)". §5's pace bullet Locked; no code change |
| 2026-10-07 | ADR 0090 audit at `ae079c377` | Overturned: §5's lock rested on an option that promised the Settings link beside the goal card's pace reason, which the card printed as plain text; the question had also said Tuzlu has no zone |
| 2026-10-07 | founder (AskUserQuestion) | Re-asked with both corrections: "Add the link (Recommended)". Built at `a9320bc4a`: the goal card draws the till's time-zone link beside the pace reason; §5 re-locked on this pick |
