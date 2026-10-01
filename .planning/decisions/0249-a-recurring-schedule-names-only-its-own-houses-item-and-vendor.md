# 0249 — A recurring schedule names only its own house's item and vendor

- **Status:** Accepted 2026-10-01 by the founder (his two answers are under Founder answers). It applies two locked rules to two more routes and adds no rule: the item rule of [[0141-a-stock-write-names-the-house-it-is-for]] and the vendor rule of [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]] with [[0221-each-house-owns-its-vendors-now-a-shared-vendor-layer-comes-later-the-word-is-vendors]]. The lane brief defined the fix as unambiguous only if it reused existing checks with their existing answers. The measurement below found that to hold, so the record was first written as Proposed; the founder then accepted it and chose to keep the 403/404 pair.
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder), 2026-10-01, session 9512567d, relayed by the lane coordinator. Both answers are quoted verbatim under Founder answers.
- **Keywords:** recurring orders, recurring_orders, schedule, inventory_id, provider_id, house, tenant, cross-house, assertInventoryBelongsToRestaurant, assertProviderBelongsToRestaurant, Vendor not found, calendar_events, createRecurringOrder, updateRecurringOrder
- **Links:** found by the audit of PR #550 on 2026-10-01 (that PR, `fix/recurring-schedule-edits-need-a-manager`, limits PUT and DELETE on these schedules to managers and owners; it is open); claim `claims.d/fix-recurring-schedule-ids-belong-to-the-house.jsonl:1`; spec `apps/api-gateway/src/procurement/recurring-schedule-ids-belong-to-the-house.http.spec.ts`; register entry `tech-debt.d/2026-10-01-fix-recurring-schedule-ids-belong-to-the-house.md`.

## Context

Line numbers are at `origin/main` 1c1a676f8.

**Neither route checked either id.** `POST /recurring-orders/:restaurantId` (`createRecurringOrder`, `recurring-orders.service.ts:364`) inserted the body's `inventory_id` and `provider_id` as given (`:397-401`). `PUT /recurring-orders/:restaurantId/:id` (`updateRecurringOrder`, `:540`) wrote either one from its allow-list (`:525-538`) as given (`:597`). The DTO's `@IsUUID()` refuses only a value that is not uuid-shaped. `assertInventoryBelongsToRestaurant` was not used in the file. The path house is the session's: `JwtAuthGuard` runs `assertTenantMatch` (`common/tenant/assert-tenant-match.ts`), which refuses a path naming another house.

**What came back, measured.** The spec above, in its first form, ran the real controller, service, DTO pipe and `JwtAuthGuard` (passport stubbed) over an in-memory store holding two houses. Its embeds follow a foreign key into any house, as PostgREST does with the gateway's service-role key. A member of house A got:

| Request | Answer at 1c1a676f8 |
|---|---|
| create, B's `inventory_id` | 201; `wine_name` was B's; 51 calendar rows written in A's house, titled with B's wine name; the approval event carried B's wine name |
| create, B's `provider_id` | 201; `provider_name` was B's; the 51 calendar rows in A's house carried B's `provider_id`; the approval event carried B's vendor name |
| create, a vendor row with no house | 201 |
| update to B's `inventory_id` | 200; then get-one and list both returned B's wine name |
| update to B's `provider_id` | 200; `provider_name` was B's |

**Every reader of the two columns, and what a foreign id stored on a schedule reaches.** Read at 1c1a676f8; none of these was run against production.

| Reader | What it reads | What a foreign id reaches |
|---|---|---|
| Create, update, get-one and list responses (`RECURRING_SELECT`, `:160-166`) | embeds `inventory:inventory_id(wine_name, master_wine_library(name))` and `provider:provider_id(name)` | the other house's item name and vendor name. No price, stock or contact field is embedded. |
| Create's calendar layout (`preCreateCalendarEvents`, `:1109`; title `:1150-1152`, `provider_id` `:1167`) | the projected row | rows written in the caller's own house, carrying the other house's wine name in the title and its `provider_id` |
| Create's approval event (`:450-477`, sent when `auto_approve` is not set) | the projected row | the other house's names, published with the caller's `restaurant_id` |
| The 06:00 reminder (`sendRecurringOrderReminders`, `:713`) | `RECURRING_SELECT` | the other house's names, published with the schedule's `restaurant_id`; it sends nothing unless its flag is armed (`:725`) |
| The 08:00 run (`executeDueRecurringOrders` `:641`, `createOrder` call `:861`) | `inventory_id`, `provider_id` | nothing: `createOrder` refuses another house's item with 403 (`procurement.service.ts:898`) and another house's vendor with 404 (`:906-939`) before it writes. The schedule stays due and is refused again each morning. |
| `execute-check` (`recurring-orders.controller.ts:182`) | the 08:00 run's body | the same as the 08:00 run; non-production, platform operators only |
| The email reminder (`scheduled-tasks.service.ts:522-529`, `recurring-order-reminder.ts:120-135`) | `select("*")`, no embed; names from `wine_name`/`wine_id` and `provider_name`/`preferred_providers` | nothing: `select("*")` returns both ids and it uses neither |
| `recurring_order_agent.py` (`_load_active_recurring_orders`, `:572-591`) | selects neither `inventory_id` nor `provider_id` | nothing |
| `apps/web` `RecurringOrders.tsx` | the list response | the names above; it reads neither id |

**Writes and foreign keys.** No reader writes into another house's rows. Two foreign-key effects follow from a stored foreign id:

- `recurring_orders.inventory_id` and `.provider_id` cascade on delete (`20260901180000_recurring_orders_shape.sql:133-143`). A hard delete of B's item or vendor deletes A's schedule, which is A's own row.
- `calendar_events.provider_id` has no `ON DELETE` clause (baseline `:12426-12430`). A's calendar rows that carry B's vendor id would make a hard DELETE of B's `providers` row fail. The gateway deletes a vendor by setting `is_active` false and `deleted_at` (`providers.service.ts:596-597`). The only hard deletes of a `restaurants` row this lane found are rollbacks of a house just created (`auth.service.ts:1750-1751` and `:1948-1949`, `organizations.service.ts:825-826`), from a search of `apps/api-gateway/src` and `services/`. So no gateway route was found that reaches it.

**How a house's vendor is defined, and the existing checks.** Each house owns its vendor rows, and a row with no house is an orphan shown to no house (ADR 0221, Decision). The checks that already existed:

| Check | Another house's id | Failed read |
|---|---|---|
| Item: `assertInventoryBelongsToRestaurant` (`common/tenant/assert-inventory-belongs-to-restaurant.ts:42`), used by `createOrder`, `verifyReceipt`, the inventory, ledger, POS and communications paths | 403; a missing id gets the same 403 | 422 |
| Vendor, inline in `createOrder` (`procurement.service.ts:906-939`) | 404 "Vendor not found"; a row with no house and a missing id get the same 404 | 503 |
| Vendor, `ProvidersService.getProvider` (`providers.service.ts:442`) and `ProviderIntelligenceService.assertProviderInHouse` | 404 "No provider with id … belongs to this restaurant." | rethrown |
| Vendor, `ConversationsService.assertProviderInHouse` (`conversations.service.ts:387`) | 404 "Vendor not found" | `Error` |

Where a request body names an item or a vendor, the checks above agree per id: 403 for an item, 404 for a vendor. `createOrder`, which every schedule runs through at 08:00, answers exactly that pair. A search of the gateway's non-spec code for a `restaurant_inventory` read followed within twelve lines by a 403 or 404 found one more answer, a 404: `PUT /pricing/wines/:inventoryId/pour` (`target-margin.service.ts:398-409`). There the path id names the row being edited, which is ADR 0147's case, not an id stored on another row.

## Options considered

1. **Check both ids on create, and the ids the body sends on update, with the two checks `createOrder` runs.** Taken. A schedule then cannot be given an item or vendor that its own 08:00 run would refuse as another house's, and the answers match `createOrder`'s.
2. **Answer 404 for a foreign item as well, as ADR 0147 does for a row that is not the caller's.** Not taken; the founder chose to keep the pair (Q2 below). This route would be the only item check answering 404, and changing the shared helper's answer changes every caller's. Recorded under Consequences.
3. **Check at read time instead (filter the embeds by house).** Not taken. The calendar rows and the approval event are written at create, before any read, and the bad id would stay stored.
4. *(Do nothing.)* The 08:00 run stays safe, but a member keeps the ability to store another house's id, read back its names, and write calendar rows in the caller's house that carry them.

## Decision

**Both ids are checked against the caller's house before the schedule is written.**

- **Create** checks both, always, before the insert: the private `assertIdsAreThisHouses` checks a key the object holds, and create passes both keys.
- **Update** checks only the ids the body sent, before it reads or writes the schedule. An edit that sends neither reads neither table.
- **The item** goes through `assertInventoryBelongsToRestaurant`, unchanged: 403 for another house's item or a missing one, 422 when the read fails.
- **The vendor** goes through `assertProviderBelongsToRestaurant`, new in `common/tenant/`. It is `createOrder`'s inline vendor fence moved out with the same query, logs and answers, and `createOrder` now calls it. Another house's vendor, a vendor row with no house and a missing id get 404 "Vendor not found". A failed read gets 503, whose sentence ends with what was not done: "so no order was placed" for `createOrder`, as before, and "so the schedule was not saved" here.
- A refusal writes nothing: no schedule row, no calendar row, no event.

The spec pins it with 13 cases. With the two service files restored to 1c1a676f8 (md5 checked) and the new helper removed, the 10 marked `[REVERT-FAILS]` fail and the 3 others pass; with the fix in place all 13 pass.

**Retire-to-write (CLAUDE.md §4).** This file is the one decision record §5 requires. It retires no document.

## Consequences

- **Easier.** Through these two routes, a schedule can no longer be created with, or moved to, another house's item or vendor. A search of `apps/web/src`, `apps/mobile`, `packages` and `supabase/functions` found no other writer of `recurring_orders`.
- **The 403 sentence speaks of stock.** It is the shared helper's: "A stock movement can only move this restaurant's own inventory, so nothing was written." `createOrder` returns the same sentence. Rewording it changes every caller's, so it is left alone here.
- **Not closed:**
  - **Rows already stored.** A schedule that already holds another house's id keeps it; this change checks writes only. Production was not queried for such rows.
  - **Calendar rows already written** with another house's `provider_id` or wine name stay as they are.
  - **`calendar_events.provider_id` keeps no `ON DELETE` rule**, and `POST /calendar/events` takes a body `providerId` and stores it without a house check (`calendar.service.ts:118`). Both are filed in the register entry linked above.
  - **The PostgreSQL answer to a `null` id on update** (`@IsOptional()` admits `null`) was not run against a database. The check runs on it before any write either way.
- **Revisit** if the founder rules that a body id naming another house's row answers 404 for items as for vendors. That would change `assertInventoryBelongsToRestaurant` for every caller, this one included. On 2026-10-01 he chose to keep the pair and revisit it separately (Q2 below); the trigger stands.

## Founder answers

Given 2026-10-01 (session 9512567d) and relayed by the lane coordinator. The picks and option texts are quoted verbatim.

**Q1, whether to accept this record.** His pick: *"Accept ADR 0249 (Recommended)"*. The option read: *"Mark it Accepted with your words, then run the full review. Create checks both ids. Update checks the ids it is given, before any write. The answers match createOrder's."* Rejected: *"Hold it"* (*"Leave #563 open as Proposed and come back to it later"*).

**Q2, items answering 403 while vendors answer 404.** His pick: *"Keep, revisit separately (Recommended)"*. The option read: *"#563 matches today's answers, and ADR 0249 records the mismatch as a revisit trigger. Changing the shared item check to 404 touches every route that uses it, so it should be its own PR with its own sweep."* Rejected:
- *"Items to 404 in a separate PR now"*: open a follow-up that makes the shared item check answer 404 everywhere, after sweeping its callers and clients that may branch on 403.
- *"Items to 404 inside #563"*: widens #563 to every route that uses the shared check. That means more files and more review, and it mixes two changes.

So #563 keeps 403 for a foreign item and 404 for a foreign vendor, and the revisit trigger under Consequences stands. No follow-up PR is opened by this answer.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | fix lane | Created with the measurement and the fix on `fix/recurring-schedule-ids-belong-to-the-house` |
| 2026-10-01 | Aldemir (founder) | Accepted (Q1); the 403/404 pair kept, to be revisited separately (Q2) |
