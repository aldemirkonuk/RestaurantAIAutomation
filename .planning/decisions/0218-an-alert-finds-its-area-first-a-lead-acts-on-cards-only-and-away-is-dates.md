# 0218 — An alert finds its area first, a lead acts on cards only, and Away is dates

- **Status:** Locked 2026-09-21 (the three rulings below, the founder's) · build details marked *built, not ruled* are the lane's and are listed under **Open** for his word
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder)
- **Keywords:** areas, area label, AreaLabel, AreaKind, house_areas, house_area_members, house_away, area lead, Away, holiday, notification routing, persistForRestaurant, focus not filter, KVKK, house log, system_audit_log
- **Links:** judge `scratchpad/q921/areas-judge.md` (v1 §4, attacks A1–A11), research `areas-model.md` §A2–A6, `snooze-sota.md` §4–5; [[0088]] (access changes file themselves), [[0162]] (a role is the role in the token's house), [[0191]] (recommendation actions — the catalogue lane that will read the label), [[0134]] (motion tokens)

## Context

Every broadcast notification went to every member of the house
(`NotificationsService.persistForRestaurant`, `notifications.service.ts`, the
`resolveRestaurantMemberIds` fan-out), and the producers claimed every member
awake outside quiet hours (`ProducerLedgerService.audienceFor`). Nothing could
say "this is the bar's alert", nothing could hold alerts back from someone on
holiday, and nothing let a head chef act on kitchen cards without being made a
manager — which also shows them every wage (`TeamService.listMembers` is
manager-gated "because the roster exposes wages").

The judge's pass (`areas-judge.md`) put four questions to the founder. He
answered three of them on 2026-09-21, in his words:

- **Areas:** *"no areas for now, but they have labels, classifcation
  responsible for each so different alerts different notifications for
  different areas. but if you say their are first is better I'd agree"*
- **Area lead:** *"Yes, cards only"*
- **Holiday:** *"they set away dates, UI shows a visual update maybe crosslined
  or I let you design it on its name with explanation. with override possible,
  via either owner/manager account or staff member's account(personal only to
  that person)"*

We recommended "their area first" (the judge's v1, which is what the founder's
"I'd agree" accepts) and built it.

## Options considered (and what killed the rejected ones)

1. **Staff see only their own area** (areas-model §A5; judge v0 item 3). Killed
   by A1: a card with the wrong label, or an area whose one member is off, has
   no login, or is away, reaches no staff member at all.
2. **Route to whoever is on shift** (judge v0 item 4). Killed by A1: `shifts`
   was last measured empty in the one real house (dossier, not re-measured), so
   shift routing reaches nobody; "the schedule names nobody" must never mean
   "nobody was working" (`producers/roster.ts`).
3. **A mandatory seven-area setup, `dish` included** (areas-model §A2). Killed
   by A4: a three-person house gains a chore and no benefit. Built instead:
   areas cost nothing until someone is put in one.
4. **Area derived from the card's `category`** (areas-model §A4). Rejected:
   `sales` does not say bar or cellar. The label is its own typed field.
5. **One card copied per area.** Rejected: two copies are two truths (ADR 0191,
   "one truth, one store").
6. **Away switched on automatically from approved leave** (judge v0 item 2).
   Wounded by A5: it reuses leave data for a new purpose, and
   `time_off_requests.reason` is free text that can hold health data (KVKK Art.
   6). None of the surveyed products does it (snooze-sota §5).
7. **"Make the head chef a manager"** (judge A5, Q4 option B). Rejected by the
   founder's "cards only": it hands over pay and the roster.
8. **A strike-through on an Away name.** The founder offered it ("maybe
   crosslined") and left the design to us. Not taken: a line through a name
   reads as "removed", the roster's word for someone who left. The name dims
   and a small note says "Away until 28 Sep"; tapping it says what Away does.
9. **Do nothing ("No areas for now").** The founder's first words — then
   "if you say their are first is better I'd agree". Doing nothing keeps every
   kitchen, bar and floor alert in one pile for everyone.

## Decision

**An item can carry an area label; a broadcast finds its area first; a lead
acts for everyone on their area's cards and nothing else; a person can be Away
on dates, and the notification funnel and the alert producers skip them.** The
founder's rule is that *no* alert reaches a person on their Away days; the
senders this build did not reach are listed under **Owed** below, and until the
last of them is wired the Away note says "most alerts", not "no alerts". With
nobody in any area and nobody Away, every audience is exactly what it was
before this ADR.

### The label (typed, for the catalogue lane)

`apps/api-gateway/src/areas/area-label.ts`: `AreaKind` is one of `kitchen`,
`bar`, `floor`, `cellar`, `receiving`, `management`; `AreaLabel` is a kind or
`null`, and **null is house-wide**. A house renames a kind or switches it off
(`house_areas`); it never invents one, so a rule written against `kitchen`
finds "Garde manger". Anything unreadable reads as house-wide — the direction
that cannot lose an alert. **This ADR labels no rule**: the recommendation
catalogue (another lane) owns which rule carries which label.

### The ladder (`area-routing.ts`, pure)

0. Nobody in any switched-on area, or a house-wide item, or a switched-off
   area's label → everyone who is not Away.
1. The labelled area's members who are not Away. A lead is a member of the area
   they lead (the mark sits on the membership row), so "then its lead" is
   reached inside this step.
2. Otherwise the owners and managers who are not Away.
3. Otherwise every owner (managers, in a house with no owner row), **inbox
   only**: a row, no push, no live ping. *Built, not ruled* — see Open.

When step 1 alerts the area, owners and managers who are not Away still get the
row without the push: areas change who is **alerted**, never what an owner can
**see**. A person with no account is in the area on the Team page but routing
passes over them.

**Where it is wired.** `persistForRestaurant(…, { area })` routes every
broadcast (no `onlyUserIds`): rows to alerted + inbox-only, push to alerted
only, the socket to the rows' user rooms instead of the restaurant room
whenever routing narrowed anything. A targeted write (`onlyUserIds`) is not
routed — its caller chose the people. `ProducerLedgerService.audienceFor` sets
people who are Away today apart from both its halves. If the area registers
cannot be read, the funnel writes to every member as before and logs
`AREA_ROUTING_UNREADABLE`; the producers fail open the same way
(`NOTIFICATION_PRODUCER_AWAY_UNREADABLE`) — a register that only narrows an
audience must never silence a house. Nothing else reads Away yet (see
**Owed**).

**Focus, not filter.** `splitForViewer` (gateway) and `splitByMyAreas` (web)
split a staff list into "your areas" and "the rest of the house"; nothing is
removed, and owners, managers and anyone in no area get the list unchanged. No
list calls either yet: nothing carries a label until the catalogue lane adds
them.

### The lead mark — "Yes, cards only"

`mayActForEveryone(viewer, label)`: owners and managers everywhere (as today);
a lead only on an item labelled with a switched-on area they lead; nobody on a
house-wide item through a lead mark. The recommendation lane decides which verbs
ask it (snooze for everyone, finish, dismiss, undo others' acts). The mark
changes no house role and writes no access row, wage or roster row (asserted in
`house-areas.service.spec.ts`).

### Away — dates only

`house_away (restaurant_id, user_id, away_from, away_until, set_by, …)`, one
window per person per house, both days inclusive, on the house's own calendar
(`restaurants.timezone`). The person sets or ends their own; an owner or manager
can set or end anyone's in the house. **No reason column, and nothing here reads
`time_off_requests`** (CLAIMS `ADR-0218-AWAY-STORES-DATES-ONLY`). The Away
marker (`components/mudavym/AwayMarker.tsx`) dims the name, says "Away until
28 Sep", and opens one sentence on tap; no motion, so no ADR 0134 token is used.

### The house log

`system_audit_log`, through `recordAccessChange` (ADR 0088's one writer):
`house_area_changed`, `area_member_added`, `area_member_removed`,
`area_lead_granted`, `area_lead_removed`, `away_set_for_member`,
`away_ended_for_member`, each with `actor_id` = `public.users.user_id` and
before → after fields. A person's own Away dates are **not** logged (judge
§4.6). A lead is told when they gain or lose the mark; a person is told when
someone else sets or ends their Away. The Team page's "What changed here" and
`/settings`' trail read these back (`READ_BACK_ACTIONS`).

### Who may do what

| Act | Who | Logged |
|---|---|---|
| Read areas | anyone in the house (staff see only their own memberships) | no |
| Rename / switch an area; add or remove a person; set or clear a lead | owner, manager | yes |
| Set or end your own Away | anyone | no |
| Set or end someone else's Away | owner, manager | yes, and the person is told |
| See Away windows | owners and managers: all; staff: their own | — |

The house and the role come from the verified token (ADR 0162), never the URL
or the body. The `admin` alias `RolesGuard` accepts does **not** widen an area
gate (judge §6 leaves its meaning open).

## Consequences

- A house can send the bar's alerts to the bar without taking them from the
  owner's inbox, and a head chef can run kitchen cards without seeing wages.
- `persistForRestaurant` now reads five small registers per broadcast (access
  rows, time zone, areas, memberships, Away). Measured cost was not taken.
- The catalogue lane must pass `area` for anything to route; until it does,
  only Away changes what anyone receives.
- **Revisit when:** a house asks for an area outside the six (custom kinds), or
  shifts carry real rows (then a shift may delay an alert, never hide one).

## Open (for the founder; not decided here)

1. **Everyone Away → owners' inbox only** (step 3). Built so an alert always
   lands and no Away person is woken. Alternative: hold it until someone is back.
2. **"Then its lead" as a time escalation** (members first, the lead after N
   minutes unacted) rather than inside step 1. Not built.
3. **Targeted messages during Away** (a manager's note or broadcast to one
   person) still reach them. Mute those too?
4. **The recommendations email digest** (`recommendation-digest.service.ts`, a
   person's own subscription) still sends during Away. Pause it?
5. **Staff seeing a colleague's Away marker.** Built: only owners, managers and
   the person see Away (judge §4.5). The founder's "on its name" may mean
   everywhere a name appears.
6. **The longest Away window**: 366 days, an input guard, built not ruled.
7. **Retention** of the log rows, and the KVKK notice text (judge §4.7) — still
   owed, with counsel.
8. **A manager setting or ending an owner's Away.** Built: any owner or manager
   can set anyone's in the house, so a manager can quiet an owner's alerts for
   the dates. The owner is told at once and it is in the house log.
   Alternative: owners' Away is set only by owners.

## Owed (the founder ruled it; this build did not reach it)

Found at last call, 2026-09-21, by reading every sender that writes a
notification row or a push outside `persistForRestaurant`'s broadcast path.
Each still reaches a person on their Away days:

- **A manager's team message to everyone** (`team.controller.ts`, the push
  leg). Its inbox row goes through the funnel and now skips the Away person;
  its push does not. The worse half is the one that still arrives.
- **Calendar reminders** (`calendar-reminders.service.ts`). They build their own
  audience and write with `onlyUserIds`, so the funnel does not route them.
  The job is behind its own flag and off by default.
- **Two in-app writers that fan out to every member themselves**:
  `inbound-responder.service.ts` `persistManagerNotification` and
  `scheduled-tasks.service.ts` `persistRestaurantNotification` (rows only, no
  push).
- **The Away marker on names outside the roster, the Areas sheet and the Away
  card** — the week grid and the rest of the shell draw names without it.

Three of those four gateway files (the team controller, calendar reminders,
scheduled tasks) carry uncommitted changes in another lane's worktree
(`wt-fin-notify`) at the time of writing, so none of the four was edited here.

## Evidence

- Gateway: `area-routing.spec.ts` (28), `house-areas.service.spec.ts` (22),
  `notifications-route-by-area.spec.ts` (9); notifications/team/settings-audit/
  calendar suites 588 passing; `tsc` clean; `check_gateway_boots.sh` PASS.
- Web: `AwayMarker.test.tsx` (9), `AreasAway.test.tsx` (8); team/mudavym/
  settings suites passing; `tsc` clean; eslint 0 errors on the changed files.
- Migration `20260921170300`: all 193 migrations build in PGlite and the file
  re-runs cleanly; cross-house membership → 23503, duplicate → 23505, unknown
  kind / blank name / backwards dates → 23514, an `auth.users`-only id → 23503,
  a roster delete cascades, anon/authenticated hold no grant. Not Supabase:
  PGlite 0.5.8 as superuser (memory `pglite-full-corpus-build`).
- Mutations: 28 code mutations and 6 claim mutations, every one turned its
  test or verify red; 3 migration mutations each changed the PGlite probe.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | judge (areas-judge.md) | v0 attacked (A1–A11), v1 recommended |
| 2026-09-21 | founder | Areas "their area first" accepted; lead "Yes, cards only"; Away dates with override |
| 2026-09-21 | areas lane | Built; Open items above left for the founder |
| 2026-09-21 | last call | "nothing reaches them" was broader than the code: Away copy made "most alerts", **Owed** added; the Areas sheet no longer says an empty area's alerts go to owners and managers while nobody is in any area; a failed Away read now says so on the roster, the Areas sheet and My shifts |
