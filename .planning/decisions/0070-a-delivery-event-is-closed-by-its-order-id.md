# 0070 — A delivery event is closed by its order id, in the calendar's own words, once

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** calendar_events, cancelCalendarEventForOrder, updateCalendarEventForDelivery, closeDeliveryCalendarEvent, order_id, 42703, tags, CalendarEventStatus, absence reported as health, silent failure, duplicate implementation, procurement
- **Links:** [[0066-order-delivery-event-vocabulary]] (opened this event; named these two as the immediate follow-up), [[0068-calendar-events-recurring-order-link]] (the recurring half, PR #234), [[0058-order-status-is-an-enum-not-a-string]], [[0056-order-paths-write-columns-that-exist]], PR #232

## Context

[[0066-order-delivery-event-vocabulary]] repaired `createCalendarEventForOrder`,
which had never once written a row. Its consequences section flagged, in red,
that the two functions which **close** that event's lifecycle were still broken
and that the fix had just made them matter:

> `updateCalendarEventForDelivery` and `cancelCalendarEventForOrder` both find
> the event by `.select("id, tags")` and both write uppercase
> `COMPLETED`/`CANCELLED`. Until now this cost nothing, because there was never
> an event to find.

Both carried the same two faults, and one more that only became visible once
they were read side by side.

**1. A scan of a column that does not exist, whose failure was discarded.**
Each selected `id, tags` and JSON-parsed `tags` looking for an `order_id`.
`calendar_events` has no `tags` column (baseline
`20260805000000_baseline_from_production.sql:2341-2375`; verified absent in
production 2026-09-01 by [[0056-order-paths-write-columns-that-exist]]), so
PostgREST answered `42703` for the whole query. The destructure took only
`data`. Supabase **returns** `{data, error}` rather than throwing, so the
wrapping `try`/`catch` was inert for precisely the error that was occurring:
`events` came back `undefined`, `(events || [])` was empty, `.find()` returned
nothing, and the function returned having done nothing — **indistinguishable
from a run that legitimately found no event.** `absence-reported-as-health`
class **O**, the same shape as the writer 0066 fixed.

**2. An invented vocabulary.** Both wrote and filtered on uppercase
`COMPLETED`/`CANCELLED`. The column carries no CHECK, so the write would have
*succeeded* and produced a row no reader recognises, while the filters matched
nothing. The real vocabulary is `CalendarEventStatus`
(`apps/api-gateway/src/calendar/dto/calendar.dto.ts:36-42`) — all lowercase —
and production holds `active`, `completed`, `pending` (19 rows, measured against
`exzueerziesmczwlhomd` on 2026-09-02).

**3. The same job, written twice, already drifted.** The two are one operation
in two directions, and each had its own copy of the query, the tags scan, the
match loop, the update and the logging. They had already diverged in a way
neither recorded: `cancelCalendarEventForOrder` excluded the terminal statuses
with `.not("status", "in", ...)`, `updateCalendarEventForDelivery` with
`.neq(...)` — different filters, different exclusion sets, no reason given for
either. Neither had ever run, so nothing surfaced the divergence.

## Options considered

**A. Finding the event.** `.eq("order_id", orderId)` against the real uuid
column, which carries `calendar_events_order_id_fkey` → `procurement_orders`
and which 0066 now writes. The alternatives were adding a `tags` column (a
migration to support a JSON-substring lookup no index can serve — rejected on
its face, and [[0068-calendar-events-recurring-order-link]] rejects the same
thing independently for the recurring path) or matching on title text (a
`varchar(255)` this change itself rewrites). There is no real fork here; it is
recorded because the ADR that ships it should say what it declined.

**B. One statement or two.** The pre-fix shape was select-then-update: read
candidate rows, pick one in JavaScript, update it by id.

1. **Keep select-then-update, fixed.** Two round trips, a window between them,
   and — the part that matters — a shape that can match a row and then fail to
   write it while reporting neither.
2. **One `update … .select("id")`.** The filter *is* the match. It cannot match
   a row it then fails to write, it closes **every** matching event rather than
   the first one `.find()` happened to return, and the returned ids make the
   success branch unreachable without rows to name. This is the shape 0066
   chose for the insert, and `procurement.service.ts:2952-2956` already uses it
   against `procurement_conversations`.

**C. The asymmetry.** Which statuses each direction must leave alone. The
pre-fix filters disagreed and this had never had a consequence, because neither
ran. Three ways to settle it:

1. **Symmetric — both leave `completed` and `cancelled` alone.** Simplest rule.
   Costs a reachable disagreement: `markDelivered` has no status guard
   (`procurement.service.ts:1317-1360`), so cancel-then-deliver is reachable,
   and under this rule the order row says DELIVERED while its event says
   `cancelled`, with nothing to reconcile them.
2. **Guard `markDelivered` instead**, refusing delivery on a cancelled order.
   Removes the ambiguity at its source rather than picking a winner — but it is
   a behaviour change to an order path with web, mobile and receiving-door
   callers, and it belongs in its own ADR rather than riding along here.
3. **Keep each direction's pre-fix exclusion, and give the difference a name.**

**D. The silence.** Same fork [[0066-order-delivery-event-vocabulary]] faced,
with the same answer available: `logger.warn` (which is the defect), throw (which
would fail an order over a calendar row), or report loudly without failing.

## Decision

**Find the event by `order_id`, close it in one statement written once, in the
calendar's own lowercase words, and report all three outcomes.**

- **One shared body.** `closeDeliveryCalendarEvent` is the single
  implementation; `cancelCalendarEventForOrder` and
  `updateCalendarEventForDelivery` become six-line wrappers that supply what
  legitimately differs. Deduplication is not the point — **the point is that the
  one real difference becomes an argument with a name** (`leaveAlone`), so it is
  a decision on the record instead of the accident it had been.
- **`.eq("order_id", orderId)`**, plus `restaurant_id` for tenant scope and
  `event_type = delivery` so a differently-typed event linked to the same order
  (`calendar.service.ts:121` lets a person create one) is not swept up.
- **One `update(...).eq(...).not(...).select("id")`**, per option B.2.
- **The enums are imported, never restated** — `CalendarEventStatus.CANCELLED`,
  `CalendarEventStatus.COMPLETED`, `CalendarEventType.DELIVERY` — so a
  divergence from the calendar's vocabulary is a compile error rather than a row
  nothing can read. The `not.in` list is built from the enum members too.
- **The asymmetry is option C.3, and it is this:** an arrival is a *physical
  fact* and outranks an earlier *administrative* cancellation, so
  `updateCalendarEventForDelivery` leaves only `completed` alone and will close
  a `cancelled` event. Cancellation is the weaker claim and yields, so
  `cancelCalendarEventForOrder` leaves both terminal statuses alone and will
  never erase a recorded delivery. Each direction reopens exactly what the
  other will not. **This is the pre-fix behaviour of both functions, preserved
  deliberately** — this change introduces no new behaviour beyond making the
  functions work at all — and it is now pinned by a test rather than resting on
  two filters that disagreed by accident.
- **On the silence:** an error is `logger.error` with `{restaurantId, orderId,
  orderNumber, code, error}`; a zero-row match is `logger.warn` naming that
  nothing was closed; success is `logger.log` naming the ids. Zero rows is
  `warn` and not `error` because it is legitimately common — an order cancelled
  before approval never had an event, and neither did any order approved before
  PR #232 shipped — but it is **stated**, because saying nothing is exactly what
  kept the `42703` invisible for the entire life of both functions.

**No migration.** Every column used already exists.

Two smaller calls, recorded so they are not re-litigated: the cancel path's
description was the bare `orderId` uuid, which is nothing a manager reading
`/calendar` can use, and is now the order number; and both wrappers take the
same `(restaurantId, orderId, order)` signature, which is what let the
description improve and what makes their sameness legible at the call sites.

## Consequences

- **The delivery event a manager sees now closes.** Without this, PR #232 would
  have made things *worse* than before it: events created for real, never
  marked complete or cancelled, accumulating as `pending` rows on `/calendar`
  for orders that had long since arrived or been cancelled. That is the whole
  urgency — these two failing cost nothing until the writer started working.
- **The two paths can no longer drift**, because there is only one of them. A
  future difference has to be added to `leaveAlone`, where it is visible.
- **Every matching event closes, not just the first.** `.find()` took one; the
  filter takes all. A second delivery event on the same order — reachable
  through the calendar's own create endpoint — is no longer left behind.
- **[[0068-calendar-events-recurring-order-link]] (PR #234) makes this reach
  further at no cost.** That change writes `order_id: order.id` on the recurring
  delivery event it creates (`recurring-orders.service.ts:993` on
  `fix/calendar-events-writes`, `event_type: "delivery"` at `:984`), so once it
  merges, recurring deliveries are found and closed by this code **with no
  further edit**. The two changes are independent — different files, no shared
  hunk — and merge in either order. The only expected contact is a `README.md`
  index row, which is an addition on both sides.
- **`KNOWN_BAD_COLUMNS` is not edited here**, exactly as in
  [[0066-order-delivery-event-vocabulary]]. Its two `calendar_events` entries
  name `recurring-orders.service.ts` as a writer and it still is one on `main`,
  so the shrink-only ratchet stays green. PR #234 is the change that empties
  those entries; whoever lands last deletes them.
- **The guard is not evidence for this fix, and says so.**
  `check_order_capture_contract.py` reads `.insert`/`.update` payload keys. Both
  pre-fix functions named `tags` in a `.select()`, which the guard is
  structurally incapable of seeing — it passed on the pre-fix tree at exit 0. It
  proves only that this change introduces no bad column. Reported rather than
  counted, in the shape [[0066-order-delivery-event-vocabulary]] used for
  `check_orders_column_writes.py`.
- **A read-side column contract has no guard.** That is the real gap this
  change surfaces: a `.select()` naming a column that does not exist fails the
  entire query, and nothing in CI looks at select lists. Not filed as work here
  — it is a guard-design question, and it wants its own decision.

## Verification

| What | Result |
|---|---|
| `apps/api-gateway/src/procurement/order-calendar-event-lifecycle.spec.ts` (20 tests, both functions), **pre-fix tree** | **18 failed, 2 passed** — the 2 are the guard-the-guard tests, which touch no service code |
| Same spec, post-fix | **20 passed** |
| `npx jest src/procurement` | **321 passed, 3 skipped, 23 suites** (301/3/22 at the merge base) |
| `npx tsc --noEmit -p tsconfig.spec.json` | exit 0 |
| `scripts/check_order_capture_contract.py` | exit 0 — **and vacuous for the defect**, see Consequences |
| Same guard, **proven to fire** on this file and table — probe column `zzz_not_a_column` added to the shared update payload | **exit 1**: `procurement.service.ts:1180 writes calendar_events.zzz_not_a_column, which no migration in supabase/migrations declares` |
| `scripts/check_order_capture_contract.py --self-test` | PASS |
| `scripts/check_adr_numbers_unique.py` | exit 0 across **463 refs** |

The pre-fix run was produced by restoring the file in place from `HEAD` — never
`git stash`, which is repo-global across worktrees
([[shared-checkout-concurrent-sessions]]) — and the file was diffed back to the
verified content afterwards.

As in [[0066-order-delivery-event-vocabulary]], the spec **derives** the
`calendar_events` column list from `supabase/migrations/` and throws if the
parse yields an empty or anchor-less set, so it cannot pass by looking at
nothing. It also asserts its two status vocabularies are non-empty and
lowercase before asserting anything against them.

**One assertion in this spec was wrong when first written, and the test caught
it.** `cancelled` was asserted to be a status production holds. It is not — it
has **zero** production rows, and the reason it has zero is the defect under
test: nothing has ever successfully cancelled a delivery event. Asserting
against production alone would have required the bug to still be present. The
value is carried instead by a second measured list — values
`calendar.service.ts` itself writes and branches on (`.update({ status:
"cancelled" })` at `:612`, `generateICal` at `:1275`) — and each case now cites
the list that carries it.

## Consequences for the register

No `OPEN-DECISIONS.md` row: adding one re-anchors roughly 41 citations
([[0025-citations-must-disagree-loudly]]). One `CLAIMS.jsonl` entry instead.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created |
| 2026-09-02 | Founder | Asked on the option-C fork; returned the call, directing that both directions stay valuable and that no two functions do the same job. Both are reflected in the Decision above. |
