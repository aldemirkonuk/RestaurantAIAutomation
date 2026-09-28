# Web page to gateway audit: what works, what breaks

*Audit of origin/main, 2026-09-28. Everything below comes from reading the code on both sides. No tests or app runs were done (see "Not checked").*

## 1. Summary

**Scope**
- 9 clusters, 68 route entries. Some entries are just redirects.
- 688 web-to-gateway calls checked.

| Cluster | Routes | Calls checked | Confirmed defects | Minor notes |
|---|---|---|---|---|
| auth-public | 14 | 48 | 1 | 2 |
| home-profile | 8 | 75 | 2 | 1 |
| inventory | 6 | 95 | 9 | 5 |
| orders-receiving | 6 | 62 | 2 | 5 |
| vendors | 7 | 85 | 1 | 1 |
| team-calendar | 3 | 75 | 5 | 5 |
| docs-money | 6 | 95 | 2 | 3 |
| settings-admin | 8 | 105 | 5 | 4 |
| ask-studio | 10 | 48 | 7 | 3 |
| **Total** | **68** | **688** | **34** | **29** |

**Confirmed defects by severity** (each one re-checked by a separate verifier)
- **Broken (9):** the feature cannot work at all.
- **Wrong (25):** the feature works, but in some cases it shows false information.
- **Refuted:** 0.

**The pattern.** 20 of the 34 are the same mistake: a failed read is shown as "empty", "zero" or "saved". The repo rule says a failed read must never look like an empty one. There are two main causes:
- On the gateway, a Supabase query returns `{data:null, error}` instead of throwing. The code reads `data` and never looks at `error`.
- On the web, pages take `data = []` from React Query and never read `isError`.

## 2. Confirmed defects

| # | Route | What breaks, for whom | Web file:line | Gateway file:line | Kind | Fix hint |
|---|---|---|---|---|---|---|
| 1 | /register | A new user with a valid invite hits a brief error (503, 429, network). The page says "Code not found, expired, or already used" and Continue stays off. | apps/web/src/pages/Register.tsx:236-241, :565-567 | apps/api-gateway/src/auth/auth.service.ts:2045-2053 | error-shown-as-empty | Show a "could not check, retry" state, as InviteLanding.tsx:87-95 already does. |
| 2 | / (dashboard) | If the calendar read fails, managers see a real-looking month of zero vendor spend instead of a dash. | apps/web/src/pages/dashboard/next/useDashboardNextData.ts:192, :200 | apps/api-gateway/src/dashboard/dashboard.service.ts:430, :439 | error-shown-as-empty | Read `error` on both queries and throw it. |
| 3 | / (dashboard KPI row, feeds) | If the reads fail, bottles, wines and spend show confident zeros. Activity and alerts show as empty. | useDashboardNextData.ts:122-131 | dashboard.service.ts:506-541, :605-640, :703-770 | error-shown-as-empty | After `allSettled`, check `.value.error` and fail the call. *Correction: the "Running low" and "Waiting on you" tiles come from other endpoints, so they are not affected.* |
| 4 | /inventory | **Broken.** Editing any zone that has a parent is rejected with a 400, but the page shows it as saved. The parent can never be cleared. | apps/web/src/hooks/useStorageLocations.ts:335-349; components/inventory/StorageLocationManager.tsx:234 | apps/api-gateway/src/storage-locations/dto/storage-locations.dto.ts:122; main.ts:53-56 | request-shape-mismatch | Map `parentId` to `parent_id`. Send `null` to clear it, and let the DTO accept null. |
| 5 | /inventory | Every zone write (assign, remove, edit, delete) hides failures. Auto-locate says "N wines assigned" whatever happened. | useStorageLocations.ts:163-176; pages/inventory/command/InventoryCommandPage.tsx:315-326 | storage-locations.controller.ts:45, :66, :144, :167 | error-shown-as-empty | Stop swallowing errors. Roll back the screen, show an error toast, and count real successes. |
| 6 | /inventory | The bottle-count stepper inside a zone never saves. The count goes back to the old number on the next refresh. | useStorageLocations.ts:267-286; StorageLocationManager.tsx:883, :902, :920 | storage-locations.controller.ts:45 (existing upsert, not called) | dead-control | Call POST mappings with the new quantity. Debounce it. |
| 7 | /inventory (open a row) | If the reads fail, the row says "No depletion recorded yet" and "No orders for this wine yet". | pages/inventory/command/RowExpansion.tsx:80, :87, :97 | inventory.controller.ts:271, :103; procurement.controller.ts:162 | error-shown-as-empty | Read `isError` and show an error with a retry. |
| 8 | /inventory (order history) | Only the house's 50 newest orders are searched. A wine with older orders shows "No orders yet". | RowExpansion.tsx:87-93; services/api/orders.ts:55 | procurement.service.ts:3036; dto/procurement.dto.ts OrderFilterDto | response-shape-mismatch | Add a server-side `inventoryId` filter. |
| 9 | /inventory | If the deliveries read fails, the "Deliveries to verify" chip and the `?verify=` link disappear silently. | InventoryCommandPage.tsx:355, :360, :395-403, :1086 | procurement.controller.ts:162 | error-shown-as-empty | Show a "could not be read" chip, like the POS one on the same page. |
| 10 | /inventory (wine pickers) | A failed search says "Nothing matches, add it as a new wine". That pushes people into making duplicate wines. | components/inventory/ManualReceiptWorkspace.tsx:71, :330-333; AddWineToInventoryModal.tsx:136, :368 | wines.controller.ts:44 | error-shown-as-empty | Show "search failed, retry" and hide the add-new prompt. |
| 11 | /inventory (menu scan) | A failed scan says "No wines were detected". | apps/web/src/services/wineDetection.ts:482-506; components/scanner/MenuScannerFlow.tsx:85-92; MenuScannerTab.tsx:85 | services/agent-orchestrator/api/scan_routes.py:411 | error-shown-as-empty | Throw on failure, as `scanWineLabel` does. |
| 12 | /inventory (receiving) | When a manager corrects a misread invoice quantity or price, the correction is accepted and then thrown away. | pages/inventory/command/ReceivingWorkspace.tsx:604-637 | procurement.service.ts:~6171-6187; dto/procurement.dto.ts:607 (known TODO) | other | Write the four `prefilled_*` columns and turn the skipped test back on. |
| 13 | /orders, /orders/:id | Houses with more than 50 orders get undercounted station counts and month totals. Older open orders are invisible. | services/api/orders.ts:55; pages/orders/next/useOrdersNextData.ts:385, :430, :457; OrdersNext.tsx:331 | procurement.service.ts:3036, :3089 | response-shape-mismatch | Page through the orders, or compute the totals on the server. **Fork F5.** |
| 14 | /orders (New order, Agreement sheets) | "New order" can quietly rewrite the quantity and money on an existing APPROVED or PARTIALLY_RECEIVED order, while the UI says "new pending order". | pages/orders/next/NewOrderSheet.tsx:320, :376; AgreementSheet.tsx:313 | procurement.service.ts:1084-1150 | response-shape-mismatch | **Fork F1.** |
| 15 | /vendors (add own vendor) | **Broken.** Choosing Payment terms gets a 400. The web hides it as "saved offline" with a fake id, and the vendor is never created. | services/api/providers.ts:198-199, :253; hooks/queries/useProviderQueries.ts:142-172; pages/providers/next/NewVendorSheet.tsx:342 | providers/dto/providers.dto.ts:21-140 (no paymentTerms) | request-shape-mismatch | Add `paymentTerms` to the create DTO. Only queue offline when the network is actually down. |
| 16 | /calendar | **Broken.** A repeating event shows only on its first date. | pages/calendar/next/useCalendarNextData.ts:338, :449, :552 | calendar.service.ts:269, :315, :1097 | response-shape-mismatch | Attach `recurrenceRule` to each row in listEvents. |
| 17 | /team (Edit shift) | "Open shift, nobody assigned" does nothing, and the sheet closes as saved. Clearing a role or note does nothing either. | pages/team/next/ShiftSheet.tsx:123, :126-128 | team/schedule.service.ts:728, :775-780 | request-shape-mismatch | Send `memberId: null` and `""` when editing. |
| 18 | /team (staff view) | Once a colleague opens a shared note, a staff member sees "You have read this" and can never mark it read. Staff can also see other recipients' names and read status. | pages/team/next/MyShiftsNext.tsx:228 | team/notes.service.ts:187-211 | response-shape-mismatch | Match on the viewer's own member id. Trimming what staff see is **fork F6**. |
| 19 | /calendar (event types) | If adding or deleting an event type fails, nothing tells the user. | pages/calendar/next/EventSheet.tsx:152, :288, :336 | calendar.controller.ts:365, :426 | error-shown-as-empty | Add both errors to the failure banner. |
| 20 | /team | If the reads fail, the page says "No credential on file", "No request on file", and shows staff "Off" every day. | pages/team/next/useTeamNextData.ts:417, :453; TeamNext.tsx:614-621; MyShiftsNext.tsx:270 | team.service.ts:1483, :1581; schedule.service.ts:226-242 | error-shown-as-empty | Read `error` and throw, as listCoverageTemplates already does. |
| 21 | /communications | **Broken.** The conversation book (the main list) always gets a 404 because the call is missing the `/api/v1` prefix. | apps/web/src/hooks/queries/useConversationQueries.ts:338 | procurement.controller.ts:1352; main.ts:74 | path-mismatch | Use the prefixed path. Fix the test mock too. |
| 22 | /reports | If the goals read fails, the page says "No goal is running". | pages/reports/next/rp-registers-bench.tsx:105, :116-117, :150-152 | analytics/advanced-analytics.service.ts:775 | error-shown-as-empty | Return `null` on failure and add a `goalsMissing` flag. |
| 23 | /settings (approval thresholds) | **Broken.** Every save is rejected with a 400 ("property enabled should not exist"). | pages/settings/next/useSettingsNextData.ts:884; ThresholdsSection.tsx:190, :301 | vendor-terms/dto/vendor-terms.dto.ts:103-104 | request-shape-mismatch | Add `@IsBoolean()` to `enabled`. Add a test that runs through the validation pipe. |
| 24 | /settings (features) | **Broken.** The arrival-page toggle always fails with a 400. | pages/settings/next/FeaturesSection.tsx:275-281; useSettingsNextData.ts:742 | settings/dto/feature-flags.dto.ts:35-70 | request-shape-mismatch | **Fork F7.** |
| 25 | /settings (email) | **Broken.** "Send a test" always returns 404 in production. The route is dev-only by design. | useSettingsNextData.ts:789; EmailSection.tsx:82; EmailSenderSettings.tsx:58 | communications.controller.ts:382-383; Dockerfile:62 | missing-endpoint | **Fork F2.** |
| 26 | /dev/truth | **Broken.** Switching between the reach and swallow tabs crashes the page. | pages/DevTruth.tsx:98-113, :171-176, :219, :356 | analytics/dev-truth.controller.ts:41-65 | response-shape-mismatch | Clear the old data when the tab changes, or only render when the stored tab matches. Add a click-through test. |
| 27 | /connections | If the catalogue read fails, every "Not connected" row vanishes with no message. | pages/connections/next/ConnectionsNext.tsx:1205, :1326 | integrations/integrations-oauth.controller.ts:60-93 | error-shown-as-empty | Show the existing UnreadRegister on error. |
| 28 | /studio/queue | Developers see Approve and Reject buttons, but every click fails with a 403. | pages/studio/StudioApprovalQueue.tsx:19; queue/QueueRow.tsx:107-127 | services/agent-orchestrator/api/studio_routes.py:428-432 | role-mismatch | **Fork F3.** |
| 29 | /studio/certify | Developers see Invite, Revoke, Enable and Disable, but every one fails with a 403. | pages/studio/StudioCertify.tsx:32-38; certify/InviteDialog.tsx:57 | studio_routes.py:501-504, :870-873, :898-901, :1118-1121 | role-mismatch | **Fork F3.** |
| 30 | /studio | Every contributor visit shows a red "Studio metrics unavailable" (403). | pages/studio/metrics/MetricsDashboard.tsx:27; Studio.tsx:20 | studio_routes.py:658-660 | role-mismatch | **Fork F3.** |
| 31 | /studio/certify | Every contributor shows as "Unknown" with a shortened id. The screen-reader label reads "Disable undefined". | pages/studio/certify/ContributorTable.tsx:118-119, :143 | studio_routes.py:855-860 | response-shape-mismatch | Look up names and emails, as `_hydrate_queue_rows` already does. |
| 32 | /studio ("empty record") | **Broken.** Every cell edit and Promote returns 404, because the record id is made up in the browser. A failed session write is also faked as success. | pages/studio/CommandBar.tsx:132-149; FieldCell.tsx:72; WineRecordsTable.tsx:51 | studio_routes.py:73-107, :188-190, :~955 | other | **Fork F4.** |
| 33 | /simpos/:id (dev only) | For a non-sim house, failed reads show "Catalog empty", "No items" and "No documents yet". | pages/simpos/SimposTerminalPage.tsx:94, :161, :540, :581, :902 | simpos/simpos.service.ts:132-145 | error-shown-as-empty | Check `isError` and show the gateway's message. |
| 34 | /simpos/:id/orders (dev only) | Any failure shows "No checks yet". | pages/simpos/SimposOrderLogPage.tsx:51, :80-82 | simpos.service.ts:755-795 | error-shown-as-empty | Add an error branch before the empty state. |

Web paths are under `apps/web/src/`, and gateway paths under `apps/api-gateway/src/`, unless a full path is given.

## 3. Proposed fix lanes

Rules for every lane: one operation per branch, under 15 files, and a pipe-level test wherever a DTO changes. Lanes B and C both touch InventoryCommandPage.tsx, so merge B first. D1 touches RowExpansion.tsx, so run it after C.

| Lane | Branch | Defects | Main files | Founder decision? |
|---|---|---|---|---|
| A | `fix/dashboard-read-errors` | 2, 3 | dashboard.service.ts + spec | No |
| B | `fix/storage-location-writes` | 4, 5, 6 | useStorageLocations.ts, StorageLocationManager.tsx, InventoryCommandPage.tsx, storage-locations.dto.ts, tests | No |
| C | `fix/inventory-read-error-states` | 7, 9, 10, 11 | RowExpansion.tsx, InventoryCommandPage.tsx, ManualReceiptWorkspace.tsx, AddWineToInventoryModal.tsx, wineDetection.ts, MenuScannerFlow.tsx, MenuScannerTab.tsx, tests | No |
| D1 | `feat/procurement-order-filters` | 8, 13 | procurement.dto.ts, procurement.service.ts, orders.ts, RowExpansion.tsx, useOrdersNextData.ts, OrdersNext.tsx | Partly (F5) |
| D2 | `fix/verify-receipt-prefilled-persist` | 12 | procurement.service.ts, proposal-preservation-deferred.spec.ts | No (it closes an ADR 0059 TODO) |
| D3 | `fix/order-create-merge-guard` | 14 | procurement.service.ts, NewOrderSheet.tsx, AgreementSheet.tsx, spec | **Yes (F1)** |
| E | `fix/provider-create-payment-terms` | 15 | providers.dto.ts, providers.service.ts, useProviderQueries.ts, NewVendorSheet.tsx, tests | No |
| F | `fix/calendar-recurrence-and-type-errors` | 16, 19 | calendar.service.ts, calendar DTO, EventSheet.tsx, tests | No |
| G | `fix/team-contract-gaps` | 17, 18, 20 | ShiftSheet.tsx, team.dto.ts, MyShiftsNext.tsx, notes.service.ts, team.service.ts, schedule.service.ts, tests | Partly (F6) |
| H | `fix/comms-history-prefix` | 21 | useConversationQueries.ts, useCommsNextData.test.tsx | No |
| I | `fix/reports-goals-missing` | 22 | advanced-analytics.service.ts, rp-registers-bench.tsx, tests | No |
| J | `fix/settings-dto-whitelist` | 23 (+24 if F7 says so) | vendor-terms.dto.ts, feature-flags.dto.ts, new pipe spec | Partly (F7) |
| K | `fix/settings-test-email` | 25 | communications.controller.ts or EmailSection.tsx + EmailSenderSettings.tsx, plus an ADR | **Yes (F2)** |
| L | `fix/devtruth-tab-crash` | 26 | DevTruth.tsx, DevTruth.test.tsx | No |
| M | `fix/connections-catalog-error` | 27 | ConnectionsNext.tsx, test | No |
| N1 | `fix/studio-role-gates` | 28, 29, 30 | StudioApprovalQueue.tsx, QueueRow.tsx, StudioCertify.tsx, ContributorTable.tsx, Studio.tsx or studio_routes.py, plus an ADR | **Yes (F3)** |
| N2 | `fix/studio-contributors-hydrate` | 31 | studio_routes.py, ContributorTable.tsx, test | No |
| N3 | `fix/studio-manual-record` | 32 | CommandBar.tsx, studio_routes.py, tests | **Yes (F4)** |
| O | `fix/register-invite-error-state` | 1 | Register.tsx, test | No |
| P | `fix/simpos-read-error-states` | 33, 34 | SimposTerminalPage.tsx, SimposOrderLogPage.tsx, tests | No |

### Forks that need a founder decision

None of these is in `.planning/decisions/` yet. Each needs an OPEN-DECISIONS entry. Its OD number has to be taken on the current main, per §5b.

- **F1 — "New order" merging into an existing order (#14).**
  - (a) Never merge into APPROVED, PARTIALLY_RECEIVED or APPROVAL_NEEDED orders. Always create a new order. This is safest for money.
  - (b) Keep merging, but return `merged: true`. The web then says "updated existing order X".
  - (c) Refuse with a 409 and let the person choose.
  - *Recommendation: (a), plus (b) for orders that are still PENDING.*
- **F2 — Email test in production (#25).**
  - (a) Build a production-safe endpoint: role-gated, scoped to the house, rate-limited, and sending only to the caller.
  - (b) Hide "Send a test" in production.
  - Either way this changes ADR 0019 D2. *Recommendation: (b) now, and (a) only if customers ask for it.*
- **F3 — Studio roles (#28-30).**
  - (a) Developers can only view: hide the queue and certify write buttons for them.
  - (b) Let developers use those orchestrator endpoints.
  - (c) Limit /studio/queue and /studio/certify to review_admin.
  - For metrics, separately: (i) let contributors see metrics, or (ii) hide the dashboard from them.
  - *Recommendation: (a) + (ii). Neither changes who can approve.*
- **F4 — Studio "start with an empty record" (#32).**
  - (a) Add an endpoint that creates a real submission row.
  - (b) Remove the option until the endpoint exists.
  - *Recommendation: (b), because it is cheap and honest.*
- **F5 — /orders totals past 50 orders (#13).**
  - (a) Page through every order in the browser.
  - (b) Compute counts and month totals on the server.
  - (c) Keep the 50-order window, labelled "from the newest N orders".
  - *Recommendation: (b), with (c) as a stopgap.*
- **F6 — Who can staff see on a crew note (#18)?**
  - (a) Staff see only their own recipient row.
  - (b) Keep the full list and fix only the "read" check.
  - *Recommendation: (a).*
- **F7 — The held-back arrival page flag (#24).**
  - (a) Let the DTO accept `mudavym_design_arrival` so it can be toggled.
  - (b) Hide the toggle until arrival is launched.
  - This is about launch timing. *Recommendation: (b).*

## 4. Not checked, per cluster

No unit tests, app runs or HTTP calls were done in any cluster. Every finding comes from reading the code. The shared disk was full, so `pnpm install` could not run.

- **auth-public:** apiClient's non-401 interceptors. Tenant-guard behaviour on switch-restaurant and /auth/me. Whether createFirstHouse refuses a second house. The menu-import result shape. The internals of HoldToApprove and the legacy AuthorizeIntegration. The Arrival folio fields. Role checks inside ArrivalService and IntegrationConsentService. Google and Microsoft script loading.
- **home-profile:** The field shapes of activity and alert items. Legacy branches that only show with a QA override. The /receiving desk children. The shell components, beyond their four reads. Help readiness reads, beyond five. The payment, billing and MCP write role rules. Whether getStats is cut off by PostgREST's row cap.
- **inventory:** The field-by-field shapes of the Cellar view models. The activity payload. The /pos-hub payloads. The sealed document verify and edit flows. The branch switcher. Realtime subscriptions. The shapes and auth of the orchestrator scan routes. Whether errors from getInventorySummary or getWinesAtLocation reach the user. Legacy branches that only show with an override.
- **orders-receiving:** The inventory and wines hooks used by the sheets. Shell chrome and the websocket. The /receipts link target. The service-level role checks (approve, cancel, confirmDeal, never-arrived). The recurrence, PATCH and DELETE routes, which have no role guard. Legacy Orders.tsx, which was searched with grep but not read in full. The door screen's offline retry.
- **vendors:** Legacy Providers, Recommendations, InsightCatalog and VendorPriceCompare, which were only listed. The recommendations `toEntry()` fields. The identity decision fields. GET /team for the assign menu. The goal-scenario POST. Currency fields. MastheadStatus shapes. Whether analytics routes pin `:restaurantId` to the caller's house, which is a tenancy question. Route order across the two ProvidersControllers.
- **team-calendar:** The legacy CalendarPage and EventModal mutations. The weather, day-record and reminder-status shapes. The iCal link sheet. Coverage and labor shapes beyond the fields the pages read. Text-sender consent. Also noted but not filed: the calendar controller has no role guard, event-types trusts the house id in the URL, and multi-day events that start before the window are missed.
- **docs-money:** The legacy pages, which were only skimmed. Response shapes for menu-engineering, financial, table-performance, waiters, inventory-science, goals progress, the canonical layers, threads and letters. Seal-service role behaviour for document verify and corrections. Service business rules behind letters, deliveries and intake. The SealedRejectDie DTOs and guards. The getInventory and getOrder shapes. The route table was extracted by regex.
- **settings-admin:** The legacy Settings, AdminPanel, AdminHealth and LogsTimelinePage, which were only searched with grep. TeamLaborSettings `mayChange`. The pos-hub, payment-methods and distributor-feed shapes, checked only at the header level. The Stripe flow. HoldToApprove seal bodies. DistributorFeedPanel internals. The DevTruth crash was worked out from React render order, not run. That production runs with NODE_ENV=production comes from the Dockerfile, not from the live host.
- **ask-studio:** The global Ask panel writes (routes confirmed to exist only). The SimPOS catalog editor's error handling. The Receipts pane's house id. The onboarding extract fields beyond the ones used. Whether JwtAuthGuard admits a studio-only token. 207 partial-extraction errors not shown in CommandBar, judged cosmetic.

## 5. Refuted claims

**No claim was refuted.** Verifiers narrowed or corrected these:
- #3: the "Running low" and "Waiting on you" tiles come from other endpoints, so they do not show the bad zeros.
- #4: the impact is wider than first claimed. Any edit to a zone that has a parent fails, not only a parent change.
- #12: only three of the four fields go through `readAliasedQuantity`. The unit price is dropped without being read at all.
- #14: "without a new seal" overstates it. Seals cover agent approvals, not manual POSTs. The money-rewrite defect stands.
- #5, #9, #15, #20, #26, #29: some cited line numbers or paths were slightly off. The substance is unchanged.

## 6. Minor notes (29, not independently verified)

Grouped by type. Most are on legacy pages that only show with a QA override.
- **Error shown as empty (13):** VerifyEmail sends a user back to onboarding after a transient error. The Inventory wine lookup has no banner. The legacy WineLibrary. Legacy ReceivingHome ×2 (one says "nothing to chase", one shows "Loading…" forever). The force-fetch call answers 200 with an error inside. Order attachments. Duplicate-vendor checks ×2. Calendar event types. The legacy OpsRulesPanel. The Reports sheet preferences. The AddLocation chain picker.
- **Role mismatches (8):**
  - Staff are shown controls or panels that the gateway refuses (403): the Notifications market panels, the add-wine prices, the menu prices, the drafts card.
  - The gateway lets staff do what the page reserves for managers: Goals writes, the sign-off name, the digest settings.
- **Dead controls (5):** "Also text N of M" on team notes. Connections "Connect" (its enabled condition is inverted) and "Connect yours". Studio Enable, which cannot be reached. Studio URL ingest.
- **Other (3):**
  - Missing endpoints: legacy `inventory/add-from-order`, and legacy `sommelier/chat`.
  - Clearing edits sends nothing, so the old value stays: calendar event fields, and team member fields.
  - Unmounted: TargetMarginSection is built but not used on any page.
  - A public route that should need sign-in: /get-started.
  - Legacy add-to-existing sends fields the DTO rejects: AddToInventoryFromLibraryModal.

The count "29" is the per-cluster total from the audit data. The groups above overlap, so they do not add up to 29.
