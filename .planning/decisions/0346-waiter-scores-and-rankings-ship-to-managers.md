# 0346 — Per-waiter scores, rankings and exports ship, to owners and managers only

- **Status:** Proposed (2026-10-31)
- **Rulings:** The founder ruled two parts himself, in AskUserQuestion on 2026-10-30 in his zone (EDT): that per-waiter figures ship (*"EVERYTHING"*, AskUserQuestion asked 2026-10-31T02:52:37Z, Q2) and that a waiter's own phone shows none of them (*"Nothing for now"*, AskUserQuestion asked 2026-10-31T03:03:50Z, Q3). Both are quoted in Context. On 2026-10-31 he answered the seven forks this record had left open, F1–F7 (asked 2026-10-31T06:00:41Z and 2026-10-31T16:54:31Z), each quoted where it decides. The executor read "Nothing for now" as owner-and-manager-only on every surface (D2), which the option text of his F4 pick now matches. Who made every other call is named in the Decider line. A lock is his.
- **Date:** 2026-10-31 (rulings of 2026-10-30 and 2026-10-31, session ca58311b)
- **Decider:** founder: the reversal of the service-floor non-goal (*"EVERYTHING"*), the waiter phone's "Nothing for now", the option picks named in Context (the till-vs-floor mismatch check, the Paid tap, auto-Paid, the analytics route fix and its 2026-10-31 scope; asked 2026-10-31T03:41:53Z, 03:46:17Z and 04:34:21Z), and his seven fork answers of 2026-10-31: F1 in D4 (b) and (c), F3 and F7 in D5, F4 in D2 (asked 06:00:41Z), and F2 in D9, F5 in D10, F6 in D11 (asked 16:54:31Z). Executor (session ca58311b): D2's reading, which is the executor's reading and not his words; the executor's design for D3, for D4 where no fork answer is named, and for D5–D8 where no fork answer is named; how ADR 0272 and ADR 0294 bind the figures; the copy inside D9–D11; the mitigation set and the owed edits. Taking F2's example as D9's copy, the mechanics inside D10 and D11, and D4 (d)'s unfloored board minutes are the executor's call under the founder's 2026-10-31T16:57:09Z delegation (OD-242 (OPEN-DECISIONS.md:329 on main)), not his pick.
- **Keywords:** waiter score, waiterPerformanceScore, visitScore, on-time, coverage attribution, handoff credit, ranking, leaderTest, CSV, export, owner, manager, staff, surveillance, management stick, honour-system taps, till-vs-floor mismatch, DASH-G6, W22, service-floor charter, non-goal, Floor Checker, band words, departed waiter, staff notice, KVKK, CPRA
- **Links:**
  - [ADR 0345](0345-floor-checker-is-ported-into-mudavym.md): the port this record serves. Each founder answer here is quoted verbatim and cited by the UTC time its question was asked.
  - **Supersedes (planning text, not ADRs):** the service-floor non-goal (`service-floor-charter.md:69`, `:71-74`) and its restatements in the service-floor, scenario and /team planning docs.
  - [ADR 0257](0257-dashboard-walk-through-r1-rulings.md) W22 and DASH-G6: **not amended** and not redrawn here.
  - [ADR 0272](0272-a-ranking-or-a-pairing-is-printed-only-when-the-data-can-tell-it-apart.md) (Proposed) and [ADR 0294](0294-the-team-performance-card-prints-every-figure-with-its-unit.md) (Locked): bind how a ranking and a figure print.
  - [ADR 0020](0020-no-fabricated-answers.md), [ADR 0051](0051-rebuilt-pages-show-live-data-only.md), [ADR 0067](0067-a-failed-read-is-never-an-empty-one.md): unknown is never a figure.
  - [ADR 0303](0303-tables-learned-from-the-pos.md) `:60`: a hidden table is out of every table figure and ranking.
  - [ADR 0348](0348-staff-are-refused-the-table-and-server-takings-and-the-rest-is-withheld-after-617.md) (Locked): staff are refused the table and server takings now, and the rest is withheld after #617. [ADR 0298](0298-cost-of-goods-is-what-sold-and-concentration-reads-the-till.md) (Proposed) decision 9: the till's figures reach only a caller who sees sales.
  - Source app: `/Users/aldemirkonuk/Projects/checker` at `5958689` (its `lib/` files cited here carry no uncommitted changes; `components/ManagerBoard.tsx` does, so it is cited at `HEAD`).

## Context

### What the founder said

- **2026-10-01, DASH-G6** (verbatim, `0257:79`): *"narrow claim,. + but keep in my mind when we integrate the POS and when system start to work we're going to using floor coverage software we're going save the stats of each waiter, and they'll be able to see table invoices."* ADR 0257 recorded it as a direction: the staff-and-money line W22 *"is to be redrawn then, not hardened now"* (`0257:146`, ADR 0257's words).
- **2026-10-30 EDT, round 1** (AskUserQuestion asked 2026-10-31T02:52:37Z, Q2). The question, verbatim: *"The Mudavym charter forbids per-waiter scores and rankings ('by shift or section, not by name'), but on 2026-10-01 you said we'd save each waiter's stats. Checker has a waiter score (100, halves when late) and per-waiter reports. What should ship?"* Among the options was *"Full checker metrics"* ("Keep the waiter score, per-waiter reports and CSV exports as built in checker. Fully reverses the charter rule."). His typed answer, in place of an option, verbatim: **"EVERYTHING"**. That its scope is the waiter score, per-waiter reports, rankings and CSV is the executor's reading, from that question and from the next round's, which took it up as "'Everything' ships" and said "Managers and owners see all scores, rankings and CSV either way."
- **2026-10-30 EDT, round 2** (AskUserQuestion asked 2026-10-31T03:03:50Z, Q3). The question, verbatim: *"'Everything' ships. What does a WAITER see on their own phone? (Managers and owners see all scores, rankings and CSV either way.)"* His pick, verbatim: **"Nothing for now"**, whose option text reads "Waiters only tap check-ins; all figures stay with managers for the first rollout." It is not the option marked (Recommended), *"Own stats + own invoices (Recommended)"*.
- **2026-10-30 EDT, round 3** (AskUserQuestion asked 2026-10-31T03:41:53Z, Q1–Q4). He picked all fourteen offered features (listed in ADR 0345 § Context › His fourteen picks), among them *"Till vs floor mismatch"* (option text: "After service: 'the till closed a check at T12 while the floor showed it empty', 'a party left with no check'. A check on the honour system. M-L; needs a real till feed (sim only today)."), *"Paid tap"* and *"Fix staff money leak now"*.
- **2026-10-30 EDT, round 4** (AskUserQuestion asked 2026-10-31T03:46:17Z, Q4), the till's closed check, verbatim: **"Auto-Paid, never auto-leave (Recommended)"**, whose option text reads "A closed check marks the table Paid (with one-tap undo for split bills); the waiter still taps Leave. Voided checks and backfills are ignored."
- **2026-10-31** (AskUserQuestion asked 2026-10-31T04:34:21Z, Q1), the scope of the leak fix, verbatim pick: **"Your pick now, rest after #617 (Recommended)"**. Its option text, paraphrased here (ADR 0348 quotes it in full): the fix closes only what he picked, the three waiter and table reports and adding a table; staff still see cost, margin, vendor spend, the till total, and the waiter ranking inside insights and recommendations until a follow-up after #617 merges withholds them; and that follow-up must land before any waiter is invited to the floor phone.

### What the corpus said

- The charter's non-goal row (`service-floor-charter.md:69`, "Staff performance management", owned by nobody, deliberately), and its paragraph: the team *"does **not** produce staff performance scores, rankings, or disciplinary evidence. If check-in timing becomes a management stick, the data becomes adversarial and the product stops working"* (`:71-74`).
- The premortem's M2 names the failure: once check-in data is management evidence, *"staff optimize the measurement: tap check-ins from the pass, leave the phone in an apron on a station, check in for each other"*, producing *"confident, false compliance data"* (`service-floor-premortem.md:50-52`). Its earliest signal is compliance near 100% while table outcomes do not move, and *"the **first** request for a per-staff ranking or export"* (`:55-57`). Counter-pressure (c) is *"service-level views by shift or section, not by name, unless the founder explicitly reverses"* (`:64-66`).
- The directive makes reversal a founder decision (`service-floor-directive.md:83-88`). This record is that reversal in writing; the founder made it in AskUserQuestion, not here.

## Decision

**Per-waiter score, on-time %, coverage attribution, per-waiter reports, rankings and CSV ship. Owners and managers see them; staff see none, on any surface, until a later ruling.**

### D1

**The founder's.** The checker's per-waiter figures (its waiter score, on-time %, coverage attribution, per-waiter report and CSV, at `5958689`) ship, from the floor's own rows. Owed, not built: the floor's reports, waiter score, ranked lists, CSV export, seating timeline and till-vs-floor mismatch check, computed on real rows (not the checker's mock), shown to owners and managers only, under D2–D11.

### D2

**The executor's reading of *"Nothing for now"*, following its option text ("all figures stay with managers") and the question's ("Managers and owners see all scores, rankings and CSV either way"); not his words.** Visible to the `owner` and `manager` roles only (`apps/api-gateway/src/auth/guards/roles.guard.ts:5`: `"owner" | "manager" | "staff"`). Area, kitchen and bar leads hold `staff` (the lead mark changes no house role, `0218:140-141`) and see none: the founder's F4 pick, *"No, owner/manager only (Recommended)"* (AskUserQuestion asked 2026-10-31T06:00:41Z, Q3), whose option text reads "A lead sees what any staff member sees: taps and the 'Out tonight' list, with no scores. No new gate is needed." That text also says what any staff member sees, so D2's reading for every surface now matches the option he picked; the reading itself stays the executor's.

### D3

**The executor's design. Access is checked at the gateway, then the socket, then the export.**

- Every floor route returning a per-name figure carries `@UseGuards(RolesGuard)` and `@Roles("owner", "manager")`, as `PATCH /analytics/tables` does (`apps/api-gateway/src/analytics/analytics.controller.ts:676-678`). The global `TenantGuard` reads no role (`common/tenant/tenant.guard.ts`: 0 matches for `role`; registered at `app.module.ts:187-188`).
- Per-name floor payloads go out only through `emitToHouseRoles` (`websocket/websocket.gateway.ts:663-691`), never to `restaurant:<id>`, which staff sockets also join (`:39-43`; joined at `:343`).
- The CSV is a cutting of the reports export module: its controller is already owner/manager (`reports/exports/report-exports.controller.ts:55-56`), and exports are deleted after 90 days (`report-export-retention.cron.ts:1-4`).
- **Prerequisite: two changes land before any waiter is invited to the floor phone** (ADR 0345 § Decision › The staff-invite step).
  1. **Landed.** PR #701 (`fix/analytics-money-routes-need-a-manager`) merged as `e7ef31145` and is recorded as ADR 0348 (Locked). It gives `GET table-performance` (`analytics.controller.ts:723-725` at `5e966c8b6`), `GET waiters` (`:747-749`), `GET hot-tables` (`:780-782`) and `POST tables` (`:595-597`) `@UseGuards(RolesGuard)` and `@Roles("owner", "manager")`, pinned by `analytics-money-needs-a-manager.spec.ts` and by the claim `A-TABLE-AND-SERVER-TAKINGS-NEED-A-MANAGER` (`.planning/decisions/claims.d/fix-analytics-money-routes-need-a-manager.jsonl:1`). Before it, their class carried `@UseGuards(JwtAuthGuard)` only (`:132`), and `GET waiters` returned per-server revenue, average check, wine attach, tip % and peer ranks (described at `:753`) to any member of the house. This is the founder's *"Fix staff money leak now"* pick, scoped on 2026-10-31 by *"Your pick now, rest after #617 (Recommended)"* (Context).
  2. **Owed, not built.** A follow-up, after #617 merges, withholds the rest from staff the way #617 does (the route stays and the figures are withheld; ADR 0298 decision 9, `0298-cost-of-goods-is-what-sold-and-concentration-reads-the-till.md:70`): cost, margin, vendor spend, the till total, and the waiter ranking inside insights (`peer_rank`) and recommendations (`staff_spread`, `analytics/recommendations.service.ts:770`). PR #701 filed that residual as `.planning/tech-debt.d/2026-10-31-fix-analytics-money-routes-need-a-manager.md`. At `5e966c8b6`, `peer_rank` and `staff_spread` still reach a staff login, so this step stays owed.

### D4

**The executor's design, except (b) and (c), which are the founder's F1 pick, *"Fix both (Recommended)"* (AskUserQuestion asked 2026-10-31T06:00:41Z, Q1). The score's curve is ported, with five corrections, (a)–(e):** what it prints with no evidence (a), which gaps count and whose they are (b, c, e), and the on-time boundary (d). His option text: "Silence counts as one long gap, so a waiter who never taps scores low, not 100. The seated-to-first-visit gap goes to the table's waiter. Scores will differ from the old checker's." Where (b) and (c) say more than that text (where the open gap ends, the 120-minute rule, credit at seat time), the detail is the executor's.

- (a) **No evidence is "—", not 100.** No gaps in the window prints the em dash (ADR 0051 `:57-59`). So does the live board's on-time for a waiter holding no tables.
- (b) **Silence is not rewarded.** In the checker, a party seated and never visited yields no gap and a score of 100, while one late visit scores low. The port counts the open gap: from the last anchor to Paid (tap or the till's auto-Paid), or to leave when nothing marked Paid, is one gap when it exceeds T. A gap over 120 minutes is kept, not dropped.
- (c) **The greeting gap belongs to the table's waiter.** The checker writes the seated event's actor as whoever seated (`app/actions.ts:233`), while the seating's caretaker is the assigned waiter (`:222`). With the prior-actor credit rule, a manager who seats the party collects the greeting gap. The port credits the seated → first-visit gap to the seating's caretaker at seat time. The handoff rule for later gaps (`response-time.ts:33-41`) is kept.
- (d) **One boundary.** On-time means t ≤ T, the score's full-marks rule (`waiter-score.ts:68`). The checker counts on-time as t < T (`reports.ts:182`), so a gap of exactly T scored 100 and was not on time. The live board's *On time* status (`lib/freshness.ts:16-18`, labelled at `:22`), whose per-waiter share is described under *What the checker computes*, takes the same t ≤ T boundary on the unfloored time since the anchor, so *Due soon* starts the moment a table passes T, as in the checker (`:3-6` floors the minutes, `:17` warns at minute T) except at exactly T; the minute count shown stays floored; comparing unfloored minutes is the executor's call under the founder's 2026-10-31T16:57:09Z delegation (OD-242), not his pick.
- (e) **Paid stops the clock.** After Paid, no gap accrues to anyone. This follows the founder's Paid and auto-Paid picks.

### D5

**The executor's design; its sort-only rule and its hidden-table rule are the founder's F3 and F7 picks. How ADR 0272 binds the ranking.** ADR 0272 is Proposed (`0272:3`). Its rule gates a printed "#1" (`0272:36-40`); it does not gate the order of a descriptive register (`0272:92`).

- The ranked lists ship as sort orders, as in the checker. A list's order is not a claim that adjacent waiters differ.
- Once a load-adjusted fit exists, a "#1" or "top" prints only when `leaderTest` (`apps/api-gateway/src/analytics/engine/comparisons.ts:436`) rejects at `SIGNIFICANCE_ALPHA` 0.05 (`analytics/insights/insight-generator.service.ts:141`) against both the runner-up and the Bonferroni-corrected pooled rest. A "bottom" prints only when the same test, run on the negated visit scores, rejects. No other rank number or medal prints: `leaderTest` tests only the highest mean (`comparisons.ts:443-448`, `:463`), and nothing in `comparisons.ts` tests a middle place (`peerComparison`, `:107`, numbers ranks without a test). The observation is the visit score, so the test's mean is the score's own statistic.
- A waiter under `MIN_RANK_N` = 30 gaps in the window (`insight-generator.service.ts:142`; `leaderTest` filters at `comparisons.ts:444`) is listed but not placed.
- ADR 0272 also makes a waiter's lead survive table adjustment (`0272:40`). No load-adjusted fit exists for visit scores, so no "#1", medal or "bottom" prints until one exists: the founder's F3 pick, *"No, sort only (Recommended)"* (AskUserQuestion asked 2026-10-31T06:00:41Z, Q2), whose option text reads "Lists stay sorted by score. No '#1', medal or 'bottom' label prints until a busy-table adjustment exists. This is ADR 0272's rule for the dashboard, applied to the floor." What a withheld #1 says is ADR 0272's open fork 2 (`0272:97`), not taken here.
- A hidden table's seatings leave every per-table floor figure and table ranking (ADR 0303 `:60`). Whether they also leave a waiter's score ADR 0303 did not rule. The founder ruled it on 2026-10-31: a hidden table's past seatings stay in each waiter's score and rank, his F7 pick *"Keep them in (Recommended)"* (AskUserQuestion asked 2026-10-31T06:00:41Z, Q4), whose option text reads "This matches the till, where a hidden table's checks stay in the servers' figures. Hiding a table never rewrites a waiter's history."

### D6

**The executor's design. How ADR 0294 binds the figures.** ADR 0294 governs the /team Performance card. Its locked rules are applied to the floor by analogy:

- Every figure prints with its unit and its count: "of 100, over N visits", "% of N visits", minutes, "N of M parties". The window is stated (M6, `0294:46`). Unknown is not zero (M4, `0294:44`), and here not 100 either.
- A house comparison (a median score) prints only when it is fed by at least two distinct waiters, and it is the textbook median. Both are the founder's 2026-10-07 picks, *"At least two waiters (Recommended)"* and *"Textbook median (Recommended)"* (`0294:56`).
- The two measures stay apart. The /team card is sales-ingest based (`06-pages/team.md:410-413`), and the floor score does not join it under this record.

### D7

**The executor's design. Each score says what stands behind it.** Beside the score: how many of its seatings a till check backs, when the house has a feed; otherwise *"self-reported taps; no till check at this house"* (the executor's copy).

### D8

**The executor's design.** The CSV carries the checker's columns, plus each figure's n, the window, the warn and late windows used, and the till-backed share. Its per-waiter alerts and nudges columns count an alert as [ADR 0351](0351-a-floor-alert-climbs-past-an-absent-person-at-once.md) § Decision › What managers see, and attribution counts it: against whoever held the table when it fired, the live cover or else the waiter, never against someone known to be absent then or no longer one of the house's active members. Each export is written to `system_audit_log` (`supabase/migrations/20260805000000_baseline_from_production.sql:5553`) with who exported which window.

### D9

**The founder's F2 pick, *"Describe the visits (Recommended)"* (AskUserQuestion asked 2026-10-31T16:54:31Z, Q1); the copy is the executor's. The word beside a score describes the visits, not the person.** His option text: "Same three bands, but the words describe the tables, not the person, e.g. 'Visits on time / Some late / Many late'. This matches your sort-only pick: no verdict on the waiter until busy tables are adjusted for." The bands keep the checker's cuts, 90 and 80 (`lib/waiter-score.ts:27-31`). The copy is that example: *Visits on time* (90 and up), *Some late* (80 to 89), *Many late* (below 80), replacing the checker's *On pace*, *Watch* and *Needs review* (`:33-41`). Taking the example as the copy is the executor's call under the founder's 2026-10-31T16:57:09Z delegation (OD-242), whose goal message (2026-10-31T16:57:09Z) reads, verbatim, *"complete the full integration with ful SOTA and robust connections with the current mudavym structure and foundation. Do not ask me anything just complete it fully."* The reason: the example is the only wording shown to him; rejected, fresh wording, which would put copy he never saw beside a name. A score of "—" (D4 (a)) carries no word, and the word prints with the score's count (D6) and claims no rank (D5).

### D10

**The founder's F5 pick, *"Keep, owners/managers only (Recommended)"* (AskUserQuestion asked 2026-10-31T16:54:31Z, Q2). A waiter who leaves keeps their floor history, named, for owners and managers.** His option text: "Their history stays as it was, named, visible only to owners and managers, like their shifts on /team. Deleting or anonymising later waits on the retention answer ADR 0218 already sent to counsel." "Like their shifts on /team" holds for kept and named, not for the audience or an end date. The mechanics are the executor's call under the founder's 2026-10-31T16:57:09Z delegation: the pick's own words govern, so managers keep the read and nothing is deleted or anonymised until counsel answers, and the floor's figures join counsel's retention question (`0218:573-575`; that line is owed). Rejected: owner-only, as on /team (his words say owners and managers); /team's five-year end (his words say deleting waits on counsel).

### D11

**The founder's F6 pick, *"Mudavym shows a notice (Recommended)"* (AskUserQuestion asked 2026-10-31T16:54:31Z, Q3); the line's wording is the executor's. The floor phone tells each waiter, the first time they sign in, that taps are timed and scored and who sees the scores.** His option text: "A one-line notice on the floor phone the first time a waiter signs in, saying taps are timed and scored and who sees the scores. Turkey's KVKK and California's CPRA both expect employees to be told." The line, in the executor's words, not a pick: "Your floor taps are timed and scored. Owners and managers see the scores; you do not." It shows once per waiter per house, and again if who sees the scores changes: the executor's call under the founder's 2026-10-31T16:57:09Z delegation; rejected, on every sign-in, which teaches a tap-through.

## What the checker computes

At `5958689`:

- **Waiter score** (`lib/waiter-score.ts`). Per visit gap t in minutes, with T = max(1, `warn_after_min`) (the house setting; its column is `not null` with default 6, `supabase/migrations/0001_init.sql:30`; the report falls back to 8 only when the house row is not read, `lib/reports.ts:108`): a visit scores 100 when t ≤ T, else 100·e^(−ln2·(t−T)/T), so it halves every T minutes past T (`:8-11`, `:18-20`, `:66-71`). The waiter's score is round(mean(visit scores)) over the window (`:77-87`), and **100 when there are no gaps** (`:81`). Bands: ≥90 "On pace", ≥80 "Watch", below 80 "Needs review" (`:27-42`). A capped severity measure (`:23`, `:44-59`) exists but is not part of the score.
- **Which gaps count** (`lib/response-time.ts`). A gap runs seated → first check-in, then check-in → check-in, on one seating (`:44-67`). Only a check-in closes a gap (`:67`). Gaps over 120 minutes are dropped (`:72`). When the tapper differs from the previous anchor's actor, the gap is credited to the previous actor (`:33-41`, `:79`).
- **On-time %** is the share of gaps under `warn_after_min` (`lib/reports.ts:182-186`), house-wide or for one waiter when the report is filtered to them (`:56`, `:150-158`); null with no gaps. Overdue gaps are those at or over `late_after_min` (column default 10, `supabase/migrations/0001_init.sql:31`; report fallback 12, `lib/reports.ts:107`; applied at `:181`, `:353`). The live board's per-waiter on-time is the share of that waiter's seated tables now fresh, **100 when they hold none**, sorted worst first (`components/ManagerBoard.tsx:1234-1251` at `HEAD`).
- **Coverage attribution.** A party counts for a waiter whose assignment intervals cover at least 50% of its seated window (`lib/attribution.ts:45-64`); at exactly 50/50 both get it (`:43`, `:63`). House coverage % is tables with a check-in or turn over all tables (`lib/reports.ts:389-393`).
- **Per-waiter report and CSV.** One row per waiter with score, hours, check-ins, tables, average response, overdue gaps, nudges and alerts (`lib/reports.ts:341-373`), sorted by check-ins (`:373`), each linking to `/manager/staff/:id` (`components/ShiftReport.tsx:306`). The CSV route is manager-only (`app/manager/reports/export/route.ts:31-33`) and repeats those columns (`:139-170`).
- **"Rankings" in the checker are sort orders and bar charts.** Its only ranked bars are tables, by check-ins or by average dwell (`components/ShiftReport.tsx:243-250`, `components/reports/FloorTableView.tsx:204-205`, drawn by `RankBars`, `components/reports/Charts.tsx:223-224`); no ranking names a waiter, and no rank position, "#1" or medal for a waiter is in `app/`, `components/` or `lib/`.
- **The score has not run on live rows in the shipped app.** It is computed only in `getReportsAnalytics` (`lib/reports.ts:50`, `:355`). Both callers read a mock instead while `REPORTS_MOCK_ONLY = true` (`lib/reports-mock.ts:4`; `app/manager/reports/page.tsx:32`; `export/route.ts:86`). Only the per-shift CSV reads live rows (`export/route.ts:39-40`), and it carries no score.

## Options considered

1. **Ship the checker's figures, owner and manager only, with the corrections in D4.** Chosen. The founder's two answers fix the scope and the audience; the corrections are needed because the checker's formula breaks locked ADRs (D4).
2. **Keep the non-goal: views by shift or section, never by name** (premortem `:64-66`). Rejected by the founder's "EVERYTHING".
3. **Also show each waiter their own score and their own tables' invoices.** It was the round-2 option marked (Recommended), *"Own stats + own invoices (Recommended)"*, which would have redrawn W22. Rejected by the founder's "Nothing for now".
4. **Port the score byte-for-byte.** Rejected by the founder's F1 pick, *"Fix both (Recommended)"*, over *"Keep checker's formula"* (AskUserQuestion asked 2026-10-31T06:00:41Z, Q1). The executor had rejected it first: it prints 100 for a waiter with no evidence (ADR 0051), and it scores a waiter who never taps above one who taps late (D4 (b), measured).
5. **Do nothing.** The port's reports would ship as the checker's do: a mock.

## How D3-D6, D8, D10 and D11 were checked

Supporting detail for the decisions named; the binding rules stay in § Decision.

- **D3.** #617 itself was closed unmerged and its work re-split; of that work, #719 and #723 put the sales gate (`salesGateFor`, `analytics.controller.ts:96`) on the till's readers, and `GET recommendations` takes it (`:1271`). But `GET insights` (`:433`) takes no gate, and the insight feed the recommendations read (`recommendations.service.ts:340`) takes none, so `peer_rank` and `staff_spread` still reach a staff login (read from code at `5e966c8b6`, not queried).
- **D4 (b), (c).** Measured by running the checker's own `responseSamples` and `waiterPerformanceScore` on a scratch copy: a party seated and never visited for 90 minutes yields no gap and a score of 100; one visit 30 minutes after seating scores 15 at `warn_after_min` = 8 (the report's fallback) and 6 at the column default of 6. For (c), measured on the same copy: a manager seats, the waiter first visits at 20 minutes and again at 26, and the result is 20 minutes credited to the manager and 6 to the waiter.
- **D5.** ADR 0303 left a hidden table's place in a waiter's score open: it keeps a hidden table's checks in the waiter adjustment's table control (`0303:61`, the founder's *"Keep them in the control (Recommended)"*), and the PATCH description keeps them in the servers' figures (`analytics.controller.ts:682` at `5e966c8b6`). F7 matches both.
- **D6.** Neither 2026-10-07 pick is built yet on the /team card itself: `apps/api-gateway/src/team/performance.service.ts:305` still tests only `servers.size === 1 && includesMember`, and `:366-370` takes the upper middle.
- **D8.** The checker counts alerts and nudges by `meta.waiter_id` (`lib/push.ts:255-256`; `lib/reports.ts:316-321`, at `5958689`); the port does not.
- **D10.** Two checks by the executor. First, /team's former-staff history is owner-only and ends at removal plus five years (`06-pages/team.md:1018-1022`; its route is owner-only, `:388`), so "like their shifts on /team" holds for kept and named, not for the audience or an end date. Second, ADR 0218's list for counsel names its own house-log rows (`0218:573-575`), not floor figures.
- **D11.** What the two laws list, as the executor read the fetched texts (not legal advice). KVKK, Law No. 6698, Article 10 has the controller inform the data subject, when data are obtained, of its identity, the purpose, to whom and why the data may be transferred, the method and legal basis of collection, and the Article 11 rights (English text at https://www.kvkk.gov.tr/Icerik/6649/Personal-Data-Protection-Law). Cal. Civ. Code §1798.100(a), as the CPRA amended it, has a business tell consumers, at or before collection, the categories and purposes, whether the data are sold or shared, and how long each is kept (the CPPA's text effective 2024-07-15, https://cppa.ca.gov/regulations/pdf/cppa_act.pdf, p. 3). Its employee exemption, §1798.145(m)(1)(A), became inoperative on 2023-01-01 and never covered §1798.100(a) (`(m)(3)`, `(m)(4)`, p. 38), and only a "business" past a §1798.140(d)(1) threshold, such as annual gross revenues of more than $25,000,000 as adjusted, is bound (p. 19). One line carries the purpose and the audience, not those full lists. Whether a house also owes its full staff notice (the KVKK *aydınlatma metni*) is counsel's, beside ADR 0218's notice question (`0218:576-580`).

## The risk the charter named, and what answers it

The founder accepted the risk by ruling. It does not go away: a figure by name is a figure a manager can discipline with, and the premortem's prediction is that staff then game the taps (`service-floor-premortem.md:50-52`). The checker's own code says the taps are trusted. `logCheckIn` is documented as *"an honor-system check-in"* (`app/actions.ts:136`). Any clocked-in staff member may check in any seated table (`:137`), and a manager may log one from the board without a shift (`:150-153`). Under the prior-actor credit rule, one waiter's tap on a colleague's table closes the colleague's gap and credits the colleague with it.

| Mitigation | Who chose it | Available today? |
|---|---|---|
| **Till-vs-floor mismatch.** After service, a check the till closed at a table the floor showed empty, and a party that left with no linked check, plus the till-backed share (D7). Matches on `pos_checks.table_id` and `closed_at` (baseline `:4197`, `:4201`); `booth_event` checks are left out (`20261223150000_a_check_carries_its_channel.sql:18`); the wording is "no linked check", never "walk-out". | Founder | **No production feed was verified** (not queried, see *Not verified*; SimPOS is not loaded in production, `app.module.ts:117`; the first real POS is OD-64, open). At a house with no feed, the score is self-reported, and D7 says so. |
| **The score does not pay for silence** (D4 (a), (b)). | Executor | With the port |
| **Taps on a colleague's table are counted** for the tapper and for the waiter credited. The checker already counts quick check-ins apart (`meta.via = "quick_check_in"`, set when a tap is marked physical-only, `app/actions.ts:164-166`; counted at `lib/reports.ts:41-44`, `:161`). | Executor | With the port |
| **Waiters see no figures**, so there is no peer ranking on the phone, and the phone tells each of them once that taps are timed and scored, and who sees the scores (D11). | Founder | With the port; it does not stop a manager |
| **Rank claims and comparisons gated** (D5, D6). | Executor, under ADR 0272, 0294 | With the port |
| **A compliance watch.** A house line that sets on-time % beside the till-backed share, so that the premortem's earliest signal (`:55-57`) is a check, not a hope. | Executor | Where a feed exists |
| **Exports audited and expired** (D3, D8). | Executor | With the port |

None of these stops a manager from using a true figure as a stick. That is the trade the ruling made, and the reason D7 prints the basis beside every score.

## What this does not redraw

ADR 0257 W22 (staff see counts, never amounts, on the dashboard's routes, `0257:94`, built in `apps/api-gateway/src/dashboard/amounts-for-role.ts:37-68`) stays as built. DASH-G6's direction that waiters will see their own stats and table invoices (`0257:79`, `:146`) is **deferred by "Nothing for now"**, not answered. This record neither redraws W22 nor hardens it; the later ruling that answers "for now" owns both. The /team card's staff read (`performance.service.ts:181-190`, own card only) is unchanged. On the web, staff are routed to My Shifts (`apps/web/src/pages/team/next/TeamNext.tsx:287-291`), which renders no Performance card.

## Superseded text

No mechanical guard holds the non-goal: `service-floor-charter`, `per-staff`, `non-goal` and `surveillance` match nothing in `CLAIMS.jsonl` or `claims.d/`, and in `scripts/` only a scaffold template's heading (`build_vault_scaffold.py:59`) (grep, origin/main). Superseding it changes prose only.

Each passage below is superseded by this record for per-waiter floor figures; none is deleted. A bracketed pointer to this record is owed at each, inside an existing line so no cited line moves; its line follows "→" (re-measured on origin/main). The service-floor files are in `01-org/product/product-vision/teams/service-floor/`.

- `service-floor-charter.md:69` (the row) and `:71-74` (the paragraph) → `:69`, `:74`.
- `service-floor-premortem.md:59-62` (counter-pressure (a)), `:64-66` (counter-pressure (c)) and `:144-145` ("a founder-level decision to reverse") → `:62`, `:66`, `:145`. M2's failure description (`:44-57`) stays true and is not superseded.
- `service-floor-directive.md:45-47` (the flowchart's per-staff node), `:56` (decision-rights row), `:83-88` (the not-a-monitoring-product rule) and `:95-96` (escalation trigger 2, which this ruling has met) → `:45`, `:56`, `:88`, `:96`. The `:45` pointer is to sit inside the node's label, quoted, since a diagram's code block cannot carry the bracket as prose.
- `service-floor-agent-stack.md:66-69` ("No per-staff output, ever") → `:69`; `service-floor-schedule.md:53-55` (no compliance-reporting skill) → `:55`; `service-floor-agenda-full.md:92-93` (the to-do) and `:104-107` (question 2, now answered) → `:93`, `:107`.
- `03-scenarios/S05-service-runs-floor-is-checked.md:65`, `:75-76`, `:81` ("never disciplines") and `:122-124` → `:65`, `:76`, `:82`, `:124`. `S07-guest-complaint-mid-service.md:61-64` and `:102-104` → `:64`, `:104`, both in part: complaint figures by server are not among this record's figures. `S16-staff-misses-a-table-window.md:61-63`, `:67-68` ("never scores a person, never silently records a miss against a name") and `:106-109` → `:63`, `:68`, `:109`.
- `03-scenarios/TIER-MAP.md:117-119` (the first of "two boundaries") → `:119`.
- `06-pages/team.md:409-413` and `:685-687` → `:413`, `:687`. Both cite `TIER-MAP.md:104-105` (`team.md:412`, `:685`) for a passage now at `:117-118`; both corrections are owed too.

A sweep of `.planning/` for `staff performance analytics`, `no staff performance scores`, `not by name`, `per-staff ranking`, `scores a person`, `performance scores`, `staff ranking` and `per-waiter` found no other passage on per-person floor figures, outside `decisions/evidence/` (two hits in ADR 0301 are about products, not staff).

## Consequences

**Retire-to-write (CLAUDE.md §4).** This file is the one decision record §5 requires. It retires no document, as ADRs 0249, 0265, 0273, 0287 and 0314 did. Whether retire-to-write binds a new ADR is OD-243 (OPEN-DECISIONS.md:330 on main), open.

- **Easier.** The port can build the checker's reports on real rows. The checker never did (§ What the checker computes). Owners and managers get the figures the founder asked for in DASH-G6.
- **Harder.** Every per-name route, emit and export needs its role check, and the post-#617 follow-up must land before any waiter is invited (D3; ADR 0348's four routes have landed). The score differs from the checker's in D4 (a)–(e), and its band words in D9, so the two apps' numbers and words for the same night would not match. The floor product is now the performance report the premortem said it was one dashboard away from (`service-floor-premortem.md:48`), and only the mitigations above stand against M2.
- **Owed, not done here.**
  - A CLAIMS row that no floor emit with a per-name payload targets `restaurant:`. The route-guard claim `A-TABLE-AND-SERVER-TAKINGS-NEED-A-MANAGER` is on main (ADR 0348); the post-#617 follow-up is to be pinned by a staff-token spec, not a static claim, for the reason its residual entry gives.
  - Two lines in ADR 0218's lawyer's list (`0218:569-580`): the floor's figures beside the retention question (D10, `0218:573-575`) and the floor notice beside the notice question (D11, `0218:576-580`).
  - The bracketed pointers at every passage under *Superseded text*, and the two `team.md` citation fixes.
  - The build of D9's words, D10's read and D11's notice, with the rest of the port.
  - No OD row is owed for F1–F7, which the founder answered. The README row was added with this file's first part.
- **Revisit when:**
  - on-time % nears 100% while the till-backed share falls or table outcomes stay flat (premortem `:55-57`);
  - a house reports taps made from the pass or for a colleague;
  - the founder answers "for now" (D11's line then changes with it), or counsel answers ADR 0218's retention or notice question for the floor too (D10, D11);
  - a printed #1 fails a shuffled-data replay (ADR 0272's own trigger, `0272:82`).

## Forks answered

The founder answered all seven on 2026-10-31, in AskUserQuestion, before his 16:57:09Z delegation: F1, F3, F4 and F7 in the question asked at 2026-10-31T06:00:41Z, and F2, F5 and F6 in the one asked at 2026-10-31T16:54:31Z. Each pick and its option text are quoted in the decision it settles.

- **F1 → D4 (b), (c)** (asked 06:00:41Z, Q1). Whether the port fixes the score's reward for silence and the greeting gap's credit. Not picked: *"Keep checker's formula"*.
- **F2 → D9** (asked 16:54:31Z, Q1). What a manager reads beside a name. Not picked: *"Keep the checker's words"*, *"Number only"*.
- **F3 → D5** (asked 06:00:41Z, Q2). Whether a "#1" or "bottom" prints before a busy-table adjustment exists. Not picked: *"Yes, when the test passes"*.
- **F4 → D2** (asked 06:00:41Z, Q3). Whether kitchen, bar and area leads see any waiter figure. Not picked: *"Their area's figures"*.
- **F5 → D10** (asked 16:54:31Z, Q2). What happens to a leaver's floor figures. Not picked: *"Keep, name removed"*, *"Delete after a period"*.
- **F6 → D11** (asked 16:54:31Z, Q3). Whether waiters are told that taps are timed and scored. Not picked: *"Leave it to each house"*, *"Ask counsel first"*.
- **F7 → D5** (asked 06:00:41Z, Q4). Whether a hidden table's past seatings count in each waiter's score and rank. Not picked: *"Leave them out"*.

One fork found in the build was not put to him; it is D4 (d)'s, and it is the executor's call under the founder's 2026-10-31T16:57:09Z delegation. Under D4 (d) the board compares unfloored minutes, so *Due soon* runs from warn to late for every pair `floor_settings`' CHECK accepts (each 1..120, warn below late, as `app/sla-actions.ts:34`). Not taken: late at least warn + 2, which refuses 119 pairs the checker took, and the documented empty band. It sets no default and moves no ADR 0351 climb.

## Not verified

- No production query was made of the number of houses with a till feed that sends table words.
- Whether insight and recommendation reads are staff-readable is answered from code, not by a query: at origin/main `5e966c8b6`, GET `insights` (`analytics.controller.ts:433`) and GET `recommendations` (`:1254`) carry only the class `JwtAuthGuard` (`:132`) and no `@Roles`, so any member of the house can read them; the recommendations route's sales gate (`:1271`) does not reach the insight feed it reads (`recommendations.service.ts:340`). The 2026-10-31 security review saw a staff token get 200 on `recommendations` (PR #701's residual entry, which did not re-run it). A per-name floor insight or recommendation must not be written until the post-#617 follow-up (D3) withholds per-name figures there.
- The D4 measurements ran the checker's two functions, unchanged, on a scratch copy under Node 22's type stripping. They did not run the checker's app or tests. The checker's cites were not re-read for this text.
- D8's alerts and nudges columns rest on ADR 0351 § Decision › What managers see, and attribution.
- D11's reading of the two laws is the executor's, from the English translation of Law No. 6698 on kvkk.gov.tr (the Turkish text prevails) and the CPPA's posted text of the CCPA, both fetched on 2026-10-31. Counsel has not read it, KVKK's Article 11 and the CPPA's regulations were not read, and no house's revenue or consumer count was checked against §1798.140(d)(1).
- D10's comparison with /team was checked against `06-pages/team.md`, not against the gateway's former-staff code.
- D9's three words are the option text's example ("e.g."); the founder did not see them as final copy.
- The directive's flowchart (`service-floor-directive.md:45`) has not been rendered with the owed quoted node label.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-31 | — | Created (session ca58311b) from the founder's 2026-10-30 answers |
| 2026-10-31 | Skeptic-and-fixer pass | D3's prerequisite, D4's five corrections, rank claims narrowed to what `leaderTest` tests, hidden tables narrowed to ADR 0303 `:60` |
| 2026-10-31 | Fork-answer fold | The founder's F1–F7 folded into D2, D4, D5 and new D9–D11 |
| 2026-10-31 | Restructure, part 1 of 2 | Context to D4, cites re-measured on origin/main; PR #701 merged (ADR 0348) |
| 2026-10-31 | Restructure, part 2 of 2 | D5 to the end; D8 follows ADR 0351's attribution; pointers owed |
| 2026-11-01 | Judge, *Due soon* | *Due soon* runs warn to late; every checker pair kept |
| 2026-11-01 | executor | R3 rewrite: no held-note cites; single decision record |
