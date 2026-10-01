# 0248 — A person's access row decides their role alone, an unreadable one gives no role, and the order seal reads the role strictly

- **Status:** Locked 2026-10-01.
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder). Five answers, all 2026-10-01 in session 9512567d, each relayed to the fix lane by the lane coordinator. The picked options are quoted verbatim with their option text.
  1. **What an access-read error means.** He answered *"Next PR: error means no role (Recommended)"*. The option read: *"Fall back to users.role only when the access read SUCCEEDED and found no row. On a read error, return no role, so managers get 403 during an outage on these routes. One-file change plus tests; behaviour for accounts that predate the access register is unchanged."*
  2. **What the order seal does with a role it cannot read.** The caller sweep below found six callers that do more than refuse once the lookup returns no role. He answered *"Strict for the order seal (Recommended)"*. The option read: *"Ship as decided. The order seal alone reads the role strictly: an unreadable role returns 500 with nothing parked and no audit row, and the person retries. This matches ADR 0020's rule that an outage must not be reported as a fact about the person. The five read views degrade, are recorded in the ADR, and grant nothing. About one extra file plus a spec."*
  3. **The second copy of the rule, `MembersService.assertMembership`.** He answered *"Fold into #561 (Recommended)"*. The option read: *"Apply the same rule to this copy: an access-read error means no role, so the caller gets a 403. That is about 2 more files and a spec, making 9 files. One review covers both copies of the rule."* Rejected: *"Separate PR after #561"* and *"Record only"*.
  4. **Inactive rows and the validity window.** He answered *"Close both in #561"*. The option read: *"Fall back to users.role only when no access row exists at all, and honour the validity window. This widens #561 and changes more callers."* Rejected: *"Count in production, then record (Recommended)"*, which would have run two read-only count queries and recorded the items as OPEN if both were 0; and *"Record only"*.
  5. **The clock the window is read with.** The caller re-sweep found that `valid_from` is stamped by the database and compared with the gateway's clock. He answered *"Small tolerance on valid_from (Recommended)"*. The option read: *"The shared check treats a valid_from up to 2 minutes in the future as already started. Since only the database's now() ever writes it, this cannot let anyone in early in practice. The predicate is also used by the recipient resolver, which gets the same tolerance. That is one line plus a spec in #561."* Rejected: *"Record it as open"* (leave the check exact, and record the skew as open and unmeasured) and *"Ignore valid_from, check only valid_until"*.
- **Keywords:** VALID_FROM_CLOCK_TOLERANCE_MS, clock skew, lookupRestaurantRole, MembersService.assertMembership, isLiveMembership, is_active, valid_from, valid_until, inactive row, held membership, readRestaurantRole, resolveRestaurantRole, assertCanManageRestaurant, user_restaurant_access, users.role, legacy fallback, access-read error, outage, readError, RestaurantRoleUnreadableError, assertApprovalAllowed, order seal, APPROVAL_NEEDED, order_approval_refused, registerAccount, acceptHeldMembership
- **Links:**
  - [[0020-no-fabricated-answers]] (an outage is not a fact about the person).
  - `v3.0-TECH-DEBT.md` 44.1i (the `users`-row fallback admits a stale row as well as a legacy one). This ADR narrows it for these two helpers and does not close it: see "What stays open".
  - `apps/api-gateway/src/common/tenant/live-membership.ts` (`isLiveMembership`, the window test both helpers now apply).
  - claim `claims.d/fix-role-read-error-means-no-role.jsonl:1`.
  - register `tech-debt.d/2026-10-01-fix-role-read-error-means-no-role.md`.
  - specs `apps/api-gateway/src/organizations/role-read-error-means-no-role.spec.ts`, `apps/api-gateway/src/procurement/order-approval-gate.spec.ts` (describe "approveOrder — a role that cannot be read") and `apps/api-gateway/src/restaurants/members.service.spec.ts` (describe "MembersService.assertMembership — the access row decides, and an unreadable one is no role").

## Context

Line numbers are at `origin/main` 2019ae7f6 unless marked "this branch". The sweep was first run at 98dfcb5af. Nothing under `apps/` or `supabase/` changed between 98dfcb5af and 2019ae7f6.

**The lookup.** `lookupRestaurantRole` (`apps/api-gateway/src/organizations/organizations.service.ts:35`) reads the active `user_restaurant_access` row (`:40-46`). If no role comes back, it reads `users.role` and returns it when `users.restaurant_id` is this house. An access read that errors returns no data, so it also reached the `users` read. It set `readError` (`:59-63`) and still returned the legacy role. `readRestaurantRole` with `strict: false` (`:78-94`), which `OrganizationsService.resolveRestaurantRole` (`:254`) uses, returned that role and dropped `readError`. With `strict: true` it threw.

**Why that is a hole.** `registerAccount` inserts `users.role = 'owner'` with `restaurant_id: null` (`apps/api-gateway/src/auth/auth.service.ts:1557-1566`). `acceptHeldMembership` later sets only `users.restaurant_id` (`:3152-3157`), and `users.role` is `varchar(20) DEFAULT 'manager' NOT NULL` (`supabase/migrations/20260805000000_baseline_from_production.sql:5854`). So an account made by `registerAccount` that later joined a house as staff through `acceptHeldMembership` read as that house's owner whenever the access read errored. It then passed `assertCanManageRestaurant` (`organizations.service.ts:297`) and the other non-strict callers below that ask for an owner or a manager.

**It reached every member, not only accounts that predate the access register.** During an access-read error the access row is unreadable for everyone. So everyone whose `users.restaurant_id` named the house was read at `users.role`, including people whose access row says `staff`.

**A row that exists did not decide alone.** The lookup selected only rows with `is_active = true` (`:45`) and returned a role only when it was non-empty (`:48-49`). So:
- an inactive row sent it to `users.role`;
- so did an active row with no role;
- an active row outside its window (`valid_from` in the future, or `valid_until` past) still gave its role, because the window was not read.

**The second copy.** `MembersService.assertMembership` (`apps/api-gateway/src/restaurants/members.service.ts:49-91`) carried the same rule with its own contract: a `users` row with no role reads as `staff` (`:74`), and the answer is a 403 rather than `null`. It discarded the access read's error (`:56`), so an error also reached the `users` row. It filtered `is_active = true` (`:61`) and ignored the window.

## The caller sweep

This is every caller of `lookupRestaurantRole`, `readRestaurantRole`, `resolveRestaurantRole`, `OrganizationsService.readRestaurantRole` and `assertCanManageRestaurant` in `apps/api-gateway/src`. For each it records what an access-read error does there after this change. The answer is now "no role" where it used to be `users.role`. The callers that the row-decides and window rules change are listed after these groups, with the callers of `assertMembership`.

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

**Changed by the row-decides and window rules (answer 4).** The answer changes only for a person whose access row here EXISTS and is not live: inactive, `valid_from` in the future, or `valid_until` past. It also changes for a live row with no role. That person now gets no role, where before an inactive row or an empty role sent the lookup to `users.role`, and an out-of-window row gave its own role.
- **Every caller of the shared lookup listed above, the strict ones included.** A strict reading does not throw here, because no read failed: `null` is a role that satisfies nothing.
  - `authority-grants.service.ts:145`, `vendor-send-authority.service.ts:89` and `:111`, and `storage-locations.service.ts:56` refuse.
  - The relay door (`relay-email.service.ts:494`) reads no role.
  - When a threshold rule fires, the order seal treats the person as holding no role: it parks a PENDING order and files a refusal, as it does for staff.
  - The 403 routes refuse, and the five callers above degrade.
- **Every caller of `assertMembership` (answer 3)** answers 403 "Access denied to this restaurant" for that person, and for anyone during an access-read error. Lines are at `origin/main` 2019ae7f6:
  - `members.service.ts:94` `getMembers`, `:153` `getInvites`, `:199` `updateMemberRole` (owner), `:338-339` `removeMember`, `:583` `addMember` and `:672` `revokeInvite`.
  - `restaurants/operating-hours.service.ts:63` (read) and `:100` (write).
  - `logs/logs.controller.ts:73` `getTimeline`.
  - `removeMember` asks for membership even when a person removes themself (`:338`). Before, an inactive row plus a `users` row naming the house, or an out-of-window row, admitted that person. Now they can no longer leave through it, and their row does not make them a member.

**Who can be in that newly changed state.** This is the lockout check: could a legitimate owner or manager be refused at their own house? It was measured by reading code; no production query was run.
- **No code path deactivates an existing row or writes `valid_until`.** `calendar/stop-links-on-leaving.ts:28-30` says the same. The three removals delete the row after clearing `users.restaurant_id`: `members.service.ts:462` and `:478-483`, and `team/team.service.ts:1274-1294`.
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

**Third question: `MembersService.assertMembership`, which this sweep found with the same access-read-error fallback.**
1. **"Fold into #561 (Recommended)"** (picked).
2. **"Separate PR after #561"** (rejected).
3. **"Record only"** (rejected).

**Fourth question: an inactive row and the validity window, both left open by the first answer.**
1. **"Close both in #561"** (picked).
2. **"Count in production, then record (Recommended)"** (rejected): two read-only counts, then record as OPEN if both were 0.
3. **"Record only"** (rejected).

**Fifth question: `valid_from` is stamped by the database and read with the gateway's clock.**
1. **"Small tolerance on valid_from (Recommended)"** (picked).
2. **"Record it as open"** (rejected): leave the check exact, and record the skew as open and unmeasured.
3. **"Ignore valid_from, check only valid_until"** (rejected).

## Decision

1. **An access read that errors returns `role: null` with `readError` set, and the `users` row is not read** (this branch, `organizations.service.ts:74-79`). `readRestaurantRole` with `strict: true`, and `OrganizationsService.readRestaurantRole`, still throw on that error, with the same message.
2. **The order seal reads the role strictly** (this branch, `procurement.service.ts:4458-4480`). `assertApprovalAllowed` calls `OrganizationsService.readRestaurantRole`. On `RestaurantRoleUnreadableError` it throws 500 before `parkOrderAwaitingApproval` and before `recordApprovalRefusal`: the order is not moved and no refusal row is written. That covers an access-read error, and also a `users` read that errors after the access read found no row. Before, that second case was read as no role: a PENDING order was parked and a refusal was filed. The role is read only when a rule fires (`:4456`), so a seal that no rule gates is unchanged.
3. **The five degrading callers above stay as they are.** `approvalGate` keeps the non-strict reading; this branch pins that it shows `callerRole: null` during an access-read error.
4. **A row that exists decides alone** (this branch, `organizations.service.ts:61-70` and `:85-91`).
   - The lookup reads the person's one row here whatever its `is_active`. `(user_id, restaurant_id)` is UNIQUE (baseline `:8152`), so there is at most one.
   - It selects `is_active, valid_from, valid_until`, and gives the row's role only while `isLiveMembership` holds and the role is non-empty. Otherwise it gives `role: null` with no `readError`, and the `users` row is not read.
   - Only a read that succeeded and found no row falls back to `users.role` when `users.restaurant_id` is this house (`:93-106`), unchanged.
   - `isLiveMembership` is imported, not copied. It treats an absent bound as open, an unparseable one as failing the row, and compares with `Date.now()`, with the `valid_from` tolerance of Decision 7.
5. **`MembersService.assertMembership` keeps the same three rules as its own copy** (this branch, `members.service.ts:62-109`).
   - An access read that errors is logged and answers 403, and the `users` row is not read.
   - A row that exists gives its role only while `isLiveMembership` holds.
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
     - `organizations/organizations.service.ts:88`, `lookupRestaurantRole`: the role lookups.
     - `restaurants/members.service.ts:83`, `assertMembership`.
     - `communications/recipient-resolver.service.ts:403`, `getUserIdsForRoles` (`:377`): who receives a notification addressed to a role.
     - `common/tenant/live-membership.ts:133`, `houseMembersInRoles`. It is read by `websocket/websocket.gateway.ts:671` (owner- and manager-only emits), `common/orchestrator/inbound-responder.service.ts:1533` (manager notifications), `notifications/producers/market-price.producer.ts:132` and `team/access-audit.ts:183` (who is told of an access change).
   - Every code path writes its own `now` into `valid_from`. A start that reads as ahead of the gateway's clock comes from a clock difference, or from a hand-written value.

## Consequences

- **Easier.**
  - A stale `users.role` no longer decides any caller of either helper when the access register cannot be read, or when the person's row here exists.
  - The seal no longer turns an access-read error into a parked order and a refusal row.
  - The two helpers and `isLiveMembership` now agree on what a current membership is.
- **Harder.**
  - During an access-read error, every member is refused on the routes listed under "Refuses with 403", including legitimate owners and managers.
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

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | — | Created on `fix/role-read-error-means-no-role`, with answers 1 and 2. |
| 2026-10-01 | — | Widened on the same branch with answers 3 and 4: the row-decides and window rules, and `MembersService.assertMembership`. |
| 2026-10-01 | — | Answer 5 on the same branch: the two-minute `valid_from` tolerance in `isLiveMembership`. |
