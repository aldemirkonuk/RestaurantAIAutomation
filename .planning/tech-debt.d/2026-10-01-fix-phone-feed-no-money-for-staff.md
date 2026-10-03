## The phone's Today screen served staff order amounts, approve cards and revenue — ~~OPEN~~ FIXED by `fix/phone-feed-no-money-for-staff` — 2026-10-01

Filed by `fix/phone-feed-no-money-for-staff`. Found by the people research recorded in ADR 0253 (`0253-a-job-and-the-right-to-do-it-are-given-in-one-step-and-staff-get-a-jobs-first-screen.md`, "Second finding"; on #566's branch `docs/houses-decisions-0251-0253` and on `fix/closed-stays-closed`, not yet on `main`). Ruled the same day in ADR 0253's "Answered 2026-10-01 (round 2)", which is on #566's branch only. Under "Money on the phone for staff" the founder answered *"Close it to staff (Recommended)"*, and the ADR records the effect: `GET /mobile/feed` stops serving order amounts, approve cards and revenue to staff. [Corrected at gate round 2: this line quoted the question he was asked as if from ADR 0253, but the ADR records only his answer, so the question is no longer quoted.]

**Where line numbers are measured** (rewritten at gate round 2; this line used to say `origin/main` 4bd11a00e, which was false for lines re-cited later). Every line number is at this branch's head, the commit that carries this text, unless its sentence names another commit. The **What** paragraph below describes the code before the fix, so its line numbers are at 4bd11a00e. Every cited file that this PR does not change is byte-identical at this head and at `origin/main` e25ebf537 (`git diff --quiet`, file by file), so those cites hold on `main` too.

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

The list comes from a census of every writer of `notifications` on 2026-10-01, which found ~~50 types and~~ one writer that takes its type from the request body (`POST /notifications`, the caller's own rows). [Corrected at gate round 1 (audit at 74d837c70): "50 types" was wrong here, in the PR body and in b02d931cd's commit message, which is left as written. Measured at gate round 1, the lists name 56 types: `MONEY_FREE_NOTIFICATION_TYPES` holds 40 (`mobile.service.ts:79-128`), and the comment above it names 16 left off (`:53-59`), the 16 listed below. At b02d931cd they named 55: 39 on the list and 16 left off.] One read-only pass covered the writers outside `notifications/producers/`; I read the producers and re-read about 15 of the other writers' templates. Left off the list, because at least one writer puts money or another person's words in the sentence:
- `service_closed`: `sale-record.producer.ts:167-190`, revenue and best-seller revenue, to the whole house.
- `invoice_received`:
  - `invoice-confirmed.producer.ts:149-185`, the total and tie-out delta, to the whole house;
  - `procurement.service.ts:6923-6945`, a price-variance sentence (`invoice-match.ts:809-812`) plus `effectiveUnitCost` and `creditDue`, to the whole house.
- `goal_reached`: `goal-reached.producer.ts:187`, `ceiling-held.producer.ts:199`; a currency goal's figures.
- `price_change`: `market-price.producer.ts:241`.
- `price_index_upload`: price-move percentages.
- `promo_digest`: `promotion-extractor.service.ts:245` (cited as `:242`, the call two lines up, until gate round 2).
- `delivery_proposal`: `delivery.service.ts:598`, "Money at risk".
- `authority_grant_issued` and `authority_grant_reapproved`: the grant's limit, `authority-grants.service.ts:535-567`.
- ~~`system`: the own-wage notice shares it, `own-wage-notice.ts:115-140`.~~ Fix round 2 moved the wage notice to its own type, `team_member_own_wage_set`, which is left off instead, and put `system` back on the list. See "Fix round 2" below.
- `system_alert`: `sendSystemAlert` takes any text.
- `deal`, `order_verification` and `vendor_reply`: an LLM summary of a negotiation, `inbound-responder.service.ts:398-402`, `:610` (cited as `:401`, the `order_verification` arm alone, until gate round 2).
- `vendor_deal_declined` and `vendor_letter_declined`: the decliner's typed reason, `vendor-send-requests.service.ts:703`.

What this costs staff, on the feed card only:
- ~~schedule, broadcast, note, Away and access rows (`system`) show their title without the sentence;~~ no longer, since fix round 2: these show their sentence again;
- the verify-delivery `invoice_received` row (`procurement.service.ts:5655`) loses its bottle count.

Titles are not gated. ~~No writer puts an amount into a title. The two that carry figures are:~~ [Corrected at gate round 1 (audit at 74d837c70): the struck sentence contradicted the list under it. Titles can carry figures, and this branch leaves every title as written; filed as Open item 4 below.] Titles that can carry a figure include:
- `price_change`, a percentage (`market-price.producer.ts:245`), written to owners and managers only (`:139-140`);
- `goal_reached`, whose title is the goal's own typed name (`goal-reached.producer.ts:162`, `:190`; `ceiling-held.producer.ts:185`, `:200`), written to the whole house.

The `@ApiOperation` text now describes all of this.

On the phone, when the pulse request fails and there is no body to read the withholding from, `drawSalesCard` draws the Insights "Sales tonight" card only for a session role of `owner` or `manager`, the role `/auth/me` gave the phone (`state/session.ts:28-29`). A staff member's failed request no longer reads "Connect Toast on the web dashboard". An owner whose role the phone does not know, and whose request failed, now sees no card instead of that line. Once there is a body, the gateway's answer decides.

Tests that pin it:
- `mobile/mobile-feed-money-for-staff.spec.ts` enters at the controller. It has 56 cases at this head. [Corrected at gate round 2: this line said "It has 43 cases", the count after rounds 0 and 1.] Rounds 0 and 1 added 43; fix round 2 added 9 (52), gate round 1 added 2 (54) and gate round 2 added 2 (56):
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
   - **Who receives it.** Every owner, plus the grantee (`:566`, `owners` from `ownersAndManagers(...).owners` at `:527`; this said `:526`, which is the `try {` above it, until gate round 2).
   - **What it says.** Every copy carries the same sentence, naming the grantee's limit (`:536`, `:541`, `:549`). So each owner's copy is about someone else's grant.
   - **What the row stores.** Metadata is `{ grantId, change }` (`:579`) and `user_id` is the recipient. Nothing on the row says whether the recipient is the grantee.
   - **Who could leak.** The feed's non-money caller holding such a row is either the grantee (their own limit, which the founder wants shown) or an owner who was later demoted in the same house (someone else's limit, which must stay quiet). The feed cannot tell them apart from the row.
   - **What stays.** Both types stay off `MONEY_FREE_NOTIFICATION_TYPES`, as in round 1. A staff grantee's card shows the title without the limit. The claim fails if either type is added to the list.
   - **Options for the founder:**
     - (a) **Recommended.** Stamp `granteeUserId` into `tell()`'s metadata. The feed then shows the sentence only when `meta.granteeUserId === userId`. Rows written before the change carry no stamp and stay quiet. Cost: one line in `tell()`, one comparison in the feed, a CLAIMS row. Old rows never gain the limit.
     - (b) Look up each grant row's grantee by `grantId` at feed time. Old rows are covered too, but every feed read touches the grants table, and a deleted grant reads as "not yours".
     - (c) Leave it as is. The limit stays on the Notifications screen, which shows every row in full (Open item 2 below).
   - **Answered 2026-10-01 (AskUserQuestion, relayed by the coordinator).** The founder: *"Record the grantee (Recommended)"*. That is option (a): write the grantee's id on new notices and show the limit only to that person; older notices never show the limit. Rejected: "Look it up each load" and "Leave it".
   - **Built on a stacked branch, not here.** The build needs `authority-grants.service.ts`, a 16th file against this branch's 15-file cap, so the coordinator put it on `fix/phone-feed-own-grant-limit`, cut from this branch's ebd69b364. There `tell()` records the grantee as `metadata.granteeUserId`. The feed then says an issued or re-approved grant notice to a reader who does not see money only when that reader is the recorded grantee. Older rows, someone else's grant and a caller with no id keep the neutral line, and the card's `meta` stays cut. That branch's own entry and claim (`ADR-0253-PHONE-FEED-OWN-GRANT-LIMIT`) record it. **On this branch alone**, both grant types stay off the list and every reader who does not see money gets the neutral line.
2. **Staff notices: *"Give wages its own type (Recommended)"*. Built.**
   - **The type.** The own-wage notice (`team/own-wage-notice.ts`, `recordOwnWageChange`, owners only) is now stored with `type` and `notification_type` set to `team_member_own_wage_set`. That is the action name it already wrote to `system_audit_log` and to its own metadata (`OWN_WAGE_ACTION`). It follows the `team_member_*` audit-action naming that the notice was already read by.
   - **No migration.** `notifications.type` is `varchar(100) DEFAULT 'system'` with no CHECK constraint and no enum. The table is `20260805000000_baseline_from_production.sql:3952-3982`, and its only table constraints are the primary key (`:7223-7224`) and the restaurant foreign key (`:12805-12806`). Several columns are NOT NULL, among them `notification_type` (`:3956`) and `type` (`:3975`). No later migration adds a constraint: a scan of every `ALTER TABLE … notifications …;` statement in `supabase/migrations` for `CONSTRAINT`, `CHECK` or `ALTER COLUMN type` finds only the primary key and the foreign key.
   - **The web inbox** files the new type under System (`nt-format.ts:122`), as it did for `system`. [Gate round 1 (audit at 74d837c70): that was true of the label only. The System chip got an exact `type = 'system'` match from the server, so wage notices showed under All but not under System. `getNotifications` now answers `type=system` with every type the inbox files under System; see "The web inbox's System filter chip" under Disclosed limits.]
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
     - `POST /notifications`, which writes the caller's own rows only (`notifications.controller.ts:258-259`; cited as `:257-258` until gate round 2). A body without a type never defaults to `system`: `CreateNotificationDto.type` is a required `@IsString()` (`notifications.controller.ts:70-72`), and past that, the insert copies the type into `notification_type` (`notifications.service.ts:575`), which is NOT NULL.

     `git log -S'type: "system"' -- apps services supabase` finds two writers removed, both on this branch. ffa94a26b moved the wage notice (`team/own-wage-notice.ts`) to `team_member_own_wage_set`, and moved `sendSystemAlert` (`notifications.service.ts`) to `system_alert`. The search's only other removal is 941d9cb40's re-indent of the `team.controller.ts` writer, which is still there (`:621`). [Corrected at gate round 2: this said the search "shows no removed writer".]
   - **`sendSystemAlert` now stores `system_alert`** (`notifications.service.ts:528`; was `:509` before gate round 1 added lines above it), not `system`. It writes any caller's words to every member. It has no caller today: its route was closed under ADR 0149.
   - **Old wage rows: the guard is kept.** Rows written as `system` by the wage notice from #440 (0c16f8434, 2026-09-28) until this deploys may exist. Production was **not queried**, so whether any exist is unverified. `isOwnWageNotice(meta)` (`mobile.service.ts:137-140`; was `:125-128` before gate round 1 added comment lines above it) blanks a row whose metadata `action` is `team_member_own_wage_set`, under any type. It compares against the writer's imported constant. The wage writer always stamped that action (0c16f8434), so every old row is recognised.
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

**Fix round 3 (docs only, 2026-10-01): from the Sonnet verify** (`p4-scratch/phone-feed-verify.md`, findings A1-A4).
- **Push and the live event** are added as Open item 3. They were missing from the list.
- **The claim's first sentence** now names the ruled exception: staff keep vendor-draft cards with their text (ADR 0253 round 9).
- **"Not settled by the ruling"** items 1-3 now carry the round-9 answers. Fix round 2, item 1 now says what the stacked branch builds.
- **The decision record.** The fix-round answers (*"Give wages its own type (Recommended)"*, *"Show their own limit (Recommended)"*, *"Record the grantee (Recommended)"*) were recorded only in tech-debt entries. They go into ADR 0253 as a dated amendment, which the coordinator applies on #566's branch. This branch does not edit the ADR.
- **Test counts that reproduce.** ffa94a26b's message says "gateway mobile + team-pay + notifications 541/541". That is `src/mobile`, `src/notifications` and `src/team/team-pay-round4.spec.ts` only; all of `team-pay*` gives a different total. Measured again at 7fdf4f95f, this round's commit (node_modules linked), from `apps/api-gateway` unless named:

  | Command | Result |
  |---|---|
  | `npx jest src/mobile/mobile-feed-money-for-staff.spec.ts` | 52/52 |
  | `npx jest src/mobile src/notifications src/team/team-pay-round4.spec.ts` | 541/541, 30 suites |
  | `npx jest src/mobile src/team src/notifications src/organizations` | 976/976, 50 suites |
  | phone suite, `apps/mobile/src/**/__tests__/*.test.ts` through api-gateway's ts-jest (diagnostics off; the linked phone node_modules has no `jest`) | 285/285, 21 suites |
  | `apps/web`: `npx vitest run src/pages/notifications/next/nt-format.test.ts` | 13/13 |
  | `bash scripts/check_decision_claims.sh` | 814/814 holding |

**Gate round 1 (2026-10-02): fixes for the ADR 0090 audit at 74d837c70** (BLOCK; PR #582 comment 5961672605). `origin/main` a823ef32d was merged in first, with no conflicts.
1. **The type count.** "50 types" is corrected in place above and in the PR body: the lists name 56, 40 on the list and 16 left off. b02d931cd's commit message keeps its 50; this entry is the correction.
2. **Titles.** The contradictory sentence is struck above. Titles are Open item 4, citing ADR 0253 round 11 F5 on #566, with the line on round 10's money right.
3. **The cached feed.** "Can draw once" is narrowed under Disclosed limits.
4. **The System chip.** Fixed in `getNotifications`; see Disclosed limits, "The web inbox's System filter chip". The same one-type gap on seven other chips is filed there.
5. **`amount` in `NON_MONEY_META_KEYS`.** A spec case feeds an `order_pending` row (a money-free type) whose metadata carries `amount: 8642.75` to each of the six roles that do not see money. It checks that `meta` is cut to `orderId` and `orderNumber` and that `8642` is not on the wire, and that an owner still gets the whole metadata. Adding `amount` to the list failed that case and no other (1 of 54). The file was copied with `cp -p`, mutated, run, restored and compared with `cmp`.
6. **The `system` default.** Open item 5.
7. **`unknown_sender`.** The list's comment now says F13, not the free-text rule, decides it. Whether F13 covers a sender who is not in the providers list is Open item 6.

Measured at gate round 1, from `apps/api-gateway` unless named:

| Command | Result |
|---|---|
| `npx jest src/mobile/mobile-feed-money-for-staff.spec.ts` | 54/54 |
| `npx jest src/mobile src/notifications src/team src/organizations` | 978/978, 50 suites |
| eslint on the 6 touched gateway `.ts` files | 0 errors; 12 warnings, all in `notifications.service.ts`, none on a line this round added |
| `npx tsc --noEmit` | 2 errors, both in `passkeys/passkeys.service.ts` (`@simplewebauthn/server` is not in the linked node_modules); not touched |
| `bash scripts/check_decision_claims.sh` (repo root) | 831/831 holding |
| `python3 scripts/check_citation_pairing.py` (repo root) | pass: 218 register citations against 174 rows |

The phone and web suites were not re-run. This round's edits touch no file under `apps/mobile` or `apps/web`; the merge brought `main`'s changes to `apps/web` documents, receipts, brand and nightly-e2e files, none of which this PR touches.

**Gate round 2 (2026-10-02): fixes for the ADR 0090 audit at 899893a6e** (BLOCK; PR #582 comment 5963233967). Reviewer A blocked on four sentences in this entry and found the code sound; Reviewer B approved. `origin/main` had moved to e25ebf537 (#587). That commit changes no file this entry cites. It is merged in with this round (1f4a348ac, no conflicts), because `main` is strict and a head behind it cannot merge.

The four blocks:
1. **`authority-grants.service.ts:526`** is corrected to `:527` in place (fix round 2, item 1).
2. **One base for line numbers.** The paragraph under the title now says where line numbers are measured: this head, unless a sentence names a commit, and the **What** paragraph at 4bd11a00e. The procurement cites that #578 and #581 moved are re-measured:
   - the discrepancy writer, `procurement.service.ts:6866-6886`, is now `:6923-6945`;
   - the verify-delivery writer, `:5598`, is now `:5655`;
   - the Supply routes, `procurement.controller.ts:201` and `:217`, are now `:203` and `:219`, and `:236` is added for `/:id`.

   Open item 3 no longer says "re-read at this head" over a stale cite, and fix round 3's table names 7fdf4f95f instead of "this head".
3. **The MMKV sentence** now says only a query that succeeded with data is written (`queryClient.ts:55`).
4. **The spec count** is 56 at this head; it said 43.

The notes:
5. **`notifications.controller.ts:257-258`** is corrected to `:258-259`. The sentence now also names the DTO's required `type` (`notifications.controller.ts:70-72`).
6. **`SYSTEM_CHIP_TYPES` and `KIND_BY_TYPE`** are tied by a spec case (Disclosed limits, the System chip).
7. **`getNotifications` and `user_id`.** A spec case seeds rows for two members of one house. It checks that each member gets only their own rows and count, with no type, with `type=system` and with an exact type.
8. **Filed as OPEN:** Open item 7 (`GetNotificationsQueryDto.type`) and Open item 8 (`GET /dashboard/summary/:restaurantId`). Both were read at this head.
9. **Numbering.** A cross-reference table under the Open items maps the PR body's Still open list to this entry.

Every other file:line in this entry was re-measured too. Seven sentences were tightened along the way:
- **ADR 0253's location** names #566's branch.
- **The `notifications` baseline** has its key and foreign key cited by line (`:7223-7224`, `:12805-12806`).
- **The push line** names routed writes and `skipMobilePush`.
- **`invoice-match.ts:809`** is now `:809-812`, the whole sentence.
- **The cellar route** is `GET /inventory/:restaurantId/summary`.
- **Open item 2's old cite** `:845-858` is placed at 4bd11a00e.
- **The `POST /notifications` sentence** names the DTO.

An independent Sonnet check of every cite in this entry ran before this round's commit. It found one wrong sentence and seven imprecise ones, and all eight are fixed here:
- **Wrong: item 7 above.** It said the two-member case reads each member with an exact type, but only the owner was read that way. The spec now reads `staff-1` with `goal_reached` too.
- **The writer search** (fix round 2, item 2) said `git log -S` shows no removed writer. It shows two, both this branch's own, and the sentence now names them.
- **Two cites:** `inbound-responder.service.ts:401` is now `:398-402`, and `promotion-extractor.service.ts:242` is now `:245`.
- **The `notifications` baseline** now names its NOT NULL `notification_type` and `type` columns (`:3956`, `:3975`).
- **The cross-reference table's rows 11 and 12** point at body items that the PR body gains in this round's edit.
- **Line 3** no longer quotes the question asked in round 2, because ADR 0253 records only the answer.
- **The `restaurant_id` swap** in the mutation table now names the exact replacement.

Each mutation below ran from a `cp -p` snapshot. The file was restored afterwards, and `cmp` matched the snapshot.

| Mutation | Spec cases failed (of 56) |
|---|---|
| `user_id` filter dropped from `getNotifications` (`notifications.service.ts:906`) | 1, the two-member case; across the four suites, 1 of 980 |
| `.eq("user_id", params.userId)` (`:906`) swapped for `.eq("restaurant_id", params.restaurantId)` | 1, the two-member case |
| The web files `goal_reached` under System | 1, the tie case |
| `system_alert` dropped from `SYSTEM_CHIP_TYPES` | 3: the chip case, the two-member case and the tie case |
| A web System entry written as `['system']: 'System'` | 1, the tie case (the line it cannot read) |
| `KIND_BY_TYPE` renamed | 1, the tie case (the table not found) |

Measured at gate round 2 on the merged tree, from `apps/api-gateway` unless named:

| Command | Result |
|---|---|
| `npx jest src/mobile/mobile-feed-money-for-staff.spec.ts` | 56/56 |
| `npx jest src/mobile src/notifications src/team src/organizations` | 980/980, 50 suites |
| `apps/web`: `npx vitest run src/pages/notifications/next/nt-format.test.ts` | 13/13 |
| eslint on the 6 touched gateway `.ts` files | 0 errors; 12 warnings, all in `notifications.service.ts`, which this round does not change |
| `bash scripts/check_decision_claims.sh` (repo root) | 836/836 holding (831 before the merge; #587 adds 5) |
| `python3 scripts/check_citation_pairing.py` (repo root) | pass: 220 register citations against 174 rows |
| `git diff --check` | clean |

The phone suite was not re-run, because this round changes no file under `apps/mobile`.

**Open, not fixed here (pre-existing, same class of leak).**
1. **WebSocket order events go to the whole house.** `order:created` and `order:status_changed` are emitted to the `restaurant:<id>` room (`websocket.gateway.ts:622-645`), which every socket with a house joins, staff included (`:342-345`). `rabbitmq-bridge.service.ts:489-496` puts `target_price` in the `order:created` payload, then sends the whole payload again as `order_change` (`:498`). — OPEN.
2. **The same notification rows reach staff in full through the inbox.** `GET /notifications` returns `message` and `metadata` as written (`mapNotificationRow`, `notifications.service.ts:870-887`, used by `getNotifications` at `:937`; controller `:272`, no `@Roles`) [re-cited at gate round 1: it read `:845-858`, where the function began at 4bd11a00e, and lines added above it since moved it]. The phone's Notifications screen draws `item.message` (`apps/mobile/app/notifications.tsx:102`), and so does the web inbox (`apps/web/src/pages/notifications/next/BookRow.tsx:132`, `:182`). This round closes the feed only. The writers that send money to every member are the root: `sale-record.producer.ts`, `invoice-confirmed.producer.ts`, the goal producers, and `procurement.service.ts:6923-6945` (cited as `:6866` until gate round 2; #578 and #581 on `main` moved it). — OPEN.
3. **Push and the live event carry the same rows to staff.** Found by the Sonnet verify of 2026-10-01. Every line number in this item was re-measured at gate round 2.
   - **Push.** `persistForRestaurant` pushes every row it writes, at any priority but `low`, to everyone the row went to; a routed write (ADR 0218) pushes only to the people routing alerted, and a caller can opt out with `skipMobilePush` (`notifications.service.ts:822-845`, `:828`, `:831`). The push carries the title, `body: payload.message` (`:837`) and the whole metadata in `data`. `ExpoPushService.sendToUsers` reads device tokens for the ids it is handed and checks no role (`push/expo-push.service.ts:126-172`).
   - **Live event.** The same funnel emits `notification:new` with `message` and `metadata`, at any priority, to the house room for a write addressed to everyone (`notifications.service.ts:789-820`). [Push and live-event lines re-measured at gate round 1; they read `:803-826`, `:818` and `:770-801` before this round's added lines moved them.] Every socket with a house joins that room, staff included (`websocket.gateway.ts:343`).
   - **Money that reaches staff this way:**
     - the delivery-discrepancy notice (`invoice_received`, `critical`): `match.summary` as the message, `creditDue` and `effectiveUnitCost` in the metadata (`procurement.service.ts:6923-6945`);
     - the certified-invoice notice (`invoice_received`, `medium`): the invoice total in the sentence (`invoice-confirmed.producer.ts:153-166`);
     - goal notices (`goal_reached`, `medium`, `goal-reached.producer.ts:192`, `ceiling-held.producer.ts:212`): a currency goal's figures;
     - the closed-service notice (`service_closed`): its revenue goes out on the live event only, since it is `low` and so is not pushed (`sale-record.producer.ts:173`).
   - **What the ruling says.** ADR 0253 round 9 closes the credit due and unit cost on delivery-difference notices to staff, "server first, as its own fix", but names no channel. This branch closes the Today feed only. — OPEN.
4. **Titles reach staff as written.** Filed at gate round 1 (audit at 74d837c70). The feed gates a notification card's subtitle and `meta`, never its title (`mobile.service.ts:305`, `:329`).
   - **`goal_reached`.** Both writers make the goal's typed name the title (`goal-reached.producer.ts:162`, `:190`; `ceiling-held.producer.ts:185`, `:200`). Both hand `ledger.emit` the audience they are given, unnarrowed (`goal-reached.producer.ts:177`, `ceiling-held.producer.ts:188`). That audience is `audienceFor`'s, built from every member of the house (`notification-producers.service.ts:259`, `:266`, `:272`; `producer-ledger.service.ts:197-198`), less anyone Away that day. A goal named "Reach $50k week" puts that figure on a staff member's card.
   - **What the ruling says.** ADR 0253 round 11 F5, *"No figures; neutral titles (Recommended)"* (on PR #566 at 21e87278a, not on `main`): for anyone without the money right, "A title that can carry a figure is replaced by a neutral one." This branch replaces no title. — OPEN.
   - **The role test stands in.** `seesHouseMoney(role)` decides who sees money here only until the money right exists. ADR 0253 round 10 (on PR #566) makes "Sees the house's money" a right of its own, with the role setting only its default, and says that right replaces #582's role test.
5. **`notifications.type` defaults to `system`.** Filed at gate round 1. The column is `type character varying(100) DEFAULT 'system'::character varying NOT NULL` (`20260805000000_baseline_from_production.sql:3975`); `notification_type` is NOT NULL with no default (`:3956`). An insert that sets `notification_type` but omits `type` is stored as `system`, which is on `MONEY_FREE_NOTIFICATION_TYPES`, so its sentence would reach staff on the feed. The audit at 74d837c70 found no writer that omits it; this branch did not sweep for one. Nothing guards it: the claim counts only literal `type: "system"` writers (Disclosed limits, "What the `system` writer pin cannot see"). — OPEN.
6. **`unknown_sender` carries an outsider's email subject.** Filed at gate round 1. Its one literal writer (grep of `apps`, `services` and `supabase/migrations`) is `_notify_unknown_sender` (`services/agent-orchestrator/agents/email_intel_agent.py:980`). It puts up to 80 characters of the incoming email's subject in the sentence (`:984`) and writes one row per member of the house (`core/notifications.py:84`, `:99`). The audit cited `:979`; the lines above are measured at gate round 1.
   - **The type is on `MONEY_FREE_NOTIFICATION_TYPES`,** so a subject that names a price reaches staff on the feed.
   - **Which rule applies.** The comment on that list withholds a type when a writer puts another person's free text in its sentence. It now says that rule does not decide `unknown_sender`. Incoming mail follows ADR 0253 round 11 F13, *"Mail kept, AI summaries neutral (Recommended)"* (on PR #566 at 21e87278a), whose option text keeps a vendor mail's subject and text for staff.
   - **Open: whether F13 covers this sender.** F13 says vendor mail, and an `unknown_sender` row is mail from an address that is not in the providers list. Counting it as vendor mail is this branch's reading, not the founder's. If it is not vendor mail, the type comes off the list. — OPEN.
7. **`GET /notifications` does not validate `type`.** Filed at gate round 2 (audit at 899893a6e, Reviewer B). This is robustness, not a leak.
   - **The gap.** `GetNotificationsQueryDto.type` carries `@IsOptional()` and no `@IsString()` (`notifications/dto/notifications.dto.ts:95-97`). Its `@ApiPropertyOptional({ enum: NotificationType })` documents the field and validates nothing.
   - **What gets through.** The global `ValidationPipe` sets `whitelist`, `forbidNonWhitelisted` and `transform`, and not `enableImplicitConversion` (`main.ts:52-58`). Express 4.22.1's `qs` parser reads `?type=system&type=x` and `?type[]=system` as arrays.
   - **Where it lands.** An array fails `params.type === "system"` (`notifications.service.ts:911`) and goes to `.eq("type", …)` as an array (`:914-915`). `user_id` binds first (`:906`), so the answer can only narrow, never widen. This is reasoned from the code and was not run against PostgREST.
   - **The fix.** One `@IsString()`, in a file this branch does not touch (15-file cap). — OPEN.
8. **`GET /dashboard/summary/:restaurantId` hands any member of the house up to five notification rows whole, whoever they were addressed to.** Filed at gate round 2 (audit at 899893a6e, Reviewer A). This is the same class of leak as item 2.
   - **The read.** `getNotificationsSummary` reads `notifications` with `select("*")`, filtered only by `restaurant_id`, and returns the rows as read under `recent` (`dashboard.service.ts:166-203`; the query is `:174-179`, the return `:192-195`). The query orders by `sent_at` descending with `limit(5)`. Postgres sorts NULLs first in a descending order, and no gateway writer of `notifications` sets `sent_at` (grep of `apps/api-gateway/src`), so the five are not the newest by any guarantee.
   - **Who can call it.** The route has the class's `JwtAuthGuard` and no `@Roles` (`dashboard.controller.ts:51`, `:70-101`). The path's house must be the token's house: `JwtAuthGuard` runs `assertTenantMatch` (`auth/guards/jwt-auth.guard.ts:74`; `common/tenant/assert-tenant-match.ts:93-98`, `:136-138`). So any member of that house can call it, staff included, and no member of another house can.
   - **What leaks.** Each row comes whole, so any money in its message or metadata comes with it. With no per-user filter, a member also gets rows addressed only to others, such as the own-wage notice, which is written to owners only (`team/own-wage-notice.ts:99-127`).
   - **Who calls it.** The web wraps the route (`apps/web/src/services/api/dashboard.ts:53-64`), and grep of `apps/web/src` finds no caller of that wrapper. The phone does not call it. Today it answers only a direct request made with a member's token. — OPEN.

**Where the PR body's "Still open" items are filed** (added at gate round 2; the two lists number differently, and their numbers are kept because audit reports cite both). The body's items 11 and 12 were added to it at gate round 2, with this table:

| PR body, Still open | This entry |
|---|---|
| 1. WebSocket order events | Open item 1 |
| 2. Both Notifications screens | Open item 2 |
| 3. Push and the live event | Open item 3 |
| 4. Supply tab amounts, Insights cellar value | "Not settled by the round-2 ruling", item 3 |
| 5. A grantee's own grant limit | Fix round 2, item 1 (built on #583) |
| 6. Older phone builds | "Not settled by the round-2 ruling", item 4 |
| 7. Titles | Open item 4 |
| 8. `notifications.type` defaults to `system` | Open item 5 |
| 9. `unknown_sender` | Open item 6 |
| 10. Seven other inbox chips | Disclosed limits, "The web inbox's System filter chip", "Not fixed: the other chips" |
| 11. `GetNotificationsQueryDto.type` | Open item 7 |
| 12. `GET /dashboard/summary/:restaurantId` | Open item 8 |

**Disclosed limits.**
- ~~**A same-house demotion can render once from cache.**~~ **A same-house demotion keeps drawing cached money until a refetch succeeds.** [Narrowed at gate round 1 (audit at 74d837c70): "once" was broader than the code.] The phone writes a query to MMKV only when it has succeeded with data (`apps/mobile/src/lib/queryClient.ts:51-69`): `:55` returns early unless `status === "success"` and `data` is defined, so a failed refetch never replaces the last good record. [Corrected at gate round 2: this said "every settled query", which was broader than `:55`.] Those records have no expiry: each boot rehydrates them and drops one only on a version mismatch or a parse failure (`:30-49`). `refreshUser` does not clear them (`apps/mobile/src/state/session.ts:278-283`); sign-in, a house switch (`adoptTokens`) and sign-out do (`:253`, `:271`, `:326`; `app/settings.tsx:28`). So after an owner or manager is demoted in the same house, the last feed and pulse they were served, with money, keep drawing until a refetch succeeds. That lasts for as long as refetches fail, for example while the phone is offline.
- **The type list is only as good as its census.** A future writer that reuses a listed type with money in its sentence would pass. The comment on `MONEY_FREE_NOTIFICATION_TYPES` says to read every writer before adding a type, and the claim fails if a known money type is ever added.
- **What the `system` writer pin cannot see (fix round 2).** The claim counts only literal `type: "system"` or `type: 'system'` in the gateway's non-spec `.ts` files, with comments stripped. It does not see:
  - a type built in a variable;
  - an existing writer whose sentence gains a figure;
  - the Python writers (`services/agent-orchestrator`). None writes `system` today. `email_intel_agent.py:913` and `research_tasks.py:933` set their own types and omit NOT NULL columns, so they always fail.

  Rows written by code older than this repo cannot be enumerated without a production query, and none was run.
- ~~**The web inbox's System filter chip misses the new type (fix round 2).**~~ **The web inbox's System filter chip: fixed at gate round 1.**
  - **What it was.** The chip sends `type=system` (`nt-book.ts:253`, `useNotificationsNextData.ts:255`), and `getNotifications` matched it exactly. An owner who filtered by System did not see a wage notice written after this fix, or any `system_alert` row: `experiment-ended.producer.ts:274` writes that type on `main`, and so does `sendSystemAlert` since fix round 2, which has no caller. Both still showed under All, filed under System (`nt-format.ts:117-118`, `:122`).
  - **The fix.** `getNotifications` answers `type=system` with `in("type", SYSTEM_CHIP_TYPES)`: `system`, `system_alert` and `team_member_own_wage_set`, the three types `nt-format.ts` files under System (`notifications.service.ts:35-39`, `:911-916`). Any other type is still matched exactly. The phone's inbox sends no type (`apps/mobile/src/api/queries.ts:216-219`), and grep of `apps/web/src` finds no other code that sends `type=system`. `mobile/mobile-feed-money-for-staff.spec.ts` pins it; four mutations each failed that case (exact match restored, the wage type dropped, `system_alert` dropped, the set used for every type). It stays in that spec, beside the two type moves it follows from, because the branch is at its 15-file cap.
  - **The two copies are tied (gate round 2).** `SYSTEM_CHIP_TYPES` is a copy of the types `KIND_BY_TYPE` files under System (`nt-format.ts:80-123`). A spec case in the same file reads `nt-format.ts` as text and fails if either side has a type the other lacks. It reads the file the way `common/iso-4217.spec.ts` reads the web's currency table, because an import would pull the browser bundle (`lucide-react`, the web's `@/` alias) into the gateway's compile. The case also fails if the table is not found or holds a line it cannot read.
  - **Not fixed: the other chips.** Seven other chips each name one type of a register that `KIND_BY_TYPE` gives two to five types: Stock, Orders, Deliveries, Vendor mail, Calendar, Reports and Advice. They still match that one type exactly. This is on `main` already; whether each gap is meant was not checked (the comment above `TYPE_CHOICES` gives a reason for Advice's). — OPEN.
- **Words typed by a person (fix round 2).** Three `system` writers carry a person's typed text to the people it was sent to: a team broadcast, a note, and a held team message. Staff now see that text on the feed card, as they already did on the Notifications screen. If an author types a price, it shows. No writer adds the house's money to these sentences.

**Not settled by the round-2 ruling: answered 2026-10-01 (ADR 0253 round 9).** Items 1-3 were put to the founder after the build; item 4 is a limit, not a question. His answers are recorded in ADR 0253 "Answered 2026-10-01 (round 9)", which is on `docs/houses-decisions-0251-0253` (#566), not yet on `main`.
1. ~~**Vendor reply cards.** Whether staff's `draft_approval` cards count as approve cards is open.~~ **Answered:** *"Keep them (Recommended)"*. Staff keep the cards for a drafted letter to a vendor, though the text may name a price; ADR 0175 D10 lets staff hold a letter as a request. A card's subtitle is the first 110 characters of the draft and `draftContent` holds the full text (`mobile.service.ts:256-278`; was `:244-266` before gate round 1 added comment lines above it). Nothing changes; the claim names this exception.
2. ~~**Money right.** Whether a grantee should see approve cards and amounts is open.~~ **Answered:** *"What they can approve (Recommended)"*. A send right alone shows no money. Once ADR 0175 D7 lets someone given the right approve orders, they see approve cards and amounts only for the orders their right covers. D7 approval is unbuilt (CLAIMS `ADR-0175-APPROVE-ORDER-ALWAYS-NEEDS-AUTHORITY` is open), so there is nothing to show yet, and a grantee keeps the staff view here.
   The grant's own limit is a separate answer, given in fix round 2: *"Show their own limit (Recommended)"*, then *"Record the grantee (Recommended)"*. It is built on the stacked branch `fix/phone-feed-own-grant-limit` (fix round 2, item 1, above). How it reads beside "a send right alone shows no money" goes into ADR 0253 as an amendment, which the coordinator applies to #566.
3. **Other phone screens: answered, not built here.** The founder: *"Close all three (Recommended)"*. The Supply tab's order amounts, the Insights tab's cellar value, and the credit due and unit cost on delivery-difference notices close to staff too, "server first, as its own fix". None of it is done on this branch. The phone still shows staff money from:
   - the Supply tab: order amounts from `GET /procurement/orders/pending`, `/history` and `/:id`;
   - the Insights tab: cellar value from `GET /inventory/:restaurantId/summary`;
   - the Notifications screen: every notification's full message and metadata (Open item 2 above). Fix round 1 closed this for the feed's cards only.

   None of these endpoints carries `@Roles` (`procurement.controller.ts:203`, `:219`, `:236`; `inventory.controller.ts:290`; read, not run). [Re-cited at gate round 2: this said `:201` and `:217`, the routes' place before #581 on `main` moved them, and named no line for `/:id`.] The round-2 ruling named only `GET /mobile/feed`; round 9 rules the first two and the delivery-difference figures for their own fix (Open item 3 above for the push path). — OPEN.
4. **Older phone builds.** A phone build from before this fix still shows staff the "Connect Toast on the web dashboard" line. It reads the missing revenue as unavailable. Only an app update clears it.
