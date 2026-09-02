# 0068 — A calendar event names its schedule in a column, and says only what the table can hold

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent. The linkage fork below was decided by the founder directly; the vocabulary and silence questions were determined from measurement.
- **Keywords:** calendar_events, recurring orders, foreign key, status vocabulary, PGRST204, phantom columns, fabricated outbound content, feature flag, absence reported as health, column guard
- **Links:** `[[0056-order-paths-write-columns-that-exist]]` (PR #220, the `recurring_orders` shape this builds on), `[[0061-recurring-reminder-reads-the-recurrence-table]]` (PR #227, the sibling reminder and the flag shared here), `[[0051-rebuilt-pages-show-live-data-only]]` / `[[0020-no-fabricated-answers]]` (why "Unknown" cannot ship), `[[0022-scheduled-jobs-run-per-tenant]]` (recipient routing), `[[0058-order-status-is-an-enum-not-a-string]]` (the same class, one table over), `supabase/migrations/20260902100000_calendar_events_recurring_order_link.sql`, PR for `fix/calendar-events-writes`

## Context

`RecurringOrdersService` writes to `calendar_events` in three places: it
pre-creates up to 60 future order events when a schedule is created, it marks
one of them complete when the 08:00 cron materialises that occurrence, and it
creates a delivery event for the resulting order. **None of the three has ever
written a row.** Four independent defects, each sufficient on its own,
all verified against production (`exzueerziesmczwlhomd`) on 2026-09-02.

| # | Defect | Evidence |
|---|---|---|
| 1 | Writes `priority` and `tags` | `calendar_events` has neither. `information_schema` returns 0 of 2. PostgREST answers PGRST204 and rejects the **whole** statement |
| 2 | Omits `source` | `source character varying(50) NOT NULL`, **no default** (baseline `:2353`). An independent 23502 |
| 3 | Links through a JSON substring | the id was serialised into the phantom `tags` and read back with `.like("tags", '%<uuid>%')` — a leading-wildcard scan no index can serve, against a column that does not exist. Dead in both directions |
| 4 | Invents the status vocabulary | writes `"SCHEDULED"` / `"COMPLETED"`, filters `.eq("status","SCHEDULED")`. The table's 19 real rows hold `pending` (16), `active` (2), `completed` (1) — all lowercase. `CalendarEventStatus` (`calendar/dto/calendar.dto.ts:36-42`) has no `SCHEDULED` member in any casing. **There is no CHECK constraint**, so every bad write was accepted in silence and every read matched nothing |

Defect 4 was not on the original defect list. It survives fixing 1–3: the
columns would become writable and the *reads* would still match zero rows.

**Why none of this was visible.** Every one of the three sites is wrapped in
`try { … } catch { logger.warn }`, and two of them additionally discard the
Supabase `error` object. Supabase returns `{data, error}` rather than throwing,
so **the try/catch was inert for every database error it appeared to cover**.
The order materialises, the API returns success, the calendar stays empty, and
nothing anywhere says so. This is instance 12 of the `absence-reported-as-health`
class, in a new place.

**And one fabrication, in outbound content.** `sendRecurringOrderReminders`
(`@Cron("0 6 * * *")`) published `wine_name: order.wine_name || "Unknown"` to
`recurring.events`. `NotificationAgent` consumes that key into the **title** of a
push notification and an email: `"Recurring Order Reminder: {wine_name}"`
(`notification_agent.py:161`, channels `["push","email"]` at `:171`). The
exchange has been declared since ADR 0039 Track A3, so the path is live, not
inert.

The name was resolved by a single-hop embed on `restaurant_inventory.wine_name`
— a **nullable** column. Measured in production 2026-09-02:

> **53 of 72 inventory rows have a NULL `wine_name`. All 53 carry a
> `master_wine_id`, and all 53 of those `master_wine_library` rows have a name**
> (`name` is `NOT NULL` there).

So "Unknown" was not an edge case to guard. It was the **majority outcome** —
74% of the catalogue — and the real name was one join away the whole time.

## Options considered

### The linkage (decided by the founder, not open)

1. **A real `recurring_order_id uuid` column on `calendar_events`, nullable, FK,
   indexed. CHOSEN.** It matches how `order_id` and `provider_id` already work
   on that table (baseline `:2344-2345`, each with its own FK, and
   `idx_calendar_events_provider` at `:8639`). It turns find-and-complete into a
   keyed lookup instead of a substring scan that can never use an index. And it
   reads correctly to the ~15 other call sites in `calendar.service.ts`, which
   all speak in columns.
2. **A join table.** Rejected: a calendar event belongs to at most one schedule,
   so this models a many-to-many that does not exist, and buys itself an RLS
   policy, an index and a cleanup path for nothing.
3. **A `metadata` JSONB column.** Rejected: it is the same un-indexable read in a
   better-typed disguise, and JSONB cannot carry a foreign key — the one
   property that makes a wine delete behave correctly (below).
4. **Drop pre-creation entirely** and create each event at materialisation time.
   Rejected: pre-created events are what make a schedule *visible* on the
   calendar before it fires, which is the feature. It also does not fix defects
   1, 2 or 4 — the delivery event has all four.

### `ON DELETE SET NULL`, which differs from the sibling columns

`calendar_events.order_id` has no `ON DELETE` clause (NO ACTION). Copying that
was the obvious move and is **wrong here**, for a reason that only shows up one
table over.

`procurement_orders_inventory_id_fkey` is itself NO ACTION, so nothing cascades
onto `procurement_orders` and `order_id`'s NO ACTION never fires. But ADR 0056's
migration gave `recurring_orders.inventory_id` an **`ON DELETE CASCADE`**
(`20260901180000:136-138`), so deleting a wine deletes its schedules. With NO
ACTION on this column, that cascade would collide with the surviving calendar
rows and Postgres would **refuse the wine delete** with a 23503 — turning
"delist a wine" into an opaque foreign-key error.

- **CASCADE** was rejected: it deletes `completed` historical events, destroying
  the record of orders that really were placed, because someone delisted a
  bottle.
- **SET NULL** keeps the history, never blocks a legitimate delete, and leaves
  the row as honest as it can be: the event happened, and the schedule that
  caused it is gone.

### The status vocabulary

- **Invent `scheduled`.** Rejected. Nothing else in the codebase or the data
  uses it; it would be defect 4 committed deliberately.
- **`approved`.** Considered seriously — there is a partial index
  `idx_calendar_events_approved_by_date ... WHERE status = 'approved'` (`:8611`),
  and `pending` renders as iCal `TENTATIVE` (`calendar.service.ts:1274-1276`).
  Rejected: `pending`/`approved`/`dismissed` is a **human approval** workflow, and
  nobody approves a diary entry. A pre-created event is not awaiting a decision;
  it is awaiting a date.
- **`pending`. CHOSEN.** It is the column default, it is 16 of the 19 real rows,
  and it is a member of `CalendarEventStatus`. Three independent sources agree.
  Completion is `completed` — the same value one production row already holds.
- `source` is **`system_generated`**: a cron wrote it. `order` exists in
  `CalendarEventSource` but means "created by the order flow", which is
  `procurement.service.ts`'s site, not this one.

### Naming a schedule in outbound content

ADR 0061 refuses to send at all when a field is missing. That is right for its
template, whose subject line also needs a **provider** and a **price** — neither
of which has a truthful substitute. This path diverges, on the founder's
instruction, and the divergence is principled: an **identity** does have a
truthful substitute, because the row's own id is not a placeholder standing in
for an unknown, it *is* the thing. So:

1. the wine's name from `restaurant_inventory.wine_name`, else
2. the wine's name from `master_wine_library.name` — the hop that covers 53 of
   the 72 production rows, else
3. `schedule <uuid>`, the primary key that the notification's own Confirm / Edit
   / Cancel buttons already key on.

Never `"Unknown"`, never `"Wine"`, never `"wine"`, never an em dash. Sending
nothing for a schedule that is genuinely due in two days trades a fabricated
reminder for an absent one, and an absent reminder is the failure this path
exists to prevent. **A reminder whose subject cannot be identified trains people
to ignore the channel** — which is the same damage as a wrong one, paid later.

Three further fabrications were fixed at the *source* rather than in the
consumer: this producer omitted `unit_type`, `frequency` and
`preferred_providers`, and `notify_agent`'s `.get()` defaults filled them with
`"bottles"`, `"scheduled"` and `"Default provider"`
(`notification_agent.py:1766-1772`). Omission is what activated them; all three
are now sent truthfully, and an unresolvable provider sends `[]` rather than a
name nobody chose.

### Loud or quiet, per site

The rule applied: **a calendar failure must not fail an order that succeeded,
and must not read as success either.** Where throwing would cause a worse
outcome than the failure itself, the outcome is *returned and logged at error*
instead of raised.

| Site | Behaviour | Why |
|---|---|---|
| `preCreateCalendarEvents` insert | `logger.error` + `CalendarWriteOutcome` returned to the caller, attached to the API response as `calendar` | Throwing would 500 a request whose schedule row is **already committed**; the client's retry creates a SECOND standing order. A duplicate schedule is strictly worse than a missing diary entry |
| completion lookup | `logger.error` on a query error, `logger.warn` on **zero rows** — a third state, distinct from both | Zero rows means the pre-create never landed. That was previously indistinguishable from success, and it is the exact shape the whole outage hid behind |
| completion update / delivery insert | `logger.error`, non-fatal | Step 5 advances `next_order_date`. Throwing here leaves the order placed and the schedule still due, and tomorrow's cron **places the same order again** |
| reminder query failure | `logger.error` + `queryFailed: true` in a returned tally | A failed query is not "no reminders due"; it is an unknown number of people who were not told. `{data, error}` meant nothing above it ever noticed |
| every `publishEvent` failure | `logger.error` + counted | The approval notification is the only thing that tells a human an order is waiting |

`sendRecurringOrderReminders` now returns a `ReminderSweepOutcome`
(`armed / scanned / sent / sentUnnamed / failed / queryFailed`). Nest ignores the
return value; the tests do not. Of the four ways this method could previously do
nothing, **zero were answerable from outside it**.

### The flag

`RECURRING_ORDER_REMINDERS_ENABLED` (ADR 0061) now gates **this** cron too, with
the same allow-list (`"true"` / `"1"` only) checked before any query.

Two crons, one concept: `ScheduledTasksService.sendRecurringOrderReminders()`
(08:00, email, `next_order_date <= today+2`) and this one (06:00, RabbitMQ →
push + email, `next_order_date == today+2`) tell the same person the same thing
off the same table. Gating one and not the other is not a smaller change, it is
a worse one — it left the **unreviewed** path live and the reviewed, fail-closed
path dark.

**The flag stays OFF. It is not turned on here, and turning it on is now blocked
on a decision, not just a check:** flipping it arms *both* jobs, so the same
schedule produces two reminders. What would justify flipping it is (a) the
founder choosing which of the two paths survives and retiring the other, plus
0061's four preconditions, of which #1 (PR #220 merged) and #2 (a reachable wine
name — delivered here by the `master_wine_library` fall-through) are now met.
`recurring_orders` still held **0 rows** on 2026-09-02, so nothing would send
today in any case.

## Decision

1. `calendar_events` gains **`recurring_order_id uuid`** — nullable, FK to
   `recurring_orders(id)` **`ON DELETE SET NULL`**, with a partial index
   `(recurring_order_id, event_date) WHERE recurring_order_id IS NOT NULL`.
2. All three write sites drop `priority` and `tags`, write `source`, use
   `pending`/`completed`, and use the real `order_id` / `provider_id` /
   `recurring_order_id` columns.
3. The completion lookup is keyed on `recurring_order_id` + `event_date` +
   `status`, never a `LIKE`.
4. Outbound content never names a wine it cannot resolve; the resolution is a
   two-hop embed with an identity fallback, and the fallback is counted.
5. Both recurring-order reminder crons share one off-by-default flag.
6. `scripts/check_orders_column_writes.py` is **generalised to a table
   registry** rather than copied, and `calendar_events` is registered with
   inserts **enforced**.

**Nothing is back-filled.** This table holds 19 real rows — unlike every other
table in this domain — and none can be attributed to a schedule: no schedule has
ever materialised an event, `recurring_orders` held 0 rows, and `order` is
absent from the nine `event_type` values present. The column stays NULL on all
19. Guessing an owner for a real row is worse than leaving it blank.

## Guard interaction

`scripts/check_orders_column_writes.py` covered one table because "a guard that
half-covers twenty tables is worse than one that fully covers the table a defect
was just found in". The defect then appeared on a second table, so the table
became a **parameter** — a `TableSpec` registry with per-table floors, per-table
debt and a per-table decision about whether inserts fail or are merely reported.
`procurement_orders` keeps its exact previous behaviour; `calendar_events`
**enforces inserts**, because that is where its defect lives.

Two things had to change for the guard to actually cover the fix rather than
merely appear to:

- **It can now read a bulk insert.** `preCreateCalendarEvents` builds
  `const events: any[] = []` and `events.push({…})`. The old extractor would
  have called that site unreadable — not a false pass, but the wrong failure:
  the guard would say "I cannot see this" about the one site the change is for,
  and the obvious way to silence that is to raise the ceiling.
- **Debt entries are pinned to the files they are debt in.** Keyed by column
  alone, `calendar_events.priority` would have covered *both* writers, so the
  guard would have gone green over the pre-fix tree. Measured: with file
  pinning it exits **1** on the pre-fix tree, naming all five sites.

`scripts/check_order_capture_contract.py`'s `KNOWN_BAD_COLUMNS` entries for
`calendar_events.priority` / `.tags` were expected to be deleted here. **They are
not, and the reason is measured rather than assumed:** that list is keyed by
`table.column` across *all* files, `procurement.service.ts
createCalendarEventForOrder` still writes both, and deleting the entries makes
Contract E fail with two NEW violations on a file this change does not own
(verified by removing them and running it: exit 1, both errors naming
`procurement.service.ts:1959`). The entries are **shrunk instead** — their text
now names the one remaining writer and says to delete both in the change that
fixes it.

**That change exists and is in flight:** branch `fix/order-calendar-event`
(ADR 0066) removes `priority` and `tags` from `procurement.service.ts` and does
not touch either debt list. So whichever of the two merges **second** removes the
last writer, both lists stop matching, and both ratchets fail — by design, on
that PR's own CI, before it lands. The fix is to delete four entries: two in
`check_order_capture_contract.py`'s `KNOWN_BAD_COLUMNS` and two in
`check_orders_column_writes.py`'s `CALENDAR_EVENTS_KNOWN_BAD`. Recorded here so
that failure is a thirty-second edit rather than an archaeology session.

## Consequences

**What becomes easier.** The recurring calendar works at all — first time. A
schedule shows its future orders, the materialiser closes the right one, and the
delivery lands on the calendar with a real order behind it. The find-and-complete
step is an index probe. Any future write of a phantom column to either
registered table fails the build.

**What is given up.** The reminder cron does nothing until the founder flips a
flag, where before it did something wrong. The flip is now blocked on a product
decision (which of the two reminder paths survives) that was previously
invisible. And the guard's registry is a thing to maintain: a table not in it is
not covered, and the entry is where the floors live.

**What would trigger revisiting this.** If pre-creation is dropped in favour of
generating occurrences from `calendar_recurrence_rules` — which exists, with a
`generate_recurring_events` RPC — this column becomes the link between a
schedule and a rule instead, and the pre-create loop and its `MAX_EVENTS = 60`
ceiling go away with it.
