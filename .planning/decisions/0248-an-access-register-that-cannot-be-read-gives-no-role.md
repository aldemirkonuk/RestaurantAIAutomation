# 0248 — A person's access row decides their role alone, an unreadable one gives no role, and the order seal reads the role strictly

- **Status:** Locked 2026-10-01.
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder). Nine answers, all 2026-10-01 in session 9512567d, each relayed to the fix lane by the lane coordinator. Each question, every option's label and text, and the picked label are copied verbatim from the session transcript under "Options considered".
  1. **What an access-read error means.** He picked "Next PR: error means no role (Recommended)".
  2. **What the order seal and five other callers do with a role they cannot read.** He picked "Strict for the order seal (Recommended)".
  3. **The second copy of the rule, `MembersService.assertMembership`.** He picked "Fold into #561 (Recommended)".
  4. **An inactive row and the validity window.** He picked "Close both in #561".
  5. **The clock the window is read with.** He picked "Small tolerance on valid_from (Recommended)".
  6. **The order in which #561 and the PRs it meets land.** He picked "#561 last + docs PR (Recommended)".
  7. **Whether to fix the record before review.** He picked "Fix now, before review (Recommended)".
  8. **Whether leaving a house and deleting an account honour the window.** He picked "Let leaving and deletion through (Recommended)".
  9. **How many files #561 may land with.** He picked "Allow 17, keep route tests (Recommended)".
- **Keywords:** VALID_FROM_CLOCK_TOLERANCE_MS, clock skew, lookupRestaurantRole, MembersService.assertMembership, isLiveMembership, is_active, valid_from, valid_until, inactive row, held membership, readRestaurantRole, resolveRestaurantRole, assertCanManageRestaurant, user_restaurant_access, users.role, legacy fallback, access-read error, outage, readError, RestaurantRoleUnreadableError, assertApprovalAllowed, order seal, APPROVAL_NEEDED, order_approval_refused, registerAccount, acceptHeldMembership
- **Links:**
  - [[0020-no-fabricated-answers]] (an outage is not a fact about the person).
  - `v3.0-TECH-DEBT.md` 44.1i (the `users`-row fallback admits a stale row as well as a legacy one). This ADR narrows it for these two helpers and does not close it: see "What stays open".
  - `apps/api-gateway/src/common/tenant/live-membership.ts` (`isLiveMembership`, the window test both helpers now apply).
  - claim `claims.d/fix-role-read-error-means-no-role.jsonl:1`.
  - register `tech-debt.d/2026-10-01-fix-role-read-error-means-no-role.md`.
  - specs `apps/api-gateway/src/organizations/role-read-error-means-no-role.spec.ts`, `apps/api-gateway/src/procurement/order-approval-gate.spec.ts` (describe "approveOrder — a role that cannot be read") and `apps/api-gateway/src/restaurants/members.service.spec.ts` (describe "MembersService.assertMembership — the access row decides, and an unreadable one is no role").

## Context

Line numbers are at `origin/main` 2019ae7f6 unless marked "this branch". The sweep was first run at 98dfcb5af. Nothing under `apps/` or `supabase/` changed between 98dfcb5af and 2019ae7f6. [Re-measured 2026-10-01 after rebasing onto `origin/main` 4bd11a00e (#563). #563 changed `procurement/procurement.service.ts` and `procurement/recurring-orders.service.ts`, so every line cited in those two files is at 4bd11a00e. No other cited file changed between 2019ae7f6 and 4bd11a00e.]

**The lookup.** `lookupRestaurantRole` (`apps/api-gateway/src/organizations/organizations.service.ts:35`) reads the active `user_restaurant_access` row (`:40-46`). If no role comes back, it reads `users.role` and returns it when `users.restaurant_id` is this house. An access read that errors returns no data, so it also reached the `users` read. It set `readError` (`:59-63`) and still returned the legacy role. `readRestaurantRole` with `strict: false` (`:78-94`), which `OrganizationsService.resolveRestaurantRole` (`:254`) uses, returned that role and dropped `readError`. With `strict: true` it threw.

**Why that is a hole.** `registerAccount` inserts `users.role = 'owner'` with `restaurant_id: null` (`apps/api-gateway/src/auth/auth.service.ts:1557-1566`). `acceptHeldMembership` later sets only `users.restaurant_id` (`:3152-3157`), and `users.role` is `varchar(20) DEFAULT 'manager' NOT NULL` (`supabase/migrations/20260805000000_baseline_from_production.sql:5854`). So, at the helper, an account made by `registerAccount` that later joined a house as staff through `acceptHeldMembership` read as that house's owner whenever the helper's access read errored. It then passed `assertCanManageRestaurant` (`organizations.service.ts:297`) and the other non-strict callers below that ask for an owner or a manager. Which callers reach that over HTTP is measured under "Reachability end to end": most sit behind a JWT step that reads the same table first.

**At the helper, it reached every member, not only accounts that predate the access register.** When the helper's access read errored, everyone whose `users.restaurant_id` named the house was read at `users.role`, including people whose access row says `staff`.

**A row that exists did not decide alone.** The lookup selected only rows with `is_active = true` (`:45`) and returned a role only when it was non-empty (`:48-49`). So:
- an inactive row sent it to `users.role`;
- so did an active row with no role;
- an active row whose `valid_from` was ahead of the clock, or whose `valid_until` had passed, still gave its role, because the window was not read.

**The second copy.** `MembersService.assertMembership` (`apps/api-gateway/src/restaurants/members.service.ts:49-91`) carried the same rule with its own contract: a `users` row with no role reads as `staff` (`:74`), and the answer is a 403 rather than `null`. It discarded the access read's error (`:56`), so an error also reached the `users` row. It filtered `is_active = true` (`:61`) and ignored the window.

## Reachability end to end

[Correction, 2026-10-01, measured at `origin/main` 1c1a676f8. Nothing under `apps/` changed between 2019ae7f6 and 1c1a676f8. Lines in `procurement.service.ts` and `recurring-orders.service.ts` are re-measured at 4bd11a00e. The questions put to the founder, and the first drafts of this ADR, described each path as if every caller reached the helper directly.]

**The JWT step.** Every route behind `JwtAuthGuard` runs `AuthService.validateJwtPayload` through `JwtStrategy` (`apps/api-gateway/src/auth/auth.service.ts:1426-1493`), in the same request and before any helper.
- It reads the access row for the token's house, filtered on `is_active = true` (`:1435-1442`).
- A read error answers 503, "Could not confirm your role in this house" (`:1471-1479`).
- No active row answers 401 `HOUSE_ACCESS_ENDED` (`:1481-1487`).
- Otherwise it sets `house_role` from that row's role, which can be null (`:1489-1492`). It does not read `valid_from` or `valid_until`.
- `JwtAuthGuard` then requires a house unless the route carries `@AllowsNoHouse()` (`auth/guards/jwt-auth.guard.ts:94`; `common/tenant/assert-house-chosen.ts:16-21`).
- It also requires any `restaurantId` or `restaurant_id` in the path, query or body to equal the token's house (`jwt-auth.guard.ts:74`; `common/tenant/assert-tenant-match.ts`).

**Which callers sit behind it, and for which house.**
- **The token's house, behind `JwtAuthGuard`.** Every controller caller in the sweep below except the two named next takes its house either from the token (`@CurrentUser("restaurantId")`, `user.restaurantId`, `houseOf`, `houseActor`, or the controllers' `scope`/`house` helpers) or from a tenant-compared `:restaurantId` (members, operating hours, logs, inventory). The leave route compares `body.restaurantId` the same way (`auth/auth.controller.ts:429-436`). No route in the sweep carries `@AllowsNoHouse()`.
  - That includes the procurement routes for cancel, approve and the credit claim (`procurement/procurement.controller.ts:336`, `:555`, `:392`), and the approval gate (`:423`).
  - The relay's person door also runs the JWT step: `RelayDoorGuard` extends `JwtAuthGuard` (`communications/relay/relay-door.guard.ts:58`, `:78`).
- **A house the JWT step did not check, behind `JwtAuthGuard`.**
  - `GET` and `PATCH /organizations/locations/:id` take the house from `:id`, which is not tenant-compared (`organizations/organizations.controller.ts:96-121`). They reach `assertManagerOrOwner` for that house.
  - `DELETE` of the account calls `removeMember`, and so `assertMembership` for the person themself, for every house where they hold an active row, not only the token's (`auth.service.ts:4538`).
- **No JWT step.** The recurring-orders cron (`procurement/recurring-orders.service.ts:708`, `@Cron("0 8 * * *")`) calls `approveOrder` for a schedule set to auto-approve (`:956`). That reaches the seal's strict read, when a threshold rule fires, with no JWT step in front of it.
  - This was found by searching the 34 files under `apps/api-gateway/src` that declare `@Cron`, `@Interval`, `setInterval`, `@SubscribeMessage`, `@OnEvent`, `@EventPattern` or `@MessagePattern` for calls into the helpers and their callers. The procurement auto-send interval (`procurement.service.ts:8255`) calls none.
  - The `isLiveMembership` audience readers (Decision 7) compute who receives a message; they gain only the tolerance.

**Each path, end to end.**
- **An access-read error.**
  - Over HTTP on a token-house route, the JWT step's own read of the same table answers 503 first when it errors.
  - The helper's path is reached only in a narrow window: the JWT step's read succeeds and the helper's separate read in the same request errors.
  - It is also reached on `/organizations/locations/:id`, and from the recurring-orders cron.
- **An inactive row, or no row at all, at the token's house.** The JWT step answers 401 first. Over HTTP the helper's inactive-row path and its no-row fallback are reached only on `/organizations/locations/:id`, and from the cron.
  - `DELETE` of the account reads only active rows, so it does not meet an inactive one.
- **An active row outside its window.** The JWT step passes it. On 1c1a676f8 the helpers gave its role; now they give no role. That is reachable over HTTP. A person removing themself is the one exception: under the eighth answer, the leave route and `DELETE` of the account let such a row through (Decision 9).
- **An active row with no role.** The JWT step passes it with `house_role: null`. On 1c1a676f8 the shared lookup then fell back to `users.role`; now it gives no role. That is reachable over HTTP.

**Specs measure the helper.** The specs on this PR call the helpers, the services and the controllers directly. They never run `validateJwtPayload`. Where a case measures an outcome that the JWT step reaches first over HTTP, the spec says so in its header.

## The caller sweep

This is every caller of `lookupRestaurantRole`, `readRestaurantRole`, `resolveRestaurantRole`, `OrganizationsService.readRestaurantRole` and `assertCanManageRestaurant` in `apps/api-gateway/src`. For each it records what an access-read error does there after this change. The answer is now "no role" where it used to be `users.role`. The callers that the row-decides and window rules change are listed after these groups, with the callers of `assertMembership`.

**Unchanged.** These already threw on any `readError`:
- `readRestaurantRole` with `strict: true`:
  - `organizations/authority-grants.service.ts:145`
  - `organizations/vendor-send-authority.service.ts:89` and `:111` (the vendor-send gate)
  - `storage-locations/storage-locations.service.ts:56`
- `OrganizationsService.readRestaurantRole` (`organizations.service.ts:276-286`), which throws `RestaurantRoleUnreadableError`: `communications/relay/relay-email.service.ts:494`.

**Refuses with 403 and writes nothing.** This is the founder's first answer. When the helper's access read errors, these refuse every member, where before `users.role` decided. Over HTTP the JWT step answers 503 first when its own read errors (see "Reachability end to end"):
- **`assertManagerOrOwner`:** `updateLocation` (`organizations.service.ts:402`) and `getLocation` (`:355`). `getLocation` is a GET: the restaurant record is refused.
- **`assertCanManageRestaurant` on writes:**
  - `settings/settings.controller.ts:136, 201, 271, 335, 402`
  - `mcp-connections/mcp-connections.controller.ts:104` (nine routes), and `mcp-connections/mcp-connections.service.ts:1005` (a write-tool call) and `:1065`
  - `calendar/calendar.controller.ts:977`
  - `mcp-server/mcp-keys.controller.ts:95` and `:121`
  - `integrations/integrations-oauth.controller.ts:154`
  - `distributor-feed/distributor-feed.controller.ts:95` and `:158`
  - `procurement/procurement.service.ts:3431` (order cancel, via `:3467` and `:3599`) and `:5751` (never-arrived credit claim)
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
- `assertApprovalAllowed` (`procurement/procurement.service.ts:4374`) read the role at `:4445` after a threshold rule fired.
- On a role that does not satisfy the rule, it moves a PENDING order to APPROVAL_NEEDED (`parkOrderAwaitingApproval`, `:4451`, body `:4610-4636`). It then inserts an `order_approval_refused` row into `system_audit_log` (`recordApprovalRefusal`, `:4454`; insert at `order-approval-gate.ts:134`) and throws 403.
- With the lookup change alone, every member's threshold-tripping seal, when the seal's own access read errored, would be parked and filed as "This session could not be shown to hold any role at this house". Over HTTP that is the narrow window after the JWT step's read succeeded; from the recurring-orders cron it is any such error.

**Does more than refuse: five callers that degrade.** These are recorded, not changed. None of them grants anything. All five sit behind `JwtAuthGuard` and use the token's house. Over HTTP they degrade on an access-read error only when the JWT step's read succeeded and the helper's own read errored. They also degrade for a row the JWT step passes but the helper does not: one outside its window, or one with no role.
1. **The approval ceremony.** `approvalGate` (`procurement.service.ts:4494`, role at `:4545`) serves `GET /procurement/order-approval-gate` (`procurement/procurement.controller.ts:413`). It returns `callerRole: null`, with `mayApprove: false` and a refusal sentence on each order a rule gates.
2. **Arrival asks.** `arrival-asks.service.ts:116-123` (`mayAnswer`) feeds `asks()` (`:213-215`) and `incomplete()` (`:229-239`), which back `arrival-asks.controller.ts:58` and `:102`. They return `forYou: false`, an empty list and the "not for you" sentence.
3. **The arrival read.** `arrival.service.ts:92-103` serves `GET /arrival` (`arrival.controller.ts:32`). It catches the 403 and sets `canManage = false`, so vendor terms and the vendors' usual currencies are withheld with "Vendor terms are available to this house's owner or manager." (`:125-143`).
4. **Catalogue admission.** This one is part of an upload, not a read view. `catalog-ingest.service.ts:214-227` runs inside `POST /procurement/documents` (`documents.controller.ts:995`, `:1101`). It catches the refusal: the file is stored, its prices are not admitted, and the 2xx body says admitting is a manager's act.
5. **Texting senders.** `text-senders.controller.ts:98-108` (`GET`) returns `crewConsents: null` ("not yours to see") instead of the count.

**Changed by the row-decides and window rules (answer 4).** The answer changes only for a person whose access row here EXISTS and is not live: inactive, `valid_from` more than 120 s ahead of the gateway's clock (Decision 7), or `valid_until` at or before that clock. It also changes for a live row with no role. At the helper, that person now gets no role, where before an inactive row or an empty role sent the lookup to `users.role`, and an out-of-window row gave its own role. Over HTTP on a token-house route, the JWT step refuses an inactive row first, so there only the window and empty-role cases reach the helper (see "Reachability end to end").
- **Every caller of the shared lookup listed above, the strict ones included.** A strict reading does not throw here, because no read failed: `null` is a role that satisfies nothing.
  - `authority-grants.service.ts:145`, `vendor-send-authority.service.ts:89` and `:111`, and `storage-locations.service.ts:56` refuse.
  - The relay door (`relay-email.service.ts:494`) reads no role.
  - When a threshold rule fires, the order seal treats the person as holding no role: it parks a PENDING order and files a refusal, as it does for staff.
  - The 403 routes refuse, and the five callers above degrade.
- **Every caller of `assertMembership` (answer 3)** answers 403 "Access denied to this restaurant" for that person, and for anyone during an access-read error. The exception is a person removing themself, admitted by any row that exists (Decision 9). Lines are at `origin/main` 2019ae7f6:
  - `members.service.ts:94` `getMembers`, `:153` `getInvites`, `:199` `updateMemberRole` (owner), `:338-339` `removeMember`, `:583` `addMember` and `:672` `revokeInvite`.
  - `restaurants/operating-hours.service.ts:63` (read) and `:100` (write).
  - `logs/logs.controller.ts:73` `getTimeline`.
  - `removeMember` asks for membership even when a person removes themself (`:338`). The window rule made a row outside its window refuse that person, so leaving and `DELETE` of the account answered 403 for such a row. The founder's eighth answer closed that before review: see Decision 9. A person removing themself is admitted by any row that exists, and the window still applies to every other caller.

**Who can be in that newly changed state.** This is the lockout check: could a legitimate owner or manager be refused at their own house? It was measured by reading code; no production query was run. On a token-house route over HTTP, the JWT step already refuses an inactive row with 401 whatever this PR does. So for an inactive row the check matters at `/organizations/locations/:id` and the cron; for the window it matters everywhere.
- **No gateway code deactivates an existing row, and no code in this repository writes `valid_until`.** `calendar/stop-links-on-leaving.ts:28-30` says the same for the gateway. The three removals delete the row after clearing `users.restaurant_id`: `members.service.ts:462` and `:478-483`, and `team/team.service.ts:1274-1294`.
- **One SQL function can set `is_active` on an existing row: `seed_sim_restaurant(jsonb)`.**
  - It upserts each access row in its payload, setting `is_active` from the payload (default true) and, on conflict, overwriting the existing row's `is_active` (`20260805000000_baseline_from_production.sql:1489-1500`).
  - Only `service_role` may execute it (`20260917010400_a_security_definer_rpc_answers_only_to_the_server.sql:73-75`).
  - It refuses a payload restaurant whose slug does not start with `sim-` (`20260805000000_baseline_from_production.sql:1417-1420`). It does not check the access rows' own `restaurant_id`.
  - Its one caller, `scripts/synth/seed.py`, builds those rows for the sim house with `is_active: True` (`:371-378`), and its direct-SQL path runs the same upsert (`:564-576`).
  - So no code in the repository passes it an inactive row today; a hand-built payload could.
- **One path writes an inactive row: `joinViaInvite`'s held membership** (`auth/auth.service.ts:2903`). `acceptHeldMembership` activates it and stamps `valid_from` with the gateway's clock (`:3127-3134`).
  - A new account names no house while it is held (`:2867`), so it has no fallback to lose.
  - An existing account can be held only at a house where it has no row at all (`:2793-2806` refuses one that has any row).
  - If that account's `users.restaurant_id` already named that house, it held the house through the `users` fallback alone. It now loses that until it accepts the hold, at the invited role.
  - That needs a member known only by the `users` row. Production, read-only, 2026-09-18: of the 8 users whose `users.restaurant_id` named a house, 1 had no access row there. Migration `20260918153000_a_setup_era_manager_holds_their_house_by_a_row.sql:9-21` records that count, and its body writes that person an active manager row.
  - After that migration was applied, a read-only re-measure the same day found 0 `users` rows naming a house without an active row there. This is recorded in the ADR 0164 bracket of claim `ADR-0162-USERS-ROW-FALLBACK-RETIRED`, `CLAIMS.jsonl:361`.
  - Not re-measured since. One writer can still leave a `users` row naming a house with no row: `registerRestaurant` does not read the error of its owner-row insert (`auth.service.ts:1882-1890`). That person keeps the fallback, because the new rule bites only when a row exists.
- **The window.**
  - Every access-row insert takes `valid_from` from the database default `now()` (baseline `:5817`). The inserts are at `auth.service.ts:1719, 1882, 2628, 2898`, `organizations.service.ts:812` and `restaurants/members.service.ts:631`. `acceptHeldMembership` writes the gateway's time (`auth.service.ts:3133`).
  - `isLiveMembership` compared `valid_from` with the gateway's `Date.now()` exactly (`live-membership.ts:39-55`). So a row inserted with the database's clock read as not yet valid while the gateway's clock was behind the database's.
  - That included a new house's first owner row (`createFirstHouse`, `auth.service.ts:1719-1725`, before its tokens are minted at `:1740`), for the length of that skew and no longer.
  - The skew was not measured. The founder's fifth answer adds a two-minute tolerance: see Decision 7.
- **A live row with no role.** The role CHECK admits NULL (`20260902200000_team_access_role_is_a_known_role.sql:62-63`). Every insert passes a role. Production on 2026-09-02 held 0 NULL roles (that migration's header, `:29-30`).
- **First-house and onboarding flows.**
  - `registerAccount` writes no row and names no house (`auth.service.ts:1557-1566`).
  - `createFirstHouse` writes the owner's active row before it mints tokens (`:1713-1740`).
  - An owner with no row at all keeps the `users` fallback, unchanged.

**Outside both helpers.** These are not changed by this ADR:
- `pricing/price-locks.service.ts:578-612` reads access rows in a batch and, on an error, skips the marker it would draw (`accessKnown`).
- `team/team.service.ts:185-220` (`TeamService.assertAccess`) discards the access read's error (`:198`). On no active row it reads a matching `users` row as `staff`, never `users.role` (`:216`). It reads `is_active` alone.
- `AuthService.generateInvite`, and the target reads in `MembersService.updateMemberRole` and `removeMember`, read the access row and the `users` row their own way.
- `assertProviderBelongsToRestaurant` (`common/tenant/assert-provider-belongs-to-restaurant.ts:31`, added by #563 at 4bd11a00e) reads only `providers` (`id`, `restaurant_id`) and no role. #563 adds no call to either helper; its only mention of `assertCanManageRestaurant` is a stub in its spec.

## Options considered

Copied verbatim from the session transcript (`AskUserQuestion` calls at the times shown, UTC). The question is quoted as it was put; where its premise was wrong, see "Corrected premises" below.

**First question, asked 2026-10-01T13:25:31.178Z.** Picked: "Next PR: error means no role (Recommended)".

> The hole itself predates these PRs and sits in the shared role helper (organizations.service.ts:40-64). It affects order cancel, recurring-schedule edits (#550) and order recurrence (#558). When the access-register read errors, a staff member whose account was made before joining gets 'owner' from the stale users.role and passes the manager check. How should it be closed?

- "Next PR: error means no role (Recommended)" (picked): "Fall back to users.role only when the access read SUCCEEDED and found no row. On a read error, return no role, so managers get 403 during an outage on these routes. One-file change plus tests; behaviour for accounts that predate the access register is unchanged."
- "Next PR: fix the stale data" (not picked): "Accepting an invite also writes the invited role to users.role, plus a migration to backfill existing rows. Fixes the source, but touches a legacy column other code may read; needs a sweep of its readers first."
- "Both, in two PRs" (not picked): "Error means no role now, then the data fix after a reader sweep. Most complete, two PRs of review."
- "Record only" (not picked): "File it in the tech-debt register as OPEN with no fix scheduled."

**Second question, asked 2026-10-01T13:34:20.667Z.** Picked: "Strict for the order seal (Recommended)".

> Building 'error means no role', the builder stopped at its caller sweep. Most of the roughly 60 callers simply refuse with 403, as you chose, but six do more than refuse when the role comes back empty. One writes: an order seal that trips an approval rule is moved to APPROVAL_NEEDED, with an audit row saying the person holds no role (procurement.service.ts:4455). Five are read views that quietly degrade: the approve button disabled, arrival asks hidden, vendor terms withheld, catalogue prices stored but not admitted, and a crew-consent count hidden. Today all six take the stale users.role during an access-read outage. How should they behave?

- "Strict for the order seal (Recommended)" (picked): "Ship as decided. The order seal alone reads the role strictly: an unreadable role returns 500 with nothing parked and no audit row, and the person retries. This matches ADR 0020's rule that an outage must not be reported as a fact about the person. The five read views degrade, are recorded in the ADR, and grant nothing. About one extra file plus a spec."
- "Ship as decided, record all six" (not picked): "One-file fix plus tests. During an outage the seal parks the order for a manager and writes an audit row with no role, and the five views degrade. All six are recorded in the ADR as how the system behaves when it fails closed."
- "Tell all six apart from 'no role'" (not picked): "Each of the six shows 'could not be read' or returns 503 instead of degrading. The most precise option, at about 6-8 files plus specs, still within 15. The most review surface."

**Third question, asked 2026-10-01T14:08:12.255Z.** Picked: "Fold into #561 (Recommended)".

> The role-fallback PR is open as #561 (ADR 0248, 7 files, 20 new cases, red on main). Its builder found a second copy of the same hole: MembersService.assertMembership (restaurants/members.service.ts:56-74) ignores its access-read error, then takes users.role. It gates the owner and manager actions on members, at members.service :153, 199, 339, 586 and 672, plus the operating-hours routes. A staff member with a stale 'owner' users row could act as owner there during an access-read outage. What should happen?

- "Fold into #561 (Recommended)" (picked): "Apply the same rule to this copy: an access-read error means no role, so the caller gets a 403. That is about 2 more files and a spec, making 9 files. One review covers both copies of the rule."
- "Separate PR after #561" (not picked): "#561 stays as reviewed so far. A second small PR fixes the members copy. Smaller diffs, but two review cycles, and the hole stays open longer."
- "Record only" (not picked): "File it OPEN in #561's tech-debt fragment with no fix scheduled."

**Fourth question, asked 2026-10-01T14:08:12.255Z.** Picked: "Close both in #561".

> Measured in code for the two paths you said to decide after measurement. (1) Inactive access row plus legacy users.role: no gateway code ever sets is_active=false on an existing row, and every removal clears users.restaurant_id first. It is reachable only through hand-run SQL, one held-invite edge case, or rows left over from before an older fix. (2) valid_from/valid_until: no code or migration ever writes them, so they are reachable only through a hand-written value. Production was not queried. What next?

- "Count in production, then record (Recommended)" (not picked): "Run two read-only count queries on production: inactive access rows whose user's restaurant_id still names that house, and access rows with valid_from or valid_until set. If both are 0, record both as OPEN in ADR 0248 with the counts. If either is not 0, I come back to you."
- "Record only" (not picked): "Record both as OPEN in ADR 0248 from the code measurement alone, without querying production."
- "Close both in #561" (picked): "Fall back to users.role only when no access row exists at all, and honour the validity window. This widens #561 and changes more callers."

**Fifth question, asked 2026-10-01T14:51:41.409Z.** Picked: "Small tolerance on valid_from (Recommended)".

> #561 now covers all four of your answers (13 files, 26 cases that fail on main, 0c72d4e51). Its builder found no path that locks a legitimate owner out for good, but did find one short-lived risk. The access row's valid_from is stamped by the database clock (now()), while the new window check compares it with the gateway's clock. If the gateway's clock runs even slightly behind the database's, a brand-new row reads as 'not yet valid'. That includes a new house's first owner row. The person gets 403 on manager routes until the clocks pass each other, usually milliseconds to seconds, and it heals on its own. It was not measured. Nothing else ever writes valid_from. How should it be handled?

- "Small tolerance on valid_from (Recommended)" (picked): "The shared check treats a valid_from up to 2 minutes in the future as already started. Since only the database's now() ever writes it, this cannot let anyone in early in practice. The predicate is also used by the recipient resolver, which gets the same tolerance. That is one line plus a spec in #561."
- "Record it as open" (not picked): "Leave the check exact and record the skew risk in ADR 0248 as open and unmeasured. A new owner could briefly see a 403 if the gateway's clock lags."
- "Ignore valid_from, check only valid_until" (not picked): "Since nothing writes a future start date, honour only the end of the window. This drops half of your 'honour the validity window' answer for a value nothing sets today."

**Sixth question, asked 2026-10-01T16:33:38.415Z.** Picked: "#561 last + docs PR (Recommended)".

> #561's planner found a merge-order problem. #550 (already PASSed) has a test, 'lets a legacy manager of this house edit and deactivate', that fails the access read and expects success; its claim pins that title. #561 makes that case a 403. Whichever PR lands second goes red. ADRs 0246 and 0247 (#550, #558) also describe today's fallback, which becomes false once #561 lands. #550 and #558 have no fix rounds left. How should they land?

- "#561 last + docs PR (Recommended)" (picked): "Merge #547, #538, #550 and #558 first. Then #561 rebases and flips #550's test and claim pin, which makes 16 files: one over the 15 cap, allowed once. A small docs PR corrects the fallback sentences in ADRs 0246 and 0247 and the claim texts. #561 and the docs PR each get a full review. No waived rounds on #550 or #558."
- "#561 last, stay within 15" (not picked): "Same order. #561 moves its ADR 0248 caller-list additions and its tech-debt fragment into the docs PR to stay at 15 files. ADR 0248 is briefly incomplete until the docs PR lands."
- "#561 first" (not picked): "Merge #561 before #550 and #558. Each then needs another fix round to flip its test, claim and prose. Both are at their cap, so that is two more waivers and two more full reviews."

**Seventh question, asked 2026-10-01T16:33:38.415Z.** Picked: "Fix now, before review (Recommended)".

> Before review, #561's planner also found these in ADR 0248. (a) The rejected options it records for your answers are paraphrased or missing, although they are in the transcript. (b) 'No code path deactivates an existing row' is too broad, because seed_sim_restaurant can set is_active. (c) Two sentences still say 'valid_from not in the future' after the 2-minute tolerance. (d) One premise I gave you was wrong: acceptHeldMembership does write valid_from, from the gateway's own clock. The planner judges that your tolerance answer stands, because it compares against that same clock. Fix these before the reviewers run?

- "Fix now, before review (Recommended)" (picked): "Treat it as part of the build, since no reviewer has ruled. Copy every option verbatim from the transcript, scope the two sentences, and record the corrected premise. Then run the full review on the new head."
- "Review as is" (not picked): "Run both reviewers now. A block on the verbatim records is likely, and the fix would then use #561's first fix round."

**Eighth question, asked 2026-10-01T17:18:48.480Z.** Picked: "Let leaving and deletion through (Recommended)".

> One consequence of 'Close both in #561', newly measured: once the validity window is honoured, a person whose access row is still active but outside its dates is refused when they try to leave that house (403). Deleting their whole account also stops with a 403 at that house. Such a row exists only if someone writes a date by hand; no code writes valid_until. But it would block someone from leaving or deleting their account. How should #561 handle it?

- "Let leaving and deletion through (Recommended)" (picked): "Removing yourself and deleting your account need only an existing row, not a live one, so nobody is ever trapped. Every other check keeps honouring the window. A small change plus a spec in #561, still within its 16 files."
- "Record it as open" (not picked): "Keep #561 as built, and record the trap in ADR 0248 as open. It is reachable only through a hand-written date."

**Ninth question, asked 2026-10-01T17:42:22.365Z.** Picked: "Allow 17, keep route tests (Recommended)".

> #561 now has the leave-and-delete fix, at 15 files. The only spec that drives leaving and account deletion end to end is a file #561 did not touch before. It now pins: an expired row can leave (200), DELETE /auth/me completes for an expired row, and an expired manager still cannot remove someone else. The rebase onto #550 adds 2 more files, so #561 would land at 17, not the 16 you allowed. Which do you want?

- "Allow 17, keep route tests (Recommended)" (picked): "Keep the end-to-end route cases. I change the twelfth bracket on #547 to 17 before you merge it, and ADR 0248 says 17. It is one more file of review, with stronger evidence."
- "Stay at 16, service tests only" (not picked): "Move the cases into members.service.spec.ts as service-level tests. That loses the route-level 200s and the end-to-end account-deletion case, but keeps your 16-file allowance as written."
## Corrected premises

Two questions above rested on statements about the code that were wrong. They are corrected here; the answers stand, for the reasons given.

- **Who writes `valid_from`.**
  - What the questions said: the fourth question said of `valid_from`/`valid_until`, "no code or migration ever writes them". The fifth said "Nothing else ever writes valid_from", and its picked option said "Since only the database's now() ever writes it".
  - The fact: `acceptHeldMembership` writes `valid_from` from the gateway's clock when it activates a held row: `valid_from: new Date().toISOString()` (`apps/api-gateway/src/auth/auth.service.ts:3133`).
  - Why the answers stand: that value is stamped by a gateway clock and compared against a gateway clock. It reads as ahead only when the two readings come from clocks that differ (two gateway instances, or one clock set back after the write). That is the same case the tolerance covers for the database's stamp. The database-stamped inserts, which the tolerance was chosen for, are unchanged.
- **Who can deactivate a row.**
  - What the fourth question said: "no gateway code ever sets is_active=false on an existing row". That holds for the gateway.
  - The fact: this ADR's own first draft said "No code path deactivates an existing row". That was too broad: the SQL function `seed_sim_restaurant(jsonb)` can (see "Who can be in that newly changed state").
  - Why the answer stands: under the fourth answer an inactive row gives no role whoever wrote it.
- **How far the paths reach.**
  - What the questions said: the first question said a staff member "passes the manager check" when the access-register read errors. The third said a staff member "could act as owner there during an access-read outage". The fourth described an inactive row plus `users.role` as a path in use.
  - The fact: those premises overstated end-to-end reachability. Over HTTP on a token-house route, the JWT step answers 503 when its own read of the same table errors, and 401 when the house has no active row, before any helper runs (see "Reachability end to end").
  - Why the answers stand: each decision stands as defence in depth. It covers callers with no JWT step (the recurring-orders cron), routes whose house the JWT step did not check (`/organizations/locations/:id`), and the narrow window where the JWT step's read succeeds and the helper's own read errors.

## Decision

1. **An access read that errors returns `role: null` with `readError` set, and the `users` row is not read** (this branch, `organizations.service.ts:80-85`). `readRestaurantRole` with `strict: true`, and `OrganizationsService.readRestaurantRole`, still throw on that error, with the same message.
2. **The order seal reads the role strictly** (this branch, `procurement.service.ts:4448-4470`). `assertApprovalAllowed` calls `OrganizationsService.readRestaurantRole`. On `RestaurantRoleUnreadableError` it throws 500 before `parkOrderAwaitingApproval` and before `recordApprovalRefusal`: the order is not moved and no refusal row is written. That covers an access-read error, and also a `users` read that errors after the access read found no row. Before, that second case was read as no role: a PENDING order was parked and a refusal was filed. The role is read only when a rule fires (`:4446`), so a seal that no rule gates is unchanged.
3. **The five degrading callers above stay as they are.** `approvalGate` keeps the non-strict reading; this branch pins that it shows `callerRole: null` during an access-read error.
4. **A row that exists decides alone** (this branch, `organizations.service.ts:67-76` and `:92-98`).
   - The lookup reads the person's one row here whatever its `is_active`. `(user_id, restaurant_id)` is UNIQUE (baseline `:8152`), so there is at most one.
   - It selects `is_active, valid_from, valid_until`, and gives the row's role only while `isLiveMembership` holds and the role is non-empty. Otherwise it gives `role: null` with no `readError`, and the `users` row is not read.
   - Only a read that succeeded and found no row falls back to `users.role` when `users.restaurant_id` is this house (`:100-113`), unchanged.
   - `isLiveMembership` is imported, not copied. It treats an absent bound as open, an unparseable one as failing the row, and compares with `Date.now()`, with the `valid_from` tolerance of Decision 7.
5. **`MembersService.assertMembership` keeps the same three rules as its own copy** (this branch, `members.service.ts:71-123`).
   - An access read that errors is logged and answers 403, and the `users` row is not read.
   - A row that exists gives its role only while `isLiveMembership` holds. The one exception is a person removing themself: Decision 9.
   - Only no row at all reads `users.role || "staff"`, unchanged.
   - It is not routed through the shared lookup because its contract differs: `|| "staff"` and a 403 rather than `null`.
   - Its access read is no longer a swallowed read, so `scripts/read_error_baseline.json` drops `members.service.ts::user_restaurant_access::access` (151 to 150).
6. **The OPEN tripwire `ADR-0162-USERS-ROW-FALLBACK-RETIRED` is re-pinned, not retired** (`CLAIMS.jsonl:361`, edited in place).
   - It fired because it pins the exact text of both fallbacks.
   - The fallback still exists for a person with no row at all, so the claim stays OPEN.
   - Its indexes 0 and 1 now pin the new text.
7. **`isLiveMembership` treats a `valid_from` up to two minutes ahead of `now` as started** (this branch, `common/tenant/live-membership.ts:41` and `:63`).
   - The constant is the exported `VALID_FROM_CLOCK_TOLERANCE_MS = 120_000`, and the boundary is inclusive: exactly 120 s ahead is live, 120,001 ms is not.
   - `valid_until` has no tolerance.
   - Every caller of the predicate gets the tolerance, and for each the only change is that a row whose `valid_from` sits at most two minutes ahead of the gateway's clock reads as started. The callers on this branch:
     - `organizations/organizations.service.ts:95`, `lookupRestaurantRole`: the role lookups.
     - `restaurants/members.service.ts:95`, `assertMembership`.
     - `communications/recipient-resolver.service.ts:403`, `getUserIdsForRoles` (`:377`): who receives a notification addressed to a role.
     - `common/tenant/live-membership.ts:133`, `houseMembersInRoles`. It is read by `websocket/websocket.gateway.ts:671` (owner- and manager-only emits), `common/orchestrator/inbound-responder.service.ts:1533` (manager notifications), `notifications/producers/market-price.producer.ts:132` and `team/access-audit.ts:183` (who is told of an access change).
   - Every code path writes its own `now` into `valid_from`: the database's on insert, the gateway's in `acceptHeldMembership`. A start that reads as ahead of the gateway's clock comes from a clock difference, or from a hand-written value. See "Corrected premises".
8. **Merge order (the sixth answer): #561 lands last.** #547, #538, #550 and #558 merge first. With the two #550 files below, this PR then has 17 files, two over the 15-file cap, as the founder's ninth answer chose. The extra file on this PR is recorded in ADR 0231.
   Then this branch rebases onto that main and does three things, which are planned and not yet done:
   - **#550's test.** `apps/api-gateway/src/procurement/recurring-schedule-edits-need-a-manager.http.spec.ts` has a case named "lets a legacy manager of this house edit and deactivate". It fails the access read and expects 200. That spec stubs the JWT step, so the case measures the helper: over HTTP the JWT step would answer 503 first if its own read failed. Under Decision 1 that caller gets 403 at the helper, so the case is changed to expect 403 with nothing written. The verify of claim `RECURRING-SCHEDULE-EDITS-NEED-A-MANAGER` names that title, so it is updated with it.
   - **The caller list.** It gains the `assertCanManageRestaurant` callers those PRs add: two in `procurement/procurement.service.ts` (#538), PUT and DELETE in `procurement/recurring-orders.controller.ts` (#550), and one in `procurement/order-recurrence.service.ts` (#558).
   - **The docs PR.** A separate docs PR corrects the fallback sentences in ADRs 0246 and 0247 and the claim texts of #550 and #558.

9. **Removing oneself needs only a row that exists** (the eighth answer; this branch, `restaurants/members.service.ts:63-76` and `:92-97`, called at `:369-376`).
   - `assertMembership` takes `opts.removingSelf`. When it is set, a row that exists admits the person whether or not it is live, at its role, or `staff` when the role is empty.
   - `removeMember` passes it only when the actor is the target. That covers the leave route (`auth.service.ts:4451`), `DELETE` of the account (`:4538`), and `DELETE /restaurants/:restaurantId/members/:memberId` when a person names themself (`restaurants/members.controller.ts:74-84`).
   - No other caller passes it.
   - An access read that errors still gives no role, and no row at all still goes to the `users` fallback.
   - Removing someone else still needs a live owner or manager row.
   - Over HTTP the JWT step passes an active row outside its window, so the leave route and `DELETE` of the account answer 200 for it. An inactive row at the token's house is still refused 401 by the JWT step first.
   - Pinned by `apps/api-gateway/src/auth/leave-and-delete-account.routes.spec.ts` (the full app, with the JWT step stubbed): an expired and a not-yet-valid row can leave, an account with an expired row is deleted, and an expired manager is refused when removing another member.
   - The resolved claim `ADR-0162-OWNERS-REMOVE-OWNERS` (`CLAIMS.jsonl:358`) and the OPEN tripwire `ADR-0162-USERS-ROW-FALLBACK-RETIRED` (`:361`) pin that text exactly. Both are re-pinned in place.

## Consequences

- **Easier.**
  - A stale `users.role` no longer decides any caller of either helper when the access register cannot be read, or when the person's row here exists.
  - The seal no longer turns an access-read error into a parked order and a refusal row.
  - The two helpers and `isLiveMembership` now agree on what a current membership is.
- **Harder.**
  - When the helper's access read errors, every member is refused on the routes listed under "Refuses with 403", including legitimate owners and managers. Over HTTP that shows only in the narrow window where the JWT step's read succeeded, and on `/organizations/locations/:id`.
  - The five callers above degrade.
  - The seal answers 500 when a rule fires and the role cannot be read.
  - None of the above happens when the access read succeeds, except the seal's 500 on a failed `users` read.
  - A person whose row here is inactive, outside its window or empty gets no role from either helper, whatever `users.role` says.
- **Revisit when:**
  - Access-read errors are seen in production often enough that the 403s or the 500 reach real people. The 500 message names the read that failed.
  - A legitimate owner or manager is refused because their row here is not live. A gateway clock more than two minutes behind the database's would do it.

## What stays open

Each item was measured on this branch by reading code. No production query was run.

- **The stale data itself.** `registerAccount` still writes `users.role = 'owner'` (`auth.service.ts:1557-1566`). `acceptHeldMembership` still sets only `users.restaurant_id` (`:3152-3157`), and it activates the person's row as it does so. Since a row that exists now decides alone, that `owner` is read only for a person with no row at all at the house.
- **(c) `team/team.service.ts:169-183` says the legacy `users` row "proves MEMBERSHIP ONLY, never privilege" (`:173`).** The no-row fallback in both helpers contradicts that: it returns `users.role` as the person's role there. It is unchanged by this ADR.
- **Other readers of the same two tables are unchanged.** They are listed under "Outside both helpers".
  - `TeamService.assertAccess` still reads `is_active` alone. Its `valid_until` gap stays filed at `tech-debt.d/2026-09-29-docs-merge-queue-followups-2026-09-29.md:89-94`, which this ADR closes for `MembersService.assertMembership` only.
  - The last-owner counts that entry names are also unchanged.
- **A clock more than two minutes behind the database's.** Beyond the tolerance, a just-written row still reads as not yet started. The skew was not measured.

**Closed by this ADR:**
- **(a) An inactive row plus a `users` row naming this house no longer reads `users.role`.** This is the founder's fourth answer. Who could be in that state is measured under "Who can be in that newly changed state".
- **(b) The validity window is honoured** by both helpers, through `isLiveMembership`.
- **(d) `MembersService.assertMembership`'s access-read-error fallback is closed.** This is the founder's third answer.
- **The clock skew on `valid_from` is covered up to two minutes.** This is the founder's fifth answer; see Decision 7.
- **Leaving and account deletion are not trapped by a row outside its window.** This is the founder's eighth answer; see Decision 9.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | — | Created on `fix/role-read-error-means-no-role`, with answers 1 and 2. |
| 2026-10-01 | — | Widened on the same branch with answers 3 and 4: the row-decides and window rules, and `MembersService.assertMembership`. |
| 2026-10-01 | — | Answer 5 on the same branch: the two-minute `valid_from` tolerance in `isLiveMembership`. |
| 2026-10-01 | — | Answers 6 and 7, before review: every question and option copied verbatim from the transcript, the deactivation sentence scoped, the `valid_from` sentences corrected for the tolerance, the corrected premises recorded, and the merge order with its planned rebase work. |
| 2026-10-01 | — | Answer 8, before review: a person removing themself needs only a row that exists. |
| 2026-10-01 | — | Answer 9, before review: the PR may land with 17 files and keeps the route-level leave and delete cases. Rebased onto 4bd11a00e (#563); the lines cited in `procurement.service.ts` and `recurring-orders.service.ts` are re-measured there. |
