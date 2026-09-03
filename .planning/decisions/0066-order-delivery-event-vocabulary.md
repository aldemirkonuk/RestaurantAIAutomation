# 0066 — An order's calendar event uses the calendar's vocabulary, and its failure is loud

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** calendar_events, createCalendarEventForOrder, delivery event, source NOT NULL, 23502, PGRST204, status vocabulary, SCHEDULED, order_id, provider_id, absence reported as health, silent failure, procurement
- **Links:** [[0056-order-paths-write-columns-that-exist]] (surfaced this and explicitly did not fix it), [[0058-order-status-is-an-enum-not-a-string]] (the same defect on `procurement_orders.status`), [[0025-citations-must-disagree-loudly]], PR #232

## Context

`createCalendarEventForOrder` (`apps/api-gateway/src/procurement/procurement.service.ts:1947`
before this change) has **never once succeeded**. It is the only writer of the
expected-delivery event that a manager sees on `/calendar` and that the dashboard
counts as "deliveries this week". Four independent faults, in ascending order of
how badly they fail:

1. **`priority`** — no such column
   (`supabase/migrations/20260805000000_baseline_from_production.sql:2341-2375`).
   PostgREST answers `PGRST204`.
2. **`tags`** — no such column either. Order identity was JSON-stuffed into it
   while the **real** `order_id` and `provider_id` uuid columns sat unused —
   columns that carry foreign keys (`calendar_events_order_id_fkey` →
   `procurement_orders`, `calendar_events_provider_id_fkey` → `providers`, at
   `:12414` and `:12430`) and an index (`idx_calendar_events_provider`, `:8639`).
3. **`source` omitted** — `character varying(50) NOT NULL` with **no default**
   (`:2353`). This one is a `23502` on its own, so even with the column names
   corrected the insert would still have failed.
4. **`status: "SCHEDULED"`** — and this is the worst of the four, because it is
   *not* an error. The column has no CHECK constraint, so a wrong value inserts
   happily. Production holds `active`, `completed`, `pending` — all lowercase,
   19 rows, measured against `exzueerziesmczwlhomd` on 2026-09-02 — and has
   never held `SCHEDULED` under any casing. Had faults 1–3 been fixed alone, the
   row would have been written and then read by nothing. This is
   [[0058-order-status-is-an-enum-not-a-string]] again, one table over.

None of it was visible. The whole body was a `try`/`catch` whose only outputs
were `logger.warn`, and the caller reported the order as approved regardless.
Supabase **returns** `{data, error}` rather than throwing, so the `catch` was
inert for exactly the errors that were occurring. `absence-reported-as-health`
class **O**: no bad row was ever written, a good row was simply never there, and
nothing recorded that. The damage cannot be enumerated — there is no way to list
the delivery events that should exist.

[[0056-order-paths-write-columns-that-exist]] measured all of this on 2026-09-01
and deliberately left it: its README row ends "**Surfaced and not fixed:**
`calendar_events` has no `priority`/`tags` and a NOT NULL `source` … and this
change makes those writes reachable for the first time." Its debt list carries
`calendar_events.priority` and `calendar_events.tags`, both naming this function
and `recurring-orders.service.ts` as writers. This ADR closes the procurement
half of that entry.

## Options considered

**A. The vocabulary.** `calendar_events.source`, `.status` and `.event_type` are
plain `varchar` with no CHECK, so the DB accepts anything and the only real
constraint is *what a reader recognises*. Two candidate sources of truth, and
they do not fully agree:

1. **The `CalendarEventStatus` / `CalendarEventSource` / `CalendarEventType`
   enums** (`apps/api-gateway/src/calendar/dto/calendar.dto.ts:36-67`) — what the
   calendar's own API validates and what the update endpoint will accept.
2. **What production actually holds** — `status ∈ {active, completed, pending}`,
   `source ∈ {manual, system_generated}`, `event_type` across nine values
   including `delivery`.

They disagree in both directions. `active` is in production but **not** in the
enum, so a row written `active` could never be transitioned by
`PATCH /calendar/events/:id/status` — class-validator would reject the value on
the way back in. `approved` is in the enum and has a dedicated partial index
(`idx_calendar_events_approved_by_date`, `:8611`) but has **zero** production
rows. Choosing from either list alone is how the next branch picks a different
answer to the same question.

3. **Intersect them** — take only values that are simultaneously in the enum and
   present in production. Costs nothing here, because the intersection is
   non-empty for all three columns.

**B. `source`.** `system_generated` (in the enum, live in production) versus
`order` (in the enum, **zero** production rows) versus `manual` (live, but a lie
— no person created this). Nothing in the codebase filters on `calendar_events.source`
today, so this is purely a legibility choice for whoever reads the table next.

**C. The silence.** Three shapes:

1. **Keep `logger.warn`.** Free, and is the defect. Rejected on its face.
2. **Throw, failing the order.** Honest about the failure, and wrong here for a
   specific reason: the one caller reaches this line only *after* the purchase
   order has been emailed to the vendor and the order row committed — the
   surrounding code at `:2385-2412` goes to considerable length to avoid exactly
   this, parking a `SEND_UNCONFIRMED` rather than letting a manager re-approve
   an order the vendor already has. Failing an order over a calendar row would
   reintroduce the harm that code exists to prevent.
3. **Not fatal, but not silent.** `logger.error` with structured context, and —
   the load-bearing half — **prove the row exists** rather than infer it from the
   absence of an error.

## Decision

**Write the intersection of the calendar's enum and what the table actually
holds; never fail an order over a calendar row; never report a calendar row that
does not exist.**

Concretely: `source: system_generated`, `status: pending`, `event_type: delivery`,
identity in the real `order_id`/`provider_id` columns, `priority` and `tags`
dropped, and the insert changed to `.insert(...).select("id").single()` so the
success branch is unreachable without an id to point at. The function returns
`string | null` — `Promise<void>` cannot express "this did not happen", and the
existing call site needs no edit to keep compiling.

The values, with their evidence:

- **`source: system_generated`** — one of only two values production holds, and
  true of this row: not a person (`manual`), not an inference from a vendor
  thread (`ai_detected`). `order` was rejected: it is in the enum but nothing has
  ever written it, and adding a third live value to a column nothing filters on
  buys nothing and costs a reader a question.
- **`status: pending`** — carried by four independent signals, which is why it
  beats `active` despite `active` also being live. It is the column's **own
  default** (`:2356`), so writing it agrees with what the DB would have done
  unaided; it is `CalendarEventStatus.PENDING`, so the calendar's update endpoint
  can transition it (`active` cannot be sent back in); it is live in production;
  and `generateICal` maps `pending` → `TENTATIVE` (`calendar.service.ts:1276`),
  which is exactly what a +7-day estimate is. `approved` was rejected — an
  estimate the vendor has not confirmed is not approved, whatever the index
  suggests.
- **`event_type: delivery`** — in the enum, live in production, and the literal
  `dashboard.service.ts:288` counts `deliveriesThisWeek` on. That counter has
  been reading a structural zero for want of this row.

The enums are **imported**, not restated as string literals, so a future
divergence between this writer and the calendar's vocabulary is a compile error
rather than a row nothing can read.

On the silence: a failure is `logger.error` with `{restaurantId, orderId,
orderNumber, trigger, code, error}` — matching the house shape already used at
`procurement.service.ts:2400` for the other "succeeded but unrecorded" case in
this same function's caller — and `null` is returned. Three failure paths are
distinguished and all three are loud: PostgREST returned an error; PostgREST
returned **no error and no row**; the client threw. The middle one is the shape
that hid this defect for its entire life, and it is now a reported failure rather
than the success branch.

**No migration.** Everything above uses columns that already exist, so this
merges in any order relative to the concurrent work on
`recurring-orders.service.ts` and cannot collide with a column being added there.

## Consequences

- The delivery event a manager sees after approving an order will exist for the
  first time. `deliveriesThisWeek` starts counting; the `/calendar` delivery row
  appears; `order_id`/`provider_id` make the event joinable to the order and the
  vendor without parsing JSON out of a column that does not exist.
- **A failed calendar write now costs a log line, not an order.** That is a
  deliberate asymmetry and it is the thing to revisit if it turns out managers
  need to *know* at approval time that no reminder was scheduled. The signal to
  revisit: a support incident where a delivery was missed and the error line was
  in the logs the whole time. The right next step then is a durable
  notification, not a thrown exception.
- **The emergency flag lost its column and kept its meaning.** `priority` does
  not exist and this change must not add one, so `isEmergency` now prefixes the
  title `URGENT — ` and appends to the description. That is weaker than a
  sortable column and it is honest about being text. If emergency ordering ever
  needs to be *queried*, that is a calendar-schema decision and its own ADR.
- **🔴 The two functions that close this event's lifecycle are still broken, and
  this change makes that newly visible.** `updateCalendarEventForDelivery`
  (`:2095` after this change) and `cancelCalendarEventForOrder` (`:1104`) both find the event by
  `.select("id, tags")` and both write uppercase `COMPLETED`/`CANCELLED`. Until
  now this cost nothing, because there was never an event to find. From this
  change onward, delivery events will be created and **never marked complete or
  cancelled** — they will accumulate as `pending` rows for orders that have long
  since arrived. Both functions were outside this change's assigned boundary and
  were deliberately not touched. They are the immediate follow-up, and the fix is
  mechanical: `.eq("order_id", orderId)` and the lowercase vocabulary settled
  above.
- `KNOWN_BAD_COLUMNS` in `check_order_capture_contract.py` is **not** edited
  here. Both `calendar_events` entries name two writers, and
  `recurring-orders.service.ts` still writes both, so the entries still have a
  writer and the shrink-only ratchet stays green. Whoever fixes that file last
  deletes the entries.

## Verification

| What | Result |
|---|---|
| `scripts/check_order_capture_contract.py` (contract 5, generalised across all tables, landed on `main` in **PR #220**) | **exit 0** post-fix |
| Same guard, **proven to fire** on this exact file and table — a probe column `zzz_not_a_column` added to this payload | **exit 1**: `procurement.service.ts:2022 writes calendar_events.zzz_not_a_column, which no migration in supabase/migrations declares` |
| `scripts/check_orders_column_writes.py` | exit 0, but **vacuous for this change** — it is scoped to `procurement_orders` and is structurally incapable of seeing a `calendar_events` write. Reported, not counted as evidence. |
| `apps/api-gateway/src/procurement/order-calendar-event.spec.ts` (13 tests), pre-fix tree | **11 failed, 2 passed** |
| Same spec, post-fix | **13 passed** |
| `npx jest src/procurement` | 301 passed, 3 skipped, 22 suites |
| `npx tsc --noEmit -p tsconfig.spec.json` | exit 0 |

The spec **derives** the column list from `supabase/migrations/` rather than
hardcoding it, and throws if the parse yields an empty or anchor-less set — a
column contract that could pass by looking at nothing would be the same fault
one level up.

## Consequences for the register

No `OPEN-DECISIONS.md` row: adding one re-anchors roughly 41 citations
([[0025-citations-must-disagree-loudly]]). One `CLAIMS.jsonl` entry instead, so the
vocabulary claim is re-checked by command rather than re-read by nobody.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created |
