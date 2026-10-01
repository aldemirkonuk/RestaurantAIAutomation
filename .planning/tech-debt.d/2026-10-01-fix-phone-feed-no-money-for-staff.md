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
- `system`: the own-wage notice shares it, `own-wage-notice.ts:115-140`.
- `system_alert`: `sendSystemAlert` takes any text.
- `deal`, `order_verification` and `vendor_reply`: an LLM summary of a negotiation, `inbound-responder.service.ts:401`, `:610`.
- `vendor_deal_declined` and `vendor_letter_declined`: the decliner's typed reason, `vendor-send-requests.service.ts:703`.

What this costs staff, on the feed card only:
- schedule, broadcast, note, Away and access rows (`system`) show their title without the sentence;
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
- The claim in `claims.d/fix-phone-feed-no-money-for-staff.jsonl` kills 21 of 21 mutations, run on scratch copies of the two files. They include `const money = true` and `role !== "staff"` in either read, which round 0's verify missed. The claim fails on 4bd11a00e and on 6a714f2a4.

**Open, not fixed here (pre-existing, same class of leak).**
1. **WebSocket order events go to the whole house.** `order:created` and `order:status_changed` are emitted to the `restaurant:<id>` room (`websocket.gateway.ts:622-645`), which every socket with a house joins, staff included (`:342-345`). `rabbitmq-bridge.service.ts:489-496` puts `target_price` in the `order:created` payload, then sends the whole payload again as `order_change` (`:498`). — OPEN.
2. **The same notification rows reach staff in full through the inbox.** `GET /notifications` returns `message` and `metadata` as written (`notifications.service.ts:845-858`, controller `:272`, no `@Roles`). The phone's Notifications screen draws `item.message` (`apps/mobile/app/notifications.tsx:102`), and so does the web inbox (`apps/web/src/pages/notifications/next/BookRow.tsx:132`, `:182`). This round closes the feed only. The writers that send money to every member are the root: `sale-record.producer.ts`, `invoice-confirmed.producer.ts`, the goal producers, and `procurement.service.ts:6866`. — OPEN.

**Disclosed limits.**
- **A same-house demotion can render once from cache.** The phone persists its query cache, so after an owner or manager is demoted, the last feed and pulse they were served, with money, can draw once before the refetch replaces it.
- **The type list is only as good as its census.** A future writer that reuses a listed type with money in its sentence would pass. The comment on `MONEY_FREE_NOTIFICATION_TYPES` says to read every writer before adding a type, and the claim fails if a known money type is ever added.

**Not settled by the ruling (put to the founder; nothing below was changed).**
1. **Vendor reply cards.** Staff still get `draft_approval` cards. A card shows the first 110 characters of the draft, and `draftContent` holds the full text, which can name prices. The ruling says "approve cards". The vendor-send rule (ADR 0175 D10) lets staff hold a letter as a request, and lets a grantee send. So whether these cards count as approve cards is open.
2. **Money right.** The ruling says "a staff member with a money right sees what that right needs". ADR 0253's second finding records approving an order as ruled for owner, manager or grantee (ADR 0175 D7), but not built. This fix gives a grantee the staff view. Whether a grantee should see approve cards and amounts is open.
   The same question now applies to a grant's own limit. `authority_grant_issued` and `authority_grant_reapproved` tell the grantee "(up to 500 USD, …)" (`authority-grants.service.ts:535-549`). Those types are off the money-free list, so a staff grantee's feed card shows the title without the limit. The full sentence is still on the Notifications screen.
3. **Other phone screens.** The phone still shows staff money from other endpoints:
   - the Supply tab: order amounts from `GET /procurement/orders/pending`, `/history` and `/:id`;
   - the Insights tab: cellar value from `GET /inventory/:id/summary`;
   - the Notifications screen: every notification's full message and metadata (Open item 2 above). Fix round 1 closed this for the feed's cards only.

   None of these endpoints carries `@Roles` (`procurement.controller.ts:201`, `:217`; `inventory.controller.ts:290`, read only, not run). The ruling names only `GET /mobile/feed`.
4. **Older phone builds.** A phone build from before this fix still shows staff the "Connect Toast on the web dashboard" line. It reads the missing revenue as unavailable. Only an app update clears it.
