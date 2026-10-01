## The phone's Today screen served staff order amounts, approve cards and revenue — ~~OPEN~~ FIXED by `fix/phone-feed-no-money-for-staff` — 2026-10-01

Filed by `fix/phone-feed-no-money-for-staff`. Found by the people research recorded in ADR 0253 (`0253-a-job-and-the-right-to-do-it-are-given-in-one-step-and-staff-get-a-jobs-first-screen.md`, "Second finding"; on branch `fix/closed-stays-closed`, not yet on `main`). Ruled the same day in ADR 0253 "Answered 2026-10-01 (round 2)": the founder answered *"Close it to staff (Recommended)"* to "On the web, staff never see prices. The phone's Today feed shows staff order amounts, approve cards and today's revenue. Close that?". Line numbers are at `origin/main` 4bd11a00e.

**What.** `GET /mobile/feed` and `GET /mobile/today-pulse` had no role logic. The controller passed only `userId` and `restaurantId` (`mobile.controller.ts:37-40`, `:52-62`). Every member got an order-approval card for each pending order, with the amount in `amount` (`mobile.service.ts:64-69`, `:80`) and again in the subtitle (`:301-306`), and `counts.orderApprovals`. The pulse read Toast for every member and returned `revenueToday`, `checksToday`, `revenueLastWeek` and `deltaPct` (`:198-219`).

**Fix.** The controller now passes `req.user.role` to both reads. That is the caller's role in the token's house, which `JwtStrategy.validate` re-reads from `user_restaurant_access` on every request (ADR 0162). `seesHouseMoney(role)` decides who sees money, using the order-approval gate's existing rank rule `roleSatisfies(role, "manager")`. Only owners and managers pass. A null, absent, empty or unknown role gets the staff view. Anyone else gets:
- no order-approval cards;
- no `amount` key on any card;
- no `counts.orderApprovals`;
- no Toast read and none of the four sales keys.

The figures are left out, not sent as `null` or `0`, because a withheld figure is not "no amount" (ADR 0016, ADR 0020).

On the phone, `amount`, `orderApprovals` and the four sales figures are now optional types. `salesWithheld` reads a missing `revenueToday` key as "not yours to see", so a staff member does not get the "Connect Toast" line. The pulse strip draws no revenue and hides itself when nothing is left to say. The Insights tab does not draw its "Sales tonight" card.

A staff member who holds a live `vendor_send` grant still gets the staff view. The feed does not read grants.

**Fix round 1: notification cards.** Found by the branch's verifier: the feed also turns the caller's unread notifications into `alert` and `receipt_verification` cards, with the row's `message` as the subtitle and its whole `metadata` as `meta` (`mobile.service.ts:162-199` at 6a714f2a4). Several writers put money there and write to every member, staff included, so `getFeed(…, "staff")` returned `subtitle: "62 checks, $4,210.00."` and `meta.revenue: 4210` off a sale record. For a caller who does not see money, the feed now:
- uses the message as the subtitle only when the type is on `MONEY_FREE_NOTIFICATION_TYPES`; any other type, including one nobody writes yet, gets the card's neutral line (`""` for an alert, "Confirm the physical count against the invoice." for a receipt card);
- cuts `meta` to `NON_MONEY_META_KEYS` (`orderId`, `orderNumber`, `wineName`, `quantity`); the phone reads no `meta` key (grep of `apps/mobile`).

Text is never scrubbed. Owner and manager output is byte-identical to 6a714f2a4 and to 4bd11a00e: a one-off comparison under a fixed clock, over producer-shaped rows with null messages, null metadata and the `meta` alias, matched byte for byte. That comparison was a scratch spec and is not committed.

The list comes from a census of every writer of `notifications` on 2026-10-01, which found 50 types and one that takes its type from the request body (`POST /notifications`, the caller's own rows). One read-only pass covered the writers outside `notifications/producers/`; I read the producers and re-read about 15 of the other writers' templates. Left off the list, because at least one writer puts money or another person's words in the sentence:
- `service_closed`: `sale-record.producer.ts:167-190`, revenue and best-seller revenue, to the whole house.
- `invoice_received`:
  - `invoice-confirmed.producer.ts:149-185`, the total and tie-out delta, to the whole house;
  - `procurement.service.ts:6866-6886`, a price-variance sentence (`invoice-match.ts:809`) plus `effectiveUnitCost` and `creditDue`, to the whole house.
- `goal_reached`: `goal-reached.producer.ts:187`, `ceiling-held.producer.ts:199`; a currency goal's figures.
- `price_change`: `market-price.producer.ts:241`.
- `price_index_upload`: price-move percentages.
- `promo_digest`: `promotion-extractor.service.ts:242`.
- `delivery_proposal`: `delivery.service.ts:598`, "Money at risk".
- `authority_grant_issued` and `authority_grant_reapproved`: the grant's limit, `authority-grants.service.ts:535-567`.
- ~~`system`: the own-wage notice shares it, `own-wage-notice.ts:115-140`.~~ Fix round 2 moved the wage notice to its own type, `team_member_own_wage_set`, which is left off instead, and put `system` back on the list. See "Fix round 2" below.
- `system_alert`: `sendSystemAlert` takes any text.
- `deal`, `order_verification` and `vendor_reply`: an LLM summary of a negotiation, `inbound-responder.service.ts:401`, `:610`.
- `vendor_deal_declined` and `vendor_letter_declined`: the decliner's typed reason, `vendor-send-requests.service.ts:703`.

What this costs staff, on the feed card only:
- ~~schedule, broadcast, note, Away and access rows (`system`) show their title without the sentence;~~ no longer, since fix round 2: these show their sentence again;
- the verify-delivery `invoice_received` row (`procurement.service.ts:5598`) loses its bottle count.

Titles are not gated. No writer puts an amount into a title. The two that carry figures are:
- `price_change`, a percentage, written to owners and managers only;
- `goal_reached`, whose title is the goal's own name.

The `@ApiOperation` text now describes all of this.

On the phone, when the pulse request fails and there is no body to read the withholding from, `drawSalesCard` draws the Insights "Sales tonight" card only for a session role of `owner` or `manager`, the role `/auth/me` gave the phone (`state/session.ts:28-29`). A staff member's failed request no longer reads "Connect Toast on the web dashboard". An owner whose role the phone does not know, and whose request failed, now sees no card instead of that line. Once there is a body, the gateway's answer decides.

Tests that pin it:
- `mobile/mobile-feed-money-for-staff.spec.ts` enters at the controller. It has 43 cases:
  - Round 0: 22 cases, 18 of which fail on 4bd11a00e. Four source mutations each failed it: every role sees money, any role but `staff` sees money, the controller drops the role, and a full revert.
  - Round 1: 21 cases built from producer-shaped rows. Restoring round 0's notification handling fails 18 of the 43. Of 12 further mutations, each failed it, from 2 to 13 cases each:
    - the message goes to everyone;
    - the whole metadata goes to everyone;
    - a denylist replaces the allowlist;
    - `service_closed` or `system` is called money-free;
    - `creditDue` is called non-money;
    - owners lose the message;
    - owners get the cut metadata;
    - `order_delivered` is dropped from the list;
    - the meta is cut to nothing;
    - the receipt card says the raw message;
    - the alert card carries the whole metadata.
- `pulseStripView.test.ts`:
  - Round 0 added 3 cases. All 3 fail when `salesWithheld` returns false.
  - Round 1 added 3 `drawSalesCard` cases. Each of 3 mutations failed one: the fallback always draws, the fallback fails open, and the body is ignored for an owner.
- The claim in `claims.d/fix-phone-feed-no-money-for-staff.jsonl` kills 21 of 21 mutations, run on scratch copies of the two files. They include `const money = true` and `role !== "staff"` in either read, which round 0's verify missed. The claim fails on 4bd11a00e and on 6a714f2a4. Fix round 2 replaced this claim; see below.

**Fix round 2: the founder's two answers (2026-10-01, AskUserQuestion).**

1. **Own limit: *"Show their own limit (Recommended)"*. Not built; stopped and reported.** The instruction was: gate on recipient == grantee if the row carries the grantee, otherwise stop. The row does not carry the grantee.
   - **The only writer.** `authority_grant_issued` and `authority_grant_reapproved` come from `AuthorityGrantsService.tell()` alone (`authority-grants.service.ts:514-584`, `type: authority_grant_${what}` at `:570`). The one SQL writer, `authority_tell_owners`, is called only with `authority_grant_suspended` (`20261116100600_a_grant_waits_for_an_owner_when_its_voucher_goes.sql:145-151`, `:214`).
   - **Who receives it.** Every owner, plus the grantee (`:566`, `owners` from `ownersAndManagers(...).owners` at `:526`).
   - **What it says.** Every copy carries the same sentence, naming the grantee's limit (`:536`, `:541`, `:549`). So each owner's copy is about someone else's grant.
   - **What the row stores.** Metadata is `{ grantId, change }` (`:579`) and `user_id` is the recipient. Nothing on the row says whether the recipient is the grantee.
   - **Who could leak.** The feed's non-money caller holding such a row is either the grantee (their own limit, which the founder wants shown) or an owner who was later demoted in the same house (someone else's limit, which must stay quiet). The feed cannot tell them apart from the row.
   - **What stays.** Both types stay off `MONEY_FREE_NOTIFICATION_TYPES`, as in round 1. A staff grantee's card shows the title without the limit. The claim fails if either type is added to the list.
   - **Options for the founder:**
     - (a) **Recommended.** Stamp `granteeUserId` into `tell()`'s metadata. The feed then shows the sentence only when `meta.granteeUserId === userId`. Rows written before the change carry no stamp and stay quiet. Cost: one line in `tell()`, one comparison in the feed, a CLAIMS row. Old rows never gain the limit.
     - (b) Look up each grant row's grantee by `grantId` at feed time. Old rows are covered too, but every feed read touches the grants table, and a deleted grant reads as "not yours".
     - (c) Leave it as is. The limit stays on the Notifications screen, which shows every row in full (Open item 2 below).
2. **Staff notices: *"Give wages its own type (Recommended)"*. Built.**
   - **The type.** The own-wage notice (`team/own-wage-notice.ts`, `recordOwnWageChange`, owners only) is now stored with `type` and `notification_type` set to `team_member_own_wage_set`. That is the action name it already wrote to `system_audit_log` and to its own metadata (`OWN_WAGE_ACTION`). It follows the `team_member_*` audit-action naming that the notice was already read by.
   - **No migration.** `notifications.type` is `varchar(100) DEFAULT 'system'` with no CHECK constraint and no enum. The only constraints are the primary key and the restaurant foreign key (`20260805000000_baseline_from_production.sql:3952-3982`). No later migration adds one: grep of `supabase/migrations` for `notifications` constraints.
   - **The web inbox** files the new type under System (`nt-format.ts:122`), as it did for `system`.
   - **`system` is back on `MONEY_FREE_NOTIFICATION_TYPES`.** First, every writer of `system` was re-read. The gateway has eight literal sites, and none puts money in the sentence:
     - `passkeys.service.ts:1051`: a passkey added or removed, with its nickname, sent to the person themselves.
     - `access-audit.ts:129` (`recordAccessChange`, sent to the person it happened to):
       - role changed (`members.service.ts:307-310`);
       - pay access on and off: "you now see wages…", with no figure (`team.service.ts:720-729`);
       - removed from the team (`team.service.ts:1366-1376`);
       - zone setup (`storage-locations.service.ts:388-397`);
       - area lead and Away set or ended (`house-areas.service.ts:431`, `:647`, `:725`). The other three `audit` calls there (`:348`, `:402`, `:484`) send no notice.
     - `access-audit.ts:197` (`noticeToHouseLeads`): a self-leave, sent to owners and managers, with shift counts only (`team.service.ts:1386-1402`).
     - `away-release.service.ts:231`: a held team message, in its author's words.
     - `schedule.service.ts:550`: schedule published, with the week date.
     - `schedule.service.ts:955`: a call-out, with role, date and times.
     - `team.controller.ts:621`: a team broadcast, in its author's words.
     - `notes.service.ts:471`: a note, in its author's words.
     
     Writers whose type is a variable never produce `system`:
     - `inbound-responder` `n.type`;
     - scheduled-tasks `payload.type`;
     - vendor-send-requests `notice.type`;
     - producer-ledger `event.payload.type`;
     - `POST /notifications`, which writes the caller's own rows only (`notifications.controller.ts:257-258`). Its `notification_type` is NOT NULL, so a body without a type fails rather than defaulting to `system`.
     
     `git log -S'type: "system"'` shows no removed writer.
   - **`sendSystemAlert` now stores `system_alert`** (`notifications.service.ts:509`), not `system`. It writes any caller's words to every member. It has no caller today: its route was closed under ADR 0149.
   - **Old wage rows: the guard is kept.** Rows written as `system` by the wage notice from #440 (0c16f8434, 2026-09-28) until this deploys may exist. Production was **not queried**, so whether any exist is unverified. `isOwnWageNotice(meta)` (`mobile.service.ts:125-128`) blanks a row whose metadata `action` is `team_member_own_wage_set`, under any type. It compares against the writer's imported constant. The wage writer always stamped that action (0c16f8434), so every old row is recognised.
     - Such a row reaches a non-money caller only as an owner later demoted in the same house: the notice goes to owners only.
     - The guard was chosen over a backfill because it needs no production write and also covers rows written by old code between merge and deploy.
   - **Tests.** `mobile/mobile-feed-money-for-staff.spec.ts` has 52 cases, up from 43. They cover:
     - the wage writer's type, run through `recordOwnWageChange` itself;
     - `sendSystemAlert` storing `system_alert`;
     - `system` on the list and the wage type off it;
     - three `system` notices (schedule, team message, role change) giving staff their sentence and no metadata;
     - an old `system`-typed wage row and a grant notice giving staff `""`.
     
     Each of these mutations failed the spec:

     | Mutation | Cases failed |
     |---|---|
     | Wage type back to `system` (`type`, `notification_type`, or both) | 1 each |
     | Guard removed, never matching, always matching, or reading the type | 12 each |
     | `system` dropped from the list | 7 |
     | Wage type called money-free | 2 |
     | `authority_grant_issued` called money-free | 13 |
     | `sendSystemAlert` back to `system` | 1 |
     | Round-1 sources (b02d931cd) | 9 |
     | Round-0 behaviour | 24 |
     | Round 1's eleven, re-anchored | 2 to 18 each |
     
     `nt-format.test.ts` is 13 of 13. Dropping the wage mapping fails 1.
   - **The claim** now also pins:
     - the wage type at the writer;
     - its metadata marker;
     - `system` on the list, with the wage, grant and `system_alert` types off it;
     - the guard: imported, reading metadata, joined with `&&`;
     - the exact set of literal `type: "system"` writers in the gateway, so a new one fails the build until it is read;
     - the web mapping.
     
     It kills 41 of 41 mutations, run on a scratch copy of the gateway src. That is round 1's twenty-one, less "system called money-free", which is now the opposite, plus twenty-one new. It fails on 4bd11a00e, 6a714f2a4, b02d931cd and on `origin/main` 5a330a88e.

**Open, not fixed here (pre-existing, same class of leak).**
1. **WebSocket order events go to the whole house.** `order:created` and `order:status_changed` are emitted to the `restaurant:<id>` room (`websocket.gateway.ts:622-645`), which every socket with a house joins, staff included (`:342-345`). `rabbitmq-bridge.service.ts:489-496` puts `target_price` in the `order:created` payload, then sends the whole payload again as `order_change` (`:498`). — OPEN.
2. **The same notification rows reach staff in full through the inbox.** `GET /notifications` returns `message` and `metadata` as written (`notifications.service.ts:845-858`, controller `:272`, no `@Roles`). The phone's Notifications screen draws `item.message` (`apps/mobile/app/notifications.tsx:102`), and so does the web inbox (`apps/web/src/pages/notifications/next/BookRow.tsx:132`, `:182`). This round closes the feed only. The writers that send money to every member are the root: `sale-record.producer.ts`, `invoice-confirmed.producer.ts`, the goal producers, and `procurement.service.ts:6866`. — OPEN.

**Disclosed limits.**
- **A same-house demotion can render once from cache.** The phone persists its query cache, so after an owner or manager is demoted, the last feed and pulse they were served, with money, can draw once before the refetch replaces it.
- **The type list is only as good as its census.** A future writer that reuses a listed type with money in its sentence would pass. The comment on `MONEY_FREE_NOTIFICATION_TYPES` says to read every writer before adding a type, and the claim fails if a known money type is ever added.
- **What the `system` writer pin cannot see (fix round 2).** The claim counts only literal `type: "system"` or `type: 'system'` in the gateway's non-spec `.ts` files, with comments stripped. It does not see:
  - a type built in a variable;
  - an existing writer whose sentence gains a figure;
  - the Python writers (`services/agent-orchestrator`). None writes `system` today. `email_intel_agent.py:913` and `research_tasks.py:933` set their own types and omit NOT NULL columns, so they always fail.
  
  Rows written by code older than this repo cannot be enumerated without a production query, and none was run.
- **The web inbox's System filter chip misses the new type (fix round 2).**
  - **What changes.** The chip sends an exact `type=system` query (`nt-book.ts:253`, `useNotificationsNextData.ts:255`). So an owner who filters by System no longer sees a wage notice written after this fix. The notice still shows under All, filed and drawn under System (`nt-format.ts:122`).
  - **Already true.** `system_alert` already had the same gap.
  - **Not fixed here.** A chip for the new type, or a filter that takes a register rather than one type, is left as a follow-up, because the branch is at its 15-file cap.
- **Words typed by a person (fix round 2).** Three `system` writers carry a person's typed text to the people it was sent to: a team broadcast, a note, and a held team message. Staff now see that text on the feed card, as they already did on the Notifications screen. If an author types a price, it shows. No writer adds the house's money to these sentences.

**Not settled by the ruling (put to the founder; nothing below was changed).**
1. **Vendor reply cards.** Staff still get `draft_approval` cards. A card shows the first 110 characters of the draft, and `draftContent` holds the full text, which can name prices. The ruling says "approve cards". The vendor-send rule (ADR 0175 D10) lets staff hold a letter as a request, and lets a grantee send. So whether these cards count as approve cards is open.
2. **Money right.** (The grant-limit part was answered in fix round 2, item 1; the approve-card part below is still open.) The ruling says "a staff member with a money right sees what that right needs". ADR 0253's second finding records approving an order as ruled for owner, manager or grantee (ADR 0175 D7), but not built. This fix gives a grantee the staff view. Whether a grantee should see approve cards and amounts is open.
   ~~The same question now applies to a grant's own limit.~~ The founder answered the limit question on 2026-10-01: *"Show their own limit (Recommended)"*. It is **not built**, because a notification row does not say whose grant it is. See "Fix round 2", item 1.
3. **Other phone screens.** The phone still shows staff money from other endpoints:
   - the Supply tab: order amounts from `GET /procurement/orders/pending`, `/history` and `/:id`;
   - the Insights tab: cellar value from `GET /inventory/:id/summary`;
   - the Notifications screen: every notification's full message and metadata (Open item 2 above). Fix round 1 closed this for the feed's cards only.

   None of these endpoints carries `@Roles` (`procurement.controller.ts:201`, `:217`; `inventory.controller.ts:290`, read only, not run). The ruling names only `GET /mobile/feed`.
4. **Older phone builds.** A phone build from before this fix still shows staff the "Connect Toast on the web dashboard" line. It reads the missing revenue as unavailable. Only an app update clears it.
