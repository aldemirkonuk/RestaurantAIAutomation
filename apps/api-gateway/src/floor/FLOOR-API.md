# Floor API (ADR 0345)

The gateway half of the Floor Checker port. Spec: ADR 0345 (Decision, Role map,
Reuse map, E1–E9), with ADRs 0347, 0350–0353. Code: this folder.

## Rules that hold on every route

- **Guards, in order:** `JwtAuthGuard`, `RolesGuard`, `FloorEnabledGuard`.
  A wrong role gets **403**, whatever the switch says. A house whose
  `restaurant_feature_flags.floor_checker` is off gets **404**, and so does an
  unreadable switch (E7).
- **The house** is always the token's `restaurantId`, never a URL or body value
  (ADR 0164). A role other than owner, manager or staff gets 403.
- **Every figure** is computed by `@wineops/floor-core` (E1).
- **Party size** is `null` unless someone entered it. Nothing guesses a seat (E9).
- **No time zone:** routes that need a service date answer
  `409 { code: "HOUSE_ZONE_NOT_SET" }`. The report answers 400 with the same
  code. Nothing falls back to UTC (ADR 0351).
- **Timestamps** are ISO `timestamptz` strings. Ids are UUIDs.

## `/floor/me`: the waiter's phone

Admits owner, manager and staff. Returns no figures.

| Method | Path | Body | 200/201 shape |
|---|---|---|---|
| GET | `/floor/me/tables` | | `{ tables: [{ tableId, label, seats, seatingId, partySize, paid, status: "fresh"\|"warn"\|"late"\|"idle", statusLabel }] }`, only the tables the caller holds |
| POST | `/floor/me/seat` | `{ tableId, partySize? (1–200) }` | `{ seatingId, tableId, partySize }`. 409 if the table is already seated or hidden |
| POST | `/floor/me/seatings/:id/visit` | | `{ visitId, seatingId }` |
| POST | `/floor/me/seatings/:id/paid` | | `{ seatingId, paid: true, already }`. Idempotent. Stops the late clock; does not end the seating |
| POST | `/floor/me/seatings/:id/paid/undo` | | `{ seatingId, paid: false }`. Allowed for the table's waiter, its cover, or an owner/manager; anyone else gets 403. The clock restarts from the undo |
| POST | `/floor/me/seatings/:id/leave` | `{ confirmShort?: boolean }` | `{ seatingId, left: true, quickLeave }`. A very short stay answers `409 { code: "CONFIRM_SHORT_VISIT" }` until `confirmShort: true` is sent |
| POST | `/floor/me/food-up` | `{ tableId, course?: "drinks"\|"starters"\|"mains"\|"dessert"\|"other", note? (≤400) }` | `{ foodUpId, tableId, pushed: { sentTo, notSent, reason } }` |
| POST | `/floor/me/food-up/:id/ack` | | `{ foodUpId, acknowledged: true }` |
| POST | `/floor/me/clock-in` | | `{ punchId, clockedInAt }` |
| POST | `/floor/me/clock-out` | | `{ punchId, clockedOutAt, reason }` |
| POST | `/floor/me/on-break` | `{ coverUserId? }` | Same shape as clock-out, with reason `break`. Records who covers; the cover must be a member of the house |
| POST | `/floor/me/back` | | Same shape as clock-in: opens a new punch |
| GET | `/floor/me/out-tonight` | | Tonight's live marks: `{ serviceDate, items: [{ id, menuItemId, name }] }` |
| GET | `/floor/me/notes` | | `{ notes: [...] }`: the caller's manager notes in this house |

## `/floor`: owners and managers

Every figure route and every admin route admits **owner and manager only**.
`floor/floor-roles.spec.ts` checks that a staff token is refused on each one.

| Method | Path | Body / query | Shape |
|---|---|---|---|
| GET | `/floor/board` | | `{ serviceDate, zoneSet, warnAfterMin, lateAfterMin, tables: [{ tableId, label, seats, sectionId, holders: [{ userId, name }], seatingId, seatedAt, seatedBy, partySize, paidAt, paidSource, minutesSinceVisit, status, statusLabel }], waiters: [{ userId, name, liveOnTimePct, gaps, notClosed, avgGapMin, onTimePct, overdueGaps, score, band, bandLabel }] in floor-core `sortByScore` order (best first, ties on userId, no score last; no rank field) }` |
| GET | `/floor/report?date=YYYY-MM-DD` | defaults to today's service date | `{ serviceDate, window: { start, end }, measuredTo, warnAfterMin, lateAfterMin, waiters: [...as on the board without liveOnTimePct, same order], notClosed: { total, unassigned }; a seating's open gap ends at its caretaker's last floor tap that day (`floor_visits` and table taps in `floor_events`); `notClosed` counts seatings with neither Paid nor leave, beside the caretaker at seat time, timeline: [{ seatingId, tableId, tableLabel, tableHidden, seatedAt, seatedBy, partySize, paidAt, paidSource, leftAt, visits: [{ at, by }] }] }` |
| GET | `/floor/report/seatings.csv?date=` | | `text/csv` attachment. A cell that starts with `= + - @` is written as text |
| GET | `/floor/report/waiters.csv?date=` | | `text/csv` attachment; last column `not_closed` |
| GET | `/floor/sections` | | `{ sections: [{ id, name, sort, tableIds }] }` |
| POST | `/floor/sections` | `{ name (1–60), sort? }` | `{ id, name, sort }`. 409 if the name is already used |
| PATCH | `/floor/sections/:id` | `{ name?, sort? }` | `{ id, name, sort }` |
| DELETE | `/floor/sections/:id` | | `{ id, archived: true }`. The section is archived, not deleted, and its live assignments are released |
| PUT | `/floor/sections/:id/tables` | `{ tableIds: [] }` | `{ sectionId, tableIds }`. Replaces the section's tables. A table belongs to one section at most |
| GET | `/floor/assignments` | | `{ serviceDate, assignments: [{ id, user_id, section_id, table_id, service_date, source, started_at }] }` |
| POST | `/floor/assignments` | `{ userId, sectionId \| tableId }` | `{ assignmentId }`. Assigning a table releases its current holder |
| DELETE | `/floor/assignments/:id` | | `{ assignmentId, released: true }` |
| POST | `/floor/reassign/propose` | `{ fromUserId }` | `{ fromUserId, proposals: [{ tableId, toWaiterId \| null, reason }] }`. Writes nothing |
| POST | `/floor/reassign/apply` | `{ fromUserId, moves: [{ tableId, toUserId }] }` | `{ fromUserId, applied: [{ tableId, toUserId, assignmentId }] }` |
| GET | `/floor/settings` | | `{ warnAfterMin, lateAfterMin, zoneSet }` |
| PUT | `/floor/settings` | `{ warnAfterMin (1–120), lateAfterMin (2–240) }` | The same values back. Late must be later than warn |
| GET | `/floor/pos-links` | | `{ links: [{ id, source, till_server_id, till_server_name, user_id, state, proposed_at, proposed_reason, confirmed_at, unlinked_at }] }` |
| POST | `/floor/pos-links/:id/confirm` | `{ userId? }` | `{ id, state: "confirmed", userId }`. Must name a member of the house |
| POST | `/floor/pos-links/:id/unlink` | | `{ id, state: "unlinked" }` |

**Out tonight.** These two routes also admit staff at the role gate. The
service then admits only owners, managers, and leads of the kitchen or bar
area. This is open as OD-242 (the executor's reading under OD-242).

| Method | Path | Body | Shape |
|---|---|---|---|
| POST | `/floor/out-tonight` | `{ menuItemId \| label }` | `{ id, serviceDate }` |
| POST | `/floor/out-tonight/:id/back` | | `{ id, back: true }` |

Every manager write adds a row to `system_audit_log`, with `entity_type` set to
one of `floor_section`, `floor_assignment`, `floor_settings` or
`pos_server_link`.

## Socket events (E2)

| Event | Room | Payload |
|---|---|---|
| `floor:changed` | `restaurant:<id>` (staff are in this room too) | `{ event: "FloorChanged", data: { tableId \| null, word }, timestamp }` |

`word` is one of: `seated`, `visited`, `paid`, `paid_undone`, `left`,
`food_up`, `food_ack`, `assigned`, `released`, `sections_changed`,
`out_tonight_changed`.

The event never carries names, minutes or figures. When a client receives it,
it fetches again: `/floor/me/tables` on the phone, `/floor/board` on the
manager view. Because the board read is role-gated, no per-name payload is
sent on the socket at all. If one is added later, it must go through
`emitToHouseRoles`.

## Pushes (ADR 0352)

Pushes use web push only, through the existing device store
(`NotificationsService.sendWebPushReported`). Every push has
`ttl = late_after_min × 60` (at least 60 s), urgency `high`, and a 10 s
timeout.

- **Staff copy:** the title is the house name. The body is
  `Table <label> · Food up | Late | Needs a visit`. The data is
  `{ url: "/floor/me", restaurant_id, table_id }`. It never contains minutes,
  names or notes.
- **Manager copy:** the same, with a reason added to the body.

## Nudge scanner (E3)

`FloorNudgeScanner` runs at second 0 of every minute.

- **Lock:** each tick inserts a `floor_nudge_ticks` row for the minute. Only
  the replica whose insert wins runs that tick.
- **Which houses:** only houses with the switch on and a time zone set.
- **Late tables:** every open seating that is unpaid and late. Its claim key is
  `late:<seating>:<anchor>:<floor(minutesLate/15)>`.
- **Food up:** every Food up that has not been acknowledged climbs at
  `warn_after_min` and again at `late_after_min`. Its claim key is
  `food_up:<event>:<threshold>`.
- **Claiming:** a claim is an insert into `floor_nudge_sends`, keyed on
  (house, key, person). If the row already exists, nothing is sent.
- **Who gets it:** each holder who is not on break, or the cover that holder
  named. If nobody can be reached, the alert goes to owners and managers as
  `manager_step`. This is open as OD-236.

## Not built here

- Automatic Paid from the till (ADR 0353).
- Merge and split routes. The tables exist; the routes do not.
- Linking a punch to a shift.
- ADR 0351's full service-day rule and absence chain, including presence reads,
  Away, quiet hours and the last-step notification row.
- Expo pushes (OD-237).
- The web client.
