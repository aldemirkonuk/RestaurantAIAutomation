# 0056 — An order path may only write columns the table has

- **Status:** Proposed
- **Date:** 2026-09-01
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** retroactive order, recurring orders, schema drift, column drift, procurement_orders, recurring_orders, order_interactions, calendar_events, off-app invoice, standing order, PostgREST 42703, PGRST204
- **Links:** [[0054-order-capture-and-unit-arithmetic]] (the migration this builds on), [[0011-pos-sale-volume-contract]] (fail closed rather than guess), [[0020-no-fabricated-answers]], [[0014-pos-catalog-claim-lifecycle]] (a claim dies with its target), [[0015-pos-referential-integrity]], [[0032-vault-structure]] (tombstone rather than silent delete), PR to `main` from `fix/retroactive-and-recurring`

## Context

Two order paths in `apps/api-gateway` write to tables whose shape they are wrong
about. Neither has ever succeeded, and neither is visibly failing, because
PostgREST answers `42703`/`PGRST204` and both callers log a warning and carry on.

**A. The retroactive order** — `POST /providers/:id/retroactive-order`, the way a
restaurant records an invoice for wine it bought off-app.
`providers.service.ts:940` hand-rolled an insert into `procurement_orders` that
named `wine_name` and `actual_delivery` — the table has neither (confirmed in
production via `information_schema`, 2026-09-01) — and omitted five columns that
are `NOT NULL`: `order_number`, `inventory_id`, `bottles_total`, `final_price`,
`total_cost`. It failed at the first statement, which is why nobody discovered
that the two follow-on inserts were broken too:
`procurement_conversations.message_text` is `NOT NULL` and was never written, and
`order_interactions` has no `channel` and no `content` column, its
`interaction_type` `CHECK` accepts only `VOICE|SMS|EMAIL|WHATSAPP` (so the
literal `"invoice_received"` is a `23514`), and its `interaction_direction` is
`NOT NULL` and was never written. `order_interactions` holds 0 rows and has no
other writer anywhere in the repository.

A second, byte-divergent copy of the same method sat at
`provider-intelligence.service.ts:603` with **zero callers** — grepped repo-wide
for any invocation, controller route or test.

**B. The recurring order** — the 8 AM cron that materialises standing orders.
`RecurringOrdersService`'s `RecurringOrderRow` declared eight columns
`recurring_orders` does not have: `inventory_id`, `provider_id`, `wine_name`,
`target_price`, `created_by`, `notes`, `last_executed_at`, `execution_count`.
`createRecurringOrder` inserted seven of them and omitted `unit_type`, which is
`NOT NULL` with no default — so it failed twice over, and the table holds **0
rows in production**. That zero is the symptom, not a coincidence.
`executeRecurringOrder` then read `.inventory_id` and `.provider_id` off a row
that had neither and handed both to `createOrder`, whose columns are `uuid NOT
NULL`. The cron has never produced an order.

Two more disagreements surfaced while measuring B. `frequency`'s `CHECK` allowed
`daily|weekly|biweekly|monthly` while the TypeScript type allowed
`weekly|biweekly|monthly|quarterly` — so `quarterly` was un-insertable, and
`daily`, which the database and the web form both offer, fell through
`calculateNextOrderDate`'s `default:` arm and returned **+1 month**. A schedule
set to run every day would have run twelve times a year and said nothing. And
that function built its dates with `new Date("YYYY-MM-DD")` (UTC midnight) and
then used LOCAL getters and setters, so west of Greenwich a monthly schedule on
the 1st came back as the 2nd — correct on Railway's UTC and wrong on every
developer's laptop, or the reverse the day the region changes.

None of this is visible to `scripts/check_queried_tables_exist.py`, whose own
docstring names the hole: *"WHAT IT DOES NOT CATCH — 1. COLUMNS"*. Both tables
exist. Only their shapes were wrong.

## Options considered

**1. Fix the two inserts in place.** Cheapest. Rejected: the retroactive path
would still hand-roll a `procurement_orders` insert, and the divergence between
the two copies of `createRetroactiveOrder` is exactly what a second hand-rolled
insert produces. `ProcurementService.createOrder` already satisfies every `NOT
NULL` column, generates the `order_number`, resolves `master_wine_id`, does the
pack-size arithmetic and writes the `procurement_order_items` line an invoice can
be matched against ([[0054-order-capture-and-unit-arithmetic]]). Duplicating that
is how we got here.

**2. Route retroactive through `createOrder` unchanged, then patch the row.**
Rejected, and this is the option that looked right longest. `createOrder` opens
every order `PENDING`, folds a matching open order into itself, and fires
`triggerDraftHttp` — which emails the vendor to open a price negotiation. For an
invoice already delivered and paid that is not a cosmetic mismatch: it would
negotiate the price of wine in the cellar, and it would overwrite a live pending
order's quantity and price with an unrelated invoice's. Patching afterwards
leaves a window in which all three have already happened.

**3. Rewrite `RecurringOrdersService` around the columns the table has.** The
table's own columns are `wine_id varchar(50)` and `preferred_providers text[]`.
Rejected: neither can reach `createOrder`. `wine_id` is a varchar no table in
this schema keys on; `preferred_providers` is an array of vendor NAMES
(`RecurringOrders.tsx:133` joins it into an email greeting) against a `uuid NOT
NULL` column. Resolving either means a name match that can hit zero rows or two,
and a schedule that quietly orders the wrong wine from the wrong vendor every
Monday is the silent-wrong-answer [[0011-pos-sale-volume-contract]] forbids.

**4. Do nothing.** Both features stay dead, and stay dead invisibly. The
retroactive endpoint 500s on every call and the recurring cron produces nothing,
while `/recurring-orders` renders an empty list that looks like "no schedules
yet" rather than "no schedule can be created".

## Decision

**Delete the unrouted duplicate; route the surviving retroactive path through
`createOrder` with an explicit `alreadyFulfilled` provenance; and reshape
`recurring_orders` to the six columns its materialiser genuinely needs, deriving
the seventh and re-pointing the eighth at a column that already exists.**

Four sub-decisions carried it.

**An order that RECORDS is not an order that REQUESTS.** `createOrder` gains
`provenance.alreadyFulfilled`, one flag with four consequences, all of which
follow from that single fact: the order opens `DELIVERED`; `requested_at` and
`delivered_at` both take the invoice date (otherwise the delivery precedes its
own request); the dedup merge is skipped; and no AI draft is triggered. Four
`if (!fulfilled)` branches keyed on one named concept is a fair price for not
duplicating the ~80 lines of NOT NULL assembly, unit arithmetic and line-row
writing that are the most safety-critical code in procurement.

**The invoice states a TOTAL; the column means PER BOTTLE.** `RetroactiveOrderDto`
promised `wineName: string` and made everything else optional — neither half
honourable, since `inventory_id` is `uuid NOT NULL` and a fuzzy name match would
attach an invoice to whichever wine it liked, moving real money against the wrong
wine's cost history. The DTO now requires `inventoryId`, `quantity` and
`invoiceTotal`, carries `unitType`/`bottlesPerUnit`, and derives the per-bottle
price as `invoiceTotal / bottlesTotal`. The old `finalConfirmedCost` was
documented as a total and written straight to a per-bottle column: a $600
five-case invoice became $600/bottle, $7,200. `total_cost` keeps the exact
invoice figure rather than the derived product, so a rounding half-cent never
becomes the number the books are kept on.

**`order_interactions` is dropped from the retroactive path, not repaired.** The
table cannot hold this event — its `interaction_type` vocabulary is a set of
CHANNELS and it has no column for a message body — and the invoice text already
has a home in `procurement_conversations`, where every other email path in this
service puts it. A second, body-less row in a table with 0 rows and no other
writer adds no information and one more thing to drift. `interactionId` leaves
the response contract; no client can depend on it, because no call has ever
returned one.

**`recurring_orders` is reshaped, and `wine_id`/`preferred_providers` are
tombstoned rather than dropped.** Six of the eight phantom fields become columns
(`inventory_id`, `provider_id`, `target_price`, `created_by`, `notes`,
`execution_count`). `wine_name` does **not**: it is a copy of
`restaurant_inventory.wine_name` that goes stale the first time a wine is
renamed, so the service embeds it and projects it onto the response — every
reader still sees `wine_name`, and the table keeps one copy of the name.
`last_executed_at` does **not**: `last_order_date` is the same fact, already
exists, and is the one `RecurringOrders.tsx` already renders; two columns for one
fact is the defect being fixed, not a thing to add more of. `notes` stops being
write-only — it is carried onto every order the schedule materialises.

The two dead columns stay because dropping them would ship a crash:
`RecurringOrders.tsx:133` calls `.join()` on `preferred_providers` unguarded and
`:348` reads `.length`, both unreachable today only because the list is always
empty. The moment the first real schedule exists they run, and against a dropped
column they throw on `undefined`. `COMMENT ON COLUMN` is the schema's version of
[[0032-vault-structure]]'s tombstone: it names what superseded them and what has
to happen before they can go.

## Consequences

**Easier.** Recording an off-app invoice produces a real `DELIVERED` order with a
line row, an order number and a wine identity an arriving document can be matched
against. A standing order can be created at all, and materialises with the right
inventory, the right vendor, the right unit and the right pack size. `daily` runs
daily. `quarterly` is insertable. A `POST` naming a field the table has never had
is now refused by name with a 400 rather than silently dropped (the controller
body was typed as a TypeScript interface, which is erased at runtime and
validated nothing) — the same rule this ADR applies to `RetroactiveOrderDto`.

**Harder / given up.** `ProvidersModule` now imports `ProcurementModule`. Nothing
in `ProcurementModule`'s transitive imports reaches back, so this is not a cycle —
but Nest resolves a genuine cycle by injecting `undefined` at runtime rather than
failing the build, so `scripts/check_gateway_boots.sh` is what proves it, not the
type checker. `apps/web/src/pages/RecurringOrders.tsx` still POSTs `wine_id`,
`preferred_providers` and five price fields the table has never had; with a real
DTO in place those are now **refused with a 400** instead of silently dropped.
That is more honest and still broken — the page needs rebuilding against the new
contract, and that is a separate operation, filed rather than smuggled in here.

**The guard.** `check_order_capture_contract.py` gains a fifth contract: no write
under `apps/api-gateway/src` may name a column no migration declares. Proven to
exit 1 against pristine `origin/main` (f5735e47) with 19 findings at the exact
lines of both defects, and to exit 0 here. It carries a measured blind spot (13
of 254 write sites whose keys are a spread, a computed key or a named variable),
ceilinged so it cannot widen silently, and a shrink-only debt list of six
entries — every one verified against production, not inferred.

**Debt this surfaced and did not fix.** `calendar_events` has no `priority` and
no `tags` column and its `source` is `NOT NULL`, so every calendar event
`procurement.service.ts` and `recurring-orders.service.ts` have ever written has
failed; the recurring materialiser also SELECTs on `tags` to find the event it
pre-created, so the linkage is dead in both directions. And
`communications.service.ts` `logConversation` writes four columns
`procurement_conversations` does not have. Both are on the guard's debt list with
their production evidence. Repairing the first means deciding where a
`recurring_order_id` link lives on a calendar event, which is a calendar-domain
decision with fifteen other call sites, not a procurement one. **This change
makes the recurring calendar writes reachable for the first time**, so the
warnings will start appearing in the logs where before the code never ran.

**Revisit when:** the first real `recurring_orders` row exists and
`RecurringOrders.tsx` has been rebuilt — at that point `wine_id` and
`preferred_providers` can be dropped and their tombstones deleted. Or if a
schedule ever genuinely needs a list of acceptable vendors rather than one, in
which case `preferred_providers` stops being dead and this ADR is wrong about it.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-01 | — | Created |
