# 0248 — An access register that cannot be read gives no role, and the order seal reads the role strictly

- **Status:** Locked 2026-10-01.
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder). Two answers, both 2026-10-01 in session 9512567d, each relayed to the fix lane by the lane coordinator. The picked options are quoted verbatim with their option text.
  1. **What an access-read error means.** He answered *"Next PR: error means no role (Recommended)"*. The option read: *"Fall back to users.role only when the access read SUCCEEDED and found no row. On a read error, return no role, so managers get 403 during an outage on these routes. One-file change plus tests; behaviour for accounts that predate the access register is unchanged."*
  2. **What the order seal does with a role it cannot read.** The caller sweep below found six callers that do more than refuse once the lookup returns no role. He answered *"Strict for the order seal (Recommended)"*. The option read: *"Ship as decided. The order seal alone reads the role strictly: an unreadable role returns 500 with nothing parked and no audit row, and the person retries. This matches ADR 0020's rule that an outage must not be reported as a fact about the person. The five read views degrade, are recorded in the ADR, and grant nothing. About one extra file plus a spec."*
- **Keywords:** lookupRestaurantRole, readRestaurantRole, resolveRestaurantRole, assertCanManageRestaurant, user_restaurant_access, users.role, legacy fallback, access-read error, outage, readError, RestaurantRoleUnreadableError, assertApprovalAllowed, order seal, APPROVAL_NEEDED, order_approval_refused, registerAccount, acceptHeldMembership
- **Links:**
  - [[0020-no-fabricated-answers]] (an outage is not a fact about the person).
  - `v3.0-TECH-DEBT.md` 44.1i (the `users`-row fallback admits a stale row as well as a legacy one). This ADR does not close it: see "What stays open".
  - claim `claims.d/fix-role-read-error-means-no-role.jsonl:1`.
  - register `tech-debt.d/2026-10-01-fix-role-read-error-means-no-role.md`.
  - specs `apps/api-gateway/src/organizations/role-read-error-means-no-role.spec.ts` and `apps/api-gateway/src/procurement/order-approval-gate.spec.ts` (describe "approveOrder — a role that cannot be read").

## Context

Line numbers are at `origin/main` 2019ae7f6 unless marked "this branch". The sweep was first run at 98dfcb5af. Nothing under `apps/` or `supabase/` changed between 98dfcb5af and 2019ae7f6.

**The lookup.** `lookupRestaurantRole` (`apps/api-gateway/src/organizations/organizations.service.ts:35`) reads the active `user_restaurant_access` row (`:40-46`). If no role comes back, it reads `users.role` and returns it when `users.restaurant_id` is this house. An access read that errors returns no data, so it also reached the `users` read. It set `readError` (`:59-63`) and still returned the legacy role. `readRestaurantRole` with `strict: false` (`:78-94`), which `OrganizationsService.resolveRestaurantRole` (`:254`) uses, returned that role and dropped `readError`. With `strict: true` it threw.

**Why that is a hole.** `registerAccount` inserts `users.role = 'owner'` with `restaurant_id: null` (`apps/api-gateway/src/auth/auth.service.ts:1557-1566`). `acceptHeldMembership` later sets only `users.restaurant_id` (`:3152-3157`), and `users.role` is `varchar(20) DEFAULT 'manager' NOT NULL` (`supabase/migrations/20260805000000_baseline_from_production.sql:5854`). So an account made by `registerAccount` that later joined a house as staff through `acceptHeldMembership` read as that house's owner whenever the access read errored. It then passed `assertCanManageRestaurant` (`organizations.service.ts:297`) and the other non-strict callers below that ask for an owner or a manager.

**It reached every member, not only accounts that predate the access register.** During an access-read error the access row is unreadable for everyone. So everyone whose `users.restaurant_id` named the house was read at `users.role`, including people whose access row says `staff`.

## The caller sweep

This is every caller of `lookupRestaurantRole`, `readRestaurantRole`, `resolveRestaurantRole`, `OrganizationsService.readRestaurantRole` and `assertCanManageRestaurant` in `apps/api-gateway/src`. For each it records what an access-read error does there after this change. The answer is now "no role" where it used to be `users.role`.

**Unchanged.** These already threw on any `readError`:
- `readRestaurantRole` with `strict: true`:
  - `organizations/authority-grants.service.ts:145`
  - `organizations/vendor-send-authority.service.ts:89` and `:111` (the vendor-send gate)
  - `storage-locations/storage-locations.service.ts:56`
- `OrganizationsService.readRestaurantRole` (`organizations.service.ts:276-286`), which throws `RestaurantRoleUnreadableError`: `communications/relay/relay-email.service.ts:494`.

**Refuses with 403 and writes nothing.** This is the founder's first answer. During an access-read error these refuse every member, where before `users.role` decided:
- **`assertManagerOrOwner`:** `updateLocation` (`organizations.service.ts:402`) and `getLocation` (`:355`). `getLocation` is a GET: the restaurant record is refused.
- **`assertCanManageRestaurant` on writes:**
  - `settings/settings.controller.ts:136, 201, 271, 335, 402`
  - `mcp-connections/mcp-connections.controller.ts:104` (nine routes), and `mcp-connections/mcp-connections.service.ts:1005` (a write-tool call) and `:1065`
  - `calendar/calendar.controller.ts:977`
  - `mcp-server/mcp-keys.controller.ts:95` and `:121`
  - `integrations/integrations-oauth.controller.ts:154`
  - `distributor-feed/distributor-feed.controller.ts:95` and `:158`
  - `procurement/procurement.service.ts:3441` (order cancel, via `:3477` and `:3609`) and `:5761` (never-arrived credit claim)
  - `procurement/documents/documents.controller.ts:1671/1676` (currency restate and its seal mint)
  - `inventory/inventory.controller.ts:60`
  - `menus/menus.controller.ts:115` and `:228`
  - `payment-methods/payment-methods.controller.ts:155, 234, 263, 288`
  - `pricing/pricing.controller.ts` (eight routes)
  - `billing/billing.controller.ts:189` and `:250`
  - `communications/text/credits/text-credits.controller.ts:256` and `:312`
  - `communications/text/text-senders.controller.ts:171, 206, 244, 279`. `:279` is the WhatsApp reply route, a send: it refuses and nothing is sent.
  - `arrival/arrival.service.ts` `manage()` (`:69`) on writes at `:204, 374, 516, 611, 632, 699, 718, 898, 986`.
- **`assertCanManageRestaurant` on GETs:** the read is refused.
  - `calendar.controller.ts:951` (iCal links)
  - `integrations-oauth.controller.ts:128` (house grants)
  - `distributor-feed.controller.ts:62` (codes)
  - `payment-methods.controller.ts:213` (list)
  - `billing.controller.ts:147` (provider)
  - `text-credits.controller.ts:232` (meter)
  - `providers/scorecard/vendor-scorecard.controller.ts:141` (vendor mail)
- **`resolveRestaurantRole`, then a refusal:**
  - `settings/house-ask-training.service.ts:93` (owner)
  - `settings/data-terms/house-data-terms.service.ts:110` (owner): accepting the data terms, its seal, and tone scoring via `settings.controller.ts:466`
  - `providers/providers.controller.ts:461` (usual currency)
  - `menus/menus.controller.ts:80`: a 403 only when a price is put on the current menu (`menus/menus.service.ts:669`)
  - `procurement/arrival-asks.service.ts` `notYet` (`:254-260`)

**Does more than refuse: the order seal.** This is the founder's second answer, built on this branch.
- `assertApprovalAllowed` (`procurement/procurement.service.ts:4384`) read the role at `:4455` after a threshold rule fired.
- On a role that does not satisfy the rule, it moves a PENDING order to APPROVAL_NEEDED (`parkOrderAwaitingApproval`, `:4461`, body `:4620-4646`). It then inserts an `order_approval_refused` row into `system_audit_log` (`recordApprovalRefusal`, `:4464`; insert at `order-approval-gate.ts:134`) and throws 403.
- With the lookup change alone, every member's threshold-tripping seal during an access-read error would be parked and filed as "This session could not be shown to hold any role at this house".

**Does more than refuse: five callers that degrade.** These are recorded, not changed. None of them grants anything.
1. **The approval ceremony.** `approvalGate` (`procurement.service.ts:4504`, role at `:4555`) serves `GET /procurement/order-approval-gate` (`procurement/procurement.controller.ts:413`). It returns `callerRole: null`, with `mayApprove: false` and a refusal sentence on each order a rule gates.
2. **Arrival asks.** `arrival-asks.service.ts:116-123` (`mayAnswer`) feeds `asks()` (`:213-215`) and `incomplete()` (`:229-239`), which back `arrival-asks.controller.ts:58` and `:102`. They return `forYou: false`, an empty list and the "not for you" sentence.
3. **The arrival read.** `arrival.service.ts:92-103` serves `GET /arrival` (`arrival.controller.ts:32`). It catches the 403 and sets `canManage = false`, so vendor terms and the vendors' usual currencies are withheld with "Vendor terms are available to this house's owner or manager." (`:125-143`).
4. **Catalogue admission.** This one is part of an upload, not a read view. `catalog-ingest.service.ts:214-227` runs inside `POST /procurement/documents` (`documents.controller.ts:995`, `:1101`). It catches the refusal: the file is stored, its prices are not admitted, and the 2xx body says admitting is a manager's act.
5. **Texting senders.** `text-senders.controller.ts:98-108` (`GET`) returns `crewConsents: null` ("not yours to see") instead of the count.

**Outside the helper.** These are not changed by this ADR:
- `pricing/price-locks.service.ts:578-612` reads access rows in a batch and, on an error, skips the marker it would draw (`accessKnown`).
- `team/team.service.ts:185-220` (`TeamService.assertAccess`) discards the access read's error (`:198`). On no row it reads a matching `users` row as `staff`, never `users.role` (`:216`).
- `MembersService.assertMembership` is not covered: see "What stays open" (d).

## Options considered

**First question: what an access-read error means.** The coordinator relayed the options he did not pick by these names; their full option text is not in this record.
1. **Error means no role** (picked). One file plus tests. It leaves the stale `users.role` data in place.
2. **"Fix the stale data"**: `acceptHeldMembership` writes the invited role, plus a backfill. It fixes the data the hole reads, and leaves the fallback reading `users.role` during an outage.
3. **"Both, in two PRs."**
4. **"Record only."**

**Second question: the six callers that do more than refuse.**
1. **"Strict for the order seal (Recommended)"** (picked).
2. **"Ship as decided, record all six"** (rejected). The seal would park the order and file a refusal during an outage.
3. **"Tell all six apart from 'no role'"** (rejected). About six to eight files: each caller would answer "could not be read" instead of degrading.

## Decision

1. **An access read that errors returns `role: null` with `readError` set, and the `users` row is not read** (this branch, `organizations.service.ts:59-64`). An access read that succeeds and finds no active row still falls back to `users.role` when `users.restaurant_id` is this house (`:66-82`). `readRestaurantRole` with `strict: true`, and `OrganizationsService.readRestaurantRole`, still throw on that error, with the same message.
2. **The order seal reads the role strictly** (this branch, `procurement.service.ts:4458-4480`). `assertApprovalAllowed` calls `OrganizationsService.readRestaurantRole`. On `RestaurantRoleUnreadableError` it throws 500 before `parkOrderAwaitingApproval` and before `recordApprovalRefusal`: the order is not moved and no refusal row is written. That covers an access-read error, and also a `users` read that errors after the access read found no row. Before, that second case was read as no role: a PENDING order was parked and a refusal was filed. The role is read only when a rule fires (`:4456`), so a seal that no rule gates is unchanged.
3. **The five degrading callers above stay as they are.** `approvalGate` keeps the non-strict reading; this branch pins that it shows `callerRole: null` during an access-read error.

## Consequences

- **Easier.** A stale `users.role` no longer decides any caller of this lookup when the access register cannot be read. The seal no longer turns that error into a parked order and a refusal row.
- **Harder.**
  - During an access-read error, every member is refused on the routes listed under "Refuses with 403", including legitimate owners and managers.
  - The five callers above degrade.
  - The seal answers 500 when a rule fires and the role cannot be read.
  - None of the above happens when the access read succeeds, except the seal's 500 on a failed `users` read.
- **Revisit when:**
  - Access-read errors are seen in production often enough that the 403s or the 500 reach real people. The 500 message names the read that failed.
  - Or (a) below is measured to be reachable in production.

## What stays open

Each item was measured on this branch by reading code. No production query was run.

- **The stale data itself.** `registerAccount` still writes `users.role = 'owner'` (`auth.service.ts:1557-1566`). `acceptHeldMembership` still sets only `users.restaurant_id` (`:3152-3157`). So the no-row fallback still reads that `owner` for a person whose access row is missing or inactive.
- **(a) An INACTIVE access row plus a `users` row naming this house reads `users.role`.** The lookup filters `is_active = true` (`organizations.service.ts:45`), and the founder's option keeps the no-row fallback unchanged. Every path in `apps/api-gateway/src`, `supabase/migrations`, `services/` and `scripts/` that sets `is_active = false` on an access row or deletes one:
  - `MembersService.removeMember` clears `users.restaurant_id` for that house before it deletes the row, in both branches (`restaurants/members.service.ts:462`, `:478-483`; `clearUsersRowHouse` `:544-559`).
  - `TeamService.deleteMember`, which `removeMember` hands a rostered person to, clears it at `team/team.service.ts:1274-1278` before deleting at `:1290-1294`.
  - `AuthService.leaveRestaurant` goes through `removeMember` (`auth.service.ts:4451`).
  - `AuthService.deleteAccount` goes through `removeMember` for each active house (`:4538`), then deletes every access row and the `users` row (`:4546-4554`).
  - `scripts/delete_demo_house.py` deletes the house, and `users.restaurant_id` is `ON DELETE SET NULL` (its header, `:25`).
  - No code path sets `is_active = false` on an existing access row; `calendar/stop-links-on-leaving.ts:28-30` says the same. The deactivation trigger (`20260926120000_a_house_membership_that_ends_is_remembered.sql:122`) records the ending and does not clear `users.restaurant_id`.
  - One path WRITES an inactive row: `joinViaInvite`'s held membership (`auth.service.ts:2903`, `is_active: !held`).
    - For a new account, `users.restaurant_id` stays null while the address is unproven (`:2867`).
    - For an existing account with no access row at that house (`:2793-2806`), `users.restaurant_id` is not written. If it already named that house, the held row changes nothing: the fallback read `users.role` before the row existed and still does.

  **So (a) is reachable only through a hand-run SQL deactivation, the held-row case just described, or rows left before the clear-first order.** That order was 44.1j, closed 2026-09-18. Whether such rows exist in production was not measured.
- **(b) The lookup ignores `valid_from` and `valid_until`.** Read: it filters `is_active` alone (`organizations.service.ts:40-46`). `isLiveMembership` checks all three (`common/tenant/live-membership.ts:39-55`).
  - No access-row insert in the gateway sets either column (`auth.service.ts:1719, 1884, 2628, 2898`; `organizations.service.ts:812`; `restaurants/members.service.ts:631`). `valid_from` defaults to `now()` (baseline `:5817`).
  - Nothing in the gateway writes `valid_until` on an access row (`stop-links-on-leaving.ts:28-30`). No migration does either: a grep found only reads, in `20260819000000_guest_identity_minimal_slice.sql:473` and `:499`.
  - **So (b) is reachable only through a hand-written value.** The same gap in `TeamService.assertAccess` and `MembersService.assertMembership` is filed in `tech-debt.d/2026-09-29-docs-merge-queue-followups-2026-09-29.md:89-94`.
- **(c) `team/team.service.ts:169-183` says the legacy `users` row "proves MEMBERSHIP ONLY, never privilege" (`:173`).** The no-row fallback in this lookup contradicts that: it returns `users.role` as the person's role here. It is unchanged by this ADR.
- **(d) `MembersService.assertMembership` has the same access-read-error fallback, and it is not changed here.**
  - Found by this sweep. It discards the access read's error (`restaurants/members.service.ts:56`; `scripts/read_error_baseline.json` lists `members.service.ts::user_restaurant_access::access`). On no data it returns `users.role || "staff"` when `users.restaurant_id` is this house (`:74`).
  - It gates owner or manager acts at `members.service.ts:153, 199, 339, 586, 672` and `restaurants/operating-hours.service.ts:101-105`.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | — | Created on `fix/role-read-error-means-no-role`, with both answers above. |
