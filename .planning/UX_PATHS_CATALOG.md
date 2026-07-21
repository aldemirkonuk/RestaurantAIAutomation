# WineOps Web App — UX Path Catalog

> **Scope:** `apps/web` (web app only).
> **Purpose:** (1) Inventory every UX path that exists in the product **today**, and (2) enumerate **400+ new UX paths** — interaction-level flows and end-to-end clickstreams that are currently *missing* from each page (double-click actions, right-click menus, keyboard shortcuts, bulk/multi-select, hover previews, faster power-user paths, and multi-step journeys).
> **Part 2 count:** **860** missing paths (`NEW-001`–`NEW-860`), including seating-density Batch 6 (NEW-761–860).
> **Source of truth:** Derived from a full source audit of `apps/web/src` (pages + components) on 2026-07-20; mobile parity + Phase 999.1 backlog included in later Part 2 sections. Findings ground every entry below.

---

## How to read this document

A **UX path** here = a concrete user interaction or journey expressed as **trigger → action(s) → outcome**. This doubles as an end-to-end (E2E) test scenario: read each row as *Given I am on page X, When I <trigger/action>, Then <outcome>*.

**Trigger legend:**

| Tag | Meaning |
|-----|---------|
| `Click` | Single left click / tap |
| `2×Click` | Double-click |
| `R-Click` | Right-click / context menu |
| `Hover` | Pointer hover (peek/preview/tooltip) |
| `Key` | Keyboard shortcut or key nav |
| `Drag` | Drag-and-drop / drag-resize |
| `Multi` | Multi-select + bulk action |
| `Inline` | Inline edit in place |
| `Long` | Long-press / press-and-hold |
| `Flow` | Multi-step journey across screens |
| `Scan` | Camera / file / QR / OCR capture |

**Status tags used in Part 1:** ✅ works · ⚠️ partial / mocked · ❌ dead button (rendered, no handler) · 🚫 not shipped (built but unrouted).

---

# PART 1 — Current UX Paths (what exists today)

This is the inventory of paths that are wired and reachable right now, grouped by page. Items flagged ⚠️/❌/🚫 exist in code but are broken, mocked, or unrouted.

## 1. Global shell — Sidebar (`components/layout/Sidebar.tsx`)

- ✅ Navigate to any section via nav links: Dashboard `/`, Inventory `/inventory`, Orders `/orders`, Wine Library `/wines`, Providers `/providers`, Promotions `/promotions`, Reports `/reports`, Calendar `/calendar`, Team `/team`, Communications `/communications`, Documents & Reports `/documents-reports`, Notifications `/notifications`, Sommelier AI `/sommelier`, Wine Agent `/wine-agent` (placeholder), Admin `/admin` (owner only), Settings `/settings`, Help `/help` (placeholder).
- ✅ Collapse / expand the rail (chevron); collapsed state shows hover tooltips.
- ✅ Open the "Get started" onboarding checklist popover (rocket icon) with completion counter; dismiss it ("Don't show again").
- ✅ Log out (bottom button).
- ❌ User profile card at the bottom looks clickable but has no handler.

## 2. Global shell — Header (`components/layout/Header.tsx`)

- ✅ Branch/location switcher (only when >1 restaurant): open dropdown, switch active branch (re-issues JWT), "Add location" / "Manage Locations" → `/settings`.
- ⚠️ Global search: opens a modal, but the input is not wired and the 4 "Quick Actions" buttons have no handlers.
- ⚠️ `⌘K` / `ESC` hints are decorative — no keyboard listener exists in the shell.
- ✅ Theme toggle (light/dark).
- ✅ Notifications bell: unread badge, open dropdown, mark-all-read, click a notification → mark read + go to `/notifications`, "View all".
- ⚠️ User menu: opens; **Profile / Settings / Help & Support items are dead**; only Log Out works.

## 3. Dashboard (`pages/Dashboard.tsx`, route `/`)

- ✅ Click any of the 4 KPI cards → detail modal (revenue / inventory / orders / low stock).
- ✅ Quick Actions: New Order, Add Wine, Stock Check, Reports (nav links).
- ⚠️ "Add to Calendar" quick action → `alert()` stub.
- ✅ `⌘N` opens Create Quick Action modal; `Esc` closes it. ❌ Created custom actions are never rendered anywhere.
- ✅ Sales calendar: filter by type, search events, prev/next month, "Full Calendar" link, subscribe/copy iCal, click a day with data → Daily Sales Report modal, hover event dots for titles.
- ✅ Today's Schedule / This Week lists (display); "Add Event" → `/calendar?openModal=true`.
- ✅ Important Dates: "Add Date" → `AddImportantDateModal`. ❌ Cannot edit/delete dates from dashboard.
- ✅ Recent Orders "View all"; Low Stock "View all inventory"; Top Performing Wines "Full report". ❌ Low-stock modal "Reorder" buttons are dead; Top Wines is permanently empty.
- ✅ One-Tap Action Center (embedded): expand/collapse rows, approve/reject, batch mode with checkboxes + "Approve Selected", smart suggestions, per-type quick corrections (+6 bottles, +1 case), Gmail composer; `⌘K`/`⌘B`/`⌘A`/`⌘/` shortcuts.

## 4. Inventory — Command page (`pages/inventory/command/InventoryCommandPage.tsx`, route `/inventory`)

- ✅ Toggle Table ↔ Cellar Map view.
- ✅ Export count sheet (CSV), Export valuation (CSV).
- ✅ Open Storage Location manager; Add wine (`AddWineToInventoryModal`).
- ✅ Attention rail: "Match invoice N" → Receiving Workspace; 5 single-select flag chips (Below par, Reconcile, Count due, Dead stock, Price signals).
- ✅ Toolbar: text search; location filter chips (first 4 only, single-select); type chips (single-select); sort dropdown (runway/velocity/value/name).
- ✅ Click a row → inline expansion (reconcile-first detail: live vs shadow, par, market, velocity chart, busy-hours heatmap, order history).
- ✅ Row expansion actions: reconcile shadow→live, "Draft PO" → `/orders`, manual adjust (delta + reason + apply), transfer stock between locations, "View ledger".
- ✅ Cellar Map: select a zone, "Open in table" (applies location filter), "Manage locations".
- ✅ Receiving Workspace: three-way match (ordered/invoiced/received), price override + reason, rejected qty + reason, unlisted extras, notes, dynamic submit.
- ❌ No multi-select, no bulk actions, no column-header sorting, no keyboard nav, no right-click menu, no KPI drill-through. Location filter only exposes first 4 locations.
- Legacy `pages/Inventory.tsx` still exists with checkboxes + a bulk bar whose buttons have **no handlers**, per-row Pour/Active toggle/Edit/Reconcile/Remove, sortable columns; QR generator is a disabled "coming soon".

## 5. Orders (`pages/Orders.tsx`, route `/orders`)

- ✅ View mode: Unified ↔ Split.
- ✅ Search box (⌘K hint is NOT bound).
- ✅ Create Order (`⌘N`) with no-vendor guard modal.
- ✅ Keyboard: `Esc` close, `⌘N` create, `⌘A` select all visible, `⌘⇧A` bulk approve.
- ✅ KPI cards clickable → status filter; "N drafts ready" chip → comms drawer.
- ✅ Multi-select + status-aware bulk bar: Approve / Reject / Mark Ordered / Mark Delivered (actionable, non-recurring, non-terminal orders only).
- ✅ Group by Wine / Provider; expand/collapse groups.
- ✅ Per-order: status badge → comms thread drawer; "AI Draft Ready" pill; Approve (opens comms), Mark Ordered, Mark Delivered.
- ✅ Recurring rows: Pause/Resume, Zap (order now), Delete.
- ✅ Create Order modal, Wine Config modal (unit/qty/presets/price mode/provider multi-select/notes), Order Approval modal (multi-provider pagination), Draft Email Approval panel, Comms Thread drawer, Deal Approval modal.
- ❌ `ActiveConversationsPanel` is rendered but has no trigger (unreachable). Heavy `alert()`/`confirm()` usage. No right-click, no drag.

## 6. Wine Library (`pages/WineLibrary.tsx`, route `/wines`)

- ✅ Triple-click title → secret Dev Mode (manual entry / test photo upload).
- ✅ Search; type filter pills; extended filters (8 selects); Filters toggle with count badge; Grid ↔ List view.
- ✅ Export (hover dropdown): Excel / CSV of the filtered set.
- ✅ Sort row (8 fields, asc/desc; Type cycles orderings). List view: sortable column headers.
- ✅ Row/card click → Wine Detail modal; Add to Inventory; Reorder (rich modal: qty steppers, presets, price mode, provider multi-select + search + select-all, notes, "save for recurring" + frequency); Remove from library (`confirm`).
- ✅ Grid-only favorite star toggle. Pagination (24 grid / 50 list).
- ✅ Add Wine → selection modal → single-label scan (`AddWineModal`, mocked detection) or Menu Scanner.
- ❌ Grid/table bulk multi-select is stubbed but has no UI. Single "Add Wine" and menu-scan batch-add don't persist. Reorder does a full-page reload to `/orders`. Favorite exists in grid but not list.

## 7. Sommelier AI (`pages/SommelierAI.tsx`, route `/sommelier`)

- ✅ New chat; load a past conversation from sidebar; collapse sidebar.
- ✅ 4 suggested-prompt cards fill the input; type + send (Enter to send, Shift+Enter newline); typing indicator.
- ❌ Model selector dropdown is decorative. Per-message Copy / ThumbsUp / ThumbsDown / Regenerate are dead. No rename/delete conversation, no stop-generation, no streaming, no attachments.

## 8. Recommendations (`pages/Recommendations.tsx`, route `/recommendations`)

- ✅ "Recompute" refetches; loading/error/empty states; read-only recommendation cards (urgency, category, observation, action, rationale).
- ❌ Cards are entirely read-only — no act/dismiss/snooze/deep-link, no filter by urgency/category.

## 9. Providers (`pages/Providers.tsx`, route `/providers`)

- ✅ Empty state: Browse Catalogue / Add Custom. Search; business-type chips; favorites toggle; grid/compact/list view; results bar + clear filters.
- ✅ Pinned favorites strip; per-card: favorite heart, call (`tel:`), email (`QuickGmailModal`), edit, website, inline star rating; intel badges.
- ✅ Detail modal: favorite, edit, remove (`confirm`), call/email/website, portfolio/address/contacts/regions, embedded Intelligence panel (Digital Twin / Promotions / Conversations / Sentiment + Actions dropdown for AI outreach).
- ✅ Add Provider modal (custom types persisted to localStorage), Edit Provider modal (inline-edit identity, Details/Contacts/Locations tabs, Places autocomplete, specialties picker).
- ❌ No multi-select/bulk, no column sorting (fixed order), notes are display-only (no create/edit UI), Edit modal "Locations" tab + "View Orders"/"Send Message" buttons don't persist/do anything.

## 10. Promotions (`pages/Promotions.tsx`, route `/promotions`)

- ✅ Tabs (URL-synced): Offers, Trusted senders, Prospects.
- ✅ Offers: read-only promo cards. Trusted senders: trust/untrust toggle per domain. Prospects: location filter chips, view-message expander + attachment downloads, "Add as vendor" (inline confirm), "Dismiss" + undo bar.
- ❌ Offers are non-interactive (no act/redeem/dismiss/source link). No search/sort/pagination on any tab.

## 11. Communications (`pages/Communications.tsx`, route `/communications`)

- ✅ Tabs: Templates, Send History, Scheduled Reports, Procurement Emails.
- ✅ Templates: channel switcher (All/Email/SMS), New Template dropdown → Gmail/SMS builders, saved-template galleries (edit/duplicate/delete/use/favorite/default).
- ✅ Send History: channel stat cards as toggle filters, search, pagination (rows not clickable).
- ✅ Procurement Emails: filters (date/provider/type/wine), expandable thread replay.
- ⚠️ Scheduled Reports (`ReportScheduler`): full config UI but Save/Generate only `console.log`. `QuickGmailModal` CC/BCC reveal nothing.

## 12. Calendar (`pages/Calendar.tsx`, route `/calendar`)

- ✅ Prev/next month, Today, search, filter dropdown (by type), Month ↔ Agenda views, Add Event.
- ✅ Month: click day → select + seed create form; click event pill → details modal. Agenda: click row → details.
- ✅ Sidebar: selected-date events, "+" create, This Month stats, Coming Up (clickable).
- ✅ Event details modal: status `<select>` update, delete. ❌ "Edit" button is a no-op.
- ✅ Create Event modal: title with entity auto-tagging, event-type grid (+ custom types), date/time (masked inputs, validation), location, description, color, reminders (incl. custom), recurrence (freq/DOW/DOM/end-condition).
- ✅ A richer modular calendar (`pages/calendar/*`) with **Week/Day views, drag-move/resize, click-slot-to-create, true event editing, RRULE preview, multi-channel reminders, meeting-memo capture** is now **routed at `/calendar`** (2026-07-20, via `pages/CalendarModular.tsx`; classic page at `/calendar-classic`). See §K.

## 13. Reports (`pages/Reports.tsx`, route `/reports`)

- ✅ Time range 7d/30d/90d; Edit Layout toggle + Arrange Charts; Compare toggle; Export dropdown (CSV/PDF work; Excel/Sheets/Drive "coming soon").
- ✅ Dashboard grid: drag-reorder + resize in edit mode; per-block grip/settings/hide/remove; add-widget modal; reset layout; persisted to localStorage.
- ✅ Widget selector, chart config modal, chart arrangement modal, inline block config.
- ⚠️ AI Command Palette (⌘K within Reports) — mock responses.
- ✅ KPI section (drag reorder, add/edit/delete), KPI spotlight slide-in (Overview/Heatmap/By Wine Type/Export), data tables (sortable + paginated in `DataTableBlock` only), engine insights (recompute, goals), check scanner upload, preview overlay (Esc/Enter/zoom).

## 14. Documents (`pages/DocumentsPage.tsx`, route `/documents-reports`)

- ✅ Tabs: Reports ↔ Communication History.
- ✅ Grid ↔ Folder view; expand/collapse year/month folders; breadcrumbs; search; filter (type/status); sort dropdown.
- ✅ Multi-select batch bar (Select All / Delete Selected); per-card download / delete.
- ❌ Per-card View / Email / Print are placeholders. No true table sorting.

## 15. Notifications (`pages/Notifications.tsx`, route `/notifications`)

- ✅ Filters (status/priority + quick: Urgent Unread, Starred Only), search, Mark All Read, Refresh, Settings.
- ✅ Batch mode: Mark Read / Archive / Delete, Select All / Deselect All.
- ✅ Per item: click → detail modal (marks read), **right-click context menu** (Star, Mark Read, Archive, Delete), star toggle, quick action.
- ✅ Keyboard: `⌘K` filters, `⌘B` batch, `⌘A` select all, `⌘/` help.
- ⚠️ "Mark as unread" is "coming soon"; several actions depend on live endpoints.

## 16. Settings (`pages/Settings.tsx`, route `/settings`)

- ✅ Sticky section nav: Team, Email, Notifications, Locations, Measurement, Features, Calendar.
- ✅ Team: invite, owner role select, remove member, revoke invite. Locations & Chains: new chain, add location, rename/delete chain, edit location. Measurement: unit toggle + default pour (+custom). Features: search + per-flag toggles + unsaved-changes bar. Calendar: copy iCal URL, regenerate token.

## 17. Team (`pages/team/command/*`, route `/team`)

- ✅ Role-scoped tabs; Manager shift desk (assign/edit shifts via editors, select cells); Performance panel (metric cards/filters); My Shifts (personal); Ops Rules panel (rule toggles/editors).

## 18. Admin (`pages/AdminPanel.tsx` `/admin`, `pages/AdminHealth.tsx` `/admin/health`)

- ✅ Admin Panel tabs (General/Agents/Notifications/Integrations); number steppers; toggles; per-agent Restart button.
- ⚠️ Save Settings / Restart / Notifications toggles are simulated/non-persistent; Integrations "Configure" links are dead.
- ✅ Admin Health: auto-poll every 30s, manual Refresh, agent status cards (read-only).

## 19. Studio (`pages/studio/*`, routes `/studio`, `/studio/queue`, `/studio/certify`)

- ✅ Command bar: click to pick PDF, drag-drop PDF, paste URL, type wine name, Enter to ingest, manual empty record.
- ✅ Wine records table: inline `FieldCell` editing with confidence + verification badges, human-override workflow (reason ≥5 chars, citation URL), per-row Promote (idle/loading/promoted/duplicate/error).
- ✅ Approval queue (poll 30s): approve / reject with inline note; Certify (poll 60s): invite contributor, enable/disable toggle. Metrics dashboard (poll 60s, read-only).
- ❌ `ContributorTable` ⋮ menu + revoke are unwired. Tables have no sorting/multi-select.

## 20. Auth & Onboarding

- ✅ **Login:** email/password, demo login, links to register. ❌ "Remember me" unbound; "Forgot password?" → non-existent route; no OAuth buttons; no show/hide password.
- ✅ **Register:** path selector (Join vs Create); Path A invite (live 8-char validation, trust card, account fields, live email availability); Path B create (account → restaurant identity/location/contact with Places autocomplete, phone validation, country-aware labels).
- ✅ **Verify Email:** token verify or resend (60s client rate-limit); redirects to `/get-started` or `/`.
- ✅ **Invite Landing** (`/invite/:code`): preview + accept (branches by auth state).
- ✅ **No Access** (`/no-access`): sign out / back to sign in (orphaned — no guard routes into it).
- ✅ **Get Started:** 3 import methods (scan / CSV / manual) + skip; success screen.
- ✅ **Onboarding:** slim redirect shim to `/get-started`.

---

# PART 2 — New UX Paths (missing — to build)

> Every entry is a path that does **not** exist today. IDs run sequentially `NEW-001 … NEW-860` (**860 total**) so the count is verifiable. Each row is written as a test-ready **trigger → action → outcome**.

## A. Global shell — command palette, search, nav, header (`NEW-001 … NEW-036`)

*Gaps today: no real command palette (`⌘K` is decorative), header search input is dead, user-menu items are dead, no global keyboard system, sidebar profile card is dead.*

> **Shipped 2026-07-20 (command batch):** global command palette
> (`components/command/*`) mounted once in `DashboardLayout`. Covers NEW-001
> (⌘K fuzzy palette over pages/actions/insights), NEW-002 (run without
> navigating), NEW-003 (↑/↓/Enter/Esc, active-descendant a11y), NEW-004 (recents
> pinned, localStorage), NEW-005/007 (header search button opens the palette),
> NEW-008 (`?` shortcut sheet), NEW-009/677/678 (`g`-then-key go-to nav),
> NEW-028/029 (Create commands). Bulletproofing: capture-phase ⌘K (authoritative,
> supersedes ad-hoc page ⌘K on Reports/Notifications/Dashboard), focus trap +
> restore, listbox/option roles, reduced-motion, body-scroll lock, instant local
> fuzzy ranking, and an insight-aware top-recommendation suggestion.
>
> **Shipped 2026-07-20 (shell remainder):** NEW-018 live sidebar badges (pending
> orders / unread notifications / low-stock, via useUnreadCount/
> usePendingOrdersCount/useLowStockItems, 99+ cap), NEW-026 3-way theme menu
> (Light/Dark/System dropdown replacing the binary toggle, click-outside/Esc),
> NEW-030 breadcrumbs (route-derived, parent-aware, collapses on flat routes;
> rendered on nested /recommendations/catalog), NEW-034 recently-viewed switcher
> (⌘⇧O overlay over the last 10 visited routes, tracked in CommandProvider).
> Remaining in §A: sidebar drag-reorder (016), hover flyout submenus (017 —
> deferred: no real sub-routes to fly out to without query-param view wiring),
> sync-status chip (032), quick-settings sheet (033), what's-new (035).

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-001 | `Key` | Press `⌘K` anywhere → global command palette opens with fuzzy search over pages, wines, orders, providers, and actions. |
| NEW-002 | `Key` | In palette, type "add wine" → run the "Add Wine" command without navigating first. |
| NEW-003 | `Key` | In palette, `↑`/`↓` to move, `Enter` to execute, `Esc` to close; last-used commands pinned to top. |
| NEW-004 | `Key` | Palette "recent" section lists last 5 visited pages for one-key return. |
| NEW-005 | `Click` | Header search input actually filters a live result list (wines/orders/providers/reports) with grouped headings. |
| NEW-006 | `Key` | Header search: `Enter` on a result navigates to it; `⌘Enter` opens it in a side peek panel. |
| NEW-007 | `Click` | Header search Quick Actions (View Inventory, Create Order, Low Stock, Generate Report) are wired to real navigation/actions. |
| NEW-008 | `Key` | Global `?` opens a keyboard-shortcut cheat-sheet overlay listing every shortcut per page. |
| NEW-009 | `Key` | Global `g` then `i`/`o`/`w`/`r` (Gmail-style "go to") jumps to Inventory/Orders/Wines/Reports. |
| NEW-010 | `Click` | User-menu "Profile" opens a profile page/drawer (avatar, name, email, password change). |
| NEW-011 | `Click` | User-menu "Settings" navigates to `/settings`. |
| NEW-012 | `Click` | User-menu "Help & Support" opens help center / contact drawer. |
| NEW-013 | `Click` | Sidebar profile card opens the account menu (mirror of header user menu). |
| NEW-014 | `Key` | `[` / `]` collapse / expand the sidebar without reaching for the chevron. |
| NEW-015 | `R-Click` | Right-click a sidebar nav item → "Open in new tab", "Pin to top", "Copy link". |
| NEW-016 | `Drag` | Drag to reorder sidebar nav items; order persists per user. |
| NEW-017 | `Hover` | Hover a sidebar item → flyout submenu of that section's sub-pages (e.g., Inventory → Receiving, Cellar Map, Count sheet). |
| NEW-018 | `Click` | Sidebar nav badges show live counts (pending orders, unread notifications, low-stock alerts, review queue). |
| NEW-019 | `Key` | `⌘\` toggles a "focus mode" that hides the sidebar/header for full-width tables. |
| NEW-020 | `Click` | Header branch switcher gains a search box to filter locations when there are many. |
| NEW-021 | `Key` | `⌘/` then digit switches directly to the Nth branch/location. |
| NEW-022 | `Click` | Branch switcher shows a per-branch health dot (open orders, low stock) inline. |
| NEW-023 | `Click` | Notifications dropdown: filter tabs (All / Mentions / Orders / Inventory) inside the popover. |
| NEW-024 | `Click` | Notifications dropdown: per-item inline "Snooze 1h / Today / Tomorrow". |
| NEW-025 | `Hover` | Hover a notification → quick-action buttons (approve/dismiss) without opening the page. |
| NEW-026 | `Click` | Theme toggle gains a 3-way menu (Light / Dark / System) directly in the header. |
| NEW-027 | `Flow` | First-run product tour: spotlight overlay walks new users through sidebar → dashboard → first action. |
| NEW-028 | `Click` | Global "＋ New" button in header with a menu (Order, Wine, Event, Provider, Report, Template). |
| NEW-029 | `Key` | `⌘N` from any page opens the global "New …" menu (context-aware default). |
| NEW-030 | `Click` | Breadcrumb bar under the header for deep pages (e.g., Inventory ▸ Wine ▸ Ledger) with clickable segments. |
| NEW-031 | `Click` | Persistent "undo" snackbar for destructive actions app-wide (delete/remove/archive) with 8s window. |
| NEW-032 | `Click` | Header shows connection/sync status chip; click → last sync time + manual "Sync now". |
| NEW-033 | `Key` | `⌘.` opens a quick-settings sheet (density, theme, default landing page). |
| NEW-034 | `Click` | Recently-viewed switcher (`⌘⇧O`) — jump back to any of the last 10 records you opened. |
| NEW-035 | `Flow` | "What's new" changelog popover surfaces after each deploy; dismiss persists. |
| NEW-036 | `Click` | Global loading/offline banner offers "Retry" and queues writes made while offline. |

## B. Dashboard (`/`) (`NEW-037 … NEW-063`)

*Gaps today: KPI modals are dead-ends, "Add to Calendar" is an alert stub, custom quick actions vanish, low-stock "Reorder" buttons dead, important dates can't be edited, recent-order rows not clickable, Top Wines permanently empty.*

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-037 | `Click` | KPI "Revenue" card → detail modal has a "View full report" CTA that deep-links to Reports pre-filtered to revenue. |
| NEW-038 | `Click` | KPI "Low Stock" modal "Reorder" buttons actually create a draft PO for that wine. |
| NEW-039 | `Multi` | KPI "Low Stock" modal: multi-select wines → "Reorder all selected" in one draft order. |
| NEW-040 | `2×Click` | Double-click a KPI card → jump straight to the underlying page filtered to that metric (skip the modal). |
| NEW-041 | `Click` | "Add to Calendar" quick action opens the real EventModal in-context (not an alert). |
| NEW-042 | `Flow` | Created custom quick actions render as pinned tiles on the dashboard and persist across sessions. |
| NEW-043 | `Drag` | Drag to reorder quick-action tiles; drag a tile to the trash zone to remove. |
| NEW-044 | `Click` | Recent Orders rows are clickable → open that order's detail/comms drawer. |
| NEW-045 | `Hover` | Hover a Recent Order row → peek popover (wine, provider, status, total) with "Approve"/"View". |
| NEW-046 | `Click` | Low Stock Alerts row → open that wine's inventory expansion inline (or side peek). |
| NEW-047 | `Click` | Important Date card → edit it (title/date/type/color) via the existing modal's edit mode. |
| NEW-048 | `R-Click` | Right-click an important date → Edit / Duplicate / Delete / "Add reminder". |
| NEW-049 | `Click` | "Top Performing Wines" populates from sales data; each row links to the wine and its report. |
| NEW-050 | `Click` | Dashboard "Customize" mode: show/hide and reorder dashboard cards; layout persists per user. |
| NEW-051 | `Drag` | Drag dashboard cards into a new arrangement (grid), like the Reports canvas. |
| NEW-052 | `Click` | Date-range switcher (Today / 7d / 30d / MTD) recomputes all KPIs and the calendar. |
| NEW-053 | `Click` | Each KPI shows a sparkline + delta vs previous period; click sparkline → trend modal. |
| NEW-054 | `Hover` | Hover a calendar day → mini popover listing that day's events without opening the report. |
| NEW-055 | `2×Click` | Double-click a calendar day → open Create Event pre-dated to that day. |
| NEW-056 | `Click` | "Today's Schedule" item → open that event's details; overdue items get a "Reschedule" quick action. |
| NEW-057 | `Multi` | One-Tap Action Center: "Approve all low-stock + confirm all deliveries" as a single mixed batch. |
| NEW-058 | `Key` | `A`/`R` while an action row is focused → approve/reject the focused action. |
| NEW-059 | `Click` | Empty-state CTAs (connect POS, import menu, add vendor) appear contextually when data is missing. |
| NEW-060 | `Flow` | "Morning briefing" one-screen digest: overnight orders, deliveries due, low stock, weather-adjusted demand → act inline. |
| NEW-061 | `Click` | Pin any KPI/insight to a "watchlist" strip that stays at the top. |
| NEW-062 | `Click` | Export dashboard snapshot to PDF/PNG for a manager handoff. |
| NEW-063 | `Key` | `R` refreshes all dashboard data; a subtle "updated Xs ago" stamp shows freshness. |

## C. Inventory (`/inventory`) (`NEW-064 … NEW-134`)

> **Shipped 2026-07-20 (inventory depth batch), on `InventoryCommandPage`:**
> NEW-064 checkbox column + selection · NEW-068 bulk Export selected (+ Copy
> names) via a sticky bulk bar · NEW-072 right-click row context menu
> (Expand/Select/Draft PO/Copy name/Export row) · NEW-078 ↑/↓ row focus + Enter
> expands · NEW-079 Space toggles selection + ⌘A selects all filtered · NEW-080
> `/` focuses search · NEW-087 click-to-sort column headers (Wine/Velocity/
> Runway/Value, asc/desc toggle with arrow indicator) · NEW-088 location filter
> shows all with "+N more" toggle (was first-4-only) · NEW-092 Below-par & Shadow
> KPIs are click-to-filter. Deferred (need backend mutations): inline qty edit
> (074), bulk transfer/par/count-due (065–067), bulk draft-single-PO (069),
> bulk archive (071).

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-064 | `Multi` | Checkbox column on inventory table; select N wines → bulk bar appears. |
| NEW-065 | `Multi` | Bulk: Transfer selected wines to a chosen storage location in one confirm. |
| NEW-066 | `Multi` | Bulk: Set/adjust par levels for selected wines (absolute or % delta). |
| NEW-067 | `Multi` | Bulk: Mark selected as Count Due / Clear Count Due. |
| NEW-068 | `Multi` | Bulk: Export selected rows only (count sheet or valuation CSV). |
| NEW-069 | `Multi` | Bulk: Draft a single PO covering all selected below-par wines. |
| NEW-070 | `Multi` | Bulk: Toggle Pour / Active status for selected wines. |
| NEW-071 | `Multi` | Bulk: Archive / soft-delete selected with undo snackbar. |
| NEW-072 | `R-Click` | Right-click a row → context menu: Expand, Reconcile, Draft PO, Transfer, Adjust, View Ledger, Copy SKU, Favorite. |
| NEW-073 | `R-Click` | Right-click empty table area → Add Wine / Paste from clipboard / Import CSV. |
| NEW-074 | `2×Click` | Double-click a qty cell → inline edit quantity with reason picker; Enter commits, Esc cancels. |
| NEW-075 | `2×Click` | Double-click a wine name → open Wine Detail side peek (not full navigation). |
| NEW-076 | `Inline` | Inline-edit par min/max directly in the expanded row without a modal. |
| NEW-077 | `Inline` | Inline-edit location assignment via dropdown in the row. |
| NEW-078 | `Key` | ↑/↓ move focus across rows; Enter expands/collapses focused row. |
| NEW-079 | `Key` | Space toggles selection of focused row; `⌘A` selects all filtered. |
| NEW-080 | `Key` | `/` focuses the inventory search box from anywhere on the page. |
| NEW-081 | `Key` | `t` toggles Table ↔ Cellar Map; `e` opens export menu. |
| NEW-082 | `Key` | `a` opens Add Wine; `r` opens Receiving Workspace when invoices pending. |
| NEW-083 | `Key` | `⌘F` opens an advanced filter sheet (type, region, vintage, runway band, vendor). |
| NEW-084 | `Hover` | Hover a wine name → peek card (photo, stock, runway days, last sale, next delivery). |
| NEW-085 | `Hover` | Hover runway cell → sparkline of 14-day velocity + projected stock-out date. |
| NEW-086 | `Hover` | Hover location chip → show qty breakdown across all locations. |
| NEW-087 | `Click` | Column headers are sortable (click cycles asc/desc/none) for all numeric/text columns. |
| NEW-088 | `Click` | Location filter shows all locations (not only first 4) with overflow "+N more" popover. |
| NEW-089 | `Click` | Multi-select location chips (OR filter) instead of single-select only. |
| NEW-090 | `Click` | Multi-select type chips; clear-all filter button. |
| NEW-091 | `Click` | Saved filter presets ("Friday service", "BTG only") pin above the toolbar. |
| NEW-092 | `Click` | KPI strip above table (SKUs, $ value, below par, dead stock); click a KPI → applies that filter. |
| NEW-093 | `Click` | "View ledger" opens a full ledger page/drawer with date range, reason filters, export. |
| NEW-094 | `Click` | Velocity chart in expansion: click a point → see that day's POS tickets for the wine. |
| NEW-095 | `Click` | Busy-hours heatmap cell → filter Reports to that hour band for the wine. |
| NEW-096 | `Drag` | Drag a wine row onto a Cellar Map zone → transfer stock to that location. |
| NEW-097 | `Drag` | In Cellar Map, drag bottles between zones to rebalance; confirm sheet summarizes moves. |
| NEW-098 | `Scan` | Scan bottle barcode / QR from inventory → jump to that wine row and expand it. |
| NEW-099 | `Scan` | Count-mode: scan bottles sequentially to build a physical count session vs system qty. |
| NEW-100 | `Flow` | Full count session: start count → scan/enter by zone → variance report → accept/adjust → close period. |
| NEW-101 | `Flow` | Dead-stock workflow: flag → suggest promo/discount → create promotion → track sell-through. |
| NEW-102 | `Flow` | Price-signal workflow: flag → compare market → accept new pour price → push to POS (or export). |
| NEW-103 | `Click` | "Show more locations" expands the filter rail beyond 4 chips. |
| NEW-104 | `Click` | Density toggle (Comfortable / Compact) for the inventory table. |
| NEW-105 | `Click` | Column picker: show/hide columns; order persisted per user. |
| NEW-106 | `Click` | Pin columns (wine name, qty) while scrolling horizontally. |
| NEW-107 | `Click` | QR label generator: select wines → print sheet of bottle/bin QR labels (was "coming soon"). |
| NEW-108 | `Click` | Print count sheet for a single zone from Cellar Map. |
| NEW-109 | `Click` | Receiving: scan invoice PDF/photo → auto-fill three-way match lines. |
| NEW-110 | `Click` | Receiving: "Apply all as invoiced" one-tap when match is clean. |
| NEW-111 | `Key` | Receiving: `Tab` through qty fields; `⌘Enter` submits the receipt. |
| NEW-112 | `Click` | Receiving: dispute line → opens vendor email draft prefilled with discrepancy. |
| NEW-113 | `Hover` | Receiving: hover price delta → show last 5 paid prices for that SKU/vendor. |
| NEW-114 | `Flow` | Split delivery: partial receive now, remainder stays open with expected date. |
| NEW-115 | `Click` | Shadow vs live badge click → explain discrepancy sources and one-tap reconcile. |
| NEW-116 | `Click` | "Compare to last count" overlay on any wine. |
| NEW-117 | `Click` | Share inventory snapshot link (read-only, expiring) with an external consultant. |
| NEW-118 | `Click` | Watchlist: star wines; filter toolbar "Watching only". |
| NEW-119 | `R-Click` | Cellar Map zone → Rename / Set capacity / Assign default type / Open in table. |
| NEW-120 | `2×Click` | Double-click a Cellar Map zone → enter zone detail with bin-level list. |
| NEW-121 | `Click` | Undo last adjust/transfer from a floating history chip. |
| NEW-122 | `Flow` | Import inventory CSV with column mapping wizard + dry-run preview. |
| NEW-123 | `Click` | "Why is this below par?" explainer sheet (sales spike, missed delivery, par too high). |
| NEW-124 | `Click` | Substitute suggestion when stock-out: pick alternate vintage/wine and update pairing notes. |
| NEW-125 | `Key` | `⌘Z` undoes the last inventory mutation in-session. |
| NEW-126 | `Click` | Mobile-handoff: generate a deep link to continue receiving on the phone app. |
| NEW-127 | `Click` | Filter by provider that supplies the wine. |
| NEW-128 | `Click` | Show only wines with open POs; badge links to those orders. |
| NEW-129 | `Hover` | Hover "Draft PO" → preview suggested qty/vendor/price before navigating. |
| NEW-130 | `Click` | Legacy Inventory page bulk bar buttons (Pour/Active/Edit/Reconcile/Remove) become fully wired. |
| NEW-131 | `Flow` | End-of-night close: variance check → waste log → next-day par preview in one wizard. |
| NEW-132 | `Click` | Tag wines with custom labels ("VIP", "Event") and filter by tag. |
| NEW-133 | `Multi` | Bulk retag selected wines. |
| NEW-134 | `Click` | Inventory search supports vintage, producer, SKU, and barcode — not just name. |

## D. Orders (`/orders`) (`NEW-135 … NEW-199`)

> **Note:** Orders already shipped much of the §C-equivalent depth in Part 1
> (multi-select + status-aware bulk bar, ⌘N/⌘A/⌘⇧A keyboard, KPI→status filter,
> group-by). **Shipped 2026-07-20 (Orders batch):** NEW-159 export the filtered/
> sorted order set to CSV (toolbar Export button) · NEW-143 `/` focuses the
> orders search (and the stale "⌘K" search hint is corrected, since ⌘K is now the
> global palette). Also cleaned the pre-existing `no-fallthrough` lint in the
> status-mapping switch (intentional fallthrough — added the conventional marker,
> no behavior change).
>
> **Shipped 2026-07-20 (Orders depth pass):** NEW-135 right-click context menu on
> both the unified and split row renders (status-appropriate Approve/Reject/Mark
> Ordered/Mark Delivered reusing the exact existing handlers, plus Open thread +
> Copy order ID) · NEW-136 double-click a row opens its comms thread · NEW-148
> "Live threads" toolbar toggle (with count) makes the already-built
> `ActiveConversationsPanel` reachable. Still deferred: Kanban view (140 — needs a
> new drag-drop render), inline delivery-date/notes edit (145/146 — needs update
> mutations), j/k row nav (144 — fiddly across two grouped renders).

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-135 | `R-Click` | Right-click an order → Approve / Reject / Mark Ordered / Mark Delivered / Open thread / Duplicate / Copy ID. |
| NEW-136 | `2×Click` | Double-click an order row → open full order detail (not only status badge). |
| NEW-137 | `Hover` | Hover an order → peek (lines, totals, last message snippet, ETA). |
| NEW-138 | `Hover` | Hover provider name → provider card with call/email shortcuts. |
| NEW-139 | `Drag` | Drag an order onto a status column in a Kanban board view (new view mode). |
| NEW-140 | `Click` | Kanban view mode alongside Unified / Split. |
| NEW-141 | `Click` | Calendar-of-deliveries view: orders plotted by expected delivery date. |
| NEW-142 | `Click` | Search `⌘K` hint is actually bound to focus the orders search. |
| NEW-143 | `Key` | `/` focuses search; `n` creates order; `g` then letter jumps group headers. |
| NEW-144 | `Key` | `j`/`k` move selection; `o` opens focused order; `a`/`x` approve/reject. |
| NEW-145 | `Inline` | Inline-edit expected delivery date on the row. |
| NEW-146 | `Inline` | Inline-edit order notes without opening a modal. |
| NEW-147 | `Click` | Replace `alert()`/`confirm()` with proper modals + undo for reject/delete. |
| NEW-148 | `Click` | ActiveConversationsPanel becomes reachable via a "Live threads" toggle/chip. |
| NEW-149 | `Click` | Conversation chip shows unread count; click filters to orders with open threads. |
| NEW-150 | `Flow` | Create Order → configure wines → multi-vendor split → approve drafts → send → track replies without leaving a guided rail. |
| NEW-151 | `Flow` | One-click re-order last PO for a provider (clone with today's date). |
| NEW-152 | `Flow` | "Smart restock": system proposes a cart from below-par + velocity; user edits then submits. |
| NEW-153 | `Multi` | Bulk "Request ETA update" emails selected open orders. |
| NEW-154 | `Multi` | Bulk attach the same note to selected drafts. |
| NEW-155 | `Multi` | Bulk assign owner/buyer on selected orders. |
| NEW-156 | `Click` | Filter chips: Mine / Unassigned / Overdue / Awaiting reply / Delivering today. |
| NEW-157 | `Click` | Saved order views ("Monday receiving", "BTG restock") as named filters. |
| NEW-158 | `Click` | Column picker + persisted sort for the orders table. |
| NEW-159 | `Click` | Export filtered orders to CSV/PDF. |
| NEW-160 | `Click` | Print pick list / receiving sheet for selected orders. |
| NEW-161 | `Click` | Deal Approval modal: side-by-side compare last paid vs offered price with accept/counter. |
| NEW-162 | `Click` | From Draft Email panel: edit subject/body inline, insert merge fields, send or schedule. |
| NEW-163 | `Click` | Schedule send for a draft email (pick time) instead of immediate send. |
| NEW-164 | `Click` | Comms thread: @mention a teammate; they get a notification. |
| NEW-165 | `Click` | Comms thread: attach invoice/PDF from documents. |
| NEW-166 | `Click` | Comms thread: convert an email quote into line items on the order. |
| NEW-167 | `Click` | Recurring: edit cadence/qty inline; preview next 4 occurrence dates. |
| NEW-168 | `Click` | Recurring: "Skip next" without pausing the series. |
| NEW-169 | `Click` | Recurring: convert one occurrence to a one-off editable order. |
| NEW-170 | `R-Click` | Recurring row → Pause / Resume / Order now / Edit series / Delete series. |
| NEW-171 | `Click` | Provider performance badge on order (on-time %, avg lead time). |
| NEW-172 | `Click` | Risk flag when ordering above credit limit or unusual price spike — confirm to proceed. |
| NEW-173 | `Hover` | Hover status badge → timeline of status changes with actors. |
| NEW-174 | `Click` | Link order ↔ calendar delivery event; click opens either side. |
| NEW-175 | `Flow` | Partial delivery: mark some lines delivered, keep remainder open automatically. |
| NEW-176 | `Flow` | Return/credit workflow from a delivered order (qty + reason → vendor email). |
| NEW-177 | `Click` | Split view: resize panes; remember widths; collapse either side. |
| NEW-178 | `Click` | Group by Wine/Provider gains Group by Status / Delivery date. |
| NEW-179 | `Key` | `⌘⇧D` marks focused order delivered; `⌘⇧O` marks ordered. |
| NEW-180 | `Click` | Empty state: guided "Add a provider first" with deep link (no dead ends). |
| NEW-181 | `Click` | Order detail shows landed cost vs menu contribution margin for the wine. |
| NEW-182 | `Scan` | Scan packing slip → match to open order and jump into receiving. |
| NEW-183 | `Click` | Pin important orders to top. |
| NEW-184 | `Click` | Watch an order for status changes; get push when it moves. |
| NEW-185 | `Flow` | RFQ path: select wines → request quotes from N providers → compare grid → convert winner to PO. |
| NEW-186 | `Click` | Compare mode: select 2–3 provider quotes side-by-side. |
| NEW-187 | `Click` | Template orders: save a cart as a named template; instantiate later. |
| NEW-188 | `Multi` | Bulk pause/resume recurring orders. |
| NEW-189 | `Click` | Snooze an order reminder to a chosen time. |
| NEW-190 | `Click` | "What's blocking approval?" checklist when Approve is disabled. |
| NEW-191 | `Hover` | Hover AI Draft Ready pill → preview first lines of the draft email. |
| NEW-192 | `2×Click` | Double-click AI Draft Ready → open Draft Email Approval immediately. |
| NEW-193 | `Click` | Undo accidental Mark Delivered within 30s. |
| NEW-194 | `Flow` | Cross-page: from inventory Draft PO → land on Orders with that draft pre-selected and approval open. |
| NEW-195 | `Click` | Filter orders by wine currently open in a side peek from Wine Library. |
| NEW-196 | `Click` | Show estimated arrival window from carrier/vendor if available. |
| NEW-197 | `Key` | `Esc` closes drawers/modals in a stack-aware order (deepest first). |
| NEW-198 | `Click` | Duplicate order as draft with editable lines. |
| NEW-199 | `Click` | Cancel order with reason codes; notify vendor optionally. |

## E. Wine Library (`/wines`) (`NEW-200 … NEW-253`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-200 | `Multi` | Enable multi-select on grid and list; bulk bar: Add to Inventory, Reorder, Export, Remove, Tag. |
| NEW-201 | `Multi` | Bulk favorite / unfavorite selected wines. |
| NEW-202 | `Multi` | Bulk set tasting notes template or food-pairing tags. |
| NEW-203 | `R-Click` | Right-click card/row → Open, Add to Inventory, Reorder, Favorite, Copy name, Remove. |
| NEW-204 | `2×Click` | Double-click card → open detail; double-click Add shortcut from grid. |
| NEW-205 | `Hover` | Hover card → quick actions overlay (Favorite, Add, Reorder) without opening modal. |
| NEW-206 | `Hover` | Hover critic score → source + tasting note excerpt. |
| NEW-207 | `Inline` | Inline-edit bin/price fields from list view. |
| NEW-208 | `Key` | `/` search; `g`/`l` toggle grid/list; `f` toggle filters; `⌘A` select all filtered. |
| NEW-209 | `Key` | Arrow keys move focus across grid; Enter opens; `f` favorites focused. |
| NEW-210 | `Click` | Favorite star available in list view (parity with grid). |
| NEW-211 | `Click` | Add Wine single-label scan persists detected wine to library (not mocked). |
| NEW-212 | `Click` | Menu Scanner batch-add persists all confirmed items to library + optional inventory. |
| NEW-213 | `Flow` | Scan menu photo → review extractions → correct fields → commit to library + master submissions. |
| NEW-214 | `Flow` | Reorder modal submits via API without full-page reload to `/orders`. |
| NEW-215 | `Click` | After reorder, toast with "View order" deep link instead of reload. |
| NEW-216 | `Click` | Compare up to 4 wines in a side-by-side sheet (price, scores, stock, velocity). |
| NEW-217 | `Click` | "Similar wines" rail on detail modal from ontology/embeddings. |
| NEW-218 | `Click` | Tasting note editor with markdown + private vs shared notes. |
| NEW-219 | `Click` | Attach photos (label, shelf) to a wine record. |
| NEW-220 | `Scan` | Rescan label to refresh metadata fields selectively. |
| NEW-221 | `Click` | Conflict resolution UI when scan disagrees with existing record. |
| NEW-222 | `Click` | Filter by in-inventory / not-in-inventory / below-par. |
| NEW-223 | `Click` | Filter by last ordered date / never ordered. |
| NEW-224 | `Click` | Saved smart collections ("BTG candidates", "High score under $60"). |
| NEW-225 | `Drag` | Drag wines into a collection/folder in a sidebar. |
| NEW-226 | `Click` | Share a wine card (read-only link or PDF sell sheet). |
| NEW-227 | `Click` | Generate QR to the wine's public tasting card. |
| NEW-228 | `Click` | Price history chart on detail; click point → related invoices. |
| NEW-229 | `Click` | Vendor availability matrix: which providers stock this wine + last quote. |
| NEW-230 | `Click` | "Propose for menu" creates a draft promo or menu change request. |
| NEW-231 | `Click` | Mark wine as 86'd with reason; auto-notify floor via notifications. |
| NEW-232 | `Click` | Vintage change assistant: map old vintage → new, carry par and pairings. |
| NEW-233 | `Click` | Deduplicate library: merge tool for near-duplicate records. |
| NEW-234 | `Key` | `⌘E` exports current filtered set; format picker remembers last choice. |
| NEW-235 | `Click` | Column customization in list view. |
| NEW-236 | `Click` | Infinite scroll option alongside pagination. |
| NEW-237 | `Click` | Dev Mode entry also available via Settings → Developer (not only triple-click). |
| NEW-238 | `Click` | Undo remove-from-library within snackbar window. |
| NEW-239 | `Hover` | Hover inventory badge on card → stock by location. |
| NEW-240 | `Click` | Deep link from card badge straight to inventory expansion for that wine. |
| NEW-241 | `Flow` | Research queue: send wine to Studio enrichment; track status back on the card. |
| NEW-242 | `Click` | Show enrichment confidence badges on cards; click → field-level breakdown. |
| NEW-243 | `Click` | Sort by "relevance" when a search query is active (not only static fields). |
| NEW-244 | `Click` | Empty filter state explains which filter emptied the set + one-click clear. |
| NEW-245 | `R-Click` | Empty canvas → Import menu / Add manually / Browse catalogue. |
| NEW-246 | `Click` | Keyboard-accessible filter selects (no mouse-only traps). |
| NEW-247 | `Click` | "By the glass" toggle filter + BTG margin calculator on detail. |
| NEW-248 | `Flow` | Pairing workshop: pick a dish → AI suggests wines from library with in-stock boost. |
| NEW-249 | `Click` | Hide wines archived from active menu without deleting. |
| NEW-250 | `Multi` | Bulk archive / restore. |
| NEW-251 | `Click` | Print shelf talkers for selected wines. |
| NEW-252 | `Click` | Export to POS item mapping worksheet. |
| NEW-253 | `Click` | Flag bad data → sends to Studio review queue with note. |

## F. Sommelier AI (`/sommelier`) (`NEW-254 … NEW-283`)

> **Shipped 2026-07-20 (Sommelier batch):** NEW-254 model/persona selector
> (Sommelier/Buyer/Floor-training dropdown, persisted to localStorage + sent as
> `persona` in the chat request) · NEW-255 per-message Copy → clipboard + toast ·
> NEW-256 ThumbsUp/Down feedback (session-local visual state) · NEW-257
> Regenerate (truncates to the preceding user turn and re-runs) · NEW-260 rename
> conversation (inline, via useUpsertSommelierConversation) · NEW-261 delete
> conversation (confirm + useDeleteSommelierConversation + toast) · NEW-263
> search conversations. Deferred: streaming/stop (258/259 — backend is a single
> POST, no token stream), pin/star (262 — no pinned field on the conversation
> schema), ⌘N/⌘[ ]/⌘⇧S shortcuts (271 — OS/browser conflicts), attachments/voice.

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-254 | `Click` | Model selector actually switches model/provider and persists preference. |
| NEW-255 | `Click` | Per-message Copy copies markdown/plain text to clipboard with toast. |
| NEW-256 | `Click` | ThumbsUp / ThumbsDown records feedback and optionally prompts for reason. |
| NEW-257 | `Click` | Regenerate re-runs the last assistant turn; previous version kept in a history stack. |
| NEW-258 | `Click` | Stop generation button appears while streaming. |
| NEW-259 | `Click` | Streaming tokens render incrementally (not wait-for-full-response). |
| NEW-260 | `Click` | Rename conversation from sidebar ⋮ menu. |
| NEW-261 | `Click` | Delete conversation with confirm + undo. |
| NEW-262 | `Click` | Pin / star important conversations. |
| NEW-263 | `Click` | Search past conversations by title or message content. |
| NEW-264 | `Click` | Export conversation to PDF/Markdown. |
| NEW-265 | `Click` | Attach inventory/context chips ("use only in-stock wines") to a prompt. |
| NEW-266 | `Click` | Attach a photo of a dish/label for multimodal advice. |
| NEW-267 | `Click` | Suggested prompts refresh based on today's 86 list and events. |
| NEW-268 | `Click` | Inline citations link to wine records / reports when the model references them. |
| NEW-269 | `Click` | "Add suggested wine to order" CTA under relevant replies. |
| NEW-270 | `Click` | "Create pairing card" from a reply → Documents. |
| NEW-271 | `Key` | `⌘N` new chat; `⌘⇧S` star; `⌘[` / `⌘]` prev/next chat. |
| NEW-272 | `Hover` | Hover a cited wine → peek card with stock. |
| NEW-273 | `Flow` | Sommelier → draft guest-facing tasting note → send to Documents/Print. |
| NEW-274 | `Click` | Branch conversation (fork from a message). |
| NEW-275 | `Click` | System prompt / persona presets (floor training, buyer, guest-facing). |
| NEW-276 | `Click` | Share read-only link to a conversation with staff. |
| NEW-277 | `Click` | Rate whole conversation; feeds model eval set. |
| NEW-278 | `Click` | Clear context / start over without deleting history. |
| NEW-279 | `Click` | Insert wine from library into the prompt via `@wine` mention autocomplete. |
| NEW-280 | `Click` | Insert provider via `@provider` mention. |
| NEW-281 | `Click` | Voice input button for hands-busy floor use. |
| NEW-282 | `Click` | Offline fallback message with retry when AI backend is down. |
| NEW-283 | `Click` | Token/cost meter for admins on each reply (dev/admin only). |

## G. Recommendations (`/recommendations`) (`NEW-284 … NEW-308`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-284 | `Click` | Act CTA on a recommendation → navigates to the relevant page with context prefilled. |
| NEW-285 | `Click` | Dismiss recommendation with reason codes. |
| NEW-286 | `Click` | Snooze recommendation (1d / 1w / until date). |
| NEW-287 | `Click` | Mark as Done when the underlying action is completed (auto or manual). |
| NEW-288 | `Click` | Filter by urgency / category / status. |
| NEW-289 | `Click` | Sort by impact $, urgency, recency. |
| NEW-290 | `Click` | Search recommendations text. |
| NEW-291 | `Hover` | Hover card → show supporting metrics chart peek. |
| NEW-292 | `Click` | Expand card for full rationale, data lineage, and confidence. |
| NEW-293 | `Multi` | Bulk dismiss / snooze selected recommendations. |
| NEW-294 | `Key` | `j`/`k` move; `a` act; `d` dismiss; `s` snooze. |
| NEW-295 | `Click` | Pin high-value recommendations to dashboard watchlist. |
| NEW-296 | `Click` | Share recommendation with a teammate (@assign). |
| NEW-297 | `Click` | "Why am I seeing this?" explainer for each card. |
| NEW-298 | `Click` | Feedback: helpful / not helpful → tunes future ranking. |
| NEW-299 | `Flow` | Recommendation "Reorder X" → creates draft PO → opens Orders approval. |
| NEW-300 | `Flow` | Recommendation "Run promo on Y" → opens Promotions compose with wine prefills. |
| NEW-301 | `Flow` | Recommendation "Recount zone Z" → opens Inventory count session for that zone. |
| NEW-302 | `Click` | History tab of past acted/dismissed recommendations. |
| NEW-303 | `Click` | Digest email toggle: daily top recommendations to manager inbox. |
| NEW-304 | `Click` | Impact tracker: after acting, show measured lift 7/30 days later. |
| NEW-305 | `R-Click` | Right-click card → Act / Snooze / Dismiss / Copy link / Assign. |
| NEW-306 | `2×Click` | Double-click card → Act primary action immediately. |
| NEW-307 | `Click` | Category tabs (Inventory, Pricing, Labor, Vendors, Menu). |
| NEW-308 | `Click` | Empty state when all clear celebrates + suggests enabling more insight types. |

## H. Providers (`/providers`) (`NEW-309 … NEW-338`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-309 | `Multi` | Multi-select providers → bulk favorite, export, tag, trust/untrust. |
| NEW-310 | `R-Click` | Right-click card → Call, Email, Edit, Favorite, View Orders, Open website, Remove. |
| NEW-311 | `2×Click` | Double-click card → open detail modal. |
| NEW-312 | `Hover` | Hover card → last order date, open PO count, on-time %. |
| NEW-313 | `Click` | Column sorting in list view (name, rating, last order, spend). |
| NEW-314 | `Click` | Notes: create/edit/delete provider notes with timestamps and author. |
| NEW-315 | `Click` | Locations tab in Edit modal persists addresses correctly. |
| NEW-316 | `Click` | "View Orders" filters Orders page to that provider. |
| NEW-317 | `Click` | "Send Message" opens QuickGmail/SMS with provider contact prefills. |
| NEW-318 | `Click` | Merge duplicate providers wizard. |
| NEW-319 | `Click` | Archive provider without deleting history. |
| NEW-320 | `Click` | Credit terms / payment terms fields + reminders. |
| NEW-321 | `Click` | Preferred items list: pin SKUs you usually buy from them. |
| NEW-322 | `Click` | Price list import (CSV/PDF) attached to provider. |
| NEW-323 | `Click` | Compare spend across providers chart from detail. |
| NEW-324 | `Click` | SLA tracker: lead time commitments vs actual. |
| NEW-325 | `Click` | Contact roles (sales, accounts, logistics) with primary flags. |
| NEW-326 | `Key` | `/` search; `n` add; `f` favorites-only. |
| NEW-327 | `Drag` | Drag to reorder pinned favorites strip. |
| NEW-328 | `Click` | Map view of provider locations near the restaurant. |
| NEW-329 | `Click` | "Request updated catalog" templated email. |
| NEW-330 | `Flow` | Add from catalogue → enrich → set payment terms → place first test order. |
| NEW-331 | `Click` | Intelligence Actions dropdown items all execute real outreach workflows. |
| NEW-332 | `Click` | Sentiment timeline click → underlying conversation. |
| NEW-333 | `Click` | Promotions tab inside provider filters Promotions to that sender/domain. |
| NEW-334 | `Click` | Export provider directory vCard / CSV. |
| NEW-335 | `Inline` | Inline-edit rating and tags from the grid. |
| NEW-336 | `Click` | Filter by region, specialty, rating band, has-open-orders. |
| NEW-337 | `Click` | Saved provider segments. |
| NEW-338 | `Click` | Warn before remove if open orders exist; offer reassign. |

## I. Promotions (`/promotions`) (`NEW-339 … NEW-358`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-339 | `Click` | Offer cards become actionable: Redeem / Apply to order / Dismiss / Snooze. |
| NEW-340 | `Click` | Click offer → detail sheet with terms, SKUs, expiry, source email. |
| NEW-341 | `Click` | Deep link from offer to source message in Communications/Promotions Prospects. |
| NEW-342 | `Click` | Search/sort/pagination on Offers, Trusted senders, Prospects. |
| NEW-343 | `Click` | Create manual promotion (not only inbound email-derived). |
| NEW-344 | `Click` | Attach promotion to specific wines in library/inventory. |
| NEW-345 | `Click` | Calendar overlay: promotions plotted by active window. |
| NEW-346 | `Multi` | Bulk dismiss / bulk add-as-vendor from Prospects. |
| NEW-347 | `Hover` | Hover offer → savings estimate vs last paid price. |
| NEW-348 | `Click` | "Apply best promo" when creating an order for matching SKUs. |
| NEW-349 | `Flow` | Prospect → Add as vendor → first order using that promo code. |
| NEW-350 | `Click` | Trusted senders: add domain manually; notes field; audit log. |
| NEW-351 | `R-Click` | Right-click offer → Apply / Share with team / Copy code / Dismiss. |
| NEW-352 | `Key` | Tab-switcher shortcuts `1`/`2`/`3` for Offers/Trusted/Prospects. |
| NEW-353 | `Click` | Filter offers by expiring soon / stackable / wine type. |
| NEW-354 | `Click` | Promo performance: redemptions and margin impact after use. |
| NEW-355 | `Click` | Share promo internally with @mention. |
| NEW-356 | `Click` | Duplicate a past promo as a new draft. |
| NEW-357 | `Click` | Archive expired offers automatically with restore. |
| NEW-358 | `Click` | CSV export of active promotions. |

## J. Communications (`/communications`) (`NEW-359 … NEW-383`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-359 | `Click` | Scheduled Reports Save persists to backend (not console.log). |
| NEW-360 | `Click` | Scheduled Reports Generate actually runs and files into Documents. |
| NEW-361 | `Click` | QuickGmailModal CC/BCC fields reveal and send correctly. |
| NEW-362 | `Click` | Send History rows are clickable → full message replay. |
| NEW-363 | `Click` | Resend / Forward from Send History. |
| NEW-364 | `Click` | Filter Send History by date range picker. |
| NEW-365 | `Click` | Template test-send to yourself before using. |
| NEW-366 | `Click` | Template version history + rollback. |
| NEW-367 | `Click` | Template variables preview with sample data. |
| NEW-368 | `Click` | SMS delivery receipts status on history rows. |
| NEW-369 | `Click` | Schedule a one-off email (not only recurring reports). |
| NEW-370 | `Click` | Shared team inbox view of procurement threads. |
| NEW-371 | `Click` | Assign thread owner; snooze thread. |
| NEW-372 | `Click` | Slash-commands in composer (/order, /wine, /promo). |
| NEW-373 | `Hover` | Hover template card → preview rendered sample. |
| NEW-374 | `R-Click` | Template → Use / Edit / Duplicate / Set default / Delete. |
| NEW-375 | `Key` | `n` new template; `/` search templates. |
| NEW-376 | `Click` | Drag-reorder favorite templates. |
| NEW-377 | `Flow` | From Orders thread → "Save as template" captures the email. |
| NEW-378 | `Click` | Procurement Emails: jump to related order/provider from a thread. |
| NEW-379 | `Click` | Translate thread toggle for multilingual vendors. |
| NEW-380 | `Click` | Attachment preview lightbox (PDF/images) without download. |
| NEW-381 | `Click` | Bulk delete/archive old send history with retention policy UI. |
| NEW-382 | `Click` | Notification when a scheduled report fails; retry button. |
| NEW-383 | `Click` | Channel health: Gmail/SMS connection status with reconnect CTA. |

## K. Calendar (`/calendar`) (`NEW-384 … NEW-418`)

> **Shipped 2026-07-20 (calendar batch):** the fully-built modular calendar
> (`pages/calendar/*`) is now **routed** at `/calendar` via
> `pages/CalendarModular.tsx` (classic page preserved at `/calendar-classic`).
> Ships NEW-384 (Week), NEW-385 (Day), NEW-386 (drag-move), NEW-387 (drag-resize),
> NEW-388 (click empty slot → create), NEW-389 (Edit opens edit mode), NEW-390
> (true update of all fields), NEW-391 (recurrence), NEW-392 (reminders), NEW-393
> (meeting-memo capture), NEW-400 (color legend filter), plus search + Month/Agenda.
> Added NEW-399 keyboard shortcuts (`t` today · `m/w/d/a` views · `n` new · ←/→
> prev/next), documented in the `?` sheet and yielding to the global ⌘K / g-nav.
> Remaining §K refinements: right-click menu (397), hover peek (396), deliveries/
> promo overlays (409/410), conflict detection (403), undo delete (413).

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-384 | `Click` | Route and ship Week view from `pages/calendar/*` modular calendar. |
| NEW-385 | `Click` | Route and ship Day view with hourly grid. |
| NEW-386 | `Drag` | Drag-move events across days/hours; persist new time. |
| NEW-387 | `Drag` | Drag-resize event duration on Week/Day. |
| NEW-388 | `Click` | Click empty slot → create event prefilled with that start time. |
| NEW-389 | `Click` | Edit button on event details actually opens edit mode (currently no-op). |
| NEW-390 | `Click` | True update of all event fields (not only status) from details modal. |
| NEW-391 | `Click` | RRULE preview list of next occurrences before save. |
| NEW-392 | `Click` | Multi-channel reminders (email/SMS/push) wired end-to-end. |
| NEW-393 | `Click` | Meeting-memo capture attached to an event. |
| NEW-394 | `Click` | Invite teammates to an event; RSVP statuses. |
| NEW-395 | `Click` | Link event to orders / wines / promotions entities (beyond auto-tag text). |
| NEW-396 | `Hover` | Hover event pill → peek with time, location, linked entities. |
| NEW-397 | `R-Click` | Right-click event → Open / Edit / Duplicate / Delete / Copy link. |
| NEW-398 | `2×Click` | Double-click event → edit; double-click day → create. |
| NEW-399 | `Key` | `t` today; `w`/`m`/`a` week/month/agenda; `n` new event; `⌘⌫` delete. |
| NEW-400 | `Click` | Color-blind safe palette picker; legend filter by color/type. |
| NEW-401 | `Click` | Working-hours shading; hide off-hours in Day view. |
| NEW-402 | `Click` | Timezone display + convert for multi-city groups. |
| NEW-403 | `Click` | Conflict detection when two prep events overlap. |
| NEW-404 | `Click` | "Prep for event" checklist auto-generated from linked wines. |
| NEW-405 | `Flow` | T-7/T-2/T-1 event prep emails deep-link back to the event with checklist. |
| NEW-406 | `Click` | Drag external .ics file onto calendar to import. |
| NEW-407 | `Click` | Export selected events to .ics. |
| NEW-408 | `Click` | Subscribe management UI (multiple feeds, rotate tokens). |
| NEW-409 | `Click` | Show deliveries from Orders on the calendar as read-only blocks. |
| NEW-410 | `Click` | Show promotions active windows as background bands. |
| NEW-411 | `Click` | Resource calendars (private dining room, tasting bar) as lanes. |
| NEW-412 | `Multi` | Multi-select events → bulk shift by N days / bulk delete. |
| NEW-413 | `Click` | Undo delete event via snackbar. |
| NEW-414 | `Inline` | Inline rename event title from Agenda row. |
| NEW-415 | `Click` | Filter by assignee / linked provider. |
| NEW-416 | `Click` | Print week sheet for the floor. |
| NEW-417 | `Click` | Mobile handoff deep link for event details. |
| NEW-418 | `Flow` | Create event from Dashboard important date in one click with mapping. |

## L. Reports (`/reports`) (`NEW-419 … NEW-448`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-419 | `Click` | Excel / Google Sheets / Drive export options actually work (remove "coming soon"). |
| NEW-420 | `Click` | AI Command Palette returns real answers grounded in live metrics (not mocks). |
| NEW-421 | `Click` | Click any chart point → drill-down table of underlying tickets/orders. |
| NEW-422 | `Click` | Cross-filter: selecting a chart segment filters all other widgets. |
| NEW-423 | `Click` | Saved report packs (named dashboards) beyond a single layout. |
| NEW-424 | `Click` | Share report pack link with role-based access. |
| NEW-425 | `Click` | Schedule a report pack to email (ties to Communications scheduler). |
| NEW-426 | `Click` | Compare mode: pick custom baseline range, not only toggle. |
| NEW-427 | `Click` | Annotations on charts ("price change", "storm") with team comments. |
| NEW-428 | `Hover` | Hover legend item → highlight series; click to isolate. |
| NEW-429 | `R-Click` | Right-click widget → Duplicate / Export widget / Remove / Fullscreen. |
| NEW-430 | `2×Click` | Double-click widget → fullscreen focus mode. |
| NEW-431 | `Key` | `e` edit layout; `⌘S` save layout; `⌘E` export; `⌘K` AI palette. |
| NEW-432 | `Click` | Widget templates gallery (Wine velocity, Vendor scorecard, Labor vs sales). |
| NEW-433 | `Click` | Goal lines on KPIs; click goal → edit target. |
| NEW-434 | `Click` | Engine insights cards: Act / Dismiss / Explain / Pin (parity with Recommendations). |
| NEW-435 | `Click` | Check scanner: review extracted fields before committing; correct inline. |
| NEW-436 | `Flow` | Check scan → match to inventory decrements → variance exceptions queue. |
| NEW-437 | `Click` | Data tables outside DataTableBlock also sort/paginate consistently. |
| NEW-438 | `Click` | Export a single widget as PNG/SVG. |
| NEW-439 | `Click` | Fullscreen presentation mode for manager meetings (auto-advance optional). |
| NEW-440 | `Click` | Bookmark a filtered state as a URL; restore on open. |
| NEW-441 | `Click` | Row-level security preview: see report as a role. |
| NEW-442 | `Click` | Null/empty states per widget with "connect data" CTAs. |
| NEW-443 | `Click` | Unit toggle (bottles/$/%) at page level. |
| NEW-444 | `Drag` | Snap-to-grid guides while resizing widgets. |
| NEW-445 | `Click` | Reset single widget without resetting whole layout. |
| NEW-446 | `Click` | Version history of layouts; restore prior. |
| NEW-447 | `Click` | Comment threads on a report pack for async review. |
| NEW-448 | `Click` | Alerts from a metric: "notify me if X drops below Y". |

## M. Documents (`/documents-reports`) (`NEW-449 … NEW-473`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-449 | `Click` | Per-card View opens a real document preview (PDF/HTML) instead of placeholder. |
| NEW-450 | `Click` | Per-card Email opens composer with document attached. |
| NEW-451 | `Click` | Per-card Print triggers print dialog for the document. |
| NEW-452 | `Click` | True table/list sorting by name/date/type/status. |
| NEW-453 | `Click` | Rename document inline. |
| NEW-454 | `Click` | Move document between folders via dialog or drag. |
| NEW-455 | `Drag` | Drag cards onto folder nodes to move. |
| NEW-456 | `Click` | Create folder / rename folder / delete folder. |
| NEW-457 | `Click` | Tags on documents + filter by tag. |
| NEW-458 | `Click` | Full-text search inside document contents, not only titles. |
| NEW-459 | `Hover` | Hover card → first-page thumbnail preview. |
| NEW-460 | `R-Click` | Right-click → View / Download / Email / Print / Rename / Delete / Copy link. |
| NEW-461 | `Multi` | Bulk download as ZIP. |
| NEW-462 | `Multi` | Bulk tag / move / email. |
| NEW-463 | `Click` | Share link with expiry and password. |
| NEW-464 | `Click` | Version history per document. |
| NEW-465 | `Click` | Generate report from template → lands in Documents automatically. |
| NEW-466 | `Flow` | From Reports export → toast "Open in Documents". |
| NEW-467 | `Click` | OCR search for scanned invoices. |
| NEW-468 | `Click` | Related entities panel (order/provider/wine) on document detail. |
| NEW-469 | `Key` | `/` search; `⌘A` select all visible; `⌫` delete selected. |
| NEW-470 | `Click` | Favorites / pinned documents strip. |
| NEW-471 | `Click` | Retention policy UI (auto-archive after N days). |
| NEW-472 | `Click` | Empty folder CTAs to generate first weekly report. |
| NEW-473 | `Click` | Communication History tab rows deep-link to Communications threads. |

## N. Notifications (`/notifications`) (`NEW-474 … NEW-493`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-474 | `Click` | "Mark as unread" works end-to-end (remove coming soon). |
| NEW-475 | `Click` | All quick actions hit live endpoints with error toasts on failure. |
| NEW-476 | `Click` | Snooze from list and detail (1h / later today / tomorrow / custom). |
| NEW-477 | `Click` | Notification preferences deep-link lands on Settings → Notifications scrolled into view. |
| NEW-478 | `Click` | Group by day / by type with sticky headers. |
| NEW-479 | `Click` | Mute a notification type for 24h from the item. |
| NEW-480 | `Hover` | Hover item → preview body + primary action. |
| NEW-481 | `Flow` | Click notification of type X → land on the exact entity state (order approved drawer open, etc.). |
| NEW-482 | `Click` | Undo archive/delete. |
| NEW-483 | `Key` | `u` unread; `e` archive; `s` star; `j`/`k` move. |
| NEW-484 | `Click` | Priority rules editor (if low stock + VIP wine → urgent). |
| NEW-485 | `Click` | Digest mode: collapse bursty alerts into one summary card. |
| NEW-486 | `Click` | Desktop push permission prompt + test notification. |
| NEW-487 | `Click` | Filter by linked entity type. |
| NEW-488 | `R-Click` | Context menu gains Snooze / Mute type / Open entity / Copy link. |
| NEW-489 | `Click` | Assign notification to teammate. |
| NEW-490 | `Click` | Resolved state when underlying issue clears (auto). |
| NEW-491 | `Click` | Export notification audit log (admin). |
| NEW-492 | `Click` | Empty state illustrates types you'll receive once integrations connect. |
| NEW-493 | `Click` | "Mark all read" confirms when count > 50. |

## O. Settings (`/settings`) (`NEW-494 … NEW-518`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-494 | `Click` | Unsaved changes: navigate away prompts confirm; Cmd-click section preserves draft. |
| NEW-495 | `Click` | Email sender settings: send test email button. |
| NEW-496 | `Click` | Notifications section: per-channel matrix (email/SMS/push/in-app) with quiet hours. |
| NEW-497 | `Click` | Features flags: export/import config; diff vs defaults. |
| NEW-498 | `Click` | Danger zone: transfer ownership, delete restaurant (with typed confirm). |
| NEW-499 | `Click` | API tokens / webhooks management for integrations. |
| NEW-500 | `Click` | POS connection wizard (Square/Toast/Clover) with status + last sync. |
| NEW-501 | `Click` | Billing / plan page (even if external link) from Settings. |
| NEW-502 | `Click` | Audit log of settings changes. |
| NEW-503 | `Click` | Locale / currency / timezone settings affect the whole app. |
| NEW-504 | `Click` |  densisty / table defaults (rows per page) persisted. |
| NEW-505 | `Key` | `⌘S` saves the active settings section. |
| NEW-506 | `Click` | Team: resend invite; copy invite link; expiry countdown. |
| NEW-507 | `Click` | Team: custom roles / permissions matrix. |
| NEW-508 | `Click` | Locations: set default receiving location; map pin edit. |
| NEW-509 | `Click` | Measurement: preview pour cost impact when changing default pour. |
| NEW-510 | `Click` | Calendar: list active subscribers; revoke a device feed. |
| NEW-511 | `Click` | Profile photo upload + crop. |
| NEW-512 | `Click` | Password change + session list (revoke other sessions). |
| NEW-513 | `Click` | 2FA enrollment and recovery codes. |
| NEW-514 | `Click` | Connected apps (Gmail, SMS provider) reconnect/disconnect. |
| NEW-515 | `Click` | Data export (GDPR-style) request button. |
| NEW-516 | `Click` | Impersonation banner when admin views as member (exit control). |
| NEW-517 | `Click` | Keyboard shortcuts customization. |
| NEW-518 | `Click` | Default landing page after login. |

## P. Team (`/team`) (`NEW-519 … NEW-543`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-519 | `Click` | Drag-assign shifts on the manager desk grid. |
| NEW-520 | `Drag` | Drag shift blocks to move; resize to change length. |
| NEW-521 | `R-Click` | Right-click shift → Edit / Duplicate / Delete / Message staff. |
| NEW-522 | `2×Click` | Double-click empty cell → create shift. |
| NEW-523 | `Click` | Conflict warnings (double-book, overtime, availability). |
| NEW-524 | `Click` | Publish schedule → notify affected staff. |
| NEW-525 | `Click` | Open shifts claim/request flow. |
| NEW-526 | `Click` | Time-off requests approve/deny. |
| NEW-527 | `Click` | Labor cost estimate vs sales forecast on the week view. |
| NEW-528 | `Click` | Performance panel: click metric → staff detail drill-down. |
| NEW-529 | `Click` | Performance: export CSV; date range control. |
| NEW-530 | `Hover` | Hover staff name → contact + next shift peek. |
| NEW-531 | `Click` | My Shifts: swap request with another staff member. |
| NEW-532 | `Click` | My Shifts: clock-in/out (if enabled) with geofence hint. |
| NEW-533 | `Click` | Ops Rules: test rule against last week (dry run). |
| NEW-534 | `Click` | Ops Rules: version history. |
| NEW-535 | `Key` | Arrow keys move desk selection; Enter edits. |
| NEW-536 | `Multi` | Multi-select shifts → bulk assign / bulk delete. |
| NEW-537 | `Click` | Filter desk by role / station. |
| NEW-538 | `Click` | Print schedule PDF / post to Slack. |
| NEW-539 | `Flow` | Hire → invite → set role → first shift assignment guided. |
| NEW-540 | `Click` | Training checklist per role with completion tracking. |
| NEW-541 | `Click` | Tip pool rules configuration UI. |
| NEW-542 | `Click` | Server wine-sales leaderboard deep link from performance cards. |
| NEW-543 | `Click` | Coverage heatmap (under/over staffed hours). |

## Q. Admin (`/admin`, `/admin/health`) (`NEW-544 … NEW-563`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-544 | `Click` | Save Settings persists admin config to backend. |
| NEW-545 | `Click` | Restart agent calls real orchestrator control API with status feedback. |
| NEW-546 | `Click` | Notifications toggles persist and affect runtime. |
| NEW-547 | `Click` | Integrations "Configure" opens real setup wizards. |
| NEW-548 | `Click` | Admin Health cards clickable → logs / last errors / runbook. |
| NEW-549 | `Click` | Filter agents by status (healthy/degraded/down). |
| NEW-550 | `Click` | Manual trigger for a job with parameter form. |
| NEW-551 | `Click` | Kill switch / pause all agents with confirm. |
| NEW-552 | `Hover` | Hover agent → last success time, queue depth, p95 latency. |
| NEW-553 | `Key` | `r` refresh health; `⌘S` save. |
| NEW-554 | `Click` | Audit trail of admin actions. |
| NEW-555 | `Click` | Feature flag overrides per restaurant from admin. |
| NEW-556 | `Click` | Impersonate restaurant user (time-boxed). |
| NEW-557 | `Click` | Cost dashboard for LLM/API spend. |
| NEW-558 | `Click` | DLQ viewer for failed jobs with retry/discard. |
| NEW-559 | `Click` | Config diff before save. |
| NEW-560 | `Click` | Export support bundle (logs + config redacted). |
| NEW-561 | `Click` | Maintenance mode banner control. |
| NEW-562 | `R-Click` | Agent card → Restart / Pause / View logs / Open runbook. |
| NEW-563 | `Click` | Alert routing rules for agent failures (Pager-style). |

## R. Studio (`/studio/*`) (`NEW-564 … NEW-588`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-564 | `Click` | ContributorTable ⋮ menu works: view profile / resend / revoke. |
| NEW-565 | `Click` | Revoke contributor end-to-end with confirm + undo window. |
| NEW-566 | `Multi` | Multi-select wine records → bulk promote / bulk send to review. |
| NEW-567 | `Click` | Sortable columns on wine records and queue tables. |
| NEW-568 | `Click` | Filter records by confidence band / missing fields / source. |
| NEW-569 | `R-Click` | Row → Edit field / Promote / Open source PDF / Copy ID. |
| NEW-570 | `Key` | `j`/`k` rows; `p` promote; `e` edit focused field. |
| NEW-571 | `Hover` | Hover confidence badge → per-field breakdown. |
| NEW-572 | `Click` | Side-by-side PDF page sync while editing fields. |
| NEW-573 | `Click` | Keyboard-first field navigation (Tab between FieldCells). |
| NEW-574 | `Click` | Batch paste from spreadsheet into empty records. |
| NEW-575 | `Click` | Conflict UI when promote hits duplicate. |
| NEW-576 | `Click` | Queue: bulk approve/reject selected. |
| NEW-577 | `Click` | Certify: edit invite permissions; expiry; revoke from menu. |
| NEW-578 | `Click` | Metrics dashboard widgets clickable → filtered queues. |
| NEW-579 | `Flow` | Ingest PDF → correct fields → promote → appears in Wine Library with provenance. |
| NEW-580 | `Click` | Undo promote within grace period. |
| NEW-581 | `Click` | Assign review to a specific contributor. |
| NEW-582 | `Click` | Comments/thread on a record for async review. |
| NEW-583 | `Click` | Export session quality report. |
| NEW-584 | `Scan` | Drag multiple PDFs to enqueue a batch ingest. |
| NEW-585 | `Click` | URL ingest validates and shows fetch preview before run. |
| NEW-586 | `Click` | Manual empty record template picker (producer/region presets). |
| NEW-587 | `Click` | Dark-studio denser mode for long review sessions. |
| NEW-588 | `Click` | Shortcut cheat sheet inside Studio (`?`). |

## S. Auth & Onboarding (`NEW-589 … NEW-608`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-589 | `Click` | Login "Remember me" persists session preference. |
| NEW-590 | `Click` | "Forgot password?" routes to a working reset-password flow. |
| NEW-591 | `Click` | Show/hide password toggles on Login and Register. |
| NEW-592 | `Click` | OAuth buttons (Google/Apple) sign-in when enabled. |
| NEW-593 | `Click` | Magic-link email login option. |
| NEW-594 | `Click` | Lockout messaging + unlock path after failed attempts. |
| NEW-595 | `Click` | Register: save draft progress if user abandons mid-wizard. |
| NEW-596 | `Click` | Invite landing: decline invite path with reason. |
| NEW-597 | `Click` | No Access page is actually reached by auth guards when role lacks permission. |
| NEW-598 | `Click` | Get Started: resume interrupted import; show partial progress. |
| NEW-599 | `Click` | Get Started: edit/remove extracted wines before commit. |
| NEW-600 | `Click` | Get Started: map CSV columns with confidence highlights. |
| NEW-601 | `Scan` | Get Started: live camera capture with edge detection guide. |
| NEW-602 | `Click` | Checklist item click deep-links to the exact incomplete task UI. |
| NEW-603 | `Flow` | Post-verify → get-started → first vendor → first invite → dashboard with celebration. |
| NEW-604 | `Click` | Skip get-started offers "remind me tomorrow" not only permanent skip. |
| NEW-605 | `Click` | Re-enter get-started later from checklist even after skip. |
| NEW-606 | `Click` | Onboarding tips dismissible coach marks on first inventory visit. |
| NEW-607 | `Click` | Email verification deep link handles expired token with clear resend. |
| NEW-608 | `Click` | Multi-restaurant users pick a home restaurant on first login. |

## T. Cross-page end-to-end journeys (`NEW-609 … NEW-628`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-609 | `Flow` | Low stock alert → notification → inventory expansion → draft PO → approve email → mark ordered → receive → reconcile. |
| NEW-610 | `Flow` | Promo email ingested → Prospects → add vendor → apply offer on PO → track savings in Reports. |
| NEW-611 | `Flow` | Calendar event T-7 → prep checklist → reserve wines → transfer to event location → post-event variance. |
| NEW-612 | `Flow` | Menu scan onboarding → library enrich (Studio) → set pars → first recurring order. |
| NEW-613 | `Flow` | Server performance dip → Team drill-down → coaching note → follow-up recommendation. |
| NEW-614 | `Flow` | Price spike on invoice receive → dispute email → credit → ledger adjustment. |
| NEW-615 | `Flow` | 86 wine mid-service → mark 86 → sommelier suggests alternate → update floor notes. |
| NEW-616 | `Flow` | Morning briefing → act on 3 items → all clear state on dashboard. |
| NEW-617 | `Flow` | Multi-location transfer request → approve → ship → receive at destination → both ledgers update. |
| NEW-618 | `Flow` | Consultant share link → view inventory snapshot → leave comment → manager notified. |
| NEW-619 | `Flow` | Failed agent job → Admin Health → retry → verify insight appears in Recommendations. |
| NEW-620 | `Flow` | New hire invite → accept → role-limited nav → complete training checklist → first shift. |
| NEW-621 | `Flow` | RFQ to 3 vendors → compare → award → PO → delivery → score vendor. |
| NEW-622 | `Flow` | Count session variance → shrinkage case → ShrinkageDetective insight → count SOP change. |
| NEW-623 | `Flow` | Guest tasting (future consumer) consent → restaurant aggregate insight → menu tweak. |
| NEW-624 | `Flow` | POS disconnect → banner → Settings reconnect → backfill → reports heal. |
| NEW-625 | `Flow` | Offline edit on mobile → sync when online → conflict resolve on web. |
| NEW-626 | `Flow` | Export weekly pack → Documents → email owners → discuss in Comments. |
| NEW-627 | `Flow` | Wine Agent placeholder → replace with real agent chat that can draft POs. |
| NEW-628 | `Flow` | Help placeholder → searchable docs + contact → ticket created with context dump. |

## U. Mobile app paths (parity & handoff) (`NEW-629 … NEW-643`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-629 | `Click` | Mobile Today tab quick action mirrors web One-Tap approve. |
| NEW-630 | `Long` | Long-press cellar item → Adjust / Transfer / Favorite. |
| NEW-631 | `Scan` | Mobile scan barcode to open wine detail. |
| NEW-632 | `Scan` | Mobile scan invoice to start receiving. |
| NEW-633 | `Flow` | Push notification on phone → deep link into supply order detail. |
| NEW-634 | `Flow` | Web creates draft → phone reviews/sends on the floor. |
| NEW-635 | `Click` | Mobile insights card → act (reorder) without opening web. |
| NEW-636 | `Click` | Biometric unlock from lock screen to last tab. |
| NEW-637 | `Click` | Offline cellar count mode with sync queue UI. |
| NEW-638 | `Click` | Share sheet: send wine card to WhatsApp/SMS. |
| NEW-639 | `Click` | Mobile team tab: claim open shift. |
| NEW-640 | `Click` | Handoff QR: web shows QR, phone opens the same entity. |
| NEW-641 | `Click` | Widget / live activity for low stock (iOS). |
| NEW-642 | `Click` | Mobile settings: notification channel toggles parity with web. |
| NEW-643 | `Long` | Swipe (or long-press menu) on supply row → Mark Ordered / Archive. |

## V. Placeholders to ship (`/wine-agent`, `/help`) (`NEW-644 … NEW-651`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-644 | `Click` | Wine Agent page is a real chat/agent UI (not under-construction placeholder). |
| NEW-645 | `Click` | Wine Agent can propose POs and hand off to Orders for approval. |
| NEW-646 | `Click` | Wine Agent can answer "what should I 86?" using live inventory. |
| NEW-647 | `Click` | Help & Support is a real help center with search, articles, and contact form. |
| NEW-648 | `Click` | Help articles deep-link into the product with coach marks. |
| NEW-649 | `Click` | In-app bug report captures route, user, and last errors. |
| NEW-650 | `Click` | Status page link for incidents. |
| NEW-651 | `Click` | Onboarding video embeds per major page from Help. |

## W. Consumer Food Profiles & Guest Insights (Phase 999.1 backlog) (`NEW-652 … NEW-666`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-652 | `Flow` | Consumer creates profile independent of restaurant org. |
| NEW-653 | `Click` | Add social handles + food/wine preferences to consumer profile. |
| NEW-654 | `Click` | Rate a dish; rate a restaurant (Beli-style). |
| NEW-655 | `Click` | Follow a restaurant; activity feed of ratings. |
| NEW-656 | `Click` | Restaurant discovery map/list with filters. |
| NEW-657 | `Flow` | Verified visit via reservation/POS link unlocks "been here" badge. |
| NEW-658 | `Click` | Consent controls: what restaurants may see about the guest. |
| NEW-659 | `Click` | Restaurant dashboard: aggregated audience segments (privacy-safe). |
| NEW-660 | `Click` | Restaurant: top guest preferences among recent visitors (k-anonymized). |
| NEW-661 | `Click` | Guest insights: which menu items attract which segments. |
| NEW-662 | `Click` | Opt-out / delete consumer data request. |
| NEW-663 | `Click` | Link consumer identity to loyalty only with explicit consent. |
| NEW-664 | `Flow` | Manager reviews weekly guest-insight digest → menu experiment. |
| NEW-665 | `Click` | Export anonymized segment report. |
| NEW-666 | `Click` | Consumer blocks a restaurant from seeing future visits. |

## X. Accessibility, i18n, and system UX (`NEW-667 … NEW-676`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-667 | `Key` | Skip-to-content link works on every page. |
| NEW-668 | `Key` | All icon-only buttons have visible focus rings and aria-labels. |
| NEW-669 | `Key` | Escape closes the topmost modal/drawer consistently app-wide. |
| NEW-670 | `Key` | Screen reader announces toast outcomes for approve/reject/save. |
| NEW-671 | `Click` | Reduced-motion mode respects `prefers-reduced-motion`. |
| NEW-672 | `Click` | High-contrast theme option. |
| NEW-673 | `Click` | Language switcher (EN + additional locales) with typed dates/currency. |
| NEW-674 | `Click` | RTL layout support where applicable. |
| NEW-675 | `Key` | Data tables expose proper grid roles for SR navigation. |
| NEW-676 | `Click` | Form errors are linked via aria-describedby and focus first error. |

## Y. Power-user, collaboration, and platform paths (`NEW-677 … NEW-706`)

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-677 | `Key` | Global `g` then `t` → Team; `g` then `c` → Calendar; `g` then `p` → Providers. |
| NEW-678 | `Key` | Global `g` then `n` → Notifications; `g` then `s` → Settings. |
| NEW-679 | `Key` | `⌘⇧P` opens command palette scoped to current page actions only. |
| NEW-680 | `Key` | `⌘⇧L` toggles list density everywhere lists exist. |
| NEW-681 | `Click` | Pin any page as default homepage override. |
| NEW-682 | `Click` | Multi-window: open entity in pop-out window. |
| NEW-683 | `Click` | Split workspace: Orders | Inventory side-by-side saved layout. |
| NEW-684 | `Click` | Copy deep link with filters encoded in query string from any list. |
| NEW-685 | `Click` | "Replay onboarding checklist" from Help for training new managers. |
| NEW-686 | `Click` | Sandbox/demo data toggle for sales demos without touching prod. |
| NEW-687 | `Click` | Field-level "was this helpful?" on empty states. |
| NEW-688 | `Click` | Ask AI about this page (contextual sommelier/agent entry). |
| NEW-689 | `Hover` | Everywhere a truncated name appears → full name tooltip with copy. |
| NEW-690 | `Click` | Bulk paste IDs into any search to filter that set. |
| NEW-691 | `Click` | Recent filters history dropdown on every major list. |
| NEW-692 | `Click` | "Explain this number" on any KPI opens methodology sheet. |
| NEW-693 | `Flow` | Manager end-of-week review wizard across Reports → Team → Inventory. |
| NEW-694 | `Click` | Starring entities (wine/order/provider) unifies into a global Stars page. |
| NEW-695 | `Click` | Global trash / archive browser with restore. |
| NEW-696 | `Click` | Activity feed: team actions stream with filters. |
| NEW-697 | `Click` | Presence avatars when teammates view the same order/wine. |
| NEW-698 | `Click` | Live cursors optional on shared receiving session. |
| NEW-699 | `Click` | Comment @thread on any entity (wine, order, provider, event). |
| NEW-700 | `Click` | Resolve comment → notification to participants. |
| NEW-701 | `Click` | Templates for adjustment reasons; manage in Settings. |
| NEW-702 | `Click` | Custom fields on wines/orders (admin-defined) shown in tables. |
| NEW-703 | `Click` | Import/export custom fields. |
| NEW-704 | `Click` | Webhook debugger UI for outbound events. |
| NEW-705 | `Click` | "Simulate delivery" in staging for QA of receiving UX. |
| NEW-706 | `Click` | Feature discovery nudges when a power path exists but unused for 14 days. |

## Z. Analytics engine surfaces — Browse 375 types + insights-in-context (`NEW-707 … NEW-760`)

*Grounded in `apps/api-gateway/src/analytics/insights/insight-catalog.ts`: **375** valid `DIMENSION × MEASURE × COMPARATOR` candidate types (10 dims × 14 measures × 13 comparators, pruned by validity matrix). Today the engine runs and Recommendations/Reports show ranked sentences, but there is **no** Browse-All picker UI and **no** detailed contextual embedding on `/orders`, `/inventory`, or `/providers`.*

### Already mapped (do not duplicate — wire next)

| Priority | Existing IDs | Wire to | Status |
|----------|--------------|---------|--------|
| P0 | `NEW-284`–`NEW-308` | Recommendations page: Act / Dismiss / Snooze / Done / filters / Act flows | ✅ shipped 2026-07-20 |
| P0 | `NEW-434` | Reports `EngineInsightsPanel` cards: Act / Dismiss / Explain / Pin | ✅ shipped 2026-07-20 |
| P0 | `NEW-303` | Digest toggle persisted (daily send is feature-flagged in the scheduler) | ✅ toggle shipped · send flagged |

> **Shipped 2026-07-20 (P0):** `recommendation_actions` + `recommendation_digest_prefs`
> tables (`20260720120000_recommendation_actions.sql`), analytics routes
> `POST/GET …/recommendations/:id/action|bulk-action|actions|history|digest`,
> a rewritten `pages/Recommendations.tsx` (act/dismiss-with-reason/snooze/done/
> pin/feedback, urgency+category+status filters, sort, search, bulk bar,
> j/k/a/d/s keys, r-click menu, 2×click act, History tab, undo, `?insight=`
> deep link), and NEW-434 on `EngineInsightsPanel` reusing the same action store
> keyed by `insight:<candidate_key>`.

### Z1. Browse All 375 Types — dimension / measure / comparator picker

> **Shipped 2026-07-20:** `GET /analytics/insight-catalog/types` (full 375-type
> enumeration + optional per-restaurant data availability) + `pages/InsightCatalog.tsx`
> at `/recommendations/catalog`, linked from Recommendations. Covers NEW-707–713,
> 718–720, 722, 724, 727 (explore dimensions/measures/comparators, type detail,
> search, category filter, computable-vs-blocked readiness + what's missing,
> coverage meter, `?type=` deep link, JSON/CSV export). Deferred: per-type
> enable/mute/pin (NEW-715–717), "run this type now" (NEW-714), diff view
> (NEW-723), admin validity overrides (NEW-726) — need a type-prefs table +
> single-type run support.

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-707 | `Click` | Recommendations (or Reports) gains **"Browse all insight types"** → full-screen explorer of all 375 catalog keys. |
| NEW-708 | `Click` | Explorer left rail lists the 10 dimensions (`overall`, `day_of_week`, `daypart`, `table`, `table_zone`, `waiter`, `wine`, `wine_type`, `vendor`, `venue_feature`) with live type counts. |
| NEW-709 | `Click` | Middle column lists measures valid for the selected dimension (validity matrix — not the full 14 when pruned). |
| NEW-710 | `Click` | Right column lists comparators valid for that dimension (e.g. `basket_affinity` only under `wine`). |
| NEW-711 | `Click` | Selecting one cell in the dim×measure×comparator grid highlights the candidate type key (`wine.bottles.peer_rank`) and category badge. |
| NEW-712 | `Hover` | Hover a type cell → tooltip with label, template family, data requirements (`consumption`/`orders`/`checks`/…). |
| NEW-713 | `Click` | Type detail pane: plain-English description, example sentence, required data sources, category, enable/disable toggle. |
| NEW-714 | `Click` | **"Run this type now"** computes live candidates for that type × current entities and shows ranked results. |
| NEW-715 | `Click` | **"Pin type to Recommendations"** so future recomputes always include this type even if score would bury it. |
| NEW-716 | `Click` | **"Mute type"** — permanently suppress a type (e.g. tip_% peer rank) with undo. |
| NEW-717 | `Multi` | Multi-select types → bulk Enable / Mute / Pin / Export keys CSV. |
| NEW-718 | `Click` | Search box fuzzy-matches across keys, labels, categories (sales/purchasing/inventory/…). |
| NEW-719 | `Click` | Filter chips by category (sales 79, tables 82, staff 35, …) and by data-requirement readiness (available vs blocked). |
| NEW-720 | `Click` | "Blocked" types show which `DataRequirement` is missing + CTA to connect POS / import checks / set goals. |
| NEW-721 | `Key` | `/` focuses search; arrow keys move the grid; `Enter` opens type detail; `e` enables; `m` mutes. |
| NEW-722 | `Click` | Coverage meter: "N of 375 types enabled · M computable with current data · K produced insights last run". |
| NEW-723 | `Click` | Diff view: last run vs prior — which types newly fired / stopped firing. |
| NEW-724 | `Flow` | From a Recommendations card → "View type in catalog" deep-links to that dim×measure×comparator cell. |
| NEW-725 | `Flow` | From Browse explorer → "Act on top result" jumps to Recommendations with that type pre-filtered. |
| NEW-726 | `Click` | Admin-only: edit validity overrides (allow/deny a triple) with audit log — advanced; default is catalog-only. |
| NEW-727 | `Click` | Export the 375-type catalog as JSON/CSV for consultants (mirrors `insight-catalog.ts`). |
| NEW-728 | `Click` | "Why isn't this type showing?" explainer: muted / missing data / scored below threshold / no entities. |

> **Shipped 2026-07-20 (contextual embedding):** shared
> `components/insights/ContextualInsights.tsx` (the NEW-758 contract) embedded
> host-scoped on `/inventory`, `/orders`, `/providers` — Act / Explain / Pin /
> Dismiss reusing the `recommendation_actions` store keyed `insight:<candidate_key>`
> so dismiss/pin sync with Reports + Recommendations (NEW-736/746/756), stable
> deep links to Browse-All + Recommendations (NEW-735/745/755/759), taught empty
> state (NEW-760). Covers NEW-729, 738, 748, 758, 759, 760 and the shared
> Act/Dismiss/Pin affordances. Per-row entity scoping (NEW-730/739/749/751),
> hover peeks (NEW-731/740/750), and `i`-key toggles (NEW-737/747/757) are the
> next refinements — the component already accepts an `entityKey` prop for them.

### Z2. Insights in context — `/inventory`

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-729 | `Click` | Inventory page hosts a collapsible **Insights** rail (right or attention strip) scoped to inventory/risk/forecast wine types. |
| NEW-730 | `Click` | Expanding a wine row auto-loads entity-scoped insights for that wine (`wine.*` types) under the expansion. |
| NEW-731 | `Hover` | Hover an insight chip on a row → sentence peek + score; click → Act (Draft PO / Recount / Adjust par). |
| NEW-732 | `Click` | Attention-rail flags (Below par, Dead stock, Price signals) each surface the top matching engine insight, not only a static filter. |
| NEW-733 | `Click` | Cellar Map zone select → zone/table_zone insights ("this zone under-indexes on wine attach"). |
| NEW-734 | `Flow` | Insight "stockout risk on Wine X" → one-tap Draft PO (NEW-299 parity) without leaving Inventory. |
| NEW-735 | `Click` | "Show all inventory insight types" deep-links Browse explorer filtered to `inventory` + `risk` + `wine` dims. |
| NEW-736 | `Click` | Dismiss/snooze contextual insight from the rail; state syncs with Recommendations (same insight id). |
| NEW-737 | `Key` | `i` toggles the Inventory insights rail; `⇧I` jumps to Browse filtered to inventory types. |

### Z3. Insights in context — `/orders`

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-738 | `Click` | Orders page hosts an **Insights** strip scoped to purchasing/vendor/spend types. |
| NEW-739 | `Click` | Selecting an order or provider group loads `vendor.*` + spend anomaly insights for that provider. |
| NEW-740 | `Hover` | Hover provider name on an order → insight peek ("spend +32% vs 30d peer rank"). |
| NEW-741 | `Click` | Create-order / Smart-restock panel shows engine recommendations that justify suggested qty (forecast_gap / days_of_cover). |
| NEW-742 | `Flow` | Purchasing concentration insight → filter Orders to that vendor + open RFQ/compare path. |
| NEW-743 | `Click` | Deal Approval modal embeds price-anomaly insight when offered price spikes vs history. |
| NEW-744 | `Click` | Recurring series row shows pace-vs-goal or trend insight when overspending vs target. |
| NEW-745 | `Click` | "Show all purchasing insight types" → Browse explorer filtered to `purchasing` / `vendor`. |
| NEW-746 | `Click` | Dismiss/snooze from Orders rail syncs to Recommendations. |
| NEW-747 | `Key` | `i` toggles Orders insights strip. |

### Z4. Insights in context — `/providers`

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-748 | `Click` | Providers page hosts an **Insights** panel (list + detail modal) for vendor peer-rank, spend trend, concentration, anomalies. |
| NEW-749 | `Click` | Provider card badge shows top insight severity (dot); click opens that insight. |
| NEW-750 | `Hover` | Hover intel badges → engine sentence (not only static profile dimensions). |
| NEW-751 | `Click` | Provider detail **Intelligence** tab gains an "Engine insights" sub-tab listing live `vendor.*` results for this entity. |
| NEW-752 | `Flow` | Insight "vendor spend concentration" → Act opens Orders filtered to that vendor or starts RFQ. |
| NEW-753 | `Flow` | Insight "lead-time / anomaly" → Act opens Comms draft requesting ETA or credit. |
| NEW-754 | `Click` | Compare mode (2–3 providers) shows side-by-side peer_rank insights on purchase_spend. |
| NEW-755 | `Click` | "Show all vendor insight types" → Browse explorer filtered to `vendor`. |
| NEW-756 | `Click` | Dismiss/snooze from Providers syncs to Recommendations. |
| NEW-757 | `Key` | `i` toggles Providers insights panel. |

### Z5. Shared contextual embedding contract

| # | Trigger | Path → Outcome |
|---|---------|----------------|
| NEW-758 | `Flow` | Shared `<ContextualInsights host="inventory\|orders\|providers" entity?>` component: same Act/Dismiss/Explain/Pin affordances as NEW-434 / NEW-284. |
| NEW-759 | `Flow` | Insight deep links are stable (`/recommendations?insight=<id>` or `?type=<dim.measure.comparator>&entity=<id>`) and work from any host page. |
| NEW-760 | `Click` | Empty contextual rail explains "connect checks/POS" or "no insights for this entity yet" with Browse-All CTA — never a blank panel. |

## AA. Seating density & sales ↔ check-in (features #361–460) (`NEW-761 … NEW-860`)

*One UX path per Batch-6 analytics feature. Surfaces: Reports density widgets, floor map, Recommendations Act flows, host/ops alerts.*

| # | Trigger | Feature | Path → Outcome |
|---|---------|---------|----------------|
| NEW-761 | `Click` | #361 Check-In Density per Seat | Reports → Seating Density widget shows **Check-In Density per Seat** (feature #361); click opens methodology + zone breakdown. |
| NEW-762 | `Hover` | #362 Checks per Seat | Hover a table on the floor map → peek **Checks per Seat** (#362) vs zone median. |
| NEW-763 | `Flow` | #363 Sales per Seat | From Recommendations insight on seating → Act opens Reports pre-filtered to **Sales per Seat** (#363). |
| NEW-764 | `Key` | #364 Wine Sales per Seat | `d` then digit on Reports focuses the **Wine Sales per Seat** (#364) density KPI. |
| NEW-765 | `Multi` | #365 Revenue per Cover | Multi-select zones → compare **Revenue per Cover** (#365) side-by-side. |
| NEW-766 | `2×Click` | #366 Wine Revenue per Cover | Double-click **Wine Revenue per Cover** KPI (#366) → fullscreen trend + scatter vs sales. |
| NEW-767 | `R-Click` | #367 Seat Utilization Rate | Right-click **Seat Utilization Rate** (#367) → Pin / Alert threshold / Open Browse type / Export. |
| NEW-768 | `Click` | #368 Table Turnover per Seat | Reports → Seating Density widget shows **Table Turnover per Seat** (feature #368); click opens methodology + zone breakdown. |
| NEW-769 | `Click` | #369 Cover Density vs Sales Elasticity | Reports → Seating Density widget shows **Cover Density vs Sales Elasticity** (feature #369); click opens methodology + zone breakdown. |
| NEW-770 | `Flow` | #370 Optimal Check-In Density Band | From Recommendations insight on seating → Act opens Reports pre-filtered to **Optimal Check-In Density Band** (#370). |
| NEW-771 | `Click` | #371 Overcrowding Penalty Score | Reports → Seating Density widget shows **Overcrowding Penalty Score** (feature #371); click opens methodology + zone breakdown. |
| NEW-772 | `Hover` | #372 Underutilized Seat Opportunity $ | Hover a table on the floor map → peek **Underutilized Seat Opportunity $** (#372) vs zone median. |
| NEW-773 | `Flow` | #373 BTG Pours per Seat | From Recommendations insight on seating → Act opens Reports pre-filtered to **BTG Pours per Seat** (#373). |
| NEW-774 | `Key` | #374 Bottle Opens per Seat | `d` then digit on Reports focuses the **Bottle Opens per Seat** (#374) density KPI. |
| NEW-775 | `Multi` | #375 Tip $ per Seat | Multi-select zones → compare **Tip $ per Seat** (#375) side-by-side. |
| NEW-776 | `2×Click` | #376 Hourly Check-In Density Heatmap | Double-click anomaly badge for **Hourly Check-In Density Heatmap** (#376) → open that day's checks. |
| NEW-777 | `R-Click` | #377 Daypart Sales vs Density | Right-click timeline → Snooze alert / Set goal on **Daypart Sales vs Density** (#377). |
| NEW-778 | `Click` | #378 Same-Weekday Density Baseline | Calendar/Reports daypart strip: toggle **Same-Weekday Density Baseline** (#378) overlay on the sales heatmap. |
| NEW-779 | `Click` | #379 Weekend vs Weekday Density Gap | Calendar/Reports daypart strip: toggle **Weekend vs Weekday Density Gap** (#379) overlay on the sales heatmap. |
| NEW-780 | `Flow` | #380 Pre-Theater Density Spike | Morning briefing includes **Pre-Theater Density Spike** (#380) when anomalous; Act → schedule staffing. |
| NEW-781 | `Click` | #381 Weather-Adjusted Density | Calendar/Reports daypart strip: toggle **Weather-Adjusted Density** (#381) overlay on the sales heatmap. |
| NEW-782 | `Hover` | #382 Density Ramp Curve | Hover an hour cell → **Density Ramp Curve** (#382) value + delta vs baseline. |
| NEW-783 | `Flow` | #383 Density Decay Curve | Morning briefing includes **Density Decay Curve** (#383) when anomalous; Act → schedule staffing. |
| NEW-784 | `Key` | #384 15-Minute Density Pulse | `t` cycles time grain (15m/hour/daypart) for **15-Minute Density Pulse** (#384). |
| NEW-785 | `Multi` | #385 Density Forecast 7-Day | Select multiple dayparts → bulk export **Density Forecast 7-Day** (#385) series. |
| NEW-786 | `2×Click` | #386 Sales-per-Seat Trend 30d | Double-click anomaly badge for **Sales-per-Seat Trend 30d** (#386) → open that day's checks. |
| NEW-787 | `R-Click` | #387 Check-In Density Anomaly Day | Right-click timeline → Snooze alert / Set goal on **Check-In Density Anomaly Day** (#387). |
| NEW-788 | `Click` | #388 Happy-Hour Density vs Wine Attach | Calendar/Reports daypart strip: toggle **Happy-Hour Density vs Wine Attach** (#388) overlay on the sales heatmap. |
| NEW-789 | `Click` | #389 Brunch Density Economics | Calendar/Reports daypart strip: toggle **Brunch Density Economics** (#389) overlay on the sales heatmap. |
| NEW-790 | `Flow` | #390 Late-Night Density Margin | Morning briefing includes **Late-Night Density Margin** (#390) when anomalous; Act → schedule staffing. |
| NEW-791 | `Click` | #391 Reservation Density Load | Calendar/Reports daypart strip: toggle **Reservation Density Load** (#391) overlay on the sales heatmap. |
| NEW-792 | `Hover` | #392 No-Show Impact on Density | Hover an hour cell → **No-Show Impact on Density** (#392) value + delta vs baseline. |
| NEW-793 | `Flow` | #393 Turn-Time vs Density | Morning briefing includes **Turn-Time vs Density** (#393) when anomalous; Act → schedule staffing. |
| NEW-794 | `Key` | #394 Server Load at Peak Density | `t` cycles time grain (15m/hour/daypart) for **Server Load at Peak Density** (#394). |
| NEW-795 | `Multi` | #395 Density-Normalized Labor Cost | Select multiple dayparts → bulk export **Density-Normalized Labor Cost** (#395) series. |
| NEW-796 | `2×Click` | #396 Zone Check-In Density Ranking | Double-click zone → detail drawer with **Zone Check-In Density Ranking** (#396) drivers. |
| NEW-797 | `R-Click` | #397 Zone Sales-per-Seat Ranking | Right-click zone → Open section / Rebalance / Mute **Zone Sales-per-Seat Ranking** (#397). |
| NEW-798 | `Click` | #398 Bar-Adjacent Density Premium | Floor map legend toggle: color by **Bar-Adjacent Density Premium** (#398). |
| NEW-799 | `Click` | #399 Kitchen-Distance × Density Interaction | Floor map legend toggle: color by **Kitchen-Distance × Density Interaction** (#399). |
| NEW-800 | `Flow` | #400 Outdoor Seat Density Yield | Host tablet deep link shows live **Outdoor Seat Density Yield** (#400) for section assignment. |
| NEW-801 | `Click` | #401 Poolside Density Seasonality | Floor map legend toggle: color by **Poolside Density Seasonality** (#401). |
| NEW-802 | `Hover` | #402 2-Top vs 4-Top Density Efficiency | Hover zone → **2-Top vs 4-Top Density Efficiency** (#402) + suggested rebalance. |
| NEW-803 | `Flow` | #403 Communal Table Density | Host tablet deep link shows live **Communal Table Density** (#403) for section assignment. |
| NEW-804 | `Key` | #404 Booth vs Banquette Density | `z` focuses densest zone by **Booth vs Banquette Density** (#404). |
| NEW-805 | `Multi` | #405 Sightline Density Effect | Multi-select tables → average **Sightline Density Effect** (#405) for the selection. |
| NEW-806 | `2×Click` | #406 Noise-Proxy Density Drag | Double-click zone → detail drawer with **Noise-Proxy Density Drag** (#406) drivers. |
| NEW-807 | `R-Click` | #407 Patio Heater Zone Density | Right-click zone → Open section / Rebalance / Mute **Patio Heater Zone Density** (#407). |
| NEW-808 | `Click` | #408 Window Seat Density Premium | Floor map legend toggle: color by **Window Seat Density Premium** (#408). |
| NEW-809 | `Click` | #409 Private Dining Density Utilization | Floor map legend toggle: color by **Private Dining Density Utilization** (#409). |
| NEW-810 | `Flow` | #410 Rebalancing Suggestion Map | Host tablet deep link shows live **Rebalancing Suggestion Map** (#410) for section assignment. |
| NEW-811 | `Click` | #411 Seat Cap Stress Test | Floor map legend toggle: color by **Seat Cap Stress Test** (#411). |
| NEW-812 | `Hover` | #412 Fire-Code Density Headroom | Hover zone → **Fire-Code Density Headroom** (#412) + suggested rebalance. |
| NEW-813 | `Flow` | #413 Wheelchair-Accessible Seat Yield | Host tablet deep link shows live **Wheelchair-Accessible Seat Yield** (#413) for section assignment. |
| NEW-814 | `Key` | #414 High-Top Density Wine Mix | `z` focuses densest zone by **High-Top Density Wine Mix** (#414). |
| NEW-815 | `Multi` | #415 Lounge Seat Check-In Cadence | Multi-select tables → average **Lounge Seat Check-In Cadence** (#415) for the selection. |
| NEW-816 | `2×Click` | #416 Floor Section Density Parity | Double-click zone → detail drawer with **Floor Section Density Parity** (#416) drivers. |
| NEW-817 | `R-Click` | #417 Host Stand Density Feed | Right-click zone → Open section / Rebalance / Mute **Host Stand Density Feed** (#417). |
| NEW-818 | `Click` | #418 Waitlist Pressure vs Density | Floor map legend toggle: color by **Waitlist Pressure vs Density** (#418). |
| NEW-819 | `Click` | #419 Combine-Table Density Shock | Floor map legend toggle: color by **Combine-Table Density Shock** (#419). |
| NEW-820 | `Flow` | #420 Geomarker Density Clusters | Host tablet deep link shows live **Geomarker Density Clusters** (#420) for section assignment. |
| NEW-821 | `Click` | #421 Avg Check vs Check-In Density Scatter | Scatter plot **sales vs check-in density**: series **Avg Check vs Check-In Density Scatter** (#421); click point → table. |
| NEW-822 | `Hover` | #422 Wine Attach vs Density Curve | Hover regression line for **Wine Attach vs Density Curve** (#422) → r / partial-r callout. |
| NEW-823 | `Flow` | #423 Tip % vs Density | Insight type fires for **Tip % vs Density** (#423) → Act drafts seating or wine attach play. |
| NEW-824 | `Key` | #424 Bottle Mix Shift at High Density | `s` toggles sales overlay on density chart for **Bottle Mix Shift at High Density** (#424). |
| NEW-825 | `Multi` | #425 Upsell Success vs Density | Compare 2–3 density bands' **Upsell Success vs Density** (#425) in a small-multiples view. |
| NEW-826 | `2×Click` | #426 Dessert Attach vs Density | Double-click outlier on **Dessert Attach vs Density** (#426) → checks + server for that table. |
| NEW-827 | `R-Click` | #427 Price Realization vs Density | Right-click **Price Realization vs Density** (#427) → Explain / Pin / Add to digest. |
| NEW-828 | `Click` | #428 VIP Guest Density Avoidance | Scatter plot **sales vs check-in density**: series **VIP Guest Density Avoidance** (#428); click point → table. |
| NEW-829 | `Click` | #429 Party Size × Density Interaction | Scatter plot **sales vs check-in density**: series **Party Size × Density Interaction** (#429); click point → table. |
| NEW-830 | `Flow` | #430 Duration × Density × Sales | Insight type fires for **Duration × Density × Sales** (#430) → Act drafts seating or wine attach play. |
| NEW-831 | `Click` | #431 Partial Correlation Sales~Distance | Density | Scatter plot **sales vs check-in density**: series **Partial Correlation Sales~Distance | Density** (#431); click point → table. |
| NEW-832 | `Hover` | #432 Partial Correlation Sales~Density | Seats | Hover regression line for **Partial Correlation Sales~Density | Seats** (#432) → r / partial-r callout. |
| NEW-833 | `Flow` | #433 Ridge Drivers including Density | Insight type fires for **Ridge Drivers including Density** (#433) → Act drafts seating or wine attach play. |
| NEW-834 | `Key` | #434 Density Peer Rank on Sales/Seat | `s` toggles sales overlay on density chart for **Density Peer Rank on Sales/Seat** (#434). |
| NEW-835 | `Multi` | #435 Concentration of Sales in Dense Seats | Compare 2–3 density bands' **Concentration of Sales in Dense Seats** (#435) in a small-multiples view. |
| NEW-836 | `2×Click` | #436 Forecast Gap: Sales given Density | Double-click outlier on **Forecast Gap: Sales given Density** (#436) → checks + server for that table. |
| NEW-837 | `R-Click` | #437 Goal Pace on Sales/Seat | Right-click **Goal Pace on Sales/Seat** (#437) → Explain / Pin / Add to digest. |
| NEW-838 | `Click` | #438 Live Surge: Density + Sales Spike | Scatter plot **sales vs check-in density**: series **Live Surge: Density + Sales Spike** (#438); click point → table. |
| NEW-839 | `Click` | #439 Basket Affinity under Density | Scatter plot **sales vs check-in density**: series **Basket Affinity under Density** (#439); click point → table. |
| NEW-840 | `Flow` | #440 Comp Rate vs Density | Insight type fires for **Comp Rate vs Density** (#440) → Act drafts seating or wine attach play. |
| NEW-841 | `Click` | #441 Void/Remake vs Density | Scatter plot **sales vs check-in density**: series **Void/Remake vs Density** (#441); click point → table. |
| NEW-842 | `Hover` | #442 Wine Service Time vs Density | Hover regression line for **Wine Service Time vs Density** (#442) → r / partial-r callout. |
| NEW-843 | `Flow` | #443 Sommelier Visit Rate vs Density | Insight type fires for **Sommelier Visit Rate vs Density** (#443) → Act drafts seating or wine attach play. |
| NEW-844 | `Key` | #444 Pairing Card Conversion vs Density | `s` toggles sales overlay on density chart for **Pairing Card Conversion vs Density** (#444). |
| NEW-845 | `Multi` | #445 Check Open-Rate Latency vs Density | Compare 2–3 density bands' **Check Open-Rate Latency vs Density** (#445) in a small-multiples view. |
| NEW-846 | `2×Click` | #446 Density Alert Threshold Config | Double-click alert → resolve workflow for **Density Alert Threshold Config** (#446). |
| NEW-847 | `R-Click` | #447 Seat Rebalance Recommendation | Right-click alert → Snooze / Retarget / Open feature #447 docs. |
| NEW-848 | `Click` | #448 Open Section Timing by Density | Settings → Density Ops: configure **Open Section Timing by Density** (#448). |
| NEW-849 | `Click` | #449 Server Section Density Balancing | Settings → Density Ops: configure **Server Section Density Balancing** (#449). |
| NEW-850 | `Flow` | #450 Density-Aware Par for BTG | Alert for **Density-Aware Par for BTG** (#450) → One-Tap Action (reseating / BTG par / host script). |
| NEW-851 | `Click` | #451 Event Seating Density Planner | Settings → Density Ops: configure **Event Seating Density Planner** (#451). |
| NEW-852 | `Hover` | #452 Density Digest Email | Hover alert chip → preview **Density Digest Email** (#452) threshold breach. |
| NEW-853 | `Flow` | #453 Host Script at Peak Density | Alert for **Host Script at Peak Density** (#453) → One-Tap Action (reseating / BTG par / host script). |
| NEW-854 | `Key` | #454 Density Goal Setting | `⌘⇧D` opens density alert center filtered to **Density Goal Setting** (#454). |
| NEW-855 | `Multi` | #455 Cross-Location Density Benchmark | Bulk acknowledge density alerts including **Cross-Location Density Benchmark** (#455). |
| NEW-856 | `2×Click` | #456 Density × Wine 86 Risk | Double-click alert → resolve workflow for **Density × Wine 86 Risk** (#456). |
| NEW-857 | `R-Click` | #457 Check-In Density SLA | Right-click alert → Snooze / Retarget / Open feature #457 docs. |
| NEW-858 | `Click` | #458 Seating Chart Density Overlay | Settings → Density Ops: configure **Seating Chart Density Overlay** (#458). |
| NEW-859 | `Click` | #459 Density Experiment Framework | Settings → Density Ops: configure **Density Experiment Framework** (#459). |
| NEW-860 | `Flow` | #460 Post-Service Density Retro | Alert for **Post-Service Density Retro** (#460) → One-Tap Action (reseating / BTG par / host script). |


---

**Part 2 total: 860 new UX paths (`NEW-001`–`NEW-860`).** Part 1 documents current (shipped/partial/dead) paths for contrast.

**Analytics wiring checklist (engine → UX):**
1. ✅ Wire Recommendations actions → `NEW-284`–`NEW-308` *(shipped 2026-07-20)*
2. ✅ Wire Reports engine-insight cards → `NEW-434` *(shipped 2026-07-20)*
3. ◐ Ship digest delivery → `NEW-303` *(toggle + prefs shipped; scheduled send feature-flagged)*
4. ◐ Ship Browse All insight-types picker → `NEW-707`–`NEW-728` *(explorer shipped; catalog now **573** types with seating-density measures)*
5. ◐ Embed insights-in-context on Inventory / Orders / Providers → `NEW-729`–`NEW-760`
   *(shipped 2026-07-20: shared `ContextualInsights` rail on all three pages,
   host-scoped, syncing via `recommendation_actions` keyed `insight:<candidate_key>`.
   Per-row entity scoping + hover peeks are the remaining refinements.)*
6. ☐ Seating density Batch 6 UX → `NEW-761`–`NEW-860` (features #361–#460)

**Insight catalog expanded 347 → 375 → 573 (2026-07-20):** seating-density measures added; prior note: widened the validity matrix
in `insight-catalog.ts` (wine_type +days_of_cover/stockout_risk, wine
+inventory_value, daypart +consumption_qty, venue_feature +tip_pct, vendor
+week-over-week/forecast_gap). All unique, all pass the validity matrix; Browse-All
and every insight surface pick them up automatically.

**Platform addition — Self-Learning UX Agent (in-product runtime):** foundation
shipped 2026-07-20. Observes friction telemetry → proposes SOTA-aligned changes
(never auto-applied) → serves human-approved, rollout-gated overrides → measures
→ learns. See `.planning/UX_SELF_LEARNING_AGENT.md`. Ships dark
(`UX_OPTIMIZER_ENABLED=false`).

**Seating density Batch 6 (2026-07-20):** analytics features **#361–#460** (sales vs check-in density over seating) + UX paths **NEW-761–NEW-860**. Insight catalog measures expanded (`checkin_density`, `checks_per_seat`, `wine_revenue_per_seat`, `revenue_per_cover`, `wine_per_cover`, `seat_utilization`, `turnover_per_seat`, `tip_per_seat`); candidate types now **573+**.
