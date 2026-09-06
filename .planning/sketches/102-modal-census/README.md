---
sketch: 102
name: modal-census
question: "Which shape does every overlay in the app take — and which overlays should not exist at all?"
winner: null
tags: [modal, sheet, panel, popover, census, mudavym, design-system, adr-0112]
---

# Sketch 102 · Every overlay, in its shape

## Design question

The founder, 2026-09-05: *"finalize all modal windows for all pages."* Sketch 099 drew the three
shapes on the first pages that used them; ADR 0112 built the primitive. This sketch reads **every**
place the web app opens something over the page — 141 sites, folded into 117 overlays plus the three the founder's rulings added (120 rows), on 22 pages plus the shell — and gives each
one the shape the policy gives it, or a reason it has none.

## How to view

```
open .planning/sketches/102-modal-census/index.html
```

Published gallery: <https://claude.ai/code/artifact/23f77c68-7766-40c8-934a-cfa7148c7508> — update THAT url, never republish new (`build.py --artifact PATH` then republish the same path).
Renders from `file://`, no server. Follows the viewer's `prefers-color-scheme`; the Ground control
pins paper or charcoal; four specimens are pinned to charcoal on purpose (the portal carrying the
page's ground). Filter by shape and by status.

**Regenerate:** `python3 .planning/sketches/102-modal-census/build.py` (add `--docs` to refresh the
`Overlays` subsection in each page doc; `--artifact PATH` for the published gallery fragment).
`census.py` is the single source of truth; `census.json` and `index.html` are build products.

## The rule this sketch applies

> **An object gets a sheet. A question gets a panel. A choice gets a popover.**
> The seal never sits in a popover. Wax is for a real commitment; bulk gets the plain die.

## The numbers

| | |
|---|---|
| Overlay sites read · census rows | 141 · 120 |
| Built on the primitive | 32 |
| Migrate — legacy inside a house-flagged page today | 10 |
| Owed — an act the rebuilt page does not yet offer | 11 |
| Target — page not yet rebuilt, shape decided | 7 |
| Retires with the legacy page | 42 |
| Delete — nobody imports it | 15 |
| Not a shape (paint, a label) | 3 |
| Drawn: sheets · panels · popovers | 28 · 22 · 10 |
| Behaviours drawn from the research (nothing built) | 22 |

## Files

- **`index.html`** — the census: the shell, then every page in route order, specimens drawn at the
  primitive's real widths (440 · 640 wide · 620 · 320), tombstones for what retires or is deleted,
  the pages that open nothing, the seven forks, the method.
- **`census.py`** — the source of truth. Edit here.
- **`census.json`** — the same data for tools (the page-doc subsections are generated from it).
- **`build.py`** — the builder.
- **`BUILD-PROMPT.md`** — the LLM-ready brief for building these overlays: the rules, the primitive's exact contract, the non-modal class, the ceremonies, five work packets generated from the census, and what "done" means. Paste it whole into a fresh session, or hand one packet to one agent.
- **`research/`** — the research behind the Behaviours section: three angles (A–C), the implementation references (D), the adversary's verdicts (E), the security ceremonies (F) and the lead's own pass over them (G), the deep pass on the assistant's and tool-write ceremonies (H) and its check (I), plus the adversary's brief.

## What to look for

- Does every **Owed** row deserve its shape, or is the house idiom (expand in place) the answer? F5 and F7 are exactly this.
- **/inventory** is the one page whose flag turns on nothing new — legacy and next are the same component, so its eight modals are live inside a house-flagged page today. Are seven migrations the right cost, or does the page get rebuilt first?
- The **studio invite** is the same act as the team invite. Reusing the one exception component keeps the policy at one exception; a second component would trigger ADR 0112's collapse clause (F2).
- Two bells and two user menus exist (F6).

## The forks

- **F1 — Ratify the three shapes.** ADR 0112 is still Proposed. Everything drawn here assumes Sheet · Panel · Popover; if the founder wants one shape everywhere, this census is the list of what that costs (the sheet exists so the list stays readable; an anchored menu with no anchor has lost its meaning). **Answered:** Ratified 2026-09-05 — ADR 0112 is Locked.
- **F2 — The studio invite.** Reuse the one exception component (Popover modal) with a second opener — my recommendation: one component, however many openers, is still one exception — or collapse the policy to two modal shapes as the ADR's revisit clause says. **Answered:** Reuse InviteTeamDialog with a second opener. One component, however many openers, is one exception.
- **F3 — A delivery without an order.** A 640 sheet on /inventory (drawn), or a route under /receipts where the receipts desk already lives. **Answered:** A 640 sheet on /inventory, not a route.
- **F4 — Acts no house surface recreates.** Pause AI on a thread · a person-authored one-tap action or quick-action bookmark · an auction purchase · certifications on file · assign a recommendation to a person. One call per act: delete, or build the drawn shape. **Answered:** All five get built, to their full purpose — functionality, endpoints, UI/UX, smoothness and above all the design (the founder's bar, 2026-09-05). Pause/resume the AI becomes a control on the responses sheet; a person's own one-tap action, an auction lot and certifications are drawn as owed sheets; assigning a recommendation to a person is the fifth, confirmed 2026-09-06.
- **F5 — Where a manual order starts.** The owed 'A new order' sheet on /orders, or from a register row, the palette, or Ask AI — OrdersNext has no create path today. **Answered:** The owed sheet on /orders is the manual entry.
- **F6 — Two bells, two user menus.** Header.tsx's house branch and HouseHeader's HouseBell/HouseUserMenu both exist. Which survives when the house header lands on every page. **Answered:** HouseHeader's bell and user menu survive; Header.tsx's house branch is deleted, its legacy branch stays byte-identical.
- **F7 — The figure behind a dashboard number.** A sheet ('the working', drawn) or the house idiom — the KPI row expands in place. **Answered:** The KPI row expands in place; no overlay.
- **F8 — The non-modal class.** Name peek · hover card · undo toast · bulk bar · the standard bottom sheet as what they are: not shapes (no scrim, no focus trap, never a form, never the seal). ADR 0112's own carve-out allows them; four files asked for them four ways — one amendment, or none. **Answered:** Name the class now — six non-modal surfaces, two constraints (no scrim, no focus trap; never a form, never the seal).
- **F9 — The sheet on a phone.** A bottom sheet with detents (peek / half / full) as the right sheet's phone form, and sheet stacking capped at three with a breadcrumb — one decision covering Apple detents, Material sheets and Vaul snap points together. **Answered:** Yes to both — detents on the phone, stacking capped at three with a breadcrumb.
- **F10 — Undo after, for what can be undone.** Fire the routine act and offer Undo (dismiss, archive, a removed shift, a note); keep the seal before for money, sends and ledger rows. The adversary's fight #4: the line must be written down or it creeps. **Answered:** Yes, with that exact line — undo-after for dismiss, archive, a removed shift, a note; money, sends and ledger rows keep the seal before.
- **F11 — A second authority.** Two ceremonies the research surfaced that the house has not chosen between: a manager's passcode at the point of action (Toast) for staff → manager acts, and presence on shared records (Figma) so a split count is safe. Which acts get which. **Answered:** All three — the manager's passcode, presence on shared records, and a two-person rule for money as the house's own rule — and 'any other possible security like that': a security-ceremonies research pass is running (F12).
- **F12 — Every other security ceremony like that.** The founder's addendum to F11. Twenty-four ceremonies catalogued (research/F), judged by the lead (research/G: 3 rejected — a retired ledger product, JIT sessions for staff, an out-of-band call per payment), six drawn above, and a fit per act proposed below. Decided act by act, not as a set. **Answered:** Every ceremony asked was adopted (2026-09-05 evening), with three amendments from the founder: (1) ceremonies must suit a high-paced operating environment — fast, never a chain; (2) the two-person rule becomes an AUTHORITY rule: one approval when the approver holds valid authority (owner, manager, or a person the owner has authorized), double approval otherwise; (3) any security change — a bank detail, an authority grant, a passcode reset, a limit, a device — is always told to the owners. The door count correction within ten minutes joins F10's list; publishing a week stays sealed. The deeper pass on the assistant's and tool-write ceremonies (research H, checked in I) closed the same night: step-up and the house's passkey seal ship together on web and mobile (never on a device-local prompt); break-glass is reviewed within 48 hours by another owner and the outcome told; any owner may revoke any grant; one tamper-evident security ledger.

## Pages that open nothing

`/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/invite/:code`, `/no-access`, `/privacy`, `/v/:slug`, `/onboarding (redirect)`, `/studio`, `/studio/queue`, `/studio/invite/:token`, `/simpos/:restaurantId (+orders, scenarios)`, `/authorize/:integrationId`, `/inventory-legacy (redirect)`, `/vendor-prices`, `/dev/truth`, `/recommendations/catalog`, `/credits`, `/logs`, `/profile`, `/connections`, `/help`, `/admin`, `/sommelier (HOLD)`, `/services`, `/dev-sandbox (mounts the retiring builders)`, `/calendar-classic`

## The census

| Page | Overlay | Shape | Status | Where the act lives or went | Source |
|---|---|---|---|---|---|
| `shell` | Command palette | panel | Built | A question the reader answers by typing: the middle of the screen, the page dimmed, focus trapped. | `components/command/CommandPalette.tsx:260` |
| `shell` | Ask AI | panel | Built | A question; the answer is a proposal the person still has to hold. | `components/askai/AskAiBar.tsx:166` |
| `shell` | Keyboard shortcuts | panel | Built | A reference the reader consults and dismisses — a panel, never a sheet: there is no object. | `components/command/ShortcutsSheet.tsx:67` |
| `shell` | Recently viewed | panel | Built | A list to jump from. | `components/command/RecentlyViewed.tsx:69` |
| `shell` | The bell | popover | Built | A control's own menu. It never carries the seal (founder, 2026-09-04) — approving from here opens the panel first. | `components/mudavym/HouseBell.tsx:127 survives; components/layout/Header.tsx:147 (the shell header's house branch) is deleted — decided 2026-09-05 (F6); its legacy branch stays byte-identical` |
| `shell` | User menu | popover | Built | A control's own menu. | `components/mudavym/HouseUserMenu.tsx:79 survives; components/layout/Header.tsx:351 is deleted — decided 2026-09-05 (F6)` |
| `shell` | Theme | popover | Built | Dimming the whole page to pick 'Dark' is ceremony; this house rations ceremony. | `components/layout/ThemeMenu.tsx:65` |
| `shell` | Switch location | popover | Built | A choice from a short list, hanging off the control that shows the choice. | `components/layout/RestaurantBranchSwitcher.tsx:80` |
| `shell` | Mobile navigation scrim | — | Not a shape | Paint only (`.mdv-scrim`) — not a shape, and it never was one. | `components/layout/DashboardLayout.tsx:60` |
| `shell` | Nav-rail hint | — | Not a shape | An anchored, non-interactive label, portalled only so it can wear the ground. Not a shape. | `components/layout/Sidebar.tsx:255` |
| `shell` | Header search | — | Retires | The palette is the search. | `components/layout/Header.tsx:464` |
| `/` | The working behind a figure | — | Retires · fork F7 | Decided 2026-09-05 (F7): the KPI row expands in place — 'show the working' under the figure, like DayDetail under the sales calendar. Not an overlay; the expansion is still owed on KpiRow.tsx. | `pages/Dashboard.tsx:1109 — the Vendor Spend · Active Inventory · Pending Orders · Low Stock detail modals; nothing on pages/dashboard/next/KpiRow.tsx opens today` |
| `/` | A one-tap action of your own | sheet | Built · fork F4 | A person's own act is one object on the rail; the rail stays producer-defined otherwise. BUILT 2026-09-06 (packet 2): pages/dashboard/next/OneTapSheet.tsx — write, change and take off the rail against POST/PUT/DELETE /one-tap-actions; the mark carries over, the colour theme does not (one chromatic colour), and the two unbuilt triggers say so. | `components/dashboard/QuickActionsPanel.tsx:332 and pages/Notifications.tsx:1705 (legacy); built by the founder's ruling 2026-09-05` |
| `/` | Add an important date | — | Retires | The calendar's entry sheet — the house has one day-book (ADR 0111). | `components/dashboard/AddImportantDateModal.tsx:125` |
| `/` | Edit a quick action | — | Retires · fork F4 | One-tap actions moved to the dashboard rail (OneTapPanel). A person's own action is built as the sheet drawn above (decided 2026-09-05, F4). | `components/dashboard/QuickActionsPanel.tsx:332` |
| `/` | Daily sales report (a day) | — | Retires | DayDetail expands in place under the sales calendar (pages/dashboard/next/SalesCalendar.tsx:217). | `pages/Dashboard.tsx:1414` |
| `/orders` | What was agreed | panel | Built | A question the house asks before it writes a price. | `pages/orders/next/AgreementSheet.tsx:349` |
| `/orders` | Make this order repeat | panel | Built | A commitment about the future — a question, answered once. | `pages/orders/next/RecurrenceSheet.tsx:222` |
| `/orders` | Vendor answers | sheet · wide | Built | One order's correspondence is one object, read at 640 because letters are prose — the wide case ADR 0112 anticipated. | `pages/orders/next/ResponsesSheet.tsx:353` |
| `/orders` | A new order | sheet | Owed · fork F5 | The order being written is one object. Decided 2026-09-05 (F5): this sheet is the manual entry; owed on OrdersNext. | `pages/orders/CreateOrderModal.tsx:123 and pages/Orders.tsx:2903 (wine config); OrdersNext has only DraftRail (AI drafts) — no manual create path was found` |
| `/orders` | Add a vendor first | panel | Owed | A question with two answers. Travels with the new-order sheet. | `components/orders/OrderGuardModal.tsx:27` |
| `/orders` | Wine config | — | Retires | What was agreed (unit · price · currency) on the ledger row. | `pages/Orders.tsx:2903` |
| `/orders` | Reject this order? | — | Retires | Vendor answers — 'Hold to reject', with the reason in words. | `pages/Orders.tsx:3359 (SealedRejectDie)` |
| `/orders` | Provider comms thread | — | Retires · fork F4 | Vendor answers reads the thread; the composer writes. **Pause / resume the AI on this thread** becomes a control in the responses sheet's head (decided 2026-09-05, F4) — a switch, not an overlay. | `components/orders/CommsThreadDrawer.tsx:436` |
| `/orders` | AI-detected deal | — | Retires | An answer kind inside Vendor answers; 'what the AI read' survives as the provenance line. | `components/orders/DealApprovalModal.tsx:45` |
| `/orders` | Active drafts | — | Retires | /communications lists threads with their drafts; approval is the panel drawn there. | `components/orders/ActiveConversationsPanel.tsx:65` |
| `/orders` | AI draft ready | — | Retires | Drawn on /communications as **The house's reply, drafted** (owed). | `components/orders/DraftEmailApprovalPanel.tsx:130` |
| `/orders` | Recurring order (page) | — | Delete | Recurrence lives on the order (Make this order repeat). Delete. | `pages/RecurringOrders.tsx:530 — nobody imports the page` |
| `/orders` | Record an auction purchase | — | Retires · fork F4 | Built as a fourth start of **Carry this bottle** on /inventory — 'An auction lot' (decided 2026-09-05, F4). The dead file is deleted once that start exists. | `components/orders/AuctionPurchaseModal.tsx:133 — nobody imports it` |
| `/inventory` | Carry this bottle | sheet | Migrate | One bottle entering the book is one object; three ways to start, one sheet. | `components/inventory/AddWineToInventoryModal.tsx:253 (opened at InventoryCommandPage.tsx:1438)` |
| `/inventory` | Carry this bottle · an auction lot | sheet | Owed · fork F4 | The same sheet, a fourth start: an auction bottle is still one bottle entering the book. | `components/orders/AuctionPurchaseModal.tsx:133 (legacy, unreachable); built by the founder's ruling 2026-09-05 as a start of the carry sheet` |
| `/inventory` | Place 14 bottles by their zones? | panel | Migrate | A question about a batch. Bulk, so no wax — the plain die. | `components/inventory/AutoLocatePreviewModal.tsx:70` |
| `/inventory` | A delivery without an order | sheet · wide | Migrate · fork F3 | Lines read as a table; 640 like the composer. Decided 2026-09-05 (F3): a sheet here, not a route. | `components/inventory/ManualReceiptWorkspace.tsx:234` |
| `/inventory` | POS buttons and stock | sheet | Migrate | One queue, worked line by line, the register still visible beneath. | `components/inventory/PosMappingPanel.tsx:294` |
| `/inventory` | Write off 6 bottles? | panel · seal | Migrate | A ledger write is a real commitment — wax. | `components/inventory/RemoveFromInventoryModal.tsx:121` |
| `/inventory` | The zones | sheet | Migrate | The zones are one object the house owns. | `components/inventory/StorageLocationManager.tsx:327` |
| `/inventory` | Spot count | sheet · seal | Migrate | Opened from the row expander; one bottle's count is one record. | `pages/inventory/command/SpotCountPanel.tsx:210 (opened from RowExpansion.tsx:384)` |
| `/inventory` | Receipt record | — | Retires | /receipts is the receipts desk (ReceiptsNext). /inventory links there and never overlays it. | `pages/inventory/command/ReceivingWorkspace.tsx:376` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Carry these bottles (from a menu scan) | sheet | Migrate | The same sheet as /inventory's, opened at its 'menu scan' start. | `pages/cellar/next/WineRegister.tsx imports components/wines/MenuScannerModal.tsx:21 (legacy, fixed-inset)` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Is this the bottle? | panel | Owed | A question the reader must answer before anything is written. | `components/wines/WineValidationModal.tsx:162 · components/wines/AddWineModal.tsx:148 ('Wine detected')` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Photograph the label | panel | Target | A step answered once; the page stays dimmed beneath. | `components/scanner/CameraCapture.tsx:607 — also mounted by /get-started and the orders scanner` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Wine detail | — | Retires | The register row expands in place (sketch 095 — the house pattern for ledger tables). | `pages/WineLibrary.tsx:1297` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Reorder wine | — | Retires | An order is written on /orders (What was agreed · Make this order repeat). | `pages/WineLibrary.tsx:1486` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | How to add (chooser) | — | Retires | The carry sheet's 'Start from'. | `components/wines/AddWineSelectionModal.tsx:33` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Add wine (label photo) | — | Retires | Carry this bottle + Is this the bottle? | `components/wines/AddWineModal.tsx:148` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Add to inventory from the library | — | Retires | Carry this bottle. | `components/wines/AddToInventoryFromLibraryModal.tsx:498` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Dev: manual wine entry | — | Delete | Dev-only. Delete, or move under /dev-sandbox. | `components/wines/DevManualWineEntry.tsx:330` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Dev: label test photos | — | Delete | Dev-only. Delete. | `components/wines/DevWinePhotoUpload.tsx:106` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Add wine (unified chooser) | — | Delete | Dead code. Delete. | `components/wines/AddWineUnifiedModal.tsx:53 — nobody imports it` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Wine research queue | — | Delete | Dead code. Delete. | `components/wines/WineResearchQueue.tsx:225 — nobody imports it` |
| `/providers` | The vendor's twin | sheet | Built | One vendor, opened from the list you can still see. | `pages/providers/next/TwinSheet.tsx:68` |
| `/providers` | A new vendor | sheet | Owed | The vendor being added is one object; the old page split it across three modals. | `components/providers/AddProviderModal.tsx:361 (+ Add Provider Type :629) · components/providers/VendorSearchModal.tsx:161` |
| `/providers` | A vendor you already have? | panel | Owed | A question with two answers before a write. | `components/providers/VendorMatchModal.tsx:108` |
| `/providers` | Edit provider | — | Retires | The twin sheet's edit half; terms on the row. | `components/providers/EditProviderModal.tsx:678` |
| `/providers` | Send message | — | Retires | The composer (letters); the text sender is ADR 0121. | `components/providers/SendMessageSlideOver.tsx:319` |
| `/providers` | Provider card | — | Retires | The twin sheet. | `pages/Providers.tsx:1355` |
| `/providers` | Add provider type | — | Retires | A field inside the new-vendor sheet. | `components/providers/AddProviderModal.tsx:629` |
| `/communications` | A letter from the house | sheet · wide · seal | Built | A letter is prose; 440 minus padding is ~46 characters — the one wide case ADR 0112 anticipated. | `pages/communications/next/Compose/ComposeSheet.tsx:209` |
| `/communications` | Templates | sheet · wide | Built | The library is one object; a template is edited in place inside it. | `pages/communications/next/TemplateSheet.tsx:132` |
| `/communications` | The house's reply, drafted | panel · seal | Owed | A question with the seal — nothing reaches a vendor without a person's hold (ADR 0118). | `components/orders/DraftEmailApprovalPanel.tsx:130 (legacy, on /orders)` |
| `/communications` | Gmail template builder | — | Retires | The composer and the template library (ADR 0118 retires both builders). | `components/documents/GmailTemplateBuilder.tsx:852` |
| `/communications` | SMS template builder | — | Retires | The house's text sender (ADR 0121, research). | `components/documents/SMSTemplateBuilder.tsx:423` |
| `/communications` | Select report type | — | Retires | 'Start from something the house noticed'. | `components/communications/ReportTypeModal.tsx:122` |
| `/communications` | Create category | — | Retires | A template's Purpose. | `components/documents/NewCategoryModal.tsx:112` |
| `/communications` | Switch component type | — | Retires | Builder-internal; goes with the builder. | `components/documents/VariationSelectorModal.tsx:124` |
| `/communications` | Quick Gmail send | — | Retires | The composer. | `components/emails/QuickGmailModal.tsx:238` |
| `/communications` | Send email (saved template) | — | Retires | The composer; the seal on the subdomain, an undo window on the house's own mailbox. | `components/documents/SavedTemplates.tsx:580` |
| `/communications` | Send SMS (saved template) | — | Retires | The text sender (ADR 0121). | `components/documents/SavedSMSTemplates.tsx:619` |
| `/communications` | Template library (new template · sent) | — | Delete | Dead code. Delete. | `components/documents/TemplateLibrary.tsx:606 and :945 — nobody imports it` |
| `/calendar` | The entry | sheet | Built | One entry is one object; the month stays readable beneath. | `pages/calendar/next/EventSheet.tsx:230` |
| `/calendar` | A note from this meeting? | panel | Owed | A question asked once, after the meeting ends (ADR 0111 unifies meetings, notes and reminders). | `pages/calendar/MeetingMemoPrompt.tsx:109` |
| `/calendar` | Ask the day-book | panel | Target | A question — the palette's shape, scoped to one page. | `sketch 098 · ADR 0111 (planned, not built)` |
| `/calendar` | Event modal | — | Retires | The entry sheet. | `pages/calendar/EventModal.tsx:1511 (1,593 lines)` |
| `/calendar` | Mobile sidebar scrim | — | Not a shape | Paint only — not a shape. | `pages/calendar/CalendarPage.tsx:597` |
| `/reports` | Ask the book | panel | Built | A question; the answer is only what the engine already said. | `pages/reports/next/AskTheBook.tsx:94` |
| `/reports` | Insight palette | — | Retires | Ask the book. | `components/reports/organisms/AICommandPalette.tsx:77` |
| `/reports` | KPI spotlight | — | Retires | A cutting is a question and expands in place (sketch 096). | `components/reports/molecules/KPISpotlightView.tsx:507` |
| `/reports` | Arrange charts | — | Delete | The sheet is arranged from the keyboard (sketch 096). Delete. | `components/reports/ChartArrangementModal.tsx:108 — nobody imports it` |
| `/reports` | Configure chart | — | Delete | Dead code. Delete. | `components/reports/ChartConfigModal.tsx:104 — reached only from dead files` |
| `/reports` | Add widget | — | Delete | Dead code. Delete. | `components/reports/DashboardGrid.tsx:361 — nobody imports it` |
| `/reports` | Edit layout | — | Delete | Dead code. Delete. | `components/reports/EditLayoutPanel.tsx:223 — nobody imports it` |
| `/reports` | Widget selector | — | Delete | Dead code. Delete. | `components/reports/WidgetSelector.tsx:119 — nobody imports it` |
| `/reports` | Choose KPI metric · Add KPI card | — | Delete | Dead code. Delete. | `components/reports/organisms/KPISection.tsx:148 and :217 — nobody imports it` |
| `/reports` | Preview overlay | — | Delete | Dead code. Delete. | `components/reports/preview/PreviewOverlay.tsx:73 — nobody imports it` |
| `/documents-reports` | Document preview | — | Retires | The reading pane. | `pages/DocumentsPage.tsx:985` |
| `/notifications` | Approve from the bell | panel · seal | Owed | The bell is a menu; a commitment needs a room that cannot be dismissed by accident. | `ADR 0112, founder answer 2026-09-04 — 'a one-click approval from the bell opens the panel first'; not built` |
| `/notifications` | Notification detail | — | Retires | The row expands in place (`.nt-expand`); a sealed act opens the panel above. | `pages/Notifications.tsx:1513` |
| `/notifications` | Create one-tap action | — | Retires · fork F4 | One-tap actions moved to the dashboard rail; a person-authored action is built as **A one-tap action of your own** on / (decided 2026-09-05, F4). | `pages/Notifications.tsx:1705` |
| `/notifications` | Add vendor deadline | — | Delete | Cutoffs live in vendor terms (ADR 0116). Delete. | `components/notifications/VendorDeadlineSettings.tsx:184 — nobody imports it` |
| `/recommendations` | Who takes this? | popover | Owed · fork F4 | A choice from a short list, anchored to the entry's control. **Confirmed by the founder 2026-09-06**: the fifth F4 act is built like the other four — the docket keeps assignment, and the roster it reads is the team's. | `pages/Recommendations.tsx:980 — not on the rebuilt docket` |
| `/settings` | Add a location | sheet | Built | One location being written. | `components/locations/AddLocationDialog.tsx:185 (opened at pages/settings/next/LocationsSection.tsx)` |
| `/settings` | New chain | sheet | Built | One chain being written. | `components/locations/CreateChainDialog.tsx:121` |
| `/settings` | Edit location | sheet | Built | One location's record. | `components/locations/EditLocationChainDialog.tsx:134` |
| `/settings` | Add to Meyhane Sim | panel | Built | A question about which. | `components/locations/AssignToChainDialog.tsx:106` |
| `/settings` | Share this with the engine? | panel | Migrate | A question. Settings stay asserted, not sealed (2026-09-04). | `components/settings/ConsentDialog.tsx:71 (opened from components/settings/ServicesPermissions.tsx:300)` |
| `/settings` | Carry your vendors to the new location? | panel | Migrate | A question about a batch, asked once after a write. | `components/providers/BranchProviderTransferModal.tsx:109` |
| `/team` | People | sheet | Built | The roster is one object. | `pages/team/next/RosterSheet.tsx:219` |
| `/team` | On the roster | sheet | Built | One person's record. | `pages/team/next/RosterSheet.tsx:392 (MemberSheet)` |
| `/team` | Edit this shift | sheet | Built | One shift's record; the week stays visible beneath. | `pages/team/next/ShiftSheet.tsx:98` |
| `/team` | Publish this week | panel · seal | Built | A commitment the whole crew sees — wax. | `pages/team/next/TeamOverlays.tsx:90 (PublishPanel)` |
| `/team` | Copy last week | panel · seal | Built | A question about a batch that overwrites — the hold, because it replaces. | `pages/team/next/TeamOverlays.tsx:167 (CopyWeekPanel)` |
| `/team` | A note to the crew | sheet | Built | One note with its receipts. | `pages/team/next/TeamOverlays.tsx:519 (CrewNoteSheet)` |
| `/team` | Time off | sheet | Built | The requests are one register. | `pages/team/next/TeamOverlays.tsx:640 (TimeOffSheet)` |
| `/team` | Export the week | popover | Built | A control's own menu. | `pages/team/next/TeamOverlays.tsx:828 (ExportPopover)` |
| `/team` | Shift actions | popover | Built | A row's own menu. | `pages/team/next/WeekGrid.tsx:424` |
| `/team` | What changed here | sheet | Built | The audit trail of one record. | `pages/team/next/TeamRecord.tsx:273 (TrailSheet)` |
| `/team` | Invite a team member | popover · modal | Built | Anchored under its button like a popover, but a form that commits — so it traps focus and dims. The one exception; the studio invite reuses this component (F2, 2026-09-05). | `components/team/InviteTeamDialog.tsx:199 — 'Popover modal', the one exception ADR 0112 names; also opened from /get-started and /settings` |
| `/team` | Certifications on file | sheet | Owed · fork F4 | One person's certificates are one record; opened from the roster row. | `pages/team/command/OpsRulesPanel.tsx:37 (legacy desk); team_certifications has no role or applies-to column; built by the founder's ruling 2026-09-05` |
| `/team` | Desk row menu | — | Retires | Shift actions, Publish this week, Copy last week. | `pages/team/command/ManagerShiftDesk.tsx:868` |
| `/team` | Desk message composer | — | Retires | A note to the crew. | `pages/team/command/ManagerShiftDesk.tsx:981` |
| `/team` | Desk confirm sheet | — | Retires | Publish this week · Copy last week. | `pages/team/command/ManagerShiftDesk.tsx:1061` |
| `/team` | Desk people sheet | — | Retires | People (the roster sheet). | `pages/team/command/ManagerShiftDesk.tsx:1132` |
| `/team` | Desk editors | — | Retires | Edit this shift · On the roster. | `pages/team/command/editors.tsx:23` |
| `/team` | Ops rules | — | Retires · fork F4 | The first-rule form is inline on the rebuilt page (ADR 0089). **Certifications** are built as the sheet drawn above (decided 2026-09-05, F4). | `pages/team/command/OpsRulesPanel.tsx:37` |
| `/team` | Import shift configurations | — | Delete | No import route exists. Delete with the desk. | `components/team/ShiftImportModal.tsx:135 — opened only from the legacy desk` |
| `/promotions` | The offer | sheet | Target | One offer is one object. | `pages/Promotions.tsx:336` |
| `/promotions` | Offer menu | popover | Target | A row's own menu. | `pages/Promotions.tsx:328` |
| `/distributors` | Distributor detail | sheet | Target | One distributor is one object. | `pages/distributors/command/DistributorDrawer.tsx:125` |
| `/studio/certify` | Invite a contributor | popover · modal | Target · fork F2 | The same act as Invite a team member. Decided 2026-09-05 (F2): the same component — InviteTeamDialog's Popover modal — with a second opener; one component, however many openers, is one exception. | `pages/studio/certify/InviteDialog.tsx:106 (Radix dialog today)` |
| `/admin/health` | Live payload | sheet | Target | One response is one object; reading it wants the page beside it. | `pages/AdminHealth.tsx:226` |
| `behaviours` | Peek beside the list | peek | Behaviour | For the 80% of glance-then-move-on lookups, a sheet is too much and a hover card too little. It is not a fourth shape: it has no scrim and traps nothing — the non-modal class ADR 0112's carve-out allows, named (fork F8). | `Linear — Peek (https://linear.app/docs/peek) · adversary A1: ADAPT, name it non-modal` |
| `behaviours` | The palette with pages and one argument | panel | Behaviour | One command box drills into a picker instead of a long tail of small popovers. The adversary's cap: a command that wants three arguments is a disguised form and belongs in a panel or a sheet. | `Raycast arguments (https://developers.raycast.com/information/lifecycle/arguments) · cmdk pages (https://dip-cmdk.mintlify.app/guides/nested-items) · adversary A3 KEEP, A4 ADAPT (cap at one argument)` |
| `behaviours` | A hover card on a referenced name | hover | Behaviour | Hovering substitutes for navigating: the reader confirms 'is this the right one' without leaving the row. Non-modal, dismissed by moving; its own menu is open/copy-link only, never a form. | `GitHub hovercards (https://github.blog/changelog/2018-10-08-issue-and-pull-request-hovercards/) · Notion hover preview · adversary A15/A16 KEEP` |
| `behaviours` | Undo after, for what can be undone | toast | Behaviour | Fire the routine act, offer the way back — instead of a panel before it. Scoped hard: dismissals, archives, a removed shift, a note. Never money, never a send, never a ledger row: those keep the seal before (fork F10). | `Linear undo (https://linear.app/changelog/undo-actions) · Sonner (https://sonner.emilkowal.ski/toast) · adversary A6/D5: ADAPT — reversible, non-money, non-send only` |
| `behaviours` | Approve, then release | panel · seal | Behaviour | Ramp separates chain approval from the payer's release; the house already lists them as separate commitments. Drawn so the second seal is seen, not assumed. | `Ramp Bill Pay approvals (https://support.ramp.com/bill-pay-approvals) · adversary B16 KEEP, verified` |
| `behaviours` | Why this was flagged, on the row | inplace | Behaviour | Every figure names its rows; every flag names the rule it tripped, on the object itself — never in a separate log the approver has to go and find. | `Ramp flagging (https://support.ramp.com/hc/en-us/articles/4417662594195-Flagging-transactions-Accidental-purchase-fraud-and-out-of-policy) · adversary B14 KEEP` |
| `behaviours` | Select many, one plain bar | bar | Behaviour | Bulk gets the plain die: a bar at the bottom, no scrim, no seal. The house rule already says so; this is only the mechanic. | `Linear select issues (https://linear.app/docs/select-issues) · adversary A17/B21 KEEP — adopt the fuller keyboard spec` |
| `behaviours` | A manager's passcode at the point of action | panel | Behaviour | The restaurant industry's own second-authority ceremony: superior authority, completed in seconds at the point of action — not a multi-step chain. A different thing from a two-person rule; the founder should choose which acts get which (fork F11). | `Toast POS discounts — manager passcode prompt (https://support.toasttab.com/en/article/Basic-Discount-Configuration) · adversary §6: MISSED by all four files` |
| `behaviours` | Suggested edits, not applied edits | inplace | Behaviour | The best structural proof that 'a draft never looks sent' is buildable: nothing is touched until a person disposes of each suggestion. Provenance is a colour that never fades. | `Notion suggested edits (https://www.notion.com/help/suggested-edits) · Granola black/grey (https://www.granola.ai/blog/how-to-use-ai-to-take-meeting-notes) · adversary C9 KEEP (verified), C16 KEEP` |
| `behaviours` | Ask about this, with its sources | sheet | Behaviour | Every sentence cites a row or says 'no data'. Sources stream with the answer, not after it — an absence is reported as an absence. | `Grounded Q&A scoped to one object (adversary C10 KEEP) · Perplexity streaming citations (https://docs.perplexity.ai/docs/cookbook/articles/streaming-citations/README) · C15 KEEP` |
| `behaviours` | A proposal you accept line by line, sealed once | panel · seal | Behaviour | Three granularities of accept are right; a plain 'Accept all' button is wrong when the apply is a real commitment. The ticks choose, the seal commits (ADR 0113). | `GitHub Copilot Edits per-hunk accept (https://learn.microsoft.com/visualstudio/ide/copilot-edits) · adversary C1 ADAPT — the batch resolves to one seal` |
| `behaviours` | The door's sheet rests at three heights | bottom | Behaviour | On a phone the right sheet becomes a bottom sheet — same object, same head, same close-in-words — resting at detents instead of a fixed 440. Four files asked for this four ways; it is one decision (fork F9). | `Apple HIG sheets and detents · Material bottom sheets (https://m2.material.io/components/sheets-bottom/android) · Vaul snap points (https://www.npmjs.com/package/vaul/v/1.0.0) · adversary C18/C19/D1: ADAPT — ONE decision` |
| `behaviours` | Swipe up to record it; the stamp at the end | bottom · seal | Behaviour | The founder's own ask, proven at scale in a high-stakes app: review, then one deliberate gesture; the house's stamp completes it. On desktop the same act is the hold. | `Robinhood swipe-up-to-submit (https://robinhood.com/us/en/support/articles/selling-a-stock/) — swipe confirmed, haptic detail dropped by the adversary (C20 ADAPT)` |
| `behaviours` | Queued is never confirmed | inplace | Behaviour | The right vocabulary for the door: four states, each unmistakable. An absence (no signal) is reported as what it is. | `WhatsApp offline queue and tick ladder · adversary C24 KEEP` |
| `behaviours` | Who else has this open | sheet | Behaviour | Concurrency is not the failure mode — invisibility is. A presence line on shared records makes a split count safe (fork F11). | `Figma presence and multiplayer (https://help.figma.com/hc/en-us/articles/360040449713) · adversary §6: MISSED — answers B's own concurrent-count gap` |
| `behaviours` | The invoice beside the order, cell by cell | inplace | Behaviour | Both cited products do this in place, not in a popup — the founder's own 'side-by-side inside an overlay' ask is answered by rule 6: the row expands and shows its working. | `Ramp PO matching · Restaurant365 discrepancy view · Toast AI invoice scanning split view (https://support.toasttab.com/en/article/Get-Started-With-AI-Invoice-Scanning) · adversary B17/B-R2 KEEP` |
| `behaviours` | Step up before the money moves | panel | Behaviour | A device left unlocked is the common failure; re-authentication at the moment of a real commitment closes it without touching routine work. | `GitHub sudo mode (https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/sudo-mode) — fetched, holds: two hours; password, passkey or 2FA · G: ADAPT` |
| `behaviours` | What the seal bound | inplace | Behaviour | The provable seal made visible: what was bound, by whom, and the link to the record before it. Verifiable after the fact, not asserted. | `FIDO Secure Payment Confirmation (https://fidoalliance.org/white-paper-secure-payment-confirmation/) — fetched, holds: amount and payee signed by the authenticator (PSD2 dynamic linking) · AWS CloudTrail digest chain (https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html) · G: KEEP` |
| `behaviours` | A new bank detail waits | panel · seal | Behaviour | Vendor-impersonation is the single highest-fraud act on the list; a rare ceremony is worth it precisely because it is rare. The house's own separation of duties in one line. | `City National Bank dual control and call-back (https://www.cnb.com/business-banking/insights/what-is-dual-approval.html) · UK Finance Confirmation of Payee (https://www.ukfinance.org.uk/policy-and-guidance/guidance/confirmation-payee) · G: ADAPT — bank-detail changes only, never every new vendor` |
| `behaviours` | Held for a look | inplace | Behaviour | A velocity check adds nothing to the common case and names its reason on the row when it trips — the house's rule for flags, applied to money. | `Stripe Radar rules and review (https://docs.stripe.com/radar/rules) · Ramp limits (https://support.ramp.com/hc/en-us/articles/10881975647763-Card-limits-and-spend-programs) · G: KEEP, silent on the common case` |
| `behaviours` | The door tablet locks itself | bottom | Behaviour | A shared device left open hands every person's authority to whoever picks it up; an idle lock is what makes the passcode ceremony mean anything. | `Toast POS screen timeout (https://support.toasttab.com/en/article/Adjust-POS-Screen-Timeout) · Square passcodes at the point of sale (https://squareup.com/help/us/en/article/8357-require-passcodes-at-point-of-sale) · G: KEEP — the precondition for the manager's passcode` |
| `behaviours` | Break the glass | panel · seal | Behaviour | Emergency access exists in every serious system; the house's version is owner-only, written down, and loud — never a quiet backdoor. | `AWS Well-Architected break-glass procedures (https://docs.aws.amazon.com/wellarchitected/latest/devops-guidance/ag.sad.5-implement-break-glass-procedures.md) · G: ADAPT — rare, reasoned, told to everyone` |

## Method

Tree: feat/mudavym-design-p4 @ origin tip, read 2026-09-05. Every `.tsx` under `apps/web/src` (tests and stories excluded) was scanned
for a JSX `<Sheet>` / `<Panel>` / `<Popover>` whose import resolves to `components/mudavym`, a
`fixed inset-0` or `position: fixed` wrapper, and a Radix `*Content`. That gave 141 sites across
25 house files and 69 legacy files, folded into 117 overlays; the founder's rulings of 2026-09-05
added three owed sheets, so the census holds 120 rows. Each site was then read by hand for what it does and who opens
it. Page-local components that merely share a name (`ReportsNext`'s cutting `Sheet`, the dashboard
rail's `Panel`, the door's local `Panel`) were excluded; files nobody imports were checked twice
(`rg` for their basename across `apps/web/src`). The house branches inside the eight shell files
count once each. Widths and the close-in-words rule come from `components/mudavym/Sheet.tsx` and
`sheet.css`.

**Example data, not a tenant** — every name, figure and date in the specimens is invented for the drawing.
