# 0019 — P2 build scope (the founder-approval list)

- **Status:** Locked (build authorized 2026-08-25) — **with two carve-outs, see Decision**
- **Date:** 2026-08-25
- **Decider:** Aldemir (founder) — this document exists to be edited and locked by you
- **Keywords:** P2.3, build scope, page graph, dead ends, live defects, endpoint gaps, web deploy
- **Links:** [[0018-p2-plan-of-record]], `.planning/06-pages/PAGES-MAP.md` (findings feed), `.planning/v3.0-TECH-DEBT.md`, `.planning/07-reference/UX_PATHS_CATALOG.md`

## Context

ADR 0018 stage P2.3: the docs are grounded, so the build scope becomes a
decision instead of a drift. Sources, all verified 2026-08-25: the Surface
graph (50 notes, 115 page→page edges), the endpoint atlas verification, the
tech-debt register, and the decision register. Approve by striking or keeping
lines; anything kept becomes P2.4's burn-down list, in this order.

## A. Live defects — proposed first, they are broken today

| # | Defect | Proposed fix |
|---|---|---|
| A1 | Inventory Command "View ledger" → `/documents` — **route does not exist** (`RowExpansion.tsx:329`) | Point at `/documents-reports?ledger=…` and honor the param there |
| A2 | One-Tap gmail actions → `/emails` — **route does not exist** (`OneTapActionCenter.tsx:131`) | Point at `/communications` with the thread preselected |
| A3 | Wines reorder confirm does a full page reload via `window.location.href` (`WineLibrary.tsx:372`) | SPA `navigate("/orders")`, state preserved |
| A4 | `v3.0-TECH-DEBT.md` 44.1b — wine-library duplicate-add mutates an in-memory store and fires a success event for a write the DB never received | **Verify against the register first** (half-closed entries are the norm); if open, persist through the API |

## B. Dead-end pages — wire, bless, or retire (one verdict each)

15 pages have no outbound page navigation. A dead end is either a deliberate
leaf or a missing connection; proposed verdicts:

| Page | Proposed verdict |
|---|---|
| `/wine-agent`, `/wineagent` | **Retire** — pure placeholders, zero buttons; the alias doubles the surface for nothing. ✅ **Done 2026-08-26** — routes, inline `PlaceholderPage`, sidebar item and both page notes deleted; mobile deep-links repointed at `/sommelier`. |
| [[admin]], [[admin-health]], [[dev-sandbox]], [[logs]] | **Bless as leaves** — dev/ops surfaces, no product flow should depend on them |
| `/calendar-classic`, `/inventory-legacy` | **Retire after parity check** — superseded by [[calendar]] and [[inventory]]; keeping two calendars and two inventories doubles every future change. ⛔ **Parity check 2026-08-26: both FAILED — retirement blocked**, see §B-parity below. ✅ **Both retired 2026-08-26** after their blockers were ported onto [[inventory]] and [[calendar]]. |
| [[calendar]] | **Wire** — today's dates should link to [[orders]] / [[promotions]] they reference |
| [[documents-reports]], [[receipts]] | **Wire** — each document row should link to its [[orders]] order and vendor page; receipts ↔ credits transition exists as API only |
| [[sommelier]], [[team]], [[vendor-prices]], [[vendor-public-page]] | **Bless as leaves** — self-contained tools; revisit if usage says otherwise |

### B-parity — the check the founder attached to the two "retire" verdicts

Run 2026-08-26, both legacy components read against their replacements. **Both
failed.** Neither page was deleted. The rule applied: a capability blocks
retirement only if it is *exclusive* **and** *actually works* — a button that
lies is not function worth preserving.

**`/inventory-legacy` (`pages/Inventory.tsx`) — 2 blockers. ✅ Both closed and the
page retired 2026-08-26.** What shipped, in the order the blockers were listed:

1. Auto-Locate is wired into `/inventory` — same engine, same modal, no
   reimplementation. `handleAutoLocate` / `handleConfirmAutoLocate` in
   `InventoryCommandPage.tsx`, `onAutoLocate` passed to `StorageLocationManager`,
   `AutoLocatePreviewModal` mounted. It scores `inventory` (the whole list), not
   `filteredInventory`, so a search box cannot silently shrink the plan.
2. `MultiLocationCell` now renders in the expanded row's action bar
   (`RowExpansion.tsx`), replacing the qty-stepper + "to…" select. `fromLocationId`
   comes from the chip the manager picked; the hardcoded `null` is gone.

Three further capabilities the first parity pass **missed**, also ported rather than
deleted: by-the-glass **pour** (`recordPour`, the endpoint's only UI caller), the
**active/inactive toggle** (row context menu → `PATCH … {isActive}`), and the
**realtime inventory subscription** — re-expressed as `refetchInventory()` on the
event instead of the legacy page's 100-line hand-merge into local state.

Original finding, retained:

1. **Auto-Locate.** `lib/autoLocateEngine.ts` scores every unassigned wine against
   every storage location (temperature band, capacity, type) and
   `AutoLocatePreviewModal` lets you review and bulk-confirm the plan. It persists:
   `handleConfirmAutoLocate` (`Inventory.tsx:654`) → `assignWineToLocation` →
   `POST /storage-locations/:rid/mappings` (`useStorageLocations.ts:238-244`).
   `/inventory` mounts the same `StorageLocationManager` but **omits the
   `onAutoLocate` prop** (`InventoryCommandPage.tsx:884-893` vs
   `Inventory.tsx:1821`), and that prop is what gates the button
   (`StorageLocationManager.tsx:1067`). The whole engine has exactly one caller.
2. **Per-location breakdown + source-selected transfer.** `MultiLocationCell`
   shows a wine's per-location chips and moves *N* bottles **from A to B**
   (`Inventory.tsx:1464-1476`). `/inventory` shows only the first location plus a
   "+N" count (`InventoryCommandPage.tsx:278-282, 491-494`), and its transfer
   hardcodes `fromLocationId: null` (`RowExpansion.tsx:102`) — you cannot say
   which location the bottles leave.

*Not blockers, verified:* `ManualOverrideModal` is superseded — `/inventory`'s
"Manual adjust" bar (`RowExpansion.tsx:288-303`) takes a delta plus a reason and
writes through `reconcileItem`, i.e. the ledger, where the legacy modal PATCHes
`stockLive`/`shadowStock` directly (`Inventory.tsx:338-345`) — the exact
dual-bookkeeping the SOTA rebuild removed. "Reset All Stock"
(`Inventory.tsx:450-484`) is **fake**: it mutates React state only, hits no API,
and then alerts "This action has been logged to the audit trail." Retiring the
page would delete a lie, not a feature.

*Tech-debt 44.1e (`InvoiceScannerModal`) is already closed* and is **not** a
reason to retire this page: the component was deleted in `e5402d67`
("delete InvoiceScannerModal — and correct my own wrong claim about it"). Zero
matches remain under `apps/web/src`. `STATE.md:64` still says the page hosts it —
that line is stale.

**`/calendar-classic` (`pages/Calendar.tsx`) — 1 blocker.**

**Event reminders only actually fire from the classic page.** `handleCreateEvent`
calls `scheduleReminder()` (`Calendar.tsx:948-960`), which writes to localStorage
and is drained every 60s by `startReminderScheduler()` (booted in `main.tsx:19`)
into a browser Notification plus `POST /notifications`
(`lib/reminder-scheduler.ts:126-206`). It also fires a "New Calendar Event"
notification on save (`Calendar.tsx:923`). `/calendar` has the *better* reminder
UI — up to three entries with in-app/email channels
(`EventModal.tsx:1325-1380`) — and **throws the data away**:
`CalendarPage.handleModalSave` never reads `data.reminders`
(`CalendarPage.tsx:196-244`) and never calls `scheduleReminder`, and
`buildCreatePayload` drops `reminders`/`customReminderMinutes` from the API body
(`services/api/calendar.ts:105-121`). So the modular page silently discards every
reminder a user sets. Fixing that is the prerequisite for retiring the classic page
— and is a live defect on `/calendar` regardless of what happens to the classic one.

✅ **Ported 2026-08-26, and the page retired.** `/calendar` now schedules through the
same proven mechanism rather than a newly invented one: `syncEventReminders`
(`CalendarPage.tsx`) writes each reminder the modal collects into the localStorage
queue `startReminderScheduler` already drains. Server-side persistence was checked
and rejected on evidence, not preference — the calendar API exposes only
`reminderEnabled` + `reminderDaysBefore` (`calendar.dto.ts:204-211`), **nothing reads
those columns** (no `@Cron` in the calendar module, no VALARM in the iCal feed,
`reminder_sent` has no writer), and the one calendar-touching cron
(`communications/scheduled-tasks.service.ts:666`) sends a fixed 2-day prep email to
managers for a single hardcoded restaurant. Persisting there would have been an
invented endpoint that still fires nothing. Editing an event now re-schedules and
deleting one cancels; the edit modal reads the scheduled set back so it stops
silently resetting to the default. 4 tests, all 4 proven to fail against the old
`handleModalSave`. **Residual, recorded not hidden:** reminders live in one browser
and the `email` channel toggle still does nothing — see calendar.md §13 items 1–2.

*Not blockers, verified:* `NewEventTypeModal` is superseded — the modular
`EventModal` creates, renames, recolors and deletes custom event types against the
same `data/customEventTypes` store (`EventModal.tsx:437-475`). `EntityAutocomplete`
multi-entity tagging is **not persisted**: `entityTags` never reaches the API
(absent from `services/api/calendar.ts` entirely), and a single non-provider
`relatedEntity` is smuggled into the description as a `[tag:type:name]` string
(`Calendar.tsx:882-886`). Provider linking, the one part that persists, exists on
`/calendar` too (`EventModal.tsx:519`). The modular page is otherwise a superset:
month/week/day/agenda, search, drag-move/resize, RRULE recurrence, meeting memos.

**Consequence.** Retiring either page needs a build first, not a delete:
port Auto-Locate and source-selected transfer onto `/inventory`, and wire
`/calendar`'s reminders to something. Those are new work items, not part of this
retirement. ✅ Both builds landed 2026-08-26 and both pages are now retired.

## C. Cold-entry pages — auth + empty-state audit

22 routes are reachable only by URL/redirect (`foundation/PAGE_MAP.md:104`).
Most are sidebar-reachable in practice (the census counts body links only);
the genuinely cold ones — `/v/:slug`, `/authorize/:integrationId`,
`/simpos/*`, `/invite/:code` — each need a verified auth + empty-state pass
before deploy. Proposed as one P2.4 line item, not four.

## D. Endpoint gaps

A first draft of this section proposed four gaps; **verification killed
three** — ux-optimizer and simpos both carry class-level `JwtAuthGuard`
(`ux-optimizer.controller.ts:55`, `simpos.controller.ts:54`), and the POS
webhook **fails closed** when `POS_HUB_WEBHOOK_SECRET` is unset
(`pos-hub.service.ts:206-214`, spec'd at `pos-hub.service.spec.ts:255`). The
draft rows are recorded here as a caution, not repeated. What survives:

The atlas re-verification landed (this PR): **450 endpoints — 411 guarded, 30
public by design, 9 unguarded**. The atlas's previous exposure claim (137
unguarded) was overstated by 128 rows of rot. The 9 real ones were all on one
controller and are **already fixed in [#66](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/66)**
(Toast: anonymous reads of any restaurant's menus/sales verified 200 in
production, plus a mock-mode escape that accepted unsigned stock-mutating
webhooks). What remains proposed:

| # | Gap (verified) | Proposed fix |
|---|---|---|
| D1 | ✅ **FIXED 2026-08-25 — and this row's original claim was wrong.** It said any authenticated user could read another restaurant's data. Not so: `TenantGuard` compares the JWT's `restaurantId` against param/query/body and throws `ForbiddenException` (`tenant.guard.ts:62`), so a user *with* a tenant was always caught. The real hole was narrower and worse-shaped: a user with **no** `restaurantId` on their session skipped the comparison entirely (`if (!user?.restaurantId) return true`), so a tenantless account could name any restaurant and be let through. Now denied whenever the request names a tenant, while tenantless routes (onboarding, profile, settings) keep working. 6 tests, 2 proven to fail against the old code | Done |
| D2 | **~9 `@Public()` `test/*` routes on `communications.controller.ts` (lines 305–991) mutate real data in production** — `test/e2e/step2-approve-reorder` approves a real order, `step3-send-vendor-email` sends a real email, no env gate | Gate behind `NODE_ENV !== "production"` like SimPOS, or delete; founder picks |
| D3 | **`POST /communications/webhooks/gmail` + `/gmail/force-fetch` are `@Public()` with no Pub/Sub OIDC verification** — anyone can trigger a fetch/publish cycle | Verify the Google-signed OIDC token on push requests |
| D4 | **AdminPanel's orchestrator health call is both mis-pathed and unauthenticated** (`AdminPanel.tsx:215` calls `/health/agents` bare; the real route is `/api/v1/health/agents` and wants `X-Admin-Key`) — it can only ever hit the graceful-error branch, so the admin page has silently never shown live agent health | Fix path + auth together when the admin page is touched in P2.4 |

## E. Deliberately NOT in P2

- **Rebrand sweep** (~71 user-visible WineOps strings) — held until brand
  direction exists (standing decision, Vision §13/§14.5).
- **Testing campaign** (44.8–44.12 breadth passes) — after the approved
  feature set ships, not interleaved; P2.4 items carry their own tests.
- **UX_PATHS_CATALOG full burn-down** (~660 unshipped paths) — P2 ships the
  approved list above; the catalog remains the backlog, reconciled per 44.15.
- **Mobile, NF-B guests, Ask AI, beverage expansion** — P3 candidates
  (ROADMAP).

## Decision

**Authorized by the founder 2026-08-25**: *"complete P2 from start to end,
deploy full process"*. That instruction locks the build scope; it does not
license everything in the tables, and two carve-outs are held back
deliberately rather than assumed:

**~~HELD~~ — page retirements (section B). Resolved 2026-08-26.** Deleting
`/calendar-classic`, `/inventory-legacy`, `/wine-agent` and `/wineagent` removes
surfaces a user may be relying on, and this ADR makes each conditional on a parity
check. The founder gave the explicit yes; the parity check then split the four:

- `/wine-agent`, `/wineagent` — **retired.** No parity condition to fail: one
  inline `PlaceholderPage` under two spellings, zero buttons, zero endpoints.
- `/calendar-classic`, `/inventory-legacy` — **not retired** on the first pass. Both
  failed parity; each still held working capability the replacement lacked
  (§B-parity above). They were not "kept for safety" — they were kept because
  deleting them would delete function. Porting that function was the prerequisite
  for a second attempt.
- `/inventory-legacy` — **retired 2026-08-26** on that second attempt. Both blockers
  (plus three the first pass missed) were ported onto `/inventory` first; then the
  route, `pages/Inventory.tsx` (1,928 lines) and the now-unimported
  `components/inventory/ManualOverrideModal.tsx` were deleted. The modal was **not**
  ported: §B-parity already ruled it superseded, and re-adding a direct
  `stockLive`/`shadowStock` PATCH to the canonical page would reintroduce the exact
  dual-bookkeeping the SOTA rebuild removed. "Reset All Stock" was not ported either
  — it was fake. Both are capability *reductions* made deliberately, not oversights.
- `/calendar-classic` — **retired 2026-08-26** on its second attempt. Its one blocker
  (reminders that fire) was ported onto `/calendar` first; then the route,
  `pages/Calendar.tsx` (2,345 lines) and the now-unimported
  `components/calendar/NewEventTypeModal.tsx` and
  `components/shared/EntityAutocomplete.tsx` (330 lines) were deleted. A second parity
  pass found three further classic-only behaviours, none worth porting, all recorded:
  the **location** input persisted nowhere (`buildCreatePayload` has no `location`
  field) — another lying input, deleted with the page; the `[tag:…]` /
  `[custom_type:…]` strings the page wrote into event descriptions were **never read
  back** by anything; and a "New Calendar Event" notification the page raised to the
  user about the event they had just created themselves. One genuine *reduction*:
  the classic page subscribed to `useCalendarEventsSubscription` for live refresh and
  `/calendar` does not, so a second operator's edits now appear on react-query refetch
  rather than instantly. Small, real, and not a reason to keep 2,345 lines.

Everything else in B is additive wiring and was never blocked by this.

**HELD — anything requiring a secret the browser must not hold (D4).** If the
admin health panel needs a server-side proxy, that is a new endpoint and an ops
change, not a build item.

**BUILT under this authorization:** A1–A4 (live defects), D1–D3 (tenant
isolation, public test routes, Gmail push verification), and the additive
wiring in B. Delivered in `feat/p2-4-burndown`.

## Consequences

Approving fixes P2.4's scope; anything struck stays in the backlog docs it
came from. The two-calendar / two-inventory retirements (B) are the largest
risk items — each needs a parity check before deletion, and the check is part
of the line item.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | — | Drafted from the Surface findings feed + register; awaiting founder lock |
| 2026-08-25 | Aldemir | Build authorized ("complete P2 start to end, deploy"); retirements and secret-bearing work held back explicitly |
| 2026-08-25 | Production | Deployed and verified live: the nine public test routes went reachable → 401, Toast reads 200 → 401, and the web bundle carries zero dead-route literals. Negative controls (login, pos-hub webhook) unchanged |
| 2026-08-25 | Verification | D1's stated premise was FALSE — TenantGuard already blocked cross-tenant reads; the real hole was the tenantless-session bypass, now closed. Row corrected in place |
