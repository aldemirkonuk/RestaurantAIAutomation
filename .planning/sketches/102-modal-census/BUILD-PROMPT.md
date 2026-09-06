# Build prompt — the overlays of Mudavym

*Generated from `census.py` by `build.py`. Edit the census or `build.py`, never this file.*
*Paste the whole file into a fresh Claude Code session at the repo root, or hand one `##`
packet to one agent. Every number and path below was read from the tree on 2026-09-05.*

---

## 0. Who you are, and what you are building

You are building the overlay layer of **Mudavym**, an autonomous restaurant-operations platform
(a Vite + React SPA in `apps/web`, a NestJS gateway in `apps/api-gateway`, Supabase Postgres, a
React Native app in `apps/mobile`). An "overlay" is anything that appears over the page: a record's
detail, a question, a menu, a preview, a toast.

The policy is **locked** — [`.planning/decisions/0112-one-modal-policy-three-shapes-one-primitive.md`](../../decisions/0112-one-modal-policy-three-shapes-one-primitive.md).
You are not designing it. You are building what it decided, to the founder's bar:

> *"everything we touch, they have must all fully serve to their purpose to their max capacity
> meaning functionality, endpoints, UI UX, smoothness, and most importantly the design."*

A re-skin of an old modal fails that bar. So does a beautiful surface over a dead endpoint.

**Read before you write anything** (in this order, and do not skip the third):

1. `.planning/decisions/0112-one-modal-policy-three-shapes-one-primitive.md` — the policy, the
   twelve founder rulings, the security fit per act.
2. `apps/web/src/components/mudavym/Sheet.tsx` and `sheet.css` — the primitive you are using.
   Its header comments carry the reasoning; the numbers below are read from it.
3. `.planning/sketches/102-modal-census/index.html` — **every overlay drawn**, at the primitive's
   real widths, with its source and the reason for its shape. Open it. Your packet is drawn there.
4. `.planning/06-pages/<page>.md` §1a, §9, §13 and the `Overlays` subsection — the page you are
   touching, in the house's own words.

---

## 1. The rules. Break one and the work is rejected

1. **Three shapes, chosen by what the reader must do next.** An object gets a **Sheet** (right,
   440px; 640 with `wide` for a letter). A question gets a **Panel** (centred, 620px). A choice
   gets a **Popover** (anchored, 320px). Never by how much content there is, never by which page.
2. **One primitive.** `components/mudavym/Sheet.tsx` exports `Sheet`, `Panel`, `Popover`. It owns
   focus (moves in on open, cycles on Tab, returns to the opener on close), Esc, the counted body
   scroll lock, the scrim, the portal and the ground. **Never hand-roll `fixed inset-0`.** Never
   add a fourth modal shape.
3. **The seal is rationed.** A real commitment (approving an order, releasing a payment, writing
   off stock, recording a count, publishing a week, sending a letter) ends with `HoldToApprove` —
   the wax. Bulk gets a plain button. **The seal never sits in a Popover**: an approval reached
   from the bell opens the Panel first.
4. **The close control is words** (`closeLabel`, default "Close"), never an X. The house never
   invented a glyph and does not start now.
5. **AI proposes, a person applies.** A suggestion is a layer on the record, never an
   already-changed cell. The person's words stay ink; the engine's stay grey, permanently.
   A draft never looks sent.
6. **Absence is never health.** No invented zero, no placeholder figure, no cheerful empty state
   that hides a missing read. Every figure names the rows it summed; every flag names the rule it
   tripped; when the book holds nothing, the overlay says so in words.
7. **A page with its flag off renders byte-for-byte as it always has.** Every house branch is
   gated. `shellOverlays.test.tsx` pins the literal legacy class strings — if you change a legacy
   branch, that test must fail, and you must stop.
8. **One chromatic colour** (İznik teal, `--seal`) on paper or Warm Charcoal ink. **No emoji,
   anywhere** — a guard checks. Tokens only, never a literal hex.
9. **The house idiom is expansion.** If the reader stays on the list, expand the row in place and
   show the working; open a surface only when the reader leaves the list behind.
10. **Ceremony is seconds.** Hold is intent; a device prompt is identity; never stack a third
    confirmation. The reason field appears only on break-glass.

---

## 2. The primitive, exactly

```tsx
import { Sheet, Panel, Popover } from '@/components/mudavym';

<Sheet
  open={!!row} onClose={() => setRow(null)}
  label="Order 118"                 // required: an accessible name; an overlay with no name is a room with no sign
  eyebrow="Vendor answers"          // mono, uppercase, seal-deep — what kind of thing this is
  title="Öküzgözü 2022"             // Fraunces — the product speaking
  action={<button …/>}              // header-right, left of Close
  footer={<span>…</span>}           // the quiet line under the body
  wide                              // 640 instead of 440. A LETTER only (sketch 100). A third width needs an ADR.
  closeLabel="Close"                // words
  initialFocusRef={ref}             // defaults to the first focusable
  zIndex={100}                      // default 100
>{children}</Sheet>
```

`Popover` additionally takes `anchorRef` (required) and `width` (default 320), and is **non-modal**
by default. `modal` on a Popover restores the trap, the lock and the dim — the system has **one**
such exception, `components/team/InviteTeamDialog.tsx` (a form that commits, anchored under its
button). The studio invite reuses that same component with a second opener; a second *component*
wanting `modal` is the signal to collapse the policy, and you stop and ask.

**Geometry and motion, from `sheet.css` and `lib/mudavym/motion.ts`:**

| Shape | Width | Enter | Token | ms |
|---|---|---|---|---|
| Sheet | 440 (`wide` 640), full-bleed under 640px viewport | `translateX(28px)` → none | `tuck` | 300 |
| Panel | `min(620px, 100vw − 32px)`, `margin-top: 10vh`, `max-height: 76vh` | `translateY(6px)` → none | `settle` | 320 |
| Popover | 320, `max-height: 72vh`, placed 10px under the anchor | `translateY(4px)` → none | `ink` | 160 |

`prefers-reduced-motion` renders **no** animation, not a shorter one. The panel's flex is
`align-items: flex-start` and the body is `flex: 0 1 auto` — both load-bearing: `stretch` made an
overlay holding one sentence render as 700px of empty paper.

**The ground is a DOM fact.** Tokens live on `.mudavym`, never `:root`, so a portalled node has no
tokens unless its own root carries `.mudavym` and, on charcoal, `data-ground` on that same element.
The primitive resolves most-specific-first: an explicit `ground` prop → `MudavymGroundContext` →
the nearest `.mudavym` ancestor of the opener → the shell store. Each reader returns `null` rather
than a paper default, because a default there is an absence reported as an answer.

**The shell gate.** `lib/mudavym/shellGround.ts` is a tiny external store `PageGate` claims while a
`next` tree is mounted. The eight shared shell overlays render the house shape only while it is on.
Nothing else writes to that store.

**The flag.** Every rebuilt page sits behind `mudavym_design_<page>`, a per-restaurant row in
`restaurant_feature_flags` read through `lib/mudavym/useMudavymDesign.ts` (`MUDAVYM_PAGES`). The
dev override is `localStorage['mudavym.design.<page>'] = '1'`. **Adding a slug shifts the readBy
anchor** — run `python3 scripts/check_flag_readby_anchors.py` after any `MUDAVYM_PAGES` edit.

---

## 3. The non-modal class (decided 2026-09-05, fork F8)

Six surfaces are **not shapes** and do not count against the three. Two constraints bind all six:
**no scrim and no focus trap; never a form and never the seal.**

- **Peek** — 400px beside the list. Space opens, ↑↓ step rows, Enter promotes it to the Sheet, Esc
  closes. The list stays live behind it.
- **Hover card** — 300px on a referenced name; dismissed by moving away; its own menu is
  open/copy-link only.
- **Undo toast** — the act fires, the way back is offered for a few seconds.
- **Bulk bar** — `x` toggles, `⇧` ranges, `⌘A` all, `Esc` clears; a plain button, never wax.
- **Bottom sheet** — the Sheet's phone form, resting at detents (peek · half · full; the grabber
  appears only when there is more than one height). Stacked sheets cap at **three**, with a
  breadcrumb.
- **The expanded row** — the house idiom; rule 9 above.

**Undo-after applies to a closed list** (fork F10): dismiss an entry, archive a thread, remove a
shift, a note, and a door count corrected within ten minutes. **Money, sends and ledger rows keep
the seal before.** Adding to that list is an ADR amendment, never a builder's call.

---

## 4. Authority and the ceremonies (forks F11–F12)

- **The authority rule.** One approval when the approver holds valid authority — an owner, a
  manager, or a person the owner authorized — and **double approval otherwise**. Separation of
  duties survives inside it: whoever confirms a vendor's bank detail cannot release the first
  payment to it.
- **Every security change is told to every owner** — a bank detail, an authority grant or
  revocation, a passcode reset, a limit change, a device added. A producer, not a ceremony.
- **Step-up** before money moves or a config applies when the session's last verification is older
  than two hours, read from a timestamp the gateway persists per session (Supabase has no
  `auth_time`; its JWT carries `amr`). A successful seal re-arms the window.
- **The seal proves who**: a house-owned WebAuthn ceremony — the hold begins, the server mints a
  single-use challenge encoding `hash(nonce ‖ amount ‖ payee ‖ order ‖ expiry)`, the release calls
  `navigator.credentials.get` with `userVerification: "required"`, the server verifies and consumes
  it. Web and mobile ship together. **Never build the mobile seal on `expo-local-authentication`** —
  a device-local prompt proves nothing to a server.
- **Break-glass**: owner-only, a written reason, every owner told at the moment, marked in the
  trail, reviewed within 48 hours by another owner, and the outcome told.
- **Grants** are rows: grantor, grantee, scope, limit, expiry, revoked-at, with *granted by* visible
  wherever the authority is used; expiry enforced server-side; grantor ≠ approver enforced in the
  database. Any owner may revoke any grant.
- **One tamper-evident `security_events` ledger.** Step-up verifications, break-glass uses and
  grant checks all write to it; the trail and the owners' notices read from it.

---

## 5. Build order

1. **The ten migrations** — legacy overlays rendering *inside* a house-flagged page today. Eight
   are on `/inventory`, whose flag turns on the same component (`App.tsx:311`), so a tenant with
   that flag on already sees them. This is the only packet with a live inconsistency in it.
2. **The twelve owed acts** — what a rebuilt page cannot yet do that its legacy page could.
3. **The seven targets** — pages not yet rebuilt whose overlays take their shape when they are.
4. **The fifteen deletions** — after 1–3 land, so nothing is deleted before its replacement exists.
5. **The behaviours** — the non-modal class and the ceremonies, each its own ADR-amendment-sized
   piece of work.

---


## 6. Packet 1 — the ten migrations

These render legacy markup inside a house-flagged page **today**. Move each onto the primitive, shape as given, copy and behaviour preserved word for word unless the census says otherwise. `/inventory` is the urgent one: its flag turns on the same component, so a tenant with it on sees these now.

**`/inventory`** — flag `mudavym_design_inventory`

- **Carry this bottle** — sheet. One bottle entering the book is one object; three ways to start, one sheet.
  `components/inventory/AddWineToInventoryModal.tsx:253 (opened at InventoryCommandPage.tsx:1438)`
- **Place 14 bottles by their zones?** — panel. A question about a batch. Bulk, so no wax — the plain die.
  `components/inventory/AutoLocatePreviewModal.tsx:70`
- **A delivery without an order** — sheet · wide. Lines read as a table; 640 like the composer. Decided 2026-09-05 (F3): a sheet here, not a route.
  `components/inventory/ManualReceiptWorkspace.tsx:234`
- **POS buttons and stock** — sheet. One queue, worked line by line, the register still visible beneath.
  `components/inventory/PosMappingPanel.tsx:294`
- **Write off 6 bottles?** — panel · seal. A ledger write is a real commitment — wax.
  `components/inventory/RemoveFromInventoryModal.tsx:121`
- **The zones** — sheet. The zones are one object the house owns.
  `components/inventory/StorageLocationManager.tsx:327`
- **Spot count** — sheet · seal. Opened from the row expander; one bottle's count is one record.
  `pages/inventory/command/SpotCountPanel.tsx:210 (opened from RowExpansion.tsx:384)`

**`/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks`** — flag `mudavym_design_cellar`

- **Carry these bottles (from a menu scan)** — sheet. The same sheet as /inventory's, opened at its 'menu scan' start.
  `pages/cellar/next/WineRegister.tsx imports components/wines/MenuScannerModal.tsx:21 (legacy, fixed-inset)`

**`/settings`** — flag `mudavym_design_settings`

- **Share this with the engine?** — panel. A question. Settings stay asserted, not sealed (2026-09-04).
  `components/settings/ConsentDialog.tsx:71 (opened from components/settings/ServicesPermissions.tsx:300)`
- **Carry your vendors to the new location?** — panel. A question about a batch, asked once after a write.
  `components/providers/BranchProviderTransferModal.tsx:109`


## 7. Packet 2 — the twelve owed acts

A rebuilt page cannot do something its legacy page could. Build the act, not a shell: the endpoint, the four states, the provenance, the ceremony. Several need a gateway route that does not exist yet — say so and build it.

**`/inventory`** — flag `mudavym_design_inventory`

- **Carry this bottle · an auction lot** — sheet. The same sheet, a fourth start: an auction bottle is still one bottle entering the book.
  `components/orders/AuctionPurchaseModal.tsx:133 (legacy, unreachable); built by the founder's ruling 2026-09-05 as a start of the carry sheet`

**`/calendar`** — flag `mudavym_design_calendar`

- **A note from this meeting?** — panel. A question asked once, after the meeting ends (ADR 0111 unifies meetings, notes and reminders).
  `pages/calendar/MeetingMemoPrompt.tsx:109`

**`/recommendations`** — flag `mudavym_design_recommendations`

- **Who takes this?** — popover. A choice from a short list, anchored to the entry's control. **Confirmed by the founder 2026-09-06**: the fifth F4 act is built like the other four — the docket keeps assignment, and the roster it reads is the team's.
  `pages/Recommendations.tsx:980 — not on the rebuilt docket`

**`/team`** — flag `mudavym_design_team`

- **Certifications on file** — sheet. One person's certificates are one record; opened from the roster row.
  `pages/team/command/OpsRulesPanel.tsx:37 (legacy desk); team_certifications has no role or applies-to column; built by the founder's ruling 2026-09-05`


## 8. Packet 3 — the seven targets

Pages not yet rebuilt. Do not rebuild the page to do these; take the shape when the page's own rebuild happens, and leave the drawing as the contract.

**`/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks`** — flag `mudavym_design_cellar`

- **Photograph the label** — panel. A step answered once; the page stays dimmed beneath.
  `components/scanner/CameraCapture.tsx:607 — also mounted by /get-started and the orders scanner`

**`/calendar`** — flag `mudavym_design_calendar`

- **Ask the day-book** — panel. A question — the palette's shape, scoped to one page.
  `sketch 098 · ADR 0111 (planned, not built)`

**`/promotions`**

- **The offer** — sheet. One offer is one object.
  `pages/Promotions.tsx:336`
- **Offer menu** — popover. A row's own menu.
  `pages/Promotions.tsx:328`

**`/distributors`**

- **Distributor detail** — sheet. One distributor is one object.
  `pages/distributors/command/DistributorDrawer.tsx:125`

**`/studio/certify`**

- **Invite a contributor** — popover · modal. The same act as Invite a team member. Decided 2026-09-05 (F2): the same component — InviteTeamDialog's Popover modal — with a second opener; one component, however many openers, is one exception.
  `pages/studio/certify/InviteDialog.tsx:106 (Radix dialog today)`

**`/admin/health`**

- **Live payload** — sheet. One response is one object; reading it wants the page beside it.
  `pages/AdminHealth.tsx:226`


## 9. Packet 4 — the fifteen deletions

Files nobody imports, or whose act now lives somewhere built. Before deleting: grep the basename across `apps/web/src` to confirm nothing imports it, and state in the commit what the act does now instead.

**`/orders`** — flag `mudavym_design_orders`

- **Recurring order (page)** — —. Recurrence lives on the order (Make this order repeat). Delete.
  `pages/RecurringOrders.tsx:530 — nobody imports the page`

**`/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks`** — flag `mudavym_design_cellar`

- **Dev: manual wine entry** — —. Dev-only. Delete, or move under /dev-sandbox.
  `components/wines/DevManualWineEntry.tsx:330`
- **Dev: label test photos** — —. Dev-only. Delete.
  `components/wines/DevWinePhotoUpload.tsx:106`
- **Add wine (unified chooser)** — —. Dead code. Delete.
  `components/wines/AddWineUnifiedModal.tsx:53 — nobody imports it`
- **Wine research queue** — —. Dead code. Delete.
  `components/wines/WineResearchQueue.tsx:225 — nobody imports it`

**`/communications`** — flag `mudavym_design_communications`

- **Template library (new template · sent)** — —. Dead code. Delete.
  `components/documents/TemplateLibrary.tsx:606 and :945 — nobody imports it`

**`/reports`** — flag `mudavym_design_reports`

- **Arrange charts** — —. The sheet is arranged from the keyboard (sketch 096). Delete.
  `components/reports/ChartArrangementModal.tsx:108 — nobody imports it`
- **Configure chart** — —. Dead code. Delete.
  `components/reports/ChartConfigModal.tsx:104 — reached only from dead files`
- **Add widget** — —. Dead code. Delete.
  `components/reports/DashboardGrid.tsx:361 — nobody imports it`
- **Edit layout** — —. Dead code. Delete.
  `components/reports/EditLayoutPanel.tsx:223 — nobody imports it`
- **Widget selector** — —. Dead code. Delete.
  `components/reports/WidgetSelector.tsx:119 — nobody imports it`
- **Choose KPI metric · Add KPI card** — —. Dead code. Delete.
  `components/reports/organisms/KPISection.tsx:148 and :217 — nobody imports it`
- **Preview overlay** — —. Dead code. Delete.
  `components/reports/preview/PreviewOverlay.tsx:73 — nobody imports it`

**`/notifications`** — flag `mudavym_design_notifications`

- **Add vendor deadline** — —. Cutoffs live in vendor terms (ADR 0116). Delete.
  `components/notifications/VendorDeadlineSettings.tsx:184 — nobody imports it`

**`/team`** — flag `mudavym_design_team`

- **Import shift configurations** — —. No import route exists. Delete with the desk.
  `components/team/ShiftImportModal.tsx:135 — opened only from the legacy desk`


## 10. Packet 5 — the behaviours

The non-modal class and the ceremonies, drawn in the sketch. Each is a piece of foundation work, not a page change: build it once in `components/mudavym`, prove it with its own spec, then adopt it page by page.

**`behaviours`**

- **Peek beside the list** — peek. For the 80% of glance-then-move-on lookups, a sheet is too much and a hover card too little. It is not a fourth shape: it has no scrim and traps nothing — the non-modal class ADR 0112's carve-out allows, named (fork F8).
  `Linear — Peek (https://linear.app/docs/peek) · adversary A1: ADAPT, name it non-modal`
- **The palette with pages and one argument** — panel. One command box drills into a picker instead of a long tail of small popovers. The adversary's cap: a command that wants three arguments is a disguised form and belongs in a panel or a sheet.
  `Raycast arguments (https://developers.raycast.com/information/lifecycle/arguments) · cmdk pages (https://dip-cmdk.mintlify.app/guides/nested-items) · adversary A3 KEEP, A4 ADAPT (cap at one argument)`
- **A hover card on a referenced name** — hover. Hovering substitutes for navigating: the reader confirms 'is this the right one' without leaving the row. Non-modal, dismissed by moving; its own menu is open/copy-link only, never a form.
  `GitHub hovercards (https://github.blog/changelog/2018-10-08-issue-and-pull-request-hovercards/) · Notion hover preview · adversary A15/A16 KEEP`
- **Undo after, for what can be undone** — toast. Fire the routine act, offer the way back — instead of a panel before it. Scoped hard: dismissals, archives, a removed shift, a note. Never money, never a send, never a ledger row: those keep the seal before (fork F10).
  `Linear undo (https://linear.app/changelog/undo-actions) · Sonner (https://sonner.emilkowal.ski/toast) · adversary A6/D5: ADAPT — reversible, non-money, non-send only`
- **Approve, then release** — panel · seal. Ramp separates chain approval from the payer's release; the house already lists them as separate commitments. Drawn so the second seal is seen, not assumed.
  `Ramp Bill Pay approvals (https://support.ramp.com/bill-pay-approvals) · adversary B16 KEEP, verified`
- **Why this was flagged, on the row** — inplace. Every figure names its rows; every flag names the rule it tripped, on the object itself — never in a separate log the approver has to go and find.
  `Ramp flagging (https://support.ramp.com/hc/en-us/articles/4417662594195-Flagging-transactions-Accidental-purchase-fraud-and-out-of-policy) · adversary B14 KEEP`
- **Select many, one plain bar** — bar. Bulk gets the plain die: a bar at the bottom, no scrim, no seal. The house rule already says so; this is only the mechanic.
  `Linear select issues (https://linear.app/docs/select-issues) · adversary A17/B21 KEEP — adopt the fuller keyboard spec`
- **A manager's passcode at the point of action** — panel. The restaurant industry's own second-authority ceremony: superior authority, completed in seconds at the point of action — not a multi-step chain. A different thing from a two-person rule; the founder should choose which acts get which (fork F11).
  `Toast POS discounts — manager passcode prompt (https://support.toasttab.com/en/article/Basic-Discount-Configuration) · adversary §6: MISSED by all four files`
- **Suggested edits, not applied edits** — inplace. The best structural proof that 'a draft never looks sent' is buildable: nothing is touched until a person disposes of each suggestion. Provenance is a colour that never fades.
  `Notion suggested edits (https://www.notion.com/help/suggested-edits) · Granola black/grey (https://www.granola.ai/blog/how-to-use-ai-to-take-meeting-notes) · adversary C9 KEEP (verified), C16 KEEP`
- **Ask about this, with its sources** — sheet. Every sentence cites a row or says 'no data'. Sources stream with the answer, not after it — an absence is reported as an absence.
  `Grounded Q&A scoped to one object (adversary C10 KEEP) · Perplexity streaming citations (https://docs.perplexity.ai/docs/cookbook/articles/streaming-citations/README) · C15 KEEP`
- **A proposal you accept line by line, sealed once** — panel · seal. Three granularities of accept are right; a plain 'Accept all' button is wrong when the apply is a real commitment. The ticks choose, the seal commits (ADR 0113).
  `GitHub Copilot Edits per-hunk accept (https://learn.microsoft.com/visualstudio/ide/copilot-edits) · adversary C1 ADAPT — the batch resolves to one seal`
- **The door's sheet rests at three heights** — bottom. On a phone the right sheet becomes a bottom sheet — same object, same head, same close-in-words — resting at detents instead of a fixed 440. Four files asked for this four ways; it is one decision (fork F9).
  `Apple HIG sheets and detents · Material bottom sheets (https://m2.material.io/components/sheets-bottom/android) · Vaul snap points (https://www.npmjs.com/package/vaul/v/1.0.0) · adversary C18/C19/D1: ADAPT — ONE decision`
- **Swipe up to record it; the stamp at the end** — bottom · seal. The founder's own ask, proven at scale in a high-stakes app: review, then one deliberate gesture; the house's stamp completes it. On desktop the same act is the hold.
  `Robinhood swipe-up-to-submit (https://robinhood.com/us/en/support/articles/selling-a-stock/) — swipe confirmed, haptic detail dropped by the adversary (C20 ADAPT)`
- **Queued is never confirmed** — inplace. The right vocabulary for the door: four states, each unmistakable. An absence (no signal) is reported as what it is.
  `WhatsApp offline queue and tick ladder · adversary C24 KEEP`
- **Who else has this open** — sheet. Concurrency is not the failure mode — invisibility is. A presence line on shared records makes a split count safe (fork F11).
  `Figma presence and multiplayer (https://help.figma.com/hc/en-us/articles/360040449713) · adversary §6: MISSED — answers B's own concurrent-count gap`
- **The invoice beside the order, cell by cell** — inplace. Both cited products do this in place, not in a popup — the founder's own 'side-by-side inside an overlay' ask is answered by rule 6: the row expands and shows its working.
  `Ramp PO matching · Restaurant365 discrepancy view · Toast AI invoice scanning split view (https://support.toasttab.com/en/article/Get-Started-With-AI-Invoice-Scanning) · adversary B17/B-R2 KEEP`
- **Step up before the money moves** — panel. A device left unlocked is the common failure; re-authentication at the moment of a real commitment closes it without touching routine work.
  `GitHub sudo mode (https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/sudo-mode) — fetched, holds: two hours; password, passkey or 2FA · G: ADAPT`
- **What the seal bound** — inplace. The provable seal made visible: what was bound, by whom, and the link to the record before it. Verifiable after the fact, not asserted.
  `FIDO Secure Payment Confirmation (https://fidoalliance.org/white-paper-secure-payment-confirmation/) — fetched, holds: amount and payee signed by the authenticator (PSD2 dynamic linking) · AWS CloudTrail digest chain (https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html) · G: KEEP`
- **A new bank detail waits** — panel · seal. Vendor-impersonation is the single highest-fraud act on the list; a rare ceremony is worth it precisely because it is rare. The house's own separation of duties in one line.
  `City National Bank dual control and call-back (https://www.cnb.com/business-banking/insights/what-is-dual-approval.html) · UK Finance Confirmation of Payee (https://www.ukfinance.org.uk/policy-and-guidance/guidance/confirmation-payee) · G: ADAPT — bank-detail changes only, never every new vendor`
- **Held for a look** — inplace. A velocity check adds nothing to the common case and names its reason on the row when it trips — the house's rule for flags, applied to money.
  `Stripe Radar rules and review (https://docs.stripe.com/radar/rules) · Ramp limits (https://support.ramp.com/hc/en-us/articles/10881975647763-Card-limits-and-spend-programs) · G: KEEP, silent on the common case`
- **The door tablet locks itself** — bottom. A shared device left open hands every person's authority to whoever picks it up; an idle lock is what makes the passcode ceremony mean anything.
  `Toast POS screen timeout (https://support.toasttab.com/en/article/Adjust-POS-Screen-Timeout) · Square passcodes at the point of sale (https://squareup.com/help/us/en/article/8357-require-passcodes-at-point-of-sale) · G: KEEP — the precondition for the manager's passcode`
- **Break the glass** — panel · seal. Emergency access exists in every serious system; the house's version is owner-only, written down, and loud — never a quiet backdoor.
  `AWS Well-Architected break-glass procedures (https://docs.aws.amazon.com/wellarchitected/latest/devops-guidance/ag.sad.5-implement-break-glass-procedures.md) · G: ADAPT — rare, reasoned, told to everyone`


---

## 11. What "done" means for one overlay

Every one of these, for every overlay you touch. A packet with any box unticked is reported as
unfinished, never as done.

- [ ] **The shape is the one the census gives it**, and the reason still holds. If you believe it
      is wrong, say so in the report and stop — do not quietly build a different shape.
- [ ] **On the primitive.** No `fixed inset-0`, no private Esc handler, no second focus effect, no
      hand-rolled scrim. The close control is words.
- [ ] **The endpoint is real and exercised.** Name the route and the controller `file:line` in the
      report. A surface over a route that does not exist is the failure this house calls hollow.
- [ ] **Four states, honestly**: empty, loading, error, permission-denied. The error says what did
      not happen in words the operator can act on ("The entry was not saved. It is unchanged."),
      never a toast that implies a write that did not land.
- [ ] **Provenance where a figure appears.** The rows it summed, the date it was read, who wrote it.
- [ ] **Motion is a house token** (`tuck` · `settle` · `ink`); reduced motion renders none.
- [ ] **Both grounds.** Paper and charcoal, checked, not assumed — the portal carries the ground.
- [ ] **Keyboard.** Tab cycles inside; Esc closes; focus returns to the opener; the anchored
      surfaces are reachable without a mouse.
- [ ] **Tests.** The overlay's own spec plus a regression that fails against the pre-fix code —
      prove it by running the test against a copy (`git show HEAD:path > /tmp/x`), **never by
      stashing or resetting the shared worktree**.
- [ ] **Flag off is byte-identical.** `shellOverlays.test.tsx` and the page's own legacy render.
- [ ] **The page doc is updated in the same session** — §1a features, §9 gaps, the Motions table,
      and the `Overlays` subsection via `python3 .planning/sketches/102-modal-census/build.py --docs`
      after editing `census.py`. Work that is not documented did not happen.

## 12. Verify, then report

```bash
cd apps/web && pnpm run typecheck && pnpm run lint && pnpm run test:run -- <your spec path>
cd ../api-gateway && pnpm run typecheck && pnpm run test -- <your spec path>
python3 scripts/check_flag_readby_anchors.py      # after any MUDAVYM_PAGES edit
python3 scripts/check_citation_pairing.py && python3 scripts/check_adr_numbers_unique.py
```

Run **both** tsconfigs (the app config and `tsconfig.spec.json`) before you claim green, and paste
**your own** measured counts — never a number you did not watch print. Screenshot the overlay on
both grounds and say which theme each shot is.

**Report honestly.** If you narrowed scope, skipped a check, or could not verify something, say so
in the first three lines. A partial result reported as complete is the one unrecoverable failure
here.

## 13. When you hit a fork

Some of these packets will raise a question only the founder can answer (a shape that does not fit,
an act with no home, a ceremony that would slow a floor down). **Ask it the moment you find it**,
with the options and their costs and your recommendation — do not default it, do not batch it to
the end, and do not stop the rest of the work while you wait. Then record the answer in ADR 0112
and in `census.py`, and rebuild.

## 14. Never

- Never `git add -A` or `git commit -a` — several sessions drive this repo at once; commit with
  explicit paths.
- Never `git stash` — the stash is repo-global across every worktree.
- Never edit a generated file (`index.html`, `census.json`, `README.md`, a page doc's `Overlays`
  table). Edit `census.py` or `build.py` and rebuild.
- Never delete a legacy modal before the act it carries exists somewhere else.
- Never invent a figure, a zero, or a success message for a write that did not land.
