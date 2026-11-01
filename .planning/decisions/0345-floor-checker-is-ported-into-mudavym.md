# 0345 — Floor Checker is ported into Mudavym

- **Status:** Proposed (2026-10-31); not to be locked before all three parts have landed.
- **Parts:** 3. Part 1 lands in two PRs: this one holds the context, Rounds 1 to 4 of his rulings and the decisions those rounds evidence; the next adds his fourteen picks, the options considered, the research, the decisions resting on them and this record's register row. Parts 2 and 3 follow, and part 3 completes Consequences and the Review trail.
- **Date:** 2026-10-31 (rulings of 2026-10-30 EDT, session ca58311b)
- **Decider:** the founder, for the port and his picks: five AskUserQuestion calls on 2026-10-30 EDT, asked 2026-10-31T02:52:37Z, 03:03:50Z, 03:13:20Z, 03:41:53Z and 03:46:17Z, and on 2026-10-31 the leak fix's scope (asked 04:34:21Z, quoted with his picks in the next PR) and, in the call asked at 16:54:31Z, that a departed waiter's floor figures are kept for owners and managers. Each is quoted under § Context. His builder answer and his Out tonight answer, whose label and text differ, are read in the ways stated where they appear; those readings are the executor's (session ca58311b), not his words, and they wait on OD-242 together with what they would change in ADRs 0303 and 0218. The founder can overrule any part of this record, and a lock is his. Its role map, reuse map and engineering rules are the executor's design. This record answers none of OD-235, OD-236 or OD-238.
- **Keywords:** Floor Checker, floor coverage, waiter-coverage, port, in-SPA, /floor, /floor/builder, /floor/me, floor module, floor-core, floor_sections, Food-up, meal run, Paid, punches, Out tonight, pos_server_links, emitToHouseRoles, memberRoom, notification_push_devices, restaurant_tables, subdomain, manifest
- **Links:**
  - His answers are cited by the UTC time each question was asked (session ca58311b's transcript, outside the repo).
  - [ADR 0001](0001-mudavym-single-entity.md) (Locked): Floor Checker is one of the small softwares inside Mudavym.
  - [ADR 0303](0303-tables-learned-from-the-pos.md) (Proposed) is changed by his seats and add-table rulings, whose option texts say so, and would be changed by the builder reading once OD-242 is answered. [ADR 0218](0218-an-alert-finds-its-area-first-a-lead-acts-on-cards-only-and-away-is-dates.md) (Locked) would be changed only by the shared part of Round 4's Out tonight answer, once OD-242 is answered. [ADR 0215](0215-money-on-team-is-the-owners-and-hours-are-worked-hours.md) (Locked): the punches option he took says it amends 0215; that amendment is made in its own PR for his review, not in this record.
  - Held as they are: [ADR 0257](0257-dashboard-walk-through-r1-rulings.md) W22; [ADR 0027](0027-push-recipients-are-not-resolved-here.md) (Proposed).
  - The staff-invite step: [ADR 0348](0348-staff-are-refused-the-table-and-server-takings-and-the-rest-is-withheld-after-617.md) (Locked) and [ADR 0298](0298-cost-of-goods-is-what-sold-and-concentration-reads-the-till.md) decision 9.
  - Binding: [0020](0020-no-fabricated-answers.md), [0131](0131-the-new-house-goes-live-dark-then-one-house-at-a-time.md), [0149](0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md), [0162](0162-managers-grant-manager-or-staff-on-both-doors.md), [0164](0164-sessions-follow-membership-and-several-houses-choose.md), [0212](0212-a-new-migration-sorts-after-every-version-its-base-holds.md), [0272](0272-a-ranking-or-a-pairing-is-printed-only-when-the-data-can-tell-it-apart.md), [0294](0294-the-team-performance-card-prints-every-figure-with-its-unit.md).
  - Register ([OPEN-DECISIONS](OPEN-DECISIONS.md)): OD-235 to OD-238, the forks these rulings left, and OD-246, all already in the register on main; OD-237 stays open. OD-64 (first real POS) is open. Two more are open and already in the register on main: OD-242, how far the founder's 2026-10-31 delegation reaches; and OD-243, whether retire-to-write binds a new ADR.

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

He ruled in five AskUserQuestion calls on 2026-10-30 EDT: Rounds 1 to 4 below, and the call asked at 2026-10-31T03:41:53Z in which he took his fourteen picks, quoted in the next PR. On 2026-10-31 he also answered the leak fix's scope (quoted with the picks) and what happens to a waiter's floor figures when the waiter leaves the house: *"Keep, owners/managers only (Recommended)"* (AskUserQuestion asked 2026-10-31T16:54:31Z, Q2), whose option text reads "Their history stays as it was, named, visible only to owners and managers, like their shifts on /team. Deleting or anonymising later waits on the retention answer ADR 0218 already sent to counsel."

A picked label is his pick; a typed answer is quoted exactly, typos included; option texts and *(Recommended)* marks are the executor's, quoted as what he was shown; a session gloss is marked.

#### Round 1

Asked 2026-10-31T02:52:37Z. **Architecture** (Q1), offered "Port into Mudavym (Recommended)", "Keep separate, sync data" and "Separate UI, shared DB"; his answer typed in place of an option, with his blank line:

> maybe it could be another subdomain I'm not sure create workflow and research what it sright.
>
> port into mudavym might be best

The workflow wf_c6c2a59b-b8b recommended the port in-SPA (§ Options considered, in the next PR).

- **Waiter stats** (Q2): *"EVERYTHING"*, typed in place of "Own stats, no ranking (Recommended)", "Full checker metrics" and "Shift/section only".
- **Old checker data** (Q3): *"Start fresh (Recommended)"*: "Treat it as demo/test data. Set floors up again in Mudavym; leave the old project alone until you retire it." Nothing is migrated from `aatljtckuqzvsttdoxjk`.
- **Food-up** (Q4): *"Include it (Recommended)"*, over "Leave it out for now", whose text was "Port only the committed features; the food-up alert waits for a kitchen-ready event from the POS." Food-up is ported.

#### Round 2

Asked 2026-10-31T03:03:50Z.

- **The port** (Q1): *"Port in-SPA (Recommended)"*, over "Port + floor.mudavym.com alias"; its option text: "The waiter screen gets its own installable app identity (a manifest scoped to /floor/) on the same origin." There is no subdomain.
- **The builder** (Q2), set against ADR 0303's *"No drawing."* (`0303:3`, `:24`) and offered "Position + hand-add guarded (Recommended)", "Position only" and "Full checker builder"; his answer typed in place of an option: *"I want to have all features but in mudavym's way oformat and design compatibility, and more features that actually provide with now the addition to the mudavym(IMPORTANT)"*. The executor's reading: `/floor/builder` ships every checker builder feature (place, group, merge), rebuilt in the Mudavym design; it starts from the tables the till taught; and ADR 0303's *"No drawing."* would no longer hold for the floor. That reading waits on OD-242. Round 4's add-a-table ruling says how tables are added.
- **The waiter phone** (Q3): *"Nothing for now"*, not the option marked (Recommended). Its option text: "Waiters only tap check-ins; all figures stay with managers for the first rollout." Session gloss: taps only; every figure (scores, rankings, CSV) is owners' and managers'.
- **Sections** (Q4): *"Separate floor sections (Recommended)"*. A new `floor_sections` table, not `house_areas`, which allows one row per kind per house (`supabase/migrations/20260930100000_a_house_names_its_areas_and_who_is_away.sql:86`) and so could not hold several floor sections.

#### Round 3

Asked 2026-10-31T03:13:20Z; it led to the call in which he took his picks.

- **Punches and wages** (Q1), offered "Floor-only first (Recommended)" and "Feed wages now"; his answer typed in place of an option: *"maybe this could be interworkable with /team"*. Each punch links to its planned /team shift when it has one, and the /team week shows punched times beside planned ones. That is the option text of *"Punches on /team"*, one of the picks he took (quoted in the next PR), not only the executor's reading. A punch changes no hours figure and no wage by itself: /team's labour cost stays priced on the planned span less the counted break (`laborCost` in `apps/api-gateway/src/team/schedule.service.ts` returns `priceShift`, which prices `workedHours` in `apps/api-gateway/src/team/pay-rules.ts`; claim ADR-0345-WAGES-PRICED-ON-PLANNED-HOURS checks it). That option's text says "It amends ADR 0215; wages stay on planned hours" (AskUserQuestion asked 2026-10-31T03:41:53Z, Q3), so wages on planned hours was part of the pick he took. What punches do to ADR 0215's day-end sheet is OD-235, which these rulings leave open.
- **Who raises Food-up** (Q2): *"Any staff (Recommended)"*: "The pass, a runner or a manager taps it, as in checker. A POS kitchen-ready event can replace the tap later." The checker allows managers only (`app/meal-actions.ts:136`, working tree).
- **Mudavym-only features** (Q3): *"Yes, research then I pick (Recommended)"*. That run is wf_3808bfdb-c92 (§ Options considered, in the next PR).

#### Round 4

Asked 2026-10-31T03:46:17Z.

- **Who marks Out tonight** (Q1): *"Managers + kitchen/bar leads"*, not the option marked (Recommended). Its option text: "Only owners, managers and area leads can mark items out; waiters only see the list." The label says kitchen/bar leads, the text area leads; kitchen and bar leads are area leads, so both halves allow them; only that shared part is proposed, and it waits on OD-242. A lead is a `house_area_members.is_lead` row (`20260930100000:104`) of kind `kitchen` or `bar` (`:98`); a house with no kitchen or bar lead has managers only. Waiters see the list only; widening it to all area leads is his.
- **Seats on floor tables** (Q2): *"Optional seats (Recommended)"*. Its option text: "The builder can set seats; a table without them shows a dash, never a guessed 2 (fixes the old POST that writes seats=2). Amends 0303." ADR 0303 already rejects a seats-2 default for learned rows (`0303:36`), and the learning insert writes NULL for `seats` and `is_outdoor` (`supabase/migrations/20261222230000_tables_learned_from_the_pos.sql:307-310`).
- **Where a table is added** (Q3): *"Both, one shared form (Recommended)"*. Its option text: "The builder and Settings → Point of sale use the same add-table form and the same twin-table guard." This widens ADR 0303's add-a-table follow-up (`0303:65`).
- **The till's closed check** (Q4): *"Auto-Paid, never auto-leave (Recommended)"*. Its option text: "A closed check marks the table Paid (with one-tap undo for split bills); the waiter still taps Leave. Voided checks and backfills are ignored."

## Decision

**Floor Checker is ported into the Mudavym web app and gateway, as a dark-launched software. Every one of its features is carried over in Mudavym's design, on Mudavym's data; the old checker stays until he retires it.**

Proposed, from his rulings (§ Context):

- **The port in-SPA**: `/floor`, `/floor/builder`, a chrome-free `/floor/me` with a `/floor/`-scoped manifest on the same origin, a NestJS floor module, new migrations. No subdomain or Expo waiter tab while OD-237 is open.
- **Start fresh**; **every checker feature**, Food-up included (raised by any staff), in Mudavym's design (ADR 0149); sections in a new `floor_sections` table.
- **The waiter phone shows no figure** (*"Nothing for now"*). Every figure is owners' and managers' only for the first rollout; DASH-G6 is not answered here; a departed waiter's are kept, named.
- **Out tonight**: who marks it is not decided here. The part both halves of his answer share is managers and kitchen and bar leads; that reading, and whether owners mark it, wait on OD-242, and no code PR builds marking before then. Waiters only see the list.
- **Tables**: optional seats, never guessed; one shared add-table form; a closed till check marks Paid, never ends a seating, and waits on OD-64.
- **Wages stay on planned hours**, as the punches option he took says; what punches do to ADR 0215 is OD-235.
- **Open forks stay open.** OD-235, OD-236 and OD-238 stay open here; this record authorises no answer to any of them, and a later record that gives one states its own basis.

### The staff-invite step

**No waiter is invited to `/floor/me` until #701 and the follow-up after #617 have merged.** Source: ADR 0348 (Locked), whose withheld remainder lands in the follow-up after #617; his answer on the leak fix's scope is quoted with his picks in the next PR. #701 merged as `e7ef31145`; the follow-up has not. The code PR that opens staff invites owes a check of both.

## Consequences

**Retire-to-write (CLAUDE.md §4).** This file is the one decision record §5 requires. It retires no document, as ADRs 0249, 0265, 0273, 0287 and 0314 did. Whether retire-to-write binds a new ADR is OD-243, open, and is raised again when this record is locked.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
