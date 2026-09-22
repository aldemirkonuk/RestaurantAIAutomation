# 0218 — An alert finds its area first, a lead acts on cards only, and Away is dates

- **Status:** Locked 2026-09-21 (the three rulings below, the founder's) · round 2 locked 2026-09-21: the eight **Open** items answered with *"Take all seven"* (see **Round 2**) · two items went to counsel, not to a build (**The lawyer's list**) · round 3 locked 2026-09-22: four more questions, each with his pick as the option label (see **Round 3**)
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder)
- **Keywords:** areas, area label, AreaLabel, AreaKind, house_areas, house_area_members, house_away, house_away_held, held_away, AwayReleaseService, area lead, Away, holiday, notification routing, persistForRestaurant, focus not filter, recommendations digest, KVKK, house log, system_audit_log
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
on dates, and the notification funnel and the alert producers skip them.**
[Round 2, 2026-09-21: also, a note or message sent to them by name waits until
they are back, and their recommendations email pauses — see **Round 2**.]
[Round 3, 2026-09-22: a message to **everyone** now waits for an Away person
the same way a named one does, and a colleague's Away is shown to staff only
once it is under way — see **Round 3**.] The founder's rule is that *no* alert
reaches a person on their Away days; the senders this build did not reach are
listed under **Owed** below, and until the last of them is wired the Away note
says "most alerts", not "no alerts". With nobody in any area and nobody Away,
every audience is exactly what it was before this ADR.

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
   reached inside this step. [Ruled 2026-09-21, round 2 answer 2: the lead is
   alerted together with the members, never after a delay.]
2. Otherwise the owners and managers who are not Away.
3. Otherwise every owner (managers, in a house with no owner row), **inbox
   only**: a row, no push, no live ping. [Ruled 2026-09-21, round 2 answer 1:
   it goes to the owners' inbox and never waits unseen.]

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
audience must never silence a house. [Round 2 adds three readers: a named
note or message holds for an Away person, the digest pauses, and staff read
colleagues' windows. The senders still not wired are under **Owed**.]

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
(`restaurants.timezone`), at most 366 days (the gateway's `AWAY_MAX_DAYS` and,
since round 2, the table's `ck_house_away_at_most_366_days`). The person sets or
ends their own; an owner or manager can set or end someone's in the house
[round 2 answer 7: but only an owner sets or ends an owner's]. **No reason column, and nothing here reads
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
`/settings`' trail read these back (`READ_BACK_ACTIONS`). [Last call, round 3,
2026-09-22: to an owner or manager only. `GET /settings-audit` has no role
gate, and until this call it handed a staff token the six person rows too —
a colleague's name, their Away dates before they start, and who set them.
The query now asks a staff reader's trail for `readBackActionsFor(role)`,
which leaves out `STAFF_WITHHELD_ACTIONS` (every row above except
`house_area_changed`). See **Round 3**, answer 3.]

### Who may do what

| Act | Who | Logged |
|---|---|---|
| Read areas | anyone in the house (staff see only their own memberships) | no |
| Rename / switch an area; add or remove a person; set or clear a lead | owner, manager | yes |
| Set or end your own Away | anyone | no |
| Set or end someone else's Away | owner, manager — an **owner's** only by an owner (round 2 answer 7) | yes, and the person is told |
| See Away windows | everyone in the house, dates only (round 2 answer 5); owners and managers see a window before it starts, staff only once it is under way (round 3 answer 3); only owners, managers and the person see who set them | — |

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
- [Round 2] A named note or message now reads Away before it is sent, and the
  release sweep reads the whole hold table every 15 minutes (no page limit; one
  real house today). Measured cost was not taken.
- [Round 2] Staff now learn a colleague's Away dates and roster name — the
  founder's answer 5 — which is why the privacy notice is on the lawyer's list.
- [Round 2, last call] Two readers disagree about who belongs to a house. The
  release (`AwayReleaseService.membersOf`) counts a person whose only tie is
  the legacy `users.restaurant_id`. The inbox funnel
  (`DatabaseService.getRestaurantMemberIds`) drops that person whenever the
  house has any active access row. For such a person a held item is never
  delivered: the strict inbox write finds 0 rows, the claim is handed back, and
  `AWAY_HOLD_DELIVERY_FAILED` is logged on every sweep. v3.0-TECH-DEBT 44.1i
  says no such member exists in production once migration `20260918153000` has
  applied. This was found by reading the code; it was not measured.
- [Round 3] A send to **everyone** now also reads Away before it sends (one
  more read than before, on every crew message, not only a named one) and can
  now hold — so the readers-disagree-about-membership consequence above
  (round 2, last call) now also applies to a whole-crew message, not only a
  named one: the same person, if they exist in production, would see
  `AWAY_HOLD_DELIVERY_FAILED` on a held "everyone" send too. Not measured;
  same production caveat as round 2 (v3.0-TECH-DEBT 44.1i).
- [Round 3] `listAway`'s answer now depends on the reader's role in a second
  way (who is filtered out, not only what `canManage`/`setBySelf` show) — a
  cache keyed only by house, not by house-and-role, would leak an upcoming
  colleague window to a staff viewer if one is ever added. None exists today
  (`useHouseAreas.ts` keys its query by restaurant id, and the query result is
  never shared across a role change without a refetch). [Last call,
  2026-09-22: that last clause is too strong, and one such cache does exist
  — the web's own. `useHouseAreas.ts` keys `/house/away` by restaurant id
  alone; `AuthContext.logout` clears the tokens but not the React Query
  cache, and `Login.tsx` moves on with `navigate`, not a reload. So on a
  shared device, a staff sign-in to the same house after a manager's can be
  drawn the manager's cached answer (`canManage: true`, upcoming windows
  included) for as long as the refetch takes (`refetchOnMount: 'always'`
  shows cached data while it refetches, `App.tsx`). Every gateway response
  is right; the stale copy is the browser's. It is app-wide, every cached
  query and not only Away, so it is not fixed in this lane. Found by
  reading the code; not reproduced in a browser.]
- **Revisit when:** a house asks for an area outside the six (custom kinds), or
  shifts carry real rows (then a shift may delay an alert, never hide one).

## Round 2 — the founder's seven answers (2026-09-21)

The lane put the eight **Open** items below to the founder as seven questions
(item 7, retention and the notice, was put as one question about counsel). He
answered, 2026-09-21: *"Take all seven"*. Those are the options he picked,
bundled — not his own words for each. What each one is, and where it is:

1. **Everyone who would be alerted is Away → the owners' inbox, never waits
   unseen.** Confirmed built (step 3 of the ladder): `area-routing.spec.ts`
   "lands in every owner's inbox, silently, when everyone who could be alerted
   is Away".
2. **The lead is alerted together with the members, not after a delay.**
   Confirmed built (inside step 1): `area-routing.spec.ts` "alerts the lead
   together with the members, in the same step", which also asserts the
   decision has no second wave. The Away sentence now says "its lead included",
   never "then its lead" (`awayWords.ts`).
3. **A note or message sent to one person who is Away waits until they are
   back, and the sender sees "away until <date>".** Built:
   - *What holds.* A crew note (`NotesService.create`) and a manager's message
     to named people (`TeamController.broadcast` with `memberIds`) set apart
     each named person who is Away **today** (house-local day). They get
     nothing now — no inbox row, no push, no text. A window that starts later
     holds nothing sent today. A message to **everyone** is not held: the
     funnel routes it (see **Owed** for its push leg).
   - *Where it waits.* `house_away_held` (migration `20260921171000`, RLS on,
     service_role only). A note's words stay on `team_notes`; a message has no
     record of its own, so its title and body are kept in the hold **only
     until it is delivered**, then the row is deleted.
   - *What the sender sees.* Before sending, the note sheet marks each Away
     recipient "Away until 28 Sep" and says the note waits; after sending, the
     response's `away.held[]` carries the same sentence, a note's receipts are
     written `held_away` with it ("Away until 28 Sep. It waits and is delivered
     when they are back, outside their quiet hours."), and the certification
     renewal row shows it instead of "Sent just now". [Last call, 2026-09-21:
     the legacy shift desk (`pages/team/command/ManagerShiftDesk.tsx`, what
     `/team` draws while `mudavym_design_team` is off) does not: its
     one-person message still toasts "Message sent" when the gateway held it.
     Listed under **Owed**.]
   - *When "back" is.* `AwayReleaseService` sweeps every 15 minutes (not
     flagged: holding is live wherever Away is, so releasing must be too) and
     delivers on the first sweep of a house-local day that is not an Away day
     for them, **outside their own quiet hours**; ending or moving someone's
     Away off today releases at once under the same rule. It delivers exactly
     as the original send would have (a note through the same `deliver` path,
     rewriting its receipts), claims each row compare-and-set so two releases
     cannot both deliver it, and hands a failed delivery back for the next
     sweep. A person who left the house first is owed nothing: the hold is
     deleted and a note's receipts say why. [Last call, round 3, 2026-09-22:
     "cannot both deliver it" is true of two releases racing, not of one
     release that fails after delivering. If the row's delete fails after
     the delivery (`AWAY_HOLD_DELETE_FAILED`, logged, `away-hold.service.ts`
     `done`), or the process stops between the two, the claim goes stale
     after 30 minutes (`STALE_CLAIM_MS`) and the next sweep delivers it
     again. So a held item is delivered at least once, never at most once:
     a rare duplicate rather than a loss, the same side of the line as round
     3 answer 2's "nothing lost or late". *Built, not ruled.* Since round 3
     answer 1 this covers a held message to everyone too.]
   - *Failures.* An unreadable Away register holds nothing (the send goes to
     everyone now) and says so (`away.readable: false`); a hold that cannot be
     written is sent now instead of dropped (`away.holdFailed`); an unreadable
     Away, membership or quiet-hours read on release delays, never guesses.
   - *Built, not ruled, then ruled 2026-09-22 (round 3, "Keep all four"):* the
     quiet-hours wait on return, the 15-minute sweep, and "back" meaning the
     first non-Away house-local day — kept exactly as built (round-3 answer
     4). [Last call: also that an unreadable Away register sends the message
     now, to an Away person too, rather than holding it for everyone named —
     also kept, round-3 answer 2, "Send now", and now the rule for a send to
     **everyone** too, not only a named one; see **Round 3**.]
4. **The recommendations email digest pauses for a person while they are
   Away.** Built (`RecommendationDigestService`): judged on the day the letter
   **fell due**, not on the day it is swept, so a letter due on the last Away
   day and swept after midnight is still paused, never `expired`. A paused
   letter writes no row and is counted `pausedAway`; the first due day they are
   back is owed as before. An unreadable Away register fails open, loudly
   (`RECOMMENDATION_DIGEST_AWAY_UNREADABLE`), like the funnel. [Last call:
   *built, not ruled* — on that sweep an Away person's letter is sent. The
   other way is to defer every letter until the register reads again, which
   `expired`s them once the 12-hour late limit passes.]
5. **Staff also see a colleague's quiet Away marker — dates only, never a
   reason.** Built: `GET /house/away` answers every window in the house that has
   not ended [last call: under way **or still to come**, so staff also read a
   colleague's "Away from 3 Oct" before it starts, as managers already did —
   *built, not ruled*; **overturned 2026-09-22, round 3 answer 3, "Only once
   under way"**: owners and managers keep the window before it starts, but
   `listAway` now withholds a colleague's (never the reader's own) upcoming
   window from a staff reader, enforced in the response, not only by what a
   page draws — see **Round 3**] to everyone the rule still admits, with the
   roster's display name (so staff, who have no
   roster, can draw the marker; `namesReadable: false` when the names could not
   be read, never an empty list). Staff are not told who set a colleague's
   dates (`setBySelf` is absent for them). On the web, My shifts carries an
   "Away in the house" card with the same marker; it draws nothing while nobody
   else is away. *Built, then ruled 2026-09-22 (round-3 answer 4, "Keep all
   four," following answer 3):* that card is where staff meet the marker,
   because the staff surface draws no colleague names anywhere else today —
   and the card now mirrors answer 3's under-way-only rule for a colleague's
   window (owners and managers still see it there before it starts).
6. **Away lasts at most 366 days.** Confirmed built in the gateway, and now also
   in the table: `ck_house_away_at_most_366_days` (`away_until - away_from <=
   365`, both days inclusive), added in `20260921171000`.
7. **Only an owner can set or end another owner's Away; a manager can no
   longer.** Built: `mayChangeAway` in `house-areas.service.ts`, asked by both
   `setAway` and `endAway` about the target's role **in this house** (read the
   way the token reads one, `auth/house-role.ts`, so a legacy `users`-row owner
   counts). An unreadable role is a 503, never "not an owner". The roster's Away
   card shows a manager an owner's dates without the controls and says who can
   change them (`mayChangeAway` in `services/api/areas.ts`, a mirror; the
   gateway decides). CLAIMS `ADR-0218-ONLY-AN-OWNER-CHANGES-AN-OWNERS-AWAY`.

## Round 3 — the founder's four answers (2026-09-22)

Round 2's build left two of its own open questions ("For the founder" in the
lane's report) and marked four behaviours *built, not ruled*. The lane put all
six to the founder as four questions, his picks as the option labels below
(2026-09-22):

1. **A message to everyone while someone is Away.** *"Wait like named
   (Recommended)"* — no push to the Away person while Away; the message waits
   in their inbox and is released on their first day back, exactly like a
   named message (same release job).

   Before round 3, only a **named** send was held (round-2 answer 3); a send
   to **everyone** was routed by the funnel, which dropped an Away person's
   inbox row for good (never delivered) and — the "Owed" bug this closes —
   still pushed them. Both defects are gone the same way: `TeamController
   .broadcast` (`team.controller.ts`) now reads Away
   (`AwayHoldService.awayToday`) and holds **whichever** audience the sender
   chose, no `named &&` gate; the inbox write always addresses `reachNow` by
   `onlyUserIds`, so a held person's row is written once, by the release, not
   twice. An Away person swept up in "everyone" gets a `house_away_held` row
   (`kind: "team_message"`, same shape as a named hold) and is delivered by
   the same `AwayReleaseService` sweep, outside their quiet hours, on their
   first house-local day back — nothing new to build there, because the
   release never asked which audience a hold came from. CLAIMS
   `ADR-0218-A-BROADCAST-TO-EVERYONE-HOLDS-AN-AWAY-PERSON-TOO`. Behaviour:
   `team.controller.broadcast.spec.ts` "holds it for an Away person swept up
   in a send to everyone too".
2. **The Away list cannot be read, mid-send.** *"Send now (Recommended)"* —
   keep as built: nothing lost or late, the same rule the alert funnel
   already uses. Unchanged code, and now the SAME code path for both
   audiences (per answer 1): `AwayHoldService.awayToday` throwing or
   answering an error leaves `awayUntil: null`, nobody is held, and the send
   goes to everyone it names, now (`away.readable: false` says so). Test:
   `team.controller.broadcast.spec.ts` "sends to everyone now, and holds
   nobody, when Away cannot be read".
3. **Staff seeing a colleague's Away before it starts.** *"Only once under
   way (Recommended)"* — owners and managers still see a colleague's Away
   before it starts (unchanged); staff see it only once it is under way,
   enforced **server-side, in the API response**, not only by what a page
   chooses to draw — this overturns round 2's "last call" widening (built,
   not ruled, then), which had staff reading an upcoming window too.

   `HouseAreasService.listAway` now filters the rows it answers with before
   naming or mapping them: a manager or owner reader, or the reader's own
   window (whichever way it runs — this is a rule about a **colleague's**
   Away, never about the reader's own dates), passes unfiltered; a
   colleague's window otherwise passes only when `from <= today <= until`.
   Names are looked up only for the rows that survive the filter, so a staff
   reader's `GET /house/away` response never carries an upcoming colleague's
   dates or name — a client cannot draw what the API never sent. The web
   mirrors the same rule in `HouseAwayCard` (`AwayCard.tsx`), the way
   `mayChangeAway` is mirrored in `services/api/areas.ts`: never the only
   place it runs, but consistent with it. CLAIMS
   `ADR-0218-STAFF-SEE-AWAY-ONLY-ONCE-UNDER-WAY`. Behaviour:
   `house-areas.service.spec.ts` "lists every current-or-upcoming window for
   owners/managers; staff never learn who set a colleague's";
   `AreasAway.test.tsx` "never draws a colleague's window that has not
   started yet" / "draws an owner or manager's upcoming colleague window
   too".

   [Last call, 2026-09-22: `GET /house/away` was not the only response that
   carried an upcoming window. `GET /settings-audit` (the house log's read,
   behind the token and the tenant, no role gate) returned
   `away_set_for_member` to any member of the house: the colleague's name as
   `subject`, the dates as the field's new value (the shape is
   `"2026-10-03 to 2026-10-10"`) before the first day, and the manager who
   set it as `actor`. Found by reading the code, then pinned by a unit test;
   not exercised against a running gateway. That broke this
   answer, and also round 2 answer 5 ("staff are not told who set a
   colleague's dates") and round 1 ("staff see only their own
   memberships") for the area rows. Fixed in the query, not after it:
   `SettingsAuditService.list` takes the token's role
   (`SettingsAuditController`, `@CurrentUser("role")`) and asks only for
   `readBackActionsFor(role)`; anything but owner or manager, `admin` and
   no role included, is read as staff. No staff page reads that trail
   (`/team` draws My shifts for staff), so nothing a staff surface shows
   changes. CLAIMS `ADR-0218-STAFF-READ-NO-COLLEAGUE-AWAY-IN-THE-HOUSE-LOG`.
   Behaviour: `settings-audit.service.spec.ts` "what a staff reader is
   never handed", on a fake that honours `.in("action", …)`. What is still
   readable, and is not a window: the `/logs` timeline
   (`logs-timeline.service.ts` `fetchAuditLog`, any member of the house)
   lists `away_set_for_member on restaurant_member` with the colleague's
   user id and the time it was set. It carries no dates and no name. It is
   not changed here, because `/logs` reads every audit action for every
   member and gating it is not this lane's call.]
4. **The four behaviours built without a ruling.** *"Keep all four
   (Recommended)"*, with this answer **following answer 3**:
   - the held item may arrive outside quiet hours, but only after quiet hours
     end — kept exactly as built (round-2 §3's release-verdict order);
   - the release sweeps every 15 minutes — kept exactly as built;
   - "back" means the first house-local day that is not an Away day for
     them — kept exactly as built;
   - staff meet a colleague's marker on My shifts' "Away in the house"
     card — kept, but now narrowed by answer 3: the card draws a colleague's
     window only once it is under way for a staff viewer, and still draws it
     before it starts for an owner or manager viewer, because that is the
     same rule the API already enforces.

   No migration: none of the four needed a schema change. Migration band
   reserved for this lane (`20260922011000`–`20260922011099`) went unused.

## The lawyer's list (recorded, not built)

Put to counsel, not to a build, per the founder's round-2 pick:

- **Retention of the house-log rows** this ADR writes (`system_audit_log`:
  `house_area_changed` … `away_ended_for_member`): how long they are kept, and
  what is deleted or anonymised after.
- **The staff privacy notice** (KVKK aydınlatma metni) for Away and areas: what
  is kept (two dates and who set them; no reason), who sees it (since round 2,
  everyone in the house sees a colleague's dates; since round 3, staff see a
  colleague's only once it is under way, owners and managers see it before it
  starts too), and for how long.
- For the same review: a held message's title and body sit in
  `house_away_held` until it is delivered (at most the rest of an Away window,
  366 days), then are deleted.

## Open (for the founder; not decided here)

[All eight answered 2026-09-21 in round 2 — see **Round 2** and **The lawyer's
list**. Kept as they were asked, so the record shows what was chosen from.]

1. **Everyone Away → owners' inbox only** (step 3). Built so an alert always
   lands and no Away person is woken. Alternative: hold it until someone is back.
   [Ruled: owners' inbox, round 2 answer 1.]
2. **"Then its lead" as a time escalation** (members first, the lead after N
   minutes unacted) rather than inside step 1. Not built. [Ruled: together, not
   after a delay, round 2 answer 2.]
3. **Targeted messages during Away** (a manager's note or broadcast to one
   person) still reach them. Mute those too? [Ruled: held, delivered on
   return, and the sender sees "away until <date>", round 2 answer 3.]
4. **The recommendations email digest** (`recommendation-digest.service.ts`, a
   person's own subscription) still sends during Away. Pause it? [Ruled: it
   pauses, round 2 answer 4.]
5. **Staff seeing a colleague's Away marker.** Built: only owners, managers and
   the person see Away (judge §4.5). The founder's "on its name" may mean
   everywhere a name appears. [Ruled: staff see it too, dates only, round 2
   answer 5. Narrowed 2026-09-22, round 3 answer 3: a colleague's only once
   it is under way.]
6. **The longest Away window**: 366 days, an input guard, built not ruled.
   [Ruled: 366 days, round 2 answer 6; now in the table too.]
7. **Retention** of the log rows, and the KVKK notice text (judge §4.7) — still
   owed, with counsel. [On the lawyer's list, not a build.]
8. **A manager setting or ending an owner's Away.** Built: any owner or manager
   can set anyone's in the house, so a manager can quiet an owner's alerts for
   the dates. The owner is told at once and it is in the house log.
   Alternative: owners' Away is set only by owners. [Ruled: only by owners,
   round 2 answer 7.]

## Owed (the founder ruled it; this build did not reach it)

Found at last call, 2026-09-21, by reading every sender that writes a
notification row or a push outside `persistForRestaurant`'s broadcast path.
Each still reaches a person on their Away days:

- ~~**A manager's team message to everyone** (`team.controller.ts`, the push
  leg). Its inbox row goes through the funnel and now skips the Away person;
  its push does not. The worse half is the one that still arrives.~~
  [Round 2 held a message to **named** people; **closed in round 3, answer 1,
  2026-09-22, "Wait like named"**: a send to everyone now holds an Away
  person the same way, through the same table and release job, so neither
  half reaches them while they are Away — see **Round 3**.]
- **Calendar reminders** (`calendar-reminders.service.ts`). They build their own
  audience and write with `onlyUserIds`, so the funnel does not route them.
  The job is behind its own flag and off by default.
- **Two in-app writers that fan out to every member themselves**:
  `inbound-responder.service.ts` `persistManagerNotification` and
  `scheduled-tasks.service.ts` `persistRestaurantNotification` (rows only, no
  push).
- **The Away marker on names outside the roster, the Areas sheet and the Away
  card** — the week grid and the rest of the shell draw names without it.
  [Round 2 adds it to the note sheet's recipients and My shifts' "Away in the
  house" card; the week grid and the mobile app still draw names without it.]

Three of those four gateway files (the team controller, calendar reminders,
scheduled tasks) carry uncommitted changes in another lane's worktree
(`wt-fin-notify`) at the time of writing, so none of the four was edited here.
[Round 2 did edit `team.controller.ts` — answer 3 lives in `broadcast` — so
that lane's staged `team.controller.ts` and `team.controller.broadcast.spec.ts`
will conflict with this one at merge. Round 3 edits the same method again
(answer 1); not re-checked against `wt-fin-notify`'s current state from this
lane — the conflict was last confirmed live at round 2's last call,
2026-09-21.] [Last call, round 3, 2026-09-22, re-checked read-only: that
worktree still stages `team.controller.ts` and its broadcast spec. Its
change there is `channelOptOuts(userIds, rid)`: `TeamService.channelOptOuts`
gains a required house argument. `AwayReleaseService.deliver` in this lane
calls it with one argument, so whichever of the two merges second fails
`tsc` until that call passes `row.restaurant_id`.]

Also owed, though nothing reaches an Away person through it [last call,
2026-09-21]: the legacy shift desk's one-person message
(`pages/team/command/ManagerShiftDesk.tsx`, `doBroadcast`) toasts "Message
sent" when the gateway held it, and never shows `away.held[]`. So on that
page the sender does not see "away until <date>" (answer 3). [Last call,
round 3, 2026-09-22: its crew message to everyone too. The same
`doBroadcast` sends `audience: 'everyone'`, and since round 3 answer 1 that
send can hold an Away person as well, so it toasts "Message sent" over a
hold there too.]

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
- **Round 2 (2026-09-21), measured on the staged index tree**
  (`p4-scratch/verify_index.sh`):
  - gateway `team`, `areas`, `analytics/digest`, `notifications`,
    `settings-audit` and `calendar`: 44 suites, 732 tests passing;
  - web `pages/team`, `components/mudavym` and `pages/settings`: 21 files, 364
    passing, 8 skipped;
  - gateway `tsc` (source and specs) and web `tsc` clean; eslint clean on every
    changed file; `check_gateway_boots.sh` PASS.
- Migration `20260921171000`, round 2 (probe
  `p4-scratch/pglite-probe/AREAS2-held-for-away.mjs`): 194/194 migrations build
  and the file re-runs cleanly. 27 checks pass:
  - cross-house note or roster row → 23503; duplicate hold → 23505;
  - a message with no or blank words, or a note carrying words → 23514;
  - an `auth.users`-only person → 23503; deleting the note deletes its hold;
  - RLS on, and no client grant;
  - `held_away` admitted, the eight old states still admitted and `bogus`
    refused;
  - 366 days kept and 367 refused.
  Not Supabase: PGlite 0.5.8 as superuser.
- Round 2 mutations, every one red:
  - 28 code mutations (gateway 22, web 6). The first pass killed 27; the held
    note's strict inbox throw survived, so a test was added and it went red;
  - 6 migration mutations (4 turned a probe check red; 2 stopped the build
    through the file's own assertions);
  - 7 claim mutations on the two new CLAIMS rows, and both rows fail against
    origin/main;
  - 4 on the corrected `ADR-0218-AWAY-STORES-DATES-ONLY`, which had matched
    round 2's `ADD CONSTRAINT` as if it were a new column.
- **Round 3 (2026-09-22), measured on the staged index tree**
  (`p4-scratch/verify_index.sh`): `gw_tsc`, `gw_tsc_spec` and `web_tsc` clean;
  gateway `jest src/team src/areas` — 10 suites, 173 tests passing; web
  `vitest src/pages/team src/components/mudavym src/pages/settings` — 21
  files, 375 tests passing; `gw_eslint` and `web_eslint` on the four changed
  files, 0; `check_gateway_boots.sh` PASS; `check_decision_claims.sh` 413/413
  holding (413 claims, one header row); no duplicate migration prefix.
  `verify_index: ALL GREEN`. No new migration this round (see **Round 3**
  answer 4).
- Round 3 mutations, every one red, snapshot-restored with `cp -p` (never
  `git checkout`, per [[unstaged-file-mutation-snapshot-first]]):
  - two mutations on `team.controller.ts` — reintroducing the `named &&` gate
    on the Away read, and reintroducing the `named ? {...} : {}` branch on
    the inbox write — each turns `ADR-0218-A-BROADCAST-TO-EVERYONE-HOLDS-AN-AWAY-PERSON-TOO`'s
    verify red;
  - two mutations on `house-areas.service.ts` — dropping the reader's-own-window
    exemption, and dropping the `activeNow` check entirely — each turns
    `ADR-0218-STAFF-SEE-AWAY-ONLY-ONCE-UNDER-WAY`'s verify red; the first
    attempt at this claim (checking for the bare substring
    `manager || r.user_id === actor.userId` anywhere in the function) passed
    on the mutated file because `listAway`'s `setBySelf` line carries the same
    substring — the claim was rewritten to isolate the filter's own block
    before either mutation was tried again, and both new claim rows fail
    against `origin/main` (`house-areas.service.ts` does not exist there —
    ADR 0218 is unmerged).
- Guards run in the worktree, all exit 0: `check_adr_numbers_unique.py`,
  `check_citation_pairing.py`, `check_no_conflict_markers.py`,
  `check_od_ids_exist.py`, `check_migration_versions_unique.py` ("Checked
  against origin/main + 57 other open PR(s)"), `check_flag_readby_anchors.py`
  ("7 ACTIVE flag anchors all resolve to real gates" — unaffected; this round
  touches no flag).
- **Last call, round 3 (2026-09-22)**, on the staged index tree
  (`verify_index.sh`): `gw_tsc`, `gw_tsc_spec` and `web_tsc` clean; gateway
  jest over `src/team src/areas src/settings-audit src/settings
  src/notifications` — 39 suites, 590 tests passing; web vitest over
  `src/pages/team src/components/mudavym src/pages/settings` — 21 files,
  367 passed and 8 skipped (375); `gw_eslint` on the changed gateway files,
  0; boots PASS; claims 414/414 holding; no duplicate migration prefix.
- Last-call mutations, snapshot-restored with `cp -p`:
  - `readBackActionsFor` answering the whole trail to every role: 5
    staff-reader cases red in `settings-audit.service.spec.ts`;
  - `broadcast` pushing a send to everyone to `targets` instead of
    `reachNow`, so the Away person is pushed: "holds it for an Away person
    swept up in a send to everyone too" red;
  - four mutations of the new CLAIMS row, each red: the owner/manager test
    widened to every role, `away_set_for_member` dropped from
    `STAFF_WITHHELD_ACTIONS`, the query back on `READ_BACK_ACTIONS`, and the
    controller no longer passing the role.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | judge (areas-judge.md) | v0 attacked (A1–A11), v1 recommended |
| 2026-09-21 | founder | Areas "their area first" accepted; lead "Yes, cards only"; Away dates with override |
| 2026-09-21 | areas lane | Built; Open items above left for the founder |
| 2026-09-21 | last call | "nothing reaches them" was broader than the code: Away copy made "most alerts", **Owed** added; the Areas sheet no longer says an empty area's alerts go to owners and managers while nobody is in any area; a failed Away read now says so on the roster, the Areas sheet and My shifts |
| 2026-09-21 | founder | Round 2: *"Take all seven"* — the eight Open items answered; retention and the notice to counsel |
| 2026-09-21 | areas lane, round 2 | Built answers 3, 4, 5, 7; confirmed 1, 2, 6 (6 now in the table too); the lawyer's list recorded; CLAIMS `ADR-0218-AWAY-STORES-DATES-ONLY` narrowed to columns (it read round 2's CHECK as a column) |
| 2026-09-21 | last call, round 2 | Re-ran 7 suites (183 tests) and 3 fresh mutations (quiet-hours verdict, push opt-out on release, membership on release), all red. Prose made as narrow as the code: staff read upcoming windows too; the digest's and the named send's fail-open marked *built, not ruled*; the legacy desk's "Message sent" and the release/funnel membership split recorded |
| 2026-09-22 | founder | Round 3: four questions, each answered *"(Recommended)"* — "Wait like named"; "Send now"; "Only once under way"; "Keep all four" (see **Round 3**) |
| 2026-09-22 | areas lane, round 3 | Built answers 1 and 3 (`team.controller.ts` broadcast, `house-areas.service.ts` listAway, `AwayCard.tsx`); recorded answers 2 and 4 (no code change — both already matched what was built). Two CLAIMS rows added and mutation-tested; the **Owed** push-leg-to-everyone item closed in place |
| 2026-09-22 | last call, round 3 | Found `GET /settings-audit` (no role gate) handing staff a colleague's `away_set_for_member` row, with the dates before they start and who set them, and the area rows: fixed in the query (`readBackActionsFor`, `STAFF_WITHHELD_ACTIONS`), CLAIMS `ADR-0218-STAFF-READ-NO-COLLEAGUE-AWAY-IN-THE-HOUSE-LOG`. Recorded, not changed: `/logs` still lists the action and the colleague's id, with no dates or name; the web's query cache outlives a sign-out; a release that fails after delivering delivers again (at least once); the legacy desk's crew message toasts over a hold too. Three code comments that still said "named only" corrected |
