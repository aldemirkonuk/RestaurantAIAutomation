---
type: index
title: Retired Pages
updated: 2026-08-26
supersedes: ["06-pages/inventory-legacy.md", "06-pages/calendar-classic.md", "06-pages/wine-agent.md", "06-pages/wineagent.md"]
links: ["[[PAGES-MAP]]", "[[PAGE-CONTRACT]]", "[[inventory]]", "[[calendar]]", "[[sommelier]]"]
---

# Retired pages

> **Retire-to-write (CLAUDE.md §4):** this file supersedes the four page dossiers
> deleted when these routes came down. Deleting a dossier while its page is still
> live leaves a page that is *both* shipping and undocumented, which is the worst of
> the two states — this index exists so the deletions are a record, not a hole.

Four routes were retired under [ADR 0019](../decisions/0019-p2-build-scope.md) §B
("yes close it entirely"). The parity work and the deletions landed in `58113e26`;
the redirects, the one regression the retirement left behind, and this record
landed in `feat/retire-legacy-pages`.

| Retired route | Component (deleted) | Replaced by | Old URL today |
|---|---|---|---|
| `/inventory-legacy` | `pages/Inventory.tsx` (1,928 ln) | [[inventory]] `/inventory` — `InventoryCommandPage` | **redirects** to `/inventory` |
| `/calendar-classic` | `pages/Calendar.tsx` (2,345 ln) | [[calendar]] `/calendar` — `CalendarModular` | **redirects** to `/calendar` |
| `/wine-agent` | inline `PlaceholderPage` | [[sommelier]] `/sommelier` | falls to the `*` catch-all → `/` |
| `/wineagent` | inline `PlaceholderPage` (same) | [[sommelier]] `/sommelier` | falls to the `*` catch-all → `/` |

Also deleted, because only a retired page imported them:
`components/inventory/ManualOverrideModal.tsx` (356 ln),
`components/calendar/NewEventTypeModal.tsx`, `components/shared/EntityAutocomplete.tsx`.

## Surface — retired routes → where they go

These are the only outbound edges a retired route still has, and they belong in the
page graph for the same reason the live ones do: a reader tracing a saved link needs
to land somewhere. (This section also keeps ADR 0018's completeness claim green — its
check reads every `.md` in this folder, not only `type: page` notes. If the register
owner would rather the check skip index notes, that is a one-word edit to the
`verify` command in `CLAIMS.jsonl:19`, which this session did not own.)

- **`/inventory-legacy`** → [[inventory]] `/inventory` (`<Navigate replace>`)
- **`/calendar-classic`** → [[calendar]] `/calendar` (`<Navigate replace>`)
- **`/wine-agent`**, **`/wineagent`** → no route; the `*` catch-all resolves them to
  [[dashboard]] `/`. Every in-app "Wine Agent" control points at [[sommelier]]
  `/sommelier` instead.

---

## The redirect decision, and why

`/inventory-legacy` and `/calendar-classic` **redirect**; the two placeholders do not.

**Redirect, not 404, for the two real pages.** A redirect is honest exactly when the
destination can do everything the bookmarked page could — otherwise it is a lie that
costs the user a support ticket instead of an error page. That condition is met here
and only because parity was ported *before* either page was deleted (table below). A
404 would be the right answer if the capability were gone; it is not.

**Redirect, not the catch-all.** Doing nothing was not neutral. `<Route path="*">`
sends every unmatched path to `/`, so before this change a saved `/inventory-legacy`
link landed silently on the Dashboard — the wrong page, with no signal that anything
had moved. That reads to a manager as "the app is broken", which is strictly worse
than either a redirect or a 404. Three aliases already in `App.tsx` (`/distributors`,
`/credits`, `/services`) set this precedent with the same stated rationale.

**No redirect for `/wine-agent` and `/wineagent`.** They rendered an
under-construction placeholder with no behaviour behind it, so there is no capability
to preserve and nothing to be honest about. Nothing in the app ever linked to them
(verified by grep across `apps/`, `packages/`, `e2e/`), and every surviving "Wine
Agent" entry point — web `GetStarted.tsx:133`, `StaffWelcome.tsx:22`, `Help.tsx:173`,
`WineAgentFab.tsx`, and the mobile deep-link in `apps/mobile/app/wine-agent.tsx` —
already navigates to `/sommelier`. A redirect here would add a permanent path alias
to buy nothing.

Guarded by `apps/web/e2e/retired-routes.spec.ts`, which asserts both directions: the
legacy paths resolve to their replacements *and* the replacements actually mount.

---

## Parity — `/inventory-legacy` → `/inventory`

Re-derived on 2026-08-26 against `git show 58113e26^:apps/web/src/pages/Inventory.tsx`
rather than trusting the earlier record.

| Legacy capability | On `/inventory`? | Where |
|---|---|---|
| Realtime inventory subscription | ✅ | `useTypedInventorySubscription` in `InventoryCommandPage.tsx` |
| Auto-Locate + preview modal | ✅ ported | `InventoryCommandPage.tsx:142-160`, `:947-963` |
| Active / inactive toggle | ✅ ported | `InventoryCommandPage.tsx:158`, row menu `:995` |
| `MultiLocationCell` + **source-selected** transfer | ✅ ported | `RowExpansion.tsx:329`, `transferStock` with a real `fromLocationId` at `:106` |
| By-the-glass pour (`recordPour`) | ✅ ported | `RowExpansion.tsx:118` — the only UI caller in the product |
| Reconcile / manual adjust | ✅ | `RowExpansion.tsx:89` `reconcileItem` |
| Remove from inventory | ✅ | `RemoveFromInventoryModal` |
| Table export | ✅ (redesigned) | two flavours — valuation + count sheet |
| **Measurement-unit display (`formatVolume`)** | ❌ **was dropped → ported here** | `RowExpansion.tsx` format strip + market-avg label, `InventoryCommandPage.tsx` count-sheet column |
| `ManualOverrideModal` | ⛔ deliberately not ported | see below |
| "Reset All Stock" | ⛔ deliberately not ported | mutated React state and persisted nothing — [ADR 0020](../decisions/0020-no-fabricated-answers.md) |

**The one real gap, now closed.** `/inventory-legacy` read `measurementUnit` from
`restaurantSettingsStore` and ran every volume through `formatVolume`
(`Inventory.tsx:543,549,1259,1444`). `/inventory` hardcoded `ml` in three places, so
retiring the legacy page pinned an oz restaurant back to ml on its main inventory
surface — while Settings still said "Display unit is currently oz" and Reports,
Settings and `AddWineToInventoryModal` all honoured it. Restored on this branch.

**`ManualOverrideModal`, deliberately not ported.** It did persist stock via a real
endpoint (`PATCH /inventory/:restaurantId/item/:itemId`, `UpdateInventoryItemDto`
accepts `stockLive` and `shadowStock`) — but it dropped reason, category, notes and
actor into local React state and a client-side event. `/inventory`'s manual adjust
records who/what/why/when through `reconcileItem`, the sanctioned write primitive, so
not porting it is a gain rather than a loss.

**A claim on record that this pass refutes.** Already corrected in
`v3.0-TECH-DEBT.md`, repeated here because it is still quoted in handoffs:

> *"`/inventory-legacy` hosts a modal posting to a nonexistent endpoint."*

The modal meant is `InvoiceScannerModal` (`POST /invoices/:id/add-to-inventory`,
never implemented). It was deleted in `e5402d67` and was **not reachable from
`/inventory-legacy`** when the claim was filed — `v3.0-TECH-DEBT.md:96` says the same.
`ManualOverrideModal` is a different modal and its endpoint exists.

Worth keeping alongside it: `v3.0-TECH-DEBT.md:395` records that this register
described the wrong page three separate times, because the file is named
`Inventory.tsx` while the live page is `InventoryCommandPage.tsx`. **Check the route
before the filename.**

---

## Parity — `/calendar-classic` → `/calendar`

| Legacy capability | On `/calendar`? | Where |
|---|---|---|
| **`useCalendarEventsSubscription`** (live refresh, OD-83(b)) | ✅ ported — **claim confirmed, gap closed** | `CalendarPage.tsx:33,164` |
| Reminders that actually fire (`scheduleReminder`) | ✅ ported | `CalendarPage.tsx:66-77`, `:287`, `:308` via `syncEventReminders` |
| `createNotification` type `calendar_reminder` | ✅ | `lib/reminder-scheduler.ts:193-196` |
| Recurrence expansion | ✅ | `useCalendarPage.ts:88` `expandAllRecurringEvents` |
| Custom event types (create / delete / name check) | ✅ absorbed into `EventModal` | `EventModal.tsx:22,480,503,516` — `NewEventTypeModal` no longer needed |
| Event CRUD + status | ✅ | `CalendarPage.tsx:253-320` |
| `providerId` / provider on an event | ✅ | `CalendarPage.tsx:279`, `:301` |
| Entity tags via `EntityAutocomplete` | ⛔ superseded | legacy encoded them as `[related_entity:…]` text jammed into the event **description**, not a relation. `/calendar` has typed `labels` plus the meeting-memo prompt |
| Self-addressed "New Calendar Event" / "Event Confirmed" toasts | ⛔ deliberately not ported | both used `userId: user.userId` — the app notifying you about your own click |

`OD-83(b)` is therefore **confirmed as a real gap and confirmed as closed**, with a
regression test already in the tree (`CalendarPage.realtime.test.tsx`).

---

## Inbound-link sweep

`grep` for `inventory-legacy`, `calendar-classic`, `wine-agent`, `wineagent` across
`apps/`, `packages/`, `e2e/`, `scripts/` on 2026-08-26: **zero live references**
outside comments explaining the retirement. Specifically clear — sidebar
(`Sidebar.tsx:163` is a comment), command palette, guidance (`LearnPanel`,
`WineAgentFab`, `Help`), onboarding (`GetStarted`, `StaffWelcome`), E2E specs, and
`FUNCTIONALITY-REGISTRY.md`. The surviving `wine_agent_*` identifiers are analytics
event names and guidance state keys, not routes.

`apps/mobile/app/wine-agent.tsx` is a **mobile** Expo route, not one of the four web
pages, and it deep-links to `/sommelier`. Out of scope for ADR 0019 §B.

---

## Still outstanding

**OD-80's dead code is still in the tree, and this branch deliberately did not remove
it.** The retirement orphaned `apps/web/src/types/companyClass.ts` (743 ln, 25
exports, **zero consumers** once `EntityAutocomplete.tsx` and `Calendar.tsx` went —
re-verified 2026-08-26) and three exports in `data/customEventTypes.ts`
(`isCustomEventType`, `getCustomEventTypeByName`, `EVENT_TYPE_COLORS`). Landing the
cleanup without flipping the two matching `CLAIMS.jsonl` rows to `resolved` makes
`scripts/check_decision_claims.sh` fail the build ("listed as open, but already
true"), and `CLAIMS.jsonl` is owned by another agent this session. Exact edits and
the claim flips are in
[HANDOFF-page-retirement](../04-specs/HANDOFF-page-retirement.md).
