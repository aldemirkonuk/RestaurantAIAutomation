# 0345 — Floor Checker is ported into Mudavym

- **Status:** Proposed (2026-10-31)
- **Date:** 2026-10-31 (rulings of 2026-10-30 EDT, session ca58311b)
- **Decider:** the founder, for the port and his picks: five AskUserQuestion calls on 2026-10-30 EDT, asked 2026-10-31T02:52:37Z, 03:03:50Z, 03:13:20Z, 03:41:53Z and 03:46:17Z, and on 2026-10-31 the leak fix's scope (pick 14, asked 04:34:21Z) and, in the call asked at 16:54:31Z, that a departed waiter's floor figures are kept for owners and managers. Each is quoted under § Context. Two of his answers, the builder and Out tonight, are read in the ways stated where they appear; those readings are the executor's reading (session ca58311b), not his words. The founder can overrule any part of this record, and a lock is his. Its role map, reuse map and engineering rules are the executor's design; what "run dry" means (pick 11) and setting aside the service-floor charter's staged entry are the executor's call under the founder's 2026-10-31T16:57:09Z delegation (OD-242 (OPEN-DECISIONS.md:329 on main)), not his pick. Any answer this series gives to OD-235, OD-236 or OD-238 is also the executor's call under the founder's 2026-10-31T16:57:09Z delegation, not his pick.
- **Keywords:** Floor Checker, floor coverage, waiter-coverage, port, in-SPA, /floor, /floor/builder, /floor/me, floor module, floor-core, floor_sections, Food-up, meal run, Paid, punches, Out tonight, pos_server_links, emitToHouseRoles, memberRoom, notification_push_devices, restaurant_tables, subdomain, manifest
- **Links:**
  - His answers are cited by the UTC time each question was asked (session ca58311b's transcript, outside the repo).
  - [ADR 0001](0001-mudavym-single-entity.md) (Locked): Floor Checker is one of the small softwares inside Mudavym.
  - Changed in part by his rulings: [ADR 0303](0303-tables-learned-from-the-pos.md) (Proposed) and [ADR 0218](0218-an-alert-finds-its-area-first-a-lead-acts-on-cards-only-and-away-is-dates.md) (Locked). [ADR 0215](0215-money-on-team-is-the-owners-and-hours-are-worked-hours.md) (Locked) is cited, and this record edits no line of it.
  - Held as they are: [ADR 0257](0257-dashboard-walk-through-r1-rulings.md) W22; [ADR 0027](0027-push-recipients-are-not-resolved-here.md) (Proposed).
  - Pick 14: [ADR 0348](0348-staff-are-refused-the-table-and-server-takings-and-the-rest-is-withheld-after-617.md) (Locked) and [ADR 0298](0298-cost-of-goods-is-what-sold-and-concentration-reads-the-till.md) decision 9.
  - Binding: [0020](0020-no-fabricated-answers.md), [0131](0131-the-new-house-goes-live-dark-then-one-house-at-a-time.md), [0149](0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md), [0162](0162-managers-grant-manager-or-staff-on-both-doors.md), [0164](0164-sessions-follow-membership-and-several-houses-choose.md), [0212](0212-a-new-migration-sorts-after-every-version-its-base-holds.md), [0272](0272-a-ranking-or-a-pairing-is-printed-only-when-the-data-can-tell-it-apart.md), [0294](0294-the-team-performance-card-prints-every-figure-with-its-unit.md).
  - Register ([OPEN-DECISIONS](OPEN-DECISIONS.md)): OD-235 to OD-238, the forks these rulings left, and OD-246, filed with this record; OD-237 stays open. OD-64 (first real POS) is open. OD-242 (how far the founder's 2026-10-31 delegation reaches) and OD-243 (OPEN-DECISIONS.md:330 on main), whether retire-to-write binds a new ADR, are open.

## Context

**The task.** The founder's session-opening message, verbatim and whole (session ca58311b's transcript, line 5, 2026-10-31T02:45:50Z, which is 22:45 EDT on 2026-10-30; the transcript is outside the repo): *"Your task is to integrate floor checker folder and its deliverables in a safely and in a right manner to the mudavim.com in a way that all of its software features will pass there, and it will also integrate with all of the data analytics, and also it will take care of everything. So before any start, make sure you do your research right, make sure to what extent you will cover everything, and move on."*

**What the corpus already said.**

- ADR 0001 (Locked) names Floor Checker among the *"little softwares"* that live inside Mudavym (`0001-mudavym-single-entity.md:30-34`, keyword at `:15`), which are *"built and understood standalone first, then unified — never a monolith, never separate companies"* (`:38-40`).
- The service-floor charter says *"Nothing in the repo backs it yet"* (`.planning/01-org/product/product-vision/teams/service-floor/service-floor-charter.md:18-19`). At `origin/main` `5e966c8b6` there is still no `/floor` route in `apps/web/src/App.tsx` and no floor file under `apps/api-gateway/src`.
- DASH-G6, verbatim and whole (`0257:79`): *"narrow claim,. + but keep in my mind when we integrate the POS and when system start to work we're going to using floor coverage software we're going save the stats of each waiter, and they'll be able to see table invoices."*

**The checker as it stands.** `/Users/aldemirkonuk/Projects/checker`, HEAD `5958689`, remote `github.com/aldemirkonuk/floor-coverage`, cited at HEAD unless marked *working tree*.

- A Next.js 16 app named `waiter-coverage`, with its own Supabase project (`aatljtckuqzvsttdoxjk`) and its own Vercel project (`floor-coverage`).
- *Working tree*: 12 modified tracked files, among them `lib/push.ts`, `lib/types.ts`, `components/ManagerBoard.tsx` and `public/sw.js`, and 7 untracked entries that hold the whole Food-up feature: `supabase/migrations/0018_meal_run_alerts.sql`, `app/meal-actions.ts`, `lib/meal-alert.ts`, `components/MealRunAlerts.tsx`, `components/MealRunSheet.tsx`, `scripts/test-meal-brief.mjs` and a sketch folder.
- A profile is an `auth.users` row with exactly one house (`supabase/migrations/0001_init.sql:35-37`), and there are two roles, `manager` and `waiter` (`:11`). House thresholds default to warn at 6 and late at 10 minutes (`:30-31`).
- `shifts` are real punches, one open shift per waiter (`0008_shifts.sql:9-19`).
- Supabase realtime publishes nine tables (seatings, events, assignments, dining_tables, invitations, profiles, table_merges, table_merge_members, shifts). One Vercel cron runs `/api/push/nudge` at `0 0 * * *`.
- Food-up, *working tree*: it refuses a table with no assigned waiter (`app/meal-actions.ts:181-186`) and adds the `meal_ready`/`meal_ack` events and `seatings.last_meal_alert_at` (`0018_meal_run_alerts.sql:11-18`).

### The founder's rulings

He ruled in five AskUserQuestion calls on 2026-10-30 EDT: Rounds 1 to 4 below, and the call asked at 2026-10-31T03:41:53Z in which he took his fourteen picks. On 2026-10-31 he answered pick 14's scope (under pick 14) and what happens to a waiter's floor figures when the waiter leaves the house: *"Keep, owners/managers only (Recommended)"* (AskUserQuestion asked 2026-10-31T16:54:31Z, Q2), whose option text reads "Their history stays as it was, named, visible only to owners and managers, like their shifts on /team. Deleting or anonymising later waits on the retention answer ADR 0218 already sent to counsel."

A picked label is his pick; a typed answer is quoted exactly, typos included; option texts and *(Recommended)* marks are the executor's, quoted as what he was shown; a session gloss is marked.

#### Round 1

Asked 2026-10-31T02:52:37Z. **Architecture** (Q1), offered "Port into Mudavym (Recommended)", "Keep separate, sync data" and "Separate UI, shared DB"; his answer typed in place of an option, with his blank line:

> maybe it could be another subdomain I'm not sure create workflow and research what it sright.
>
> port into mudavym might be best

The workflow wf_c6c2a59b-b8b recommended the port in-SPA (§ Options considered).

- **Waiter stats** (Q2): *"EVERYTHING"*, typed in place of "Own stats, no ranking (Recommended)", "Full checker metrics" and "Shift/section only".
- **Old checker data** (Q3): *"Start fresh (Recommended)"*: "Treat it as demo/test data. Set floors up again in Mudavym; leave the old project alone until you retire it." Nothing is migrated from `aatljtckuqzvsttdoxjk`.
- **Food-up** (Q4): *"Include it (Recommended)"*, over "Leave it out for now", whose text was "Port only the committed features; the food-up alert waits for a kitchen-ready event from the POS." Food-up is ported.

#### Round 2

Asked 2026-10-31T03:03:50Z.

- **The port** (Q1): *"Port in-SPA (Recommended)"*, over "Port + floor.mudavym.com alias"; its option text: "The waiter screen gets its own installable app identity (a manifest scoped to /floor/) on the same origin." There is no subdomain.
- **The builder** (Q2), set against ADR 0303's *"No drawing."* (`0303:3`, `:24`) and offered "Position + hand-add guarded (Recommended)", "Position only" and "Full checker builder"; his answer typed in place of an option: *"I want to have all features but in mudavym's way oformat and design compatibility, and more features that actually provide with now the addition to the mudavym(IMPORTANT)"*. The executor's reading: `/floor/builder` ships every checker builder feature (place, group, merge), rebuilt in the Mudavym design; it starts from the tables the till taught (pick 9); and ADR 0303's *"No drawing."* no longer holds for the floor. Round 4's add-a-table ruling says how tables are added.
- **The waiter phone** (Q3): *"Nothing for now"*, not the option marked (Recommended). Its option text: "Waiters only tap check-ins; all figures stay with managers for the first rollout." Session gloss: taps only; every figure (scores, rankings, CSV) is owners' and managers'.
- **Sections** (Q4): *"Separate floor sections (Recommended)"*. A new `floor_sections` table, not `house_areas`, which allows one row per kind per house (`supabase/migrations/20260930100000_a_house_names_its_areas_and_who_is_away.sql:86`) and so could not hold several floor sections.

#### Round 3

Asked 2026-10-31T03:13:20Z; it led to the call in which he took his picks.

- **Punches and wages** (Q1), offered "Floor-only first (Recommended)" and "Feed wages now"; his answer typed in place of an option: *"maybe this could be interworkable with /team"*. Each punch links to its planned /team shift when it has one, and the /team week shows punched times beside planned ones. That is the option text of pick 10, *"Punches on /team"*, which he took, not only the executor's reading. A punch changes no hours figure and no wage by itself: /team's labour cost stays priced on the planned span less the counted break (`apps/api-gateway/src/team/schedule.service.ts:596-603`). Pick 10's option text says "It amends ADR 0215; wages stay on planned hours" (AskUserQuestion asked 2026-10-31T03:41:53Z, Q3), so wages on planned hours was part of the pick he took. What punches do to ADR 0215's day-end sheet is OD-235, which these rulings leave open.
- **Who raises Food-up** (Q2): *"Any staff (Recommended)"*: "The pass, a runner or a manager taps it, as in checker. A POS kitchen-ready event can replace the tap later." The checker allows managers only (`app/meal-actions.ts:136`, working tree).
- **Mudavym-only features** (Q3): *"Yes, research then I pick (Recommended)"*. That run is wf_3808bfdb-c92 (§ Options considered).

#### Round 4

Asked 2026-10-31T03:46:17Z.

- **Who marks Out tonight** (Q1): *"Managers + kitchen/bar leads"*, not the option marked (Recommended). Its option text: "Only owners, managers and area leads can mark items out; waiters only see the list." The label says kitchen/bar leads, the text area leads; the executor reads the label, the narrower. A lead is a `house_area_members.is_lead` row (`20260930100000:104`) of kind `kitchen` or `bar` (`:98`); a house with no kitchen or bar lead has owners and managers only. Waiters see the list only; widening it to all area leads is his.
- **Seats on floor tables** (Q2): *"Optional seats (Recommended)"*. Its option text: "The builder can set seats; a table without them shows a dash, never a guessed 2 (fixes the old POST that writes seats=2). Amends 0303." ADR 0303 already rejects a seats-2 default for learned rows (`0303:36`), and the learning insert writes NULL for `seats` and `is_outdoor` (`supabase/migrations/20261222230000_tables_learned_from_the_pos.sql:307-310`).
- **Where a table is added** (Q3): *"Both, one shared form (Recommended)"*. Its option text: "The builder and Settings → Point of sale use the same add-table form and the same twin-table guard." This widens ADR 0303's add-a-table follow-up (`0303:65`).
- **The till's closed check** (Q4): *"Auto-Paid, never auto-leave (Recommended)"*. Its option text: "A closed check marks the table Paid (with one-tap undo for split bills); the waiter still taps Leave. Voided checks and backfills are ignored."

### His fourteen picks

He took all fourteen offered items (AskUserQuestion asked 2026-10-31T03:41:53Z, Q1 to Q4, several options could be chosen in each), and the tool result gives each label in quotation marks. Option texts are quoted in part; the hook after each is the executor's, checked at `origin/main` `037452ebe`; how each is built is owed by the port's code PRs.

#### pick 1

*"Paid tap"* (Q1): "Waiter taps 'Paid'; that table stops nagging" … "A closed check from the till does it automatically later, once a real till feed exists". The automatic Paid is Round 4's *"Auto-Paid, never auto-leave (Recommended)"*.

#### pick 2

*"Seating timeline"* (Q1): "The shift report splits each turn into greet, pay and leave times, by section, to show where table time is lost. Unknown phases show a dash, never a zero." Computed by floor-core from floor rows, so it works without a till.

#### pick 3

*"On-break handoff"* (Q1): "their tables and alerts pass to the cover until 'Back'. The manager can record the break on the shift in one tap." The tap itself writes no /team break, hours or wage.

#### pick 4

*"Reassignment proposal"* (Q1): "the board proposes who takes which tables (same section, lightest load). Nothing moves until the manager taps Apply."

#### pick 5

*"Alerts always reach someone"* (Q2): "If the table's waiter is off shift, on break or unassigned, Food-up and late alerts go to the cover, then to a working manager, who sees who got it and why." Modelled on the area ladder (`apps/api-gateway/src/areas/area-routing.ts:10-33`) but floor-only; when it climbs is OD-236, and none of it is built on main.

#### pick 6

*"No-show + forgotten clock-out"* (Q2): "A shift started with no clock-in shows Call out / Offer cover buttons (reusing /team's flow)." … "Cover offers also reach phones by web push."

#### pick 7

*"Manager notes at clock-in"* (Q2): "Right after clocking in, the phone shows unread manager notes addressed to that waiter." From /team's notes.

#### pick 8

*"Goal notices name who worked"* (Q2): "the notice names the people clocked in, not just those on the schedule." Today `shifts` is a plan with no clock-in table (`apps/api-gateway/src/notifications/producers/roster.ts:15-16`); the audience does not change.

#### pick 9

*"Builder starts from the till"* (Q3): "Tables the till already taught wait in a tray to be named, placed and sectioned. 'Bar' or 'Window' can become a table once, with old checks linked." From the tables ADR 0303 learns.

#### pick 10

*"Punches on /team"* (Q3): "One Clock-in button works the same from the floor phone and from My Shifts, and the /team week shows punched times beside planned ones." … "It amends ADR 0215; wages stay on planned hours." Owed: a punch table linked to `public.shifts` (`supabase/migrations/20260805000000_baseline_from_production.sql:5378`) by a nullable shift id, so a punch with no planned shift is kept, and its /team week display.

#### pick 11

*"'Out tonight' list on phone"* (Q3): "Waiters see what not to sell: items staff mark out, plus drinks the cellar shows run dry, and 'Back' when they return. No figures." Who marks is Round 4; the run-dry drinks enter without a mark. "Run dry" is the executor's call under the founder's 2026-10-31T16:57:09Z delegation, not his pick: a drink reads Out when its linked inventory item has had live stock and no live `active` lot holds a sealed bottle or an open-bottle measure above 0, and Back when such a lot appears.

#### pick 12

*"Till vs floor mismatch"* (Q3): "A check on the honour system." … "needs a real till feed (sim only today)." It reads `pos_checks.table_id` and `closed_at` (baseline `:4197`, `:4201`) and waits on OD-64.

#### pick 13

*"Floor trends in Recommendations"* (Q4): "Comes from floor taps alone and needs weeks of data." A `floor` data requirement joins the insight catalog's `DataRequirement` (`apps/api-gateway/src/analytics/insights/insight-catalog.ts:32-39`, which has none).

#### pick 14

*"Fix staff money leak now"* (Q4), a defect, not a feature: "Today any staff login can read every waiter's sales and tips and live table spend through 3 analytics routes (no role check). Fix it in its own small PR first, before any floor work." #701 (ADR 0348) merged `e7ef31145` and gives `POST tables`, `GET table-performance`, `GET waiters` and `GET hot-tables` `@Roles("owner", "manager")` (`apps/api-gateway/src/analytics/analytics.controller.ts:595-597`, `:723-725`, `:747-749`, `:780-782` at `5e966c8b6`; claim `A-TABLE-AND-SERVER-TAKINGS-NEED-A-MANAGER`, `claims.d/fix-analytics-money-routes-need-a-manager.jsonl`). Asked how far the fix goes, he picked *"Your pick now, rest after #617 (Recommended)"* (AskUserQuestion asked 2026-10-31T04:34:21Z, Q1). Its option text, the executor's: "A follow-up PR after #617 merges closes those the way #617 already does: staff keep the page but the figures are hidden. That PR must land before any waiter is invited to the floor phone." ADR 0348 makes that binding (§ Decision › The staff-invite step).

## Options considered

1. **Port in-SPA (chosen).** The checker's features are rebuilt as a Mudavym software: `/floor` (the manager board), `/floor/builder`, a chrome-free waiter screen at `/floor/me`, a NestJS floor module, and new migrations on Mudavym's Supabase. It reuses Mudavym's people, tables, push, realtime, audit and flags. Cost: the largest build of the four. The checker's Supabase realtime has to be replaced by the gateway's socket.io, and its history is not carried over.
2. **A subdomain (`floor.mudavym.com`) on the Mudavym backend**, the same gateway and database with its own origin and install identity. Rejected for now:
   - **Per-origin sessions.** The web app keeps the access token in `localStorage` (`apps/web/src/stores/authStore.ts:94`, `apps/web/src/contexts/AuthContext.tsx:814`), which a second origin cannot read, so the subdomain needs a second sign-in or a new handoff-token surface with its own security ADR.
   - **Push devices.** `notification_push_devices` has no app or origin column (`supabase/migrations/20260925160500_a_preference_is_kept_once_per_person_per_house.sql:96-120`, keyed `UNIQUE (user_id, endpoint)` at `:119`), so a device row cannot say which surface it came from.
   - **Realtime.** The socket's CORS list would need the new origin (`apps/api-gateway/src/websocket/websocket.gateway.ts:174-190`).
   - **Not ruled out.** His Round 1 answer named a subdomain; it stays open as OD-237.
3. **A separate subdomain app with sync.** The checker stays a Next.js app on its own Supabase, and the two systems sync. Rejected:
   - **Identity.** The checker allows one house per user (`0001_init.sql:35-37`); Mudavym lets a person hold several houses and choose one (ADR 0164).
   - **Roles.** The checker's are `manager`/`waiter`; Mudavym's are `owner`/`manager`/`staff` (`supabase/migrations/20260902200000_team_access_role_is_a_known_role.sql:61-63`).
   - **Two numbers for one waiter.** Two databases compute one waiter's figures twice.
   - **Push.** It keeps a `push_subscriptions` table, which ADR 0027 says *"does not exist and must not be created"* (`0027:119`); the `notification_push_devices` objection of option 2 applies too.
   - **Design.** It keeps its own design layer, and ADR 0149 (Locked) makes Mudavym's design, `apps/web/src/components/mudavym` (80 entries), the only one.
4. **Do nothing.** ADR 0001's "then unified" never happens; analytics never sees the floor, which the task asked for; DASH-G6 has no data.

### The research behind the choice

Source runs, 2026-10-30, session ca58311b: **wf_c6c2a59b-b8b** (architecture: 3 advocates, 3 adversaries, 1 judge) and **wf_3808bfdb-c92** (features: 4 finders, 4 adversaries, 1 ranker). Their output is not in the repo; what this record takes from them is stated here.

- **Why the port won.** ADR 0001 makes Floor Checker a software of the one entity; *"Start fresh"* removes the reason for a second database; analytics reads floor rows cheaply only in the same one; role-gated realtime exists.
- **Why option 3 died.** One house per checker user cannot map onto several houses per person, and a two-way sync would sit under every floor figure.
- **Why option 2 lost.** Pushes cross between service workers, a second sign-in or token handoff is needed, CORS lacks the origin, the design layer must be extracted, and the floor still fails with the gateway. A `/floor/` manifest on the same origin gives the install identity free.
- **Grafted from the losers.** A shared floor-core package, role-gated realtime, a single-runner nudge job, `pos_server_links`, the `/floor/` manifest, and freezing the checker's spec first.
- **The features.** He took all fourteen ranked items.

## Decision

**Floor Checker is ported into the Mudavym web app and gateway, as a dark-launched software. Every one of its features is carried over in Mudavym's design, on Mudavym's data, and the checker is retired after the port.**

Adopted, from his rulings and picks (§ Context):

- **The port in-SPA**: `/floor`, `/floor/builder`, a chrome-free `/floor/me` with a `/floor/`-scoped manifest on the same origin, a NestJS floor module, new migrations. No subdomain or Expo waiter tab while OD-237 is open.
- **Start fresh**; **every checker feature**, Food-up included (raised by any staff), in Mudavym's design (ADR 0149); sections in a new `floor_sections` table.
- **The waiter phone shows no figure** (*"Nothing for now"*). Every figure is owners' and managers' only; a departed waiter's are kept, named.
- **Out tonight** is marked by owners, managers and kitchen or bar leads (the executor's reading).
- **Tables**: optional seats, never guessed; one shared add-table form; a closed till check marks Paid, never ends a seating, and waits on OD-64.
- **All fourteen picks ship**; wages stay on planned hours.
- **Open forks stay open.** Any answer this series gives OD-235, OD-236 or OD-238 is Proposed, narrow and reversible, and goes past no pick of his.

### The staff-invite step

**No waiter is invited to `/floor/me` until #701 and the follow-up after #617 have merged.** Source: pick 14 (§ Context › His fourteen picks) and ADR 0348 (Locked). #701 merged as `e7ef31145`; the follow-up has not. The code PR that opens staff invites owes a check of both.

## Feature ideas the adversaries killed

- **Live till check, hot-table flag, fast-spender nudged first, the till running a table's clock**: no feed sends open checks. The manual Paid tap was kept (pick 1).
- **Till name as a floor person with sales, tips and a /team bridge; floor-filled sales register and card**: figures in front of staff, and tips are payroll. A manager-confirmed link survives.
- **Punches crossed with the till, or as a prime-cost labour feed**: under-recorded hours, a meaningless ratio.
- **Does a table visit pay; takings per table-hour; server figures from attribution**: no real checks, a default party of 2 printed as measured, double counting.
- **Covers forecast to waiters; open days from the floor; learned coverage rules; who is missing now**: no history, a circular method, already covered, or empty data.
- **Clock-in line-up from weekly notes**: a stale item all week; reduced to pick 7.
- **Late tables climb the area ladder**: reopens his sections pick; floor-only form is pick 5.

## Role map

The executor's design, from his picks.

| Mudavym `user_restaurant_access.role` (`20260902200000:61-63`) | Checker role (`0001_init.sql:11`) | On the floor |
|---|---|---|
| `owner` | `manager` | Board, builder, sections, settings, assignments, every figure and CSV, confirm till-name links (E4), mark Out tonight |
| `manager` | `manager` | Same as owner |
| `staff` | `waiter` | `/floor/me`: own tables, taps, clock-in and clock-out, raise Food-up, read Out tonight. No figure of any kind (*"Nothing for now"*) |
| `staff` with a kitchen or bar lead mark | none | As staff, plus mark Out tonight. Nothing else |

House roles are granted as today (ADR 0162). A person with several houses picks one (ADR 0164), and the floor follows the chosen house.

## Reuse map

The executor's design. Each target is re-measured at `origin/main` `037452ebe`; `baseline` is `supabase/migrations/20260805000000_baseline_from_production.sql`.

| Checker | Mudavym | Where |
|---|---|---|
| `dining_tables` | `restaurant_tables` | `baseline:5169-5185`; `seats` nullable since `20261222230000:130`; `hidden_at`, `till_words`, `former_labels` at `:133-147` |
| `profiles`, `invitations` | `public.users` + `user_restaurant_access`, invites through `RestaurantsModule` | role CHECK `20260902200000:61-63`; `apps/api-gateway/src/app.module.ts:148`; role names `apps/api-gateway/src/common/tenant/live-membership.ts:62-64`, role read `houseMembersInRoles` at `:93` |
| `push_subscriptions` | `notification_push_devices`; no `push_subscriptions` table is created | `20260925160500:96-120` (why it is not called `push_subscriptions`: `:53`); sender `apps/api-gateway/src/notifications/notifications.service.ts:150-163`; ADR 0027 `:119` |
| Supabase realtime on nine tables | gateway socket.io, `emitToHouseRoles` → `memberRoom` | `apps/api-gateway/src/websocket/websocket.gateway.ts:39-51`, `:337`, `:343-344`, `:663-691` |
| staff and settings history | `system_audit_log` | `baseline:5553-5568`; writer precedent `apps/api-gateway/src/team/access-audit.ts:97` |
| per-house switches | `restaurant_feature_flags` + registry | `baseline:5097-5105`; `apps/api-gateway/src/settings/feature-flag-registry.ts:38`, `:44-46` (`readBy` required), `:54` |
| `sections` | new `floor_sections` (his pick) | not `house_areas` (`20260930100000:86`) |
| `shifts` (punches) | new punch table, linked to `public.shifts` by a nullable id | `baseline:5378`; no clock-in table on main (`roster.ts:15-16`) |
| `assignments`, `seatings`, `events`, `table_merges` | new floor tables in the floor module | named in the migrations, not fixed here |
| `/api/push/nudge` daily cron | a gateway job under `ScheduleModule` | `app.module.ts:90` |
| till server names | new `pos_server_links` (E4) | `pos_checks.server_external_id`, `server_name` at `baseline:4198-4199` |

Floor taps are written to the floor's own event table. `system_audit_log` keeps who changed staff, sections, settings and links, as the area tables already do (`20260930100000:46-48`).

## Engineering rules E1-E9

The executor's design, Proposed.

### E1. One floor logic, `packages/floor-core`

- What moves: the checker's pure modules, without React and without a database (`lib/` adjacency, attribution, floor-merge, freshness, heat, meal-alert, merge-orientation, response-time, visit-leave, waiter-score).
- The gateway (nudges, reports, insights) and the web board both import it, so a waiter's figure on screen and in Recommendations is one computation.
- Tests import the real code, not a mirror: the checker's tests copy the logic today (*"Mirrors lib/meal-alert.ts"*, `scripts/test-meal-brief.mjs:5`).
- `packages/` holds only `database` and `ui` today.

### E2. Per-name floor payloads travel only through role-gated rooms

- Who seated, lag minutes and scores go to `memberRoom`/`user:` rooms through `emitToHouseRoles`.
- `restaurant:<id>`, which staff also join (`websocket.gateway.ts:42-43`), carries word-only state. `emitToHouseRoles` reads roles at send time and emits nothing on a failed read (`:663-691`).
- The gateway has no socket.io adapter: its socket packages are `@nestjs/platform-socket.io`, `@nestjs/websockets` and `socket.io` (`apps/api-gateway/package.json:35`, `:38`, `:65`), no adapter package is listed, and no gateway code sets one. Rooms are per process, so one gateway replica is a stated limit.
- `pos-hub` emits nothing over the socket today, so auto-Paid needs a new emit or a read.

### E3. The nudge scanner runs on one runner and is idempotent

- It is a gateway job (`app.module.ts:90`) that takes a single-runner lock per tick.
- Each table alert carries an idempotency key of seating, kind, the visit its lateness counts from and the 15-minute window since the table turned late, so a re-run or a second replica sends nothing twice, a new visit starts a new episode, and a table that stays late is pushed again. A Food-up alert is keyed on its meal run and threshold instead. An On break handoff is keyed on the alert, `handoff` and the cover's user id, so the cover's copy of an alert already sent to the waiter is sent once.
- The keys follow when an alert climbs, which is OD-236: the window and the handoff key are the executor's call under the founder's 2026-10-31T16:57:09Z delegation, not his pick.
- The checker's per-seating guards are the precedent: `last_nudge_at`, and `last_meal_alert_at` kept separate (`0018_meal_run_alerts.sql:14-18`, working tree; untracked at `5958689`).

### E4. A till name becomes a person only when a manager confirms it

- `pos_server_links` holds (house, source, till id or normalised name) → member. Links are proposed by name match and seated-time overlap.
- An owner or manager confirms or unlinks a link.
- An unlinked till name prints as unlinked, never as a guessed person (ADR 0020). Past checks' raw words are never rewritten.
- ADR 0303's "not every word is a name" care applies: its dry run found six people's names among the till's table words (`20261222230000:22-23`).

### E5. Migrations

- RLS is on, service_role only, in the file that creates the table (precedent `20260930100000:152-171`).
- Actor columns reference `public.users(user_id)` (`:41-44`).
- Versions sort after the newest on main, `20270301170000` at `5e966c8b6`, and are assigned at merge (ADR 0212).

### E6. Every floor route carries its own `@Roles`

The global `TenantGuard` (`app.module.ts:187-188`) reads no role (`apps/api-gateway/src/common/tenant/tenant.guard.ts` contains no "role"). Waiter routes admit `staff`, and every figure route admits `owner`/`manager` only.

### E7. Dark, then one house at a time

- One flag ships with a `restaurant_feature_flags` column and an `ACTIVE_FEATURE_FLAGS` entry with its `readBy`, in one change, default off (ADR 0131).
- The `mudavym_design_arrival` entry is the precedent (`feature-flag-registry.ts:82-92`).

### E8. Routes and install

- `/floor` and `/floor/builder` sit in the shell.
- `/floor/me` is chrome-free, like the door route (`apps/web/src/App.tsx:297-310`).
- `apps/web/vercel.json:86`'s SPA rewrite list gains `floor`.
- A second manifest is scoped to `/floor/`. Today's manifest has scope and `start_url` `/` (`apps/web/public/manifest.json:5-6`).

### E9. Seats are never guessed

- The floor and the shared add-table form write `seats` NULL when nobody said.
- Today the column keeps `DEFAULT 2` (`baseline:5173`): `20261222230000:130` drops only NOT NULL.
- `upsertTable` writes `Number(table.seats) || 2` (`apps/api-gateway/src/analytics/table-analytics.service.ts:59`).
- Both writers change before pick 9 ships.

## Executor's calls

**The delegation.** At 2026-10-31T16:57:03Z the session asked the founder three questions, on OD-235, OD-236 and OD-238. They closed without an answer, with the result *"Tool permission request aborted"*, as his queued `/goal` took effect at 16:57:09Z (session ca58311b's transcript, outside the repo). His goal, verbatim and whole:

> complete the full integration with ful SOTA and robust connections with the current mudavym structure and foundation. Do not ask me anything just complete it fully.

So each call in this section is the executor's call under the founder's 2026-10-31T16:57:09Z delegation, not his pick. The options and *(Recommended)* marks those questions offered were the executor's, and he picked none of them. How far the delegation reaches is OD-242, which is open. The founder can overrule any of this.

**OD-237 stays open.** It was not among the 16:57:03Z questions. It waits for measured iPhone and Android install and web-push results, and then the founder decides. Until then neither `floor.mudavym.com` nor an Expo waiter tab is built.

### The lot rule

This is what pick 11's "drinks the cellar shows run dry" means (§ Context › His fourteen picks › pick 11); those drinks enter the list without a mark. It is the executor's call under the founder's 2026-10-31T16:57:09Z delegation, not his pick:

- **Only the live book counts** (`stock_state`, `baseline:3177`, CHECK `:3192`).
- **Out.** A drink on the house's menu reads Out when its linked inventory item (`menu_items.inventory_item_id`, `baseline:3797`, a `restaurant_inventory` id, `apps/api-gateway/src/menus/menus.service.ts:852-857`) has had live stock, that is a live lot of any status (`inventory_lots.inventory_id`, `baseline:3174`) or a live ledger row (`inventory_transactions.stock_type`, `baseline:3223`, `:3233`), and no live lot whose `status` is `active` (`:3183`, CHECK `:3191`) has `qty` or `open_bottle_ml` above 0 (`:3178-3179`).
- **Back.** It reads Back when such a lot appears.
- **Edges.** A `reserved` lot is held back and keeps no drink Back; a `depleted` lot counts as empty; a shadow lot never makes a drink Out or Back; an imported item with no live lot and no live ledger row stays off the list.
- **Why "every lot is empty" was dropped.** An earlier form of this call read Out when the item had had at least one lot and every lot had `qty` 0 and `open_bottle_ml` 0. It ignored `stock_state` and `status`, and a whole-bottle sale that takes a lot's last sealed bottle deletes the lot (`supabase/migrations/20261222100000_a_pos_sale_is_dated_by_its_check.sql:228`; open as tech debt, `.planning/tech-debt.d/2026-10-04-fix-a-short-pour-opens-the-next-bottle.md:14-16`), so "has had a lot" cannot be read from lots alone.
- **Rejected: a zero stock figure.** Menu import writes `restaurant_inventory` rows with no stock (`menus.service.ts:1940-1948`), and the dashboard counts `stock_live` 0 as critical (`apps/api-gateway/src/dashboard/dashboard.service.ts:631-632`), so every imported drink never received would read Out.
- **Rejected: a person confirming each entry.** It undoes the automatic entry his option names.

### The service-floor charter's staged entry

- **What it said.** The service-floor charter, a plan document at `.planning/01-org/product/product-vision/teams/service-floor/service-floor-charter.md`, stages the team's start under its Entry trigger (`:125`): Stage 0, a per-provider input audit; Stage 1, a non-simulator provider emitting `table_id` and `server_name`; Stage 2, a kitchen-ready event in `CanonicalCheck` (`:127-139`). No question on these triggers was asked.
- **The call.** The staged entry no longer holds back the floor build; the floor is built on his rulings and picks, not on the charter's stages. This is the executor's call under the founder's 2026-10-31T16:57:09Z delegation, not his pick. Only Stage 2's yield follows from his pick *"Include it (Recommended)"*.
- **Evidence.**
  - Food-up: he picked *"Include it (Recommended)"* over "Leave it out for now", whose option text was "the food-up alert waits for a kitchen-ready event from the POS" (AskUserQuestion asked 2026-10-31T02:52:37Z, Q4). That is Stage 2's trigger, and it was the option he did not pick.
  - Who raises it: *"Any staff (Recommended)"*, whose option text says "A POS kitchen-ready event can replace the tap later." (AskUserQuestion asked 2026-10-31T03:13:20Z, Q2).
  - *"Port in-SPA (Recommended)"* (AskUserQuestion asked 2026-10-31T03:03:50Z, Q1), *"EVERYTHING"* (AskUserQuestion asked 2026-10-31T02:52:37Z, Q2) and all fourteen picks: the floor times check-ins from its own taps, not the till, so Stage 1's trigger gates nothing the floor needs.
  - The features that need a till say so in their own option texts: *"Paid tap"*'s automatic Paid comes "once a real till feed exists", and *"Till vs floor mismatch"* "needs a real till feed (sim only today)" (AskUserQuestion asked 2026-10-31T03:41:53Z, Q1 and Q3). Both wait on OD-64. Stage 0's per-provider table still serves them, E4's till-name links and pick 9's tray, since it says which providers send table words: *"Builder starts from the till"* reads "Tables the till already taught wait in a tray to be named, placed and sectioned." It gates none of them, nor any other part of the build.
- **Rejected.**
  - Keeping the staged gate: it contradicts *"Include it (Recommended)"*.
  - Asking the founder: the delegation says "Do not ask me anything". This stays live only if OD-242 rules the delegation narrower.
  - Deleting the section: retirement is a bracket in place, and the premortem cites the charter's staged entry (`service-floor-premortem.md:34`, `:140`).
- The charter's `:69` and `:71-74` are not touched by this call, and this record edits no line of the charter.

## Consequences

**Retire-to-write (CLAUDE.md §4).** This file is the one decision record §5 requires. It retires no document, as ADRs 0249, 0265, 0273, 0287 and 0314 did. Whether retire-to-write binds a new ADR is OD-243 (OPEN-DECISIONS.md:330 on main), open.

### OD-235, OD-236 and OD-238

Each of the three was put to him at 16:57:03Z; the prompt was aborted and he made no pick, so each is answered only because of the 16:57:09Z goal message. Each answer is the executor's call under the founder's 2026-10-31T16:57:09Z delegation, not his pick, is Proposed and takes the narrow, reversible option; each OD row stays open in the register, with that answer marked, until he rules.

- **OD-235**, what punches do to ADR 0215's day-end sheet: [ADR 0350](0350-punches-pre-fill-the-day-end-sheet-and-a-manager-marks-every-shift.md) § Decision.
- **OD-236**, when a floor alert climbs: [ADR 0351](0351-a-floor-alert-climbs-past-an-absent-person-at-once.md) § Decision.
- **OD-238**, whether ADR 0027 is locked: [ADR 0352](0352-floor-pushes-use-only-the-existing-device-stores.md) § Decision, with the floor's own rule in § Decision › The push rule.

### Easier

- One sign-in, one house choice and one push registry serve the floor.
- The floor's data reaches insights and Recommendations through the engine that already exists.
- Per-waiter figures come from the same rows the board shows.

### Harder

- The checker's history is lost at retirement (*"Start fresh (Recommended)"*).
- Realtime is limited to one gateway replica until an adapter exists (§ Engineering rules E1-E9 › E2).
- The checker's uncommitted Food-up work and its 12 modified files have to be frozen (tag or tarball) before porting, or the spec moves under the port. This record does not freeze them.

### Text changed in published files

- **The rule.** A change this record causes in a published file is a dated bracket written in place inside the existing line; no merged sentence is reworded, and no line moves.
- **Brackets this series writes:** ADR 0027's at `0027:154`, pointing at ADR 0352 § Decision › The push rule; the register rows of OD-235, OD-236 and OD-238, each marked with its Proposed answer in place and kept open.
- **Changed by his rulings, bracketed by the other records of this series:** ADR 0303 (`:3`, `:24` *"No drawing."*; `:67` seats, which `:36` already agrees with; `:65` add-a-table), at [ADR 0347](0347-the-floor-builder-draws-tables-the-till-also-teaches.md) and [ADR 0353](0353-a-closed-till-check-marks-paid-only-a-person-ends-a-seating.md); ADR 0218's lead-mark rule (`0218:138-142`, Out tonight) and its retention item (`:572-575`, a departed waiter's floor figures), with the service-floor plans, at [ADR 0346](0346-waiter-scores-and-rankings-ship-to-managers.md) among others; and the service-floor charter's staged entry (§ Executor's calls › The service-floor charter's staged entry).
- **Re-pointed at this record:** ADR 0348 and `.planning/tech-debt.d/2026-10-31-fix-analytics-money-routes-need-a-manager.md` point at § Context › His fourteen picks › pick 14, § Context › The founder's rulings › Round 2 (*"Nothing for now"*) and § Decision › The staff-invite step. That re-pointing is the executor's call under the founder's 2026-10-31T16:57:09Z delegation, not his pick.

### ADR 0215 is untouched

- This series edits no line of ADR 0215 (Locked). Pick 10's option text, "It amends ADR 0215; wages stay on planned hours" (AskUserQuestion asked 2026-10-31T03:41:53Z, Q3), is what he was shown; what it changes is recorded here and in ADR 0350, not in 0215.
- Wages stay on planned hours: /team's labour cost is priced on the planned span less the counted break (`apps/api-gateway/src/team/schedule.service.ts:596-603`), and a punch changes no hours figure or wage by itself.
- The day-end sheet (`0215:1231-1233`) is OD-235, which stays open; ADR 0350 § Decision gives the executor's Proposed answer.
- Any bracket in ADR 0215 is the founder's to review, in its own PR. Clock hardware stays out of scope (`0215:1243`).

### Held

- The evidence note, the software note, its SOFTWARE-MAP row and the CLAIMS roster bump are held for the founder under OD-246; nothing landed depends on them.
- ADR 0257 W22 (`0257:146`): a waiter sees no figures for now, so the staff-money line is not redrawn.
- ADR 0027 stays Proposed. Its rule that `push_subscriptions` *"does not exist and must not be created"* (`0027:119`) is matched by ADR 0352 § Decision › The push rule, so the floor does not depend on its status.
- Ask AI: its action families stay `procurement` and `communications` (`apps/api-gateway/src/ask-ai/ask-ai-actions.ts:32`). The port adds no floor action there.
- ADR 0348 (Locked) holds as written: its post-#617 follow-up merges before any waiter is invited to `/floor/me` (§ Decision › The staff-invite step).

### Open items

- **OD-237**: `floor.mudavym.com` or an Expo waiter tab? Neither is built. It waits for measured iPhone and Android install and web-push results; then the founder decides. Whether floor alerts also reach a person's Expo devices waits on the Expo staff app running on a device (OD-109).
- OD-235, OD-236 and OD-238 stay open in the register; their answers are Proposed (› OD-235, OD-236 and OD-238 above).
- OD-246 (whether the held notes land), OD-242 (how far the delegation reaches), OD-243 (retire-to-write for a new ADR) and OD-64 (first real POS; auto-Paid and the mismatch check wait on it) are open.

### Owed

- By the code PRs that build the port, each citing the section of this record it builds (no repo doc holds these obligations): the floor module and routes (E6, E8); the `floor_sections` table; the punch table linked to `public.shifts` by a nullable shift id, and its /team week display (pick 10); `packages/floor-core` (E1); `pos_server_links` (E4); the nudge job (E3); the flag (E7); and the two seats writers' change before pick 9 ships (E9).
- CLAIMS rows: no migration creates `push_subscriptions`; no floor emit of per-name data targets `restaurant:`; Call out's Expo leg; the Settings Push row.
- The checker snapshot (tag or tarball), before any porting starts.
- The post-#617 follow-up of ADR 0348, before any waiter invite (§ Decision › The staff-invite step).

### Revisit when

- `/floor/me` fails to install or to receive push on a waiter's iPhone (OD-237);
- a second gateway replica is added (§ Engineering rules E1-E9 › E2, E3);
- a real till feed lands (OD-64): auto-Paid and the mismatch check start to carry weight, and the live-till features the adversaries killed are re-asked (§ Feature ideas the adversaries killed);
- tap compliance sits near 100% while table outcomes do not move, the premortem's signal for gamed taps;
- the founder lifts the "for now" of *"Nothing for now"* on the waiter phone (ADR 0257 W22).

## Not verified

- Whether a second same-origin manifest installs, and receives web push, on an iPhone (OD-237).
- The gateway's replica count in production, whether any device in production has received a web push, and the production device counts.
- The checker's line counts; its cites above were re-read at `5958689` and in its working tree on 2026-10-31.
- The research runs' own citations, beyond those this record uses; Mudavym cites were read at `037452ebe`, and the `analytics.controller.ts` lines, the newest migration and the absence of a floor route were re-read at `5e966c8b6`.
- The research and adversary passes behind OD-235, OD-236 and OD-238, and the law and counsel items, are in ADR 0350, ADR 0351 and ADR 0352 § Not verified.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-31 | executor, session ca58311b | Created from the founder's 2026-10-30 rulings and the two research workflows; citations read at `origin/main` and the checker at `5958689` |
| 2026-10-31 | skeptic and fixer | Pick 14 brought up to #701 and his 2026-10-31 scope pick, with the staff-invite rule; citations corrected |
| 2026-10-31 | fork-answer fold | The executor's calls added under the founder's 2026-10-31T16:57:09Z delegation, quoted verbatim; OD-237 kept open |
| 2026-10-31 | judge rounds on OD-235 | The day-end sheet answer kept and repaired, the executor's call under the founder's 2026-10-31T16:57:09Z delegation |
| 2026-10-31 | judge rounds on OD-236 | When an alert climbs, and E3's keys, kept and repaired, the executor's call under the founder's 2026-10-31T16:57:09Z delegation |
| 2026-10-31 | judge rounds on OD-238 | ADR 0027 left Proposed with the floor's own push rule, the executor's call under the founder's 2026-10-31T16:57:09Z delegation |
| 2026-10-31 | finish round | Five calls, not four; the lot rule corrected to the live book; #701 recorded as merged |
| 2026-10-31 | consolidation | Each answer to OD-235, OD-236 and OD-238 stated once, unchanged |
| 2026-10-31 | restructure | Three parts; the three answers moved to ADRs 0350, 0351 and 0352, the staged entry to § Executor's calls |
| 2026-11-01 | executor | R3 rewrite: no held-note cites; single decision record |
