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

Tests that pin it:
- `mobile/mobile-feed-money-for-staff.spec.ts` enters at the controller. It has 22 cases, and 18 fail on 4bd11a00e. Four source mutations each failed it: every role sees money, any role but `staff` sees money, the controller drops the role, and a full revert.
- `pulseStripView.test.ts` has 3 new cases. All 3 fail when `salesWithheld` returns false.
- The claim in `claims.d/fix-phone-feed-no-money-for-staff.jsonl` kills 9 of 9 mutations and fails on 4bd11a00e.

**Not settled by the ruling (put to the founder; nothing below was changed).**
1. **Vendor reply cards.** Staff still get `draft_approval` cards. A card shows the first 110 characters of the draft, and `draftContent` holds the full text, which can name prices. The ruling says "approve cards". The vendor-send rule (ADR 0175 D10) lets staff hold a letter as a request, and lets a grantee send. So whether these cards count as approve cards is open.
2. **Money right.** The ruling says "a staff member with a money right sees what that right needs". ADR 0253's second finding records approving an order as ruled for owner, manager or grantee (ADR 0175 D7), but not built. This fix gives a grantee the staff view. Whether a grantee should see approve cards and amounts is open.
3. **Other phone screens.** The phone still shows staff money from other endpoints:
   - the Supply tab: order amounts from `GET /procurement/orders/pending`, `/history` and `/:id`;
   - the Insights tab: cellar value from `GET /inventory/:id/summary`;
   - delivery and discrepancy notices: `invoice_received` notifications go to every member, with `creditDue` and `effectiveUnitCost` in their metadata (`procurement.service.ts:6871-6883`). The feed passes that metadata through as card `meta`.

   None of these endpoints carries `@Roles` (`procurement.controller.ts:201`, `:217`; `inventory.controller.ts:290`, read only, not run). The ruling names only `GET /mobile/feed`.
4. **Older phone builds.** A phone build from before this fix still shows staff the "Connect Toast on the web dashboard" line. It reads the missing revenue as unavailable. Only an app update clears it.
