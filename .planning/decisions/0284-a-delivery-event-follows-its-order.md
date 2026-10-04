# 0284 — A delivery event follows its order, and the table keeps it so

- **Status:** Proposed (2026-10-03). The trigger-versus-gateway choice (fork 4) follows the founder's ADR 0125 Q2 answer and is recorded here as Proposed so he can overturn it; forks 1–3 are open and wait on him. Who builds the door-path close is answered (founder, 2026-10-04, quoted under "Founder answers this rests on").
- **Date:** 2026-10-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** calendar_events, delivery event, procurement_orders, expected_delivery_date, delivered_at, trigger, AFTER UPDATE, AFTER INSERT, sync_calendar_dates_trigger, reminder_enabled, createCalendarEventForOrder, closeDeliveryCalendarEvent, F-152, A-034, C16, AW10, procurement_agent, tags
- **Links:** supersedes the closing half of [[0073-a-delivery-event-is-closed-by-its-order-id]]; keeps [[0066-order-delivery-event-vocabulary]] (the writer and its "never fail an order over a calendar row" rule); precedent [[0125-an-order-changes-state-through-a-sealed-transition]] Q2 (`:332`) ("Enforce the table as a database trigger"); ADR 0267 ruling 1 "At the door" (on wt-review-3, not on main at the time of writing); migration `a_delivery_event_follows_its_order`; branch `fix/delivery-events-follow-the-order`

## Context

The owner-quarter simulation on Tuzlu Rüzgar (read-only, 2026-10-03, F-152 /
A-034, register cluster C16) found **534 of 534** October delivery events
`pending`, every one dated 9 October at 10:00, and **87 of 87** whose orders
were read already `COMPLETED`. Three defects produce that picture, cited at
`origin/main` 8c673db4b:

1. **Placement ignores the order.** `createCalendarEventForOrder` put every
   event at approval + 7 days (`procurement.service.ts:7013`) although the
   order row has its own `expected_delivery_date` (written at `:1278`). A
   batch approved on one day landed on one day.
2. **Only two doors close an event.** `cancelOrder` (`:3722`) and
   `markDelivered` (`:5642`) called ADR 0073's closers. Orders also arrive
   through the receiving door (`receiving.service.ts:565-566` writes
   `PARTIALLY_RECEIVED` and `delivered_at`), the order edit, the agents and
   the SQL console, and none of those touched the event.
3. **The delivered close never moved the date.** `closeDeliveryCalendarEvent`
   wrote only `status` and `description` (`:3932-3933`), so even a closed
   event stayed on the estimated day.

A fourth, adjacent, from code: `services/agent-orchestrator/agents/procurement_agent.py:928-962`
(`_cancel_order_calendar_event`) still selected `id, tags` from
`calendar_events` (no such column), filtered on uppercase statuses the table
never holds, and swallowed the error — the exact fault ADR 0073 removed from
the gateway, left alive in Python. The out-of-stock cancel at `:855` writes
`CANCELLED` straight to Supabase and never reaches the gateway.

## Options considered

1. **A table trigger (chosen, fork 4 (a)).** One SQL function, reached from an
   `AFTER UPDATE OF status, delivered_at` trigger on `procurement_orders` and
   an `AFTER INSERT` trigger on `calendar_events`. Every writer in every
   language is covered, including Python, the simulation harness and the
   console. The founder answered this class in ADR 0125 Q2 for the same
   reason: the service cannot reach `procurement_agent.py`.
2. **Gateway-only helper (fork 4 (b)).** Call one shared closer from
   `markDelivered`, `cancelOrder`, `verifyReceipt`, `recordDoorReceipt` and
   `updateOrder`, and fix the Python helper separately. Rejected: it misses
   every writer outside the gateway, it would edit `receiving.service.ts:567-601`
   which R3 is rewriting uncommitted in wt-review-3, and it still misses an
   event written after its order has already closed (approveDraft writes the
   event when the vendor letter goes, whatever the order's state by then).
3. **Keep the TypeScript closers beside the trigger.** Rejected: two writers of
   one rule drift (ADR 0073 recorded exactly that drift between its two
   closers), and the TypeScript close would race the trigger's with a
   different description.
4. **A BEFORE INSERT rewrite on `calendar_events`.** Rejected: it would have to
   duplicate the order read and the rule for one entry point, and a BEFORE
   trigger that raises fails the insert, which ADR 0066 forbids.
5. **Do nothing.** Every delivery event stays pending on the estimate for as
   long as the house runs, the reminder sweep keeps announcing deliveries that
   came weeks ago, and the dashboard's week panel lists them as coming.

## Decision

**A delivery event is placed on the date its order states, and the table keeps
it in step with the order from then on.**

The rule, in `public.delivery_event_follows_its_order(order, house)`:

| The order is | The event becomes |
|---|---|
| open (any non-terminal state before the goods arrive) | untouched: `pending` where it was placed |
| arrived — `DELIVERED`, `PARTIALLY_RECEIVED`, `COMPLETED`, with `delivered_at` | `completed`, moved to the arrival's house-local date and time (minute), reminder off; a house with no zone set, or one Postgres cannot read, lands on UTC and the text says which |
| arrived, `delivered_at` empty | `completed`, date kept, and the text says the order does not record when it arrived |
| not coming — `CANCELLED`, `FAILED`, `REJECTED` | `cancelled`, date kept, reminder off; a `completed` event is never cancelled |

Reasoning that carried it:

- **Placement.** `createCalendarEventForOrder` takes the order's
  `expected_delivery_date` (read off the row in `approveDraft`, since
  `OrderResponseDto` does not carry it), cut to `YYYY-MM-DD`; a value that is
  not a real day counts as no date. With no date it keeps approval + 7 (fork 2
  recommendation (a)) and the event text says "estimated 7 days after
  approval; the order states no date" instead of reading like a date someone
  gave. No ADR locks +7: ADR 0066 cites it only as context for `pending`.
- **The arrived and not-coming sets are generated, not typed.** They are
  `ORDER_GOODS_ARRIVED_STATUSES` and `ORDER_TERMINAL_STATUSES` minus it, from
  `order-transitions.ts`, sorted; `order-calendar-event-lifecycle.spec.ts`
  renders both and asserts the migration holds them character for character.
- **`PARTIALLY_RECEIVED` closes the event** because the delivery happened at
  the door (ADR 0267 ruling 1, "At the door", which names F-152). Whatever is
  still owed shows on `/orders` (fork 3 recommendation (a)).
- **ADR 0073 is kept where it was right**: matched by `order_id` (never a
  `tags` scan), in the order's house, in the calendar's lowercase vocabulary,
  and with its asymmetry — an arrival completes even a cancelled event (the
  goods are on the shelf), a cancellation never touches a completed one, and a
  cancelled event keeps its first reason.
- **ADR 0066's "never fail an order over a calendar row"** is kept as a caught
  exception in both trigger functions: the order write stands and Postgres
  raises a `WARNING` naming the order. The helper itself raises, so a future
  direct caller (the backfill of fork 1) fails loudly.
- **The `sync_calendar_dates_trigger` trap.** That BEFORE trigger
  (`20260805000000_baseline_from_production.sql:1716-1738`, `:12118`) copies a
  non-null `start_time` over `event_time` on every UPDATE and `start_date`
  over `event_date` when it changes. Writing `event_date`/`event_time` alone is
  silently reverted, so every move writes both pairs.
- **Reminder off on close** — a design addition beyond the lane plan. The
  reminder sweep skips only `cancelled` and `dismissed`
  (`calendar-reminders.service.ts:263-265`), so a `completed` delivery with its
  reminder on would still be announced.
- **Idempotent by state.** An arrival rewrites only an event whose status or
  date/time differs, so `PARTIALLY_RECEIVED → COMPLETED` with the same
  `delivered_at` writes nothing; a `delivered_at` correction moves the event.
- **Invoker rights**, `search_path = public, pg_temp`, execute granted only to
  `service_role`, the repo's function pattern. The house's zone is read from
  `restaurants.timezone`. A zone that is not set (null since ADR 0116) or that
  Postgres cannot read falls back to UTC, and the event text says which:
  "(UTC; the house has no time zone set)" or "(UTC; the house's time zone could
  not be read)". This follows, as precedent, the founder's ruling on the
  low-stock digest hour for a house with no zone, "UTC, said on the page
  (Recommended)" (ADR 0149, 2026-09-27, item 61), rather than a bare "(UTC)"
  that reads as a zone somebody chose. That ruling was given for the digest,
  not for calendar events; this ADR applies it and does not widen it.

The gateway's `closeDeliveryCalendarEvent`, `cancelCalendarEventForOrder`,
`updateCalendarEventForDelivery` and `TERMINAL_CALENDAR_STATUSES` are removed
and each call site carries a pointer to the migration. The Python
`_cancel_order_calendar_event` and its call are removed, and the manager's
out-of-stock message no longer says the delivery was "removed from calendar"
(it is marked cancelled there, by the table).

## Consequences

- Every path that moves an order now moves its event, including ones nobody
  has written yet. A new arrival path needs no calendar code.
- An event written for an order that has already arrived or been cancelled is
  closed at birth (the `AFTER INSERT` trigger).
- **Quieter failure.** A calendar failure is a Postgres `WARNING` in the
  database log, not the gateway's `logger.error` — quieter than ADR 0066's
  bar. Accepted because the alternative fails the order write; named so it is
  not mistaken for health.
- The delivered event's text no longer states the ordered quantity
  ("Delivered: ORD-…, arrived 2026-10-14 16:05 (Europe/Istanbul).").
- A later edit of `expected_delivery_date` on an open order does not move its
  pending event; only status and `delivered_at` moves are followed.
- Events written before this change stay as they are until fork 1 is
  answered: on Tuzlu Rüzgar, the 534 stale pending events.
- Revisit if: a writer needs the order write to fail when the calendar cannot
  follow; or the arrived/terminal sets in `order-transitions.ts` change (the
  spec fails until the migration is regenerated by a new migration).

### Hand-offs, not built here

- The dashboard's week panel draws no event status (`apps/web/src/pages/dashboard/next/RailPanels.tsx:76-87`),
  so a cancelled delivery still reads as coming there.
- The calendar list read defaults to 100 rows (`calendar.service.ts:275`), a
  C15-class cap; `/calendar` asks for 500. AW12: the month read pulls every
  full row.
- The canonical delivery path does not move the order itself; whatever moves
  the order moves the event.

## Founder answers this rests on (verbatim)

- **Who builds the door-path close (2026-10-04 01:56Z, AskUserQuestion,
  session 05c659bb).** Asked: "[SPLIT] Two of my lanes touch the door, which
  you gave to R3 on 10-02: 'doortime' (delivered_at keeps the arrival time,
  your 72 h rule) and the door-path close in 'events' (a delivery's calendar
  event closes when the door receipt is signed). R3 is offline and has no
  door-release PR yet. Who builds them?" Picked: **"You build, R3 rebases
  (Recommended)"**, whose option read: "I build both now, keep the edits
  surgical, and merge after the audit. R3's later door-release PR (release and
  close at the door) builds on top. 'events' still waits for #592 (event-prep
  mail off) before merging." Built so: the door-path close is the
  `PARTIALLY_RECEIVED` arm of the trigger, and this branch edits no receiving
  file, so R3's door-release PR rebases on it without a conflict. #592 merged
  as 619a068a9 on 2026-10-04, so the merge-order condition is met; the branch
  is cut at 8c673db4b and still has to take main before it merges.
- **Door versus verify (2026-10-02, AskUserQuestion, recorded in memory
  `founder-answers-2026-10-02-sim-share-out` and in ADR 0267 ruling 1 on
  wt-review-3, not on main).** Picked: **"At the door (Recommended)"**. It is
  why `PARTIALLY_RECEIVED`, the status every door receipt writes, completes the
  event.
- **The Tuzlu repair precedent (2026-10-02, same record).** Picked: **"Yes,
  dry-run first (Recommended)"**. It is the precedent behind fork 1's
  recommendation.
- **A house with no time zone (2026-09-27, ADR 0149 item 61, asked about the
  low-stock digest hour).** Picked: **"UTC, said on the page (Recommended)"**.
  Applied here as precedent: it is why the event text says when a house has no
  zone set. Whether it binds calendar events was not asked.
- **`DELIVERED` on `/orders` (2026-10-03, F-140 re-ask, same memory record).**
  Picked: **"Open, 'Not counted yet' (Recommended)"**: an order the vendor
  reports delivered, not yet counted at the door, is listed as open on
  `/orders`. That ruling is about the order list, and this ADR does not change
  it. The calendar event of a `DELIVERED` order was already completed by ADR
  0073's `markDelivered` closer; here it is still completed, and now also
  moved to `delivered_at`. If the founder reads "At the door" as "the calendar
  event closes only at the door", `DELIVERED` leaves the arrived set; that has
  not been asked.

## Open forks (the founder's)

1. **Repair the events written before this fix?** About 534 at Tuzlu Rüzgar,
   plus any at other houses. (a) a backfill in this migration, applied at merge
   with no dry run; **(b) a follow-up PR whose body shows a read-only dry-run
   count and sample, and merging it is the founder's yes** (recommended: his
   2026-10-02 Tuzlu repair ruling, "Yes, dry-run first", and it leaves the
   halted simulation's W10 evidence untouched until he chooses); (c) leave them.
   This migration has no backfill.
2. **Where does an event go when the order states no date?** **(a) approval +
   7, labelled as an estimate** (recommended, built); (b) the vendor's
   `lead_time_days`, though ADR 0111:145 found it set on 11 of 21 vendors and
   4 of those exactly the column default of 7; (c) no event until a date is
   stated.
3. **Does a short count at the door open a new event for what is still owed?**
   **(a) No; the event closes at the door and the backorder shows on
   `/orders`** (recommended, built: no date for the remainder exists anywhere);
   (b) yes, a new pending event at +7 or undated.
4. **Trigger or gateway?** Built as (a), the trigger, on the ADR 0125 Q2
   precedent. If he rejects it, the closing half is redone as the gateway-only
   helper of option 2 and the Python fix stands alone.

## Verification

- `supabase/tests/<version>_a_delivery_event_follows_its_order_test.sql`, run on
  a full-corpus PGlite build (every migration on the branch, 285 files). The
  test ends in a verdict that raises unless all 16 cases ran and every one is
  true. The control without the migration (284 files) passes 3 of 16 (T10,
  T14, T15 hold by construction), and its verdict raises. With the migration,
  16 of 16 pass, and the migration re-applies cleanly. Eight mutations of the
  migration are each caught: no INSERT trigger (by the in-file assertion, at
  build), `event_time` without `start_time`, no not-coming branch, the
  trigger's catch removed, no zone fallback, house scope dropped, a no-zone
  house labelled a bare "UTC" (T16), and a cancellation that overwrites a
  completed event (T8). Re-run 2026-10-04 at 0844786f0 plus the no-zone change.
- `order-calendar-event-lifecycle.spec.ts` (14) pins the SQL; ten mutations of
  the migration are each caught by exactly one case, and the file fails to load
  without the migration.
- `order-calendar-event.spec.ts` (15 new) and
  `tests/approve-draft-concurrency.spec.ts` (2 new) pin placement. Run with
  `origin/main`'s service swapped in, those 17 and the lifecycle spec's gateway
  case fail (18 of the three files' 110) and every pre-existing case passes.
- `tests/test_procurement_agent_vendor_decline.py` pins that the agent no
  longer touches `calendar_events`; it fails against `origin/main`'s agent.
- PGlite is PostgreSQL 18 as superuser with the Supabase platform stubbed; no
  production database was read or written.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | settle pass (lane `events`) | No independent verify had run; a re-run of the build agent was interrupted with one uncommitted edit, the SQL test's verdict block, which was checked on PGlite and kept (0844786f0). Added: a house with no zone set is labelled "UTC; the house has no time zone set" (ADR 0149 item 61) with test T16; the founder answers above, quoted verbatim, including the 2026-10-04 door split. `check_adr_numbers_unique.py` re-run before commit. |
| 2026-10-03 | — | Created on `fix/delivery-events-follow-the-order` (lane `events`). Numbered 0284, a gap, after three collisions with parallel lanes: the lane plan's 0271 went to `logs`, 0289 was held in wt-fix-stateeditor, and 0290 then appeared in wt-fix-dash (the plan's number for that lane). At the last check (origin/main 619a068a9) `check_adr_numbers_unique.py` gave next free 0292 across 1648 refs, worktrees held 0270-0273, 0277, 0281 and 0285-0292, and 0284 was on no ref, in none of 212 worktrees, and cited nowhere on origin/main, in a wt-fix-* decisions folder or in the lane plan. The migration version moved likewise from 20261215100000, which two other lanes hold. Re-check both at merge. |
