## A recurring schedule stored another house's item or vendor — ~~OPEN~~ CLOSED by `fix/recurring-schedule-ids-belong-to-the-house` — 2026-10-01

Filed by `fix/recurring-schedule-ids-belong-to-the-house` ([ADR 0249](../decisions/0249-a-recurring-schedule-names-only-its-own-houses-item-and-vendor.md)). Found by the audit of PR #550 on 2026-10-01, which recorded it as inherited and owed a register entry. Line numbers are at `origin/main` 1c1a676f8.

**What.** `POST /recurring-orders/:restaurantId` and `PUT /recurring-orders/:restaurantId/:id` stored the body's `inventory_id` and `provider_id` without checking either one's house (`recurring-orders.service.ts:397-401`, `:525-538`, `:597`). In a two-house harness, a member of house A got 201 or 200. The create and update responses named house B's wine or vendor, and get-one and list, read after an update to B's item, named B's wine. Create also wrote calendar rows in A's house that carried B's wine name or B's `provider_id`, and published an approval event with B's names.

**Reach.** Names only: the embeds carry `wine_name`, `master_wine_library.name` and `providers.name` (`:160-166`). The 08:00 run refuses the stored id in `createOrder` before it writes (`procurement.service.ts:898`, `:906-939`). The email reminder and `recurring_order_agent.py` never read either id. The full reader table is in ADR 0249.

**Fix.** Both routes now run `assertInventoryBelongsToRestaurant` (403, or 422 on a failed read) and `assertProviderBelongsToRestaurant` (404 "Vendor not found", or 503 on a failed read) before the schedule is written: create checks both ids, update the ids the body sent. The vendor helper is `createOrder`'s fence moved to `common/tenant/`; `createOrder` calls it too. Pinned by `recurring-schedule-ids-belong-to-the-house.http.spec.ts` (10 cases red on 1c1a676f8) and the claim in `claims.d/fix-recurring-schedule-ids-belong-to-the-house.jsonl`.

## Schedules and calendar rows written before the fix may still name another house — OPEN — 2026-10-01

Filed by `fix/recurring-schedule-ids-belong-to-the-house` (ADR 0249).

**What.** The fix checks writes. A `recurring_orders` row that already holds another house's `inventory_id` or `provider_id` keeps it. Its get-one and list responses still name that house's wine or vendor, and the 08:00 run refuses it every morning without advancing it. Calendar rows the create wrote (`recurring-orders.service.ts:1109-1215` at 1c1a676f8) keep the other house's wine name in `title` and its id in `provider_id`.

**Today.** Production was not queried. On 2026-09-01 `recurring_orders` held 0 rows (`recurring-orders.service.ts:71`); that is not a count of rows like these today.

**Fix (deferred).** Count them with a read-only query that joins `recurring_orders` to `restaurant_inventory` and `providers` and compares `restaurant_id`. Then ask the founder what happens to any found. Rows are not deleted without his word.

## A calendar event stores a body `providerId` without a house check — OPEN — 2026-10-01

Filed by `fix/recurring-schedule-ids-belong-to-the-house` (ADR 0249), found while reading the readers of `recurring_orders.provider_id`. Line numbers are at `origin/main` 1c1a676f8.

**What.** `POST /calendar/events` passes the body DTO to `CalendarService.createEvent`, which writes `provider_id: dto.providerId || null` (`calendar.service.ts:118`). The DTO's `@IsUUID()` (`dto/calendar.dto.ts:176-178`) refuses only a value that is not uuid-shaped. A search of `calendar.service.ts` and `calendar.controller.ts` for a `providers` read before that insert found none. So a member can store another house's vendor id on a calendar event in their own house.

**Why it matters, measured only by reading.** A search of `apps/api-gateway/src/calendar` found no read that embeds `providers` through `calendar_events.provider_id`; the reads there return the id itself (`calendar.service.ts:1163`). `calendar_events.provider_id` has no `ON DELETE` rule (baseline `20260805000000_baseline_from_production.sql:12426-12430`), so a calendar row holding another house's vendor id would make a hard DELETE of that `providers` row fail. The gateway deletes a vendor softly (`providers.service.ts:583-597`).

**Fix (deferred).** Run `assertProviderBelongsToRestaurant` on a present `providerId` in `createEvent`, and in any calendar update that writes `provider_id` (not checked here).
