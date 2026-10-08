## What the house-switch fix left keyed without the house, and the paths it does not cover — OPEN — 2026-10-07

Filed by branch `fix/a-house-switch-clears-the-last-house` (lane `houseswitch`, findings PROCURE-04, MENU-01, OPS-03).

**What the branch fixed.**
- A house switch (`setActiveRestaurantId` in `apps/web/src/contexts/AuthContext.tsx`) now does four things, in this order:
  1. It empties the device read cache, bounded like sign-out's clear.
  2. It stores the new session.
  3. It resets every cached react-query read (`forgetHouseReads`) before the new house is set.
  4. It then reads again only what is still on screen.
- `createFirstHouse` does the same. [Since 2026-10-07 ~22:35Z: until then it skipped step 1, so a person who created a second house from inside the first kept the device rows keyed by person only. It now empties the device read cache, bounded, before it stores the new session, and `houseSwitch.test.tsx` checks that.] Sign-out (`endSession`) resets the reads and clears the mutation cache.
- Six named reads now carry the house in their key: promotions, vendor currency coverage, price locks, price advice, menu versions, and Menu's house currency.
- `/recommendations` resets its Standing figures in the same render that switches the house. It keys its roster to the house, and a failed roster read is read again when the menu is next opened.
- The gateway refuses an `assignedTo` that is not a row of the path house's roster. [Narrowed 2026-10-08 at the re-head after the ADR 0090 BLOCK at `505a03400`: until then it also refused any row whose status was not `active`, and the page offered only `active` rows. Now any status is accepted and offered (ADR 0306).]

Everything below is what the branch did **not** fix. "House-scoped" below is judged from the key's name and the function it calls. The gateway route behind each read was not opened, except where a line says so.

**1. Reads still keyed without the house.**

Since this branch, a switch forgets and re-reads every one of them, so they no longer show the last house after a switch through `setActiveRestaurantId`. Their keys still omit the house. That matters on every path in item 2.

How the list was built: a regex over every `queryKey:` in `apps/web/src` (tests excluded) flagged each key with no `rid`/`restaurantId`/`house` token. It found 85 keys. The 7 this branch fixed are not listed. The rest were sorted by hand. Line numbers are at this branch's head.

**House-wide reads with neither the house nor a record id in the key:**
- `components/mudavym/DeliveriesToName.tsx:197`: `['procurement','items-to-name']`.
- `components/providers/ProviderComparisonView.tsx:9`, `:14`.
- `components/providers/ProviderPromotionsPanel.tsx:43`, `:49`, `:55`.
- `hooks/queries/useOnboardingProgress.ts:7`.
- `hooks/queries/usePromotionsQueries.ts:20`, `:43`, `:94`.
- `hooks/queries/useConversationQueries.ts:164`.
- `pages/inventory/command/InventoryCommandPage.tsx:370`, `:375`.
- `pages/inventory/command/NameThisWine.tsx:34`: `['inventory','research']`.
- `pages/inventory/command/ReceivingWorkspace.tsx:395`: `['settings','currency']`. This is the same read that Menu now keys as `['settings','currency',rid]`, so the two pages no longer share one cache entry.
- `pages/inventory/command/RowExpansion.tsx:87`: keyed by item, but it calls `getOrders()` for the whole house.
- `pages/vendor-prices/next/useVendorPricesNextData.ts:290`, `:297`, `:316`.
- `pages/settings/next/ConsentPanel.tsx:97`: `['consent-trail', spec.register]` reads `GET /settings-audit`. That route takes the house from the token (`settings-audit/settings-audit.controller.ts:84`, `@CurrentUser("restaurantId")`), so it is a house read. A register name is not a record id. It is not keyed on this branch because of the 15-file cap. [Added 2026-10-07 after the lane's verifier found it missing from this list.]

**Keyed by the person only:**
- `hooks/queries/useNotificationQueries.ts:40`, `:80`, `:92`, `:122`. The device cache entry `notifications_${userId}_…` is keyed the same way, which is why the switch empties the device cache.
- `hooks/queries/useSommelierQueries.ts:63`.
- `hooks/useUserPreferences.ts:127`.
- `pages/profile/next/ConsentRegister.tsx:95`.

Whether the routes behind the Sommelier, consent and preference reads are house-scoped was not checked.

**Keyed by one record's id:** 37 keys, for an order, provider, delivery, inventory item, document, folio, thread, prospect or wine. Two examples are `useDraftEmailQueries.ts` and `RowExpansion.tsx:80`/`:97`. An id belongs to one house, so these are lower risk; this branch did not change them. `CanonicalDocumentPage.tsx:219`/`:226` were already filed in `2026-10-02-fix-review-receipts.md`.

**Probably not house reads (not verified):**
- Studio: `StudioApprovalQueue.tsx:24`, `StudioCertify.tsx:19`, `MetricsDashboard.tsx:31`.
- `useHelpNextData.ts:215` (`/health/ready`).
- `useConnectionsNextData.ts:743` (a fixed letter).
- `useGoalScenarios.ts:177` (takes no restaurant, by its own comment).
- Passkeys (`PasskeyRows.tsx:83`).
- `useVendorScopes.ts:185` and `useWineQueries.ts:21`/`:38`/`:46`, and `useVendorPricesNextData.ts:104`/`:116` (catalogue searches; not checked).

**False positives (the key variable carries the house):**
- `useCellarNextData.ts:1100`, `:1205`.
- `MenuNext.tsx:87`.
- `useReportExports.ts:126`.
- `ReceiptsNext.tsx:845`.
- `InventoryCommandPage.tsx:202`, `:402`.

**2. Paths that change the house without `setActiveRestaurantId`, and so forget nothing.**
- **A second tab of the same browser.** Tabs share the stored token. Nothing in `apps/web/src` listens for a `storage` event on `accessToken`: `lib/sessionRenewed.ts` listens only for its own `RENEWED_KEY`, for the websocket. After a switch in one tab, another tab keeps its cache and its label, while its reads go out under the new house's token.
- **Session restore picking the token's house** (`applyBranches` in `fetchAndSetBranches`), and **`joinViaInvite`.** Both set the house without a forget.
- **A sign-in on top of a live session**, without signing out first.
- **A refused refresh that does not reach `endSession`.** AuthContext's own axios interceptor and `stores/authStore.ts` call `doRefresh`, which removes the tokens on a refused refresh token. Neither calls `endSession` or reloads the page, so the cached reads and changes stay until the next sign-out or load (item 15 of `2026-09-29-feat-device-storage-keeps-unsent-work.md`, closed there for sign-out only).

Fix: route every house change and every session end through one function that forgets, and listen for `storage` on `accessToken` in `AuthContext`.

**3. The switch's device-cache clear can lose a race.** A notifications read of the last house that is still in flight writes its device-cache row after the clear, because `cacheEntity` is fire-and-forget. A failed notifications read in the new house can then fall back to that row for its 2-minute life. This is the late-write race already filed as item 9 of `2026-09-29-feat-device-storage-keeps-unsent-work.md`. Fix: key that row by house, or drop a write whose session has changed.

**4. `/recommendations`, loose ends seen while fixing the roster.**
- `loadGoals` (`useRecommendationsNextData.ts`) has the roster's old fault: it is `null` both while reading and after a failure, it never reads again after a failure, and a body that is not a list becomes `[]`. That last one shows a failed read as "no goals".
- The failed-roster sentence (`WhoTakesThisPopover.tsx` `rosterWords`) does not say that opening the menu again tries again. That file was left out to stay under the 15-file cap.
- An assignment sent as `assignedName` alone is still written as sent, unchecked.
- An `assignedName` sent with an `assignedTo` is not compared with the roster's `display_name`.

**5. Who takes an entry is any row of this house's roster, whatever its status (ADR 0306).** [Replaced 2026-10-08. Until then this item read "Active" as `status = 'active'`, dropped `trial` rows on the page and at the gateway, and leaned on ADR 0218 round 4 answer 3, which rules only on the audience of a crew message to everyone. The ADR 0090 audit at `505a03400` BLOCKed on that.] ADR 0306 records the rule as decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation. What it leaves open:
- The popover (`WhoTakesThisPopover.tsx`) shows no status, so an `inactive` person looks like an `active` one. `/team`'s `RosterSheet.tsx` tags non-active rows; a tag here is owed and was left out for the 15-file cap.
- An assignment outlives the assignee's later change to `inactive` or removal: `assigned_to` has no foreign key and nothing sweeps it.
- Invite placeholder rows are `active` roster rows (`ensureTeamMemberForInvite`, `auth/auth.service.ts:2448-2467`), so they can be picked. `revokeInvite` (`restaurants/members.service.ts:667-685`) deletes only the `organization_invites` row (`:674-679`), and no trigger in `supabase/migrations` removes the placeholder, so a revoked invite's placeholder can still be picked.
- The roster read (`listMembers`) is manager-gated, so a staff member's popover says the roster could not be read, while the gateway still accepts a roster id that staff member sends, when the note gate lets the write through.
- Production `team_members.status` values were not read. Every `team_members.status` writer that a git grep of `apps/`, `services/`, `packages/`, `scripts/` and `supabase/migrations` found is in the gateway: `team/team.service.ts` (`:894` and `:995`, `active` or `trial`; `:1040`, `trial`; `:1054`, the member update, a DTO value limited to `active`, `inactive` or `trial` by `team/dto/team.dto.ts:48`) and `auth/auth.service.ts` (`:2455` and `:2466`, invite placeholders; `:2535`, a member who accepts an invite; all `active`). Rows written before those writers, or by hand, were not looked at.
- An assignment sent as `assignedName` alone is not checked against the roster (item 4), so a name can still be put on an entry with no roster row behind it.
