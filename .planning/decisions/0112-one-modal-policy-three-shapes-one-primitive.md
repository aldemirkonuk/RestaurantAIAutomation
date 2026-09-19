# 0112 — One modal policy: three shapes, one primitive, and the overlay wears the page's ground

- **Status:** Locked — ratified by the founder 2026-09-05 at the sketch 102 census review; built behind the existing per-page design flags
- **Date:** 2026-09-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** modal, sheet, panel, popover, overlay, dialog, focus trap, scrim, ground, portal, shell, mudavym, design foundation
- **Links:** [[0042-mudavym-brand-system]] (tokens are scoped to `.mudavym`, one chromatic colour),
  [[0020-no-fabricated-answers]], [[0051-rebuilt-pages-show-live-data-only]],
  [[DESIGN-FOUNDATION]] §3 item 4 (the co-design agenda's "one modal/drawer/sheet policy"),
  sketch 010 (centered sheet for providers)

## Context

The founder's instruction for this pass, verbatim: **"modal window changes are a must to
match with new wave."** Every dialog, sheet, popover or palette that can appear while a
rebuilt (Mudavym) page is on screen has to look and move like the page under it.

Measured on `feat/mudavym-design-p4` before any of this was built:

- **Four hand-rolled overlays, no shared primitive.** Providers `TwinSheet.tsx` (right
  sheet, inline styles, its own `pv-sheet-in` keyframes — that overlay is deleted by this
  ADR, so it has no line to cite any more; it was 186 lines and is now 110), calendar
  `EventSheet.tsx:220` (right sheet, `.cn-scrim`/`.cn-sheet` at `calendar-next.css:484,492`),
  reports `AskTheBook.tsx:102` (centered panel, `.rp-ask__*` at `reports-next.css:640`), and
  communications `TemplateSheet.tsx:246` (a `position:fixed` wrapper mounting two **legacy**
  builders that are themselves `fixed inset-0 bg-black/60` modals —
  `GmailTemplateBuilder.tsx:852`, `SMSTemplateBuilder.tsx:423`).
- **`components/mudavym/` held Wordmark, Seal, HoldToApprove, PageGate — and nothing else.**
  Each page re-derived the scrim colour, the motion and the Esc handler. **None trapped
  focus, none returned focus to the opener, none locked body scroll.**
- **Nine shell overlays render over every page, all legacy** (`bg-white`, `gray-200`
  borders, wine accents, `popIn`/framer). Line numbers below are where each of those legacy
  branches lives NOW, after this pass put a gated house branch above it:
  `CommandPalette.tsx:364`, `AskAiBar.tsx:290`, `ShortcutsSheet.tsx:98`,
  `RecentlyViewed.tsx:113`, the notifications popover (`Header.tsx:232`) and the user menu
  (`Header.tsx:397`), `ThemeMenu.tsx:95`, `RestaurantBranchSwitcher.tsx:149`, the mobile
  scrim (`DashboardLayout.tsx:54`) and the nav-rail hint (`Sidebar.tsx:220`).
- **Tokens are scoped to `.mudavym`, never `:root`** (`mudavym.css:27`, ADR 0042). Anything
  portalled to `document.body` therefore has **no tokens at all** unless its own root carries
  `.mudavym` and, for a charcoal page, `data-ground` on that same element — PageGate's header
  comment records why a second bare `.mudavym` node silently re-declares the light column.
- **No modal policy was recorded.** DESIGN-FOUNDATION §3 item 4 lists "one modal/drawer/sheet
  policy" as unbuilt and notes sketch 010 chose a *centered* sheet for providers — yet
  ProvidersNext shipped a *right* sheet and the calendar copied it. Two pages agreed by
  accident, not by decision.

## Options considered

1. **One shape everywhere.** Pick a single geometry (most plausibly the centered panel,
   which is the most unambiguous about modality) and render every overlay in it. Appeals
   because it is the least invention: one geometry, one motion, one mental model, one
   accessibility surface. Costs: it spends a scrim on a theme toggle. The theme menu, the
   branch switcher and the user menu hang off header buttons that are on screen at all
   times; dimming the whole page to pick "Dark" is ceremony, and this house rations ceremony
   deliberately (`HoldToApprove` exists precisely so that commitment is marked and routine is
   not). It also throws away information that position carries for free: a surface arriving
   from the right means *one record, opened from the list you can still see*; a surface in
   the middle means *answer me*. And it has to break anyway — nobody would portal the
   nav-rail hover hint into a scrimmed centered panel — so "one shape" is really "one shape
   plus uncounted exceptions", which is neither a policy nor uniformity.
2. **Per-page freedom.** What exists today. Appeals because each page can suit itself and
   nothing has to be coordinated. Costs are measured above: four re-derivations of one scrim
   colour, four Esc handlers, and zero focus traps in four attempts. Every accessibility fix
   is multiplied by the page count, and the count is still rising.
3. **Three named shapes over one primitive.** `Sheet` (right, one object's detail or edit),
   `Panel` (centered, an ask or a confirmation), `Popover` (anchored, a menu or a switcher).
   Costs: three is more than one, and the third — non-modal, anchored, portalled — is the
   hardest of the three to get right.
4. **Do nothing.** The founder's instruction is explicit and this is a "must". Doing nothing
   leaves a Mudavym page whose ⌘K palette, bell and user menu are white-and-wine, which is
   the exact seam the instruction names.

## Decision

**Three named shapes over one primitive (`components/mudavym/Sheet.tsx`), chosen by what the
overlay is FOR, portalled to `document.body` with `.mudavym` and the page's ground on the
same element, and gated so a page with its flag off renders byte-for-byte as it always has.**

What actually carried it:

- **The evidence contradicts one shape.** The two overlays this house built by hand, on two
  different pages, independently, converged on *two* geometries — a 440px right sheet
  (`calendar-next.css:499`) and a 620px centered panel (`reports-next.css:657`). Two builders
  reading the same brand foundation each reached for a different geometry for a different
  purpose. That is evidence the distinction is real, not an implementer's whim. The
  primitive adopts both numbers verbatim rather than inventing a third.
- **Shape as information.** Three shapes are three sentences the reader does not have to
  read: from the right = a record; in the middle = a question; hanging off a control = that
  control's own menu.
- **One implementation is the point, not one shape.** The thing the pages actually got wrong
  was never the geometry — it was focus, scroll and Esc. Those live in `OverlayRoot` once:
  focus moves inside on open, Tab cycles inside, Esc closes, focus returns to the opener,
  body scroll locks (counted, so stacked overlays cannot unlock each other), and
  `prefers-reduced-motion` renders **no** animation rather than a shorter one.
- **The gate keeps ADR 0042's promise.** `lib/mudavym/shellGround.ts` is a tiny external
  store that `PageGate` claims while a `next` tree is mounted. Each shell overlay renders the
  house shape **only when it is on**; otherwise it renders its existing markup, and
  `shellOverlays.test.tsx` pins the literal legacy class strings so a drift is loud.
- **The ground is a DOM fact, not a prop.** PageGate cannot be told the ground: it renders
  `next` as-is, and the page — not the gate — owns `data-ground` (App.tsx passes none;
  `DoorNext.tsx:380` hardcodes charcoal on its own root). So an overlay resolves the ground
  most-specific-first: an explicit prop, then the `MudavymGroundContext` PageGate provides
  from its measurement, then the nearest `.mudavym` ancestor of the opener, then the store.
  Each reader returns `null`/`off` rather than a paper default when it does not know, because
  a default here would be an absence reported as an answer (ADR 0020).
- **The close control is words, not an X** — the calendar's idiom (`EventSheet.tsx:233`).
  It is the one place this system would have had to invent a glyph, and it never needed to.

**The exception, named rather than hidden:** `InviteTeamDialog` is anchored under its button
like a popover but is a *form that commits*, not a picker. It takes `Popover modal`, which
restores the focus trap, scroll lock and dim its Radix dialog had while keeping the anchored
position operators know. One exception is a seam; two would mean the third shape is a
spectrum, not a shape (see Consequences).

## Consequences

- **Easier.** A focus-trap, scroll-lock or scrim fix is now one edit in one file instead of
  one per page. A new overlay is three lines and inherits the whole contract. The shell's
  nine overlays match the page under them the moment a page flag turns on, with no global
  restyle and no change to any legacy page.
- **Retired by this (retire-to-write).** `TwinSheet`'s hand-rolled overlay — its inline
  scrim, its `pv-sheet-in` keyframes and its private Esc handler — is **deleted**, not
  archived; the component is now 106 lines of content over the shared `Sheet`.
  `.cn-scrim`/`.cn-sheet`/`@keyframes cn-sheet-in` and `.rp-ask`/`.rp-ask__scrim`/
  `.rp-ask__panel`/`.rp-ask__field`/`.rp-ask__foot` **were retired on 2026-09-04**, when the
  two held files came free: `EventSheet.tsx` is a `Sheet` and `AskTheBook.tsx` is a `Panel`,
  each having also shed its own Esc handler, its own focus effect and (for reports) its own
  `animate(settle)` call. Both pages' form and list classes are untouched. `.rp-ask__body`
  survives alone, because the list inside it is still the reports page's own.
  DESIGN-FOUNDATION §3 item 4 stops being an open agenda item and points here.
- **Harder / given up.** Three shapes means an implementer chooses, and can choose wrong; the
  ADR's "what it is FOR" test is the whole guardrail. The `Popover` is non-modal by default,
  so anything anchored that needs a trap has to say `modal` out loud. Two branches now exist
  in nine shell files, which is more code to read — the price of ADR 0042's byte-for-byte
  promise, and it disappears the day the last legacy page is retired.
- **NOT covered, deliberately.** The two legacy template builders keep their internals: only
  their backdrop, card and header band are re-skinned, structurally, from
  `TemplateSheet`'s wrapper. Four shared Radix dialogs opened from rebuilt `/settings`
  (`components/locations/{AddLocationDialog,CreateChainDialog,AssignToChainDialog,EditLocationChainDialog}.tsx`,
  used at `pages/settings/next/LocationsSection.tsx:120,126,133,144`) are **still legacy** —
  they were not in this pass's scope and are the first follow-up. `ShiftImportModal` is not
  migrated: it is opened only from the legacy desk (`pages/team/command/ManagerShiftDesk.tsx:594`),
  so its house branch could never render, and its apply path is simulated
  (`ShiftImportModal.tsx:100-101`).
- **Two live defects this pass also caught and fixed, both invisible to the tests.** The app
  ships a global `*:focus-visible { ring-2 ring-wine-500 }` (`styles/globals.css:221-264`) —
  a wine ring, a colour this house does not have — which painted itself inside every overlay
  until `.mdv-ovl :focus-visible` cancelled the Tailwind ring box-shadow explicitly (outline
  alone does not). And the centered `Panel` inherited `align-items: stretch`, so an overlay
  holding one sentence rendered as ~700px of empty paper. `.rp-ask` had that same latent
  shape, and it went with the rule on 2026-09-04.
- **Revisit when:** a *second* anchored surface needs `modal`. (2026-09-05: a second *opener* of
  the same component is not a second surface — the studio invite reuses `InviteTeamDialog`.) One
  exception is a seam; two
  means the third shape is a spectrum and the policy should collapse to two modal shapes
  (Sheet, Panel), with menus staying as plain anchored elements inside their trigger's own
  stacking context — which is what they are today.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-03 | — | Created (Proposed). Built, gated, 19 tests green. Founder ratification open. |
| 2026-09-04 | — | **Migration complete for the two held pages.** `pages/calendar/next/EventSheet.tsx` → `Sheet`, `pages/reports/next/AskTheBook.tsx` → `Panel`; the per-page scrim/panel/keyframe CSS named above is deleted. Status unchanged (**Proposed**) — the founder has still not ratified the three-shape policy itself. Tests: `Sheet.test.tsx` 15, `shellOverlays.test.tsx` 25, `InviteTeamDialog.test.tsx` 5, calendar 44, reports 77, all green. |
| 2026-09-05 | — | **Census (sketch 102).** Every overlay in the web app read and given a shape or a reason: 141 sites folded into 117 overlays — 31 built, 10 migrate, 12 owed, 7 target, 42 retire, 15 delete, 3 not a shape (after the 2026-09-05 rulings). Seven forks for the founder (F1–F7). |
| 2026-09-05 | founder | **Ratified (F1) — status → Locked.** F2: the studio invite reuses `InviteTeamDialog` with a second opener. F5: the manual order starts in the owed 'A new order' sheet. F7: a dashboard figure expands in place, no overlay. F3: a 640 sheet. F4: every legacy act is rebuilt to its full purpose (the founder's bar recorded below). F6: HouseHeader's bell and menu survive. All seven answered. |

## Founder answers (2026-09-04)

- **The seal never appears inside an anchored popover.** Anything sealed opens a sheet or a
  panel; a one-click approval from the bell opens the panel first. The third shape stays a
  choice, not a commitment. (Sketch 099's rule, ratified.)

## Census (2026-09-05, sketch 102)

`.planning/sketches/102-modal-census/` reads every place `apps/web/src` opens something over the
page — a house `<Sheet>`/`<Panel>`/`<Popover>`, a `fixed inset-0` wrapper, or a Radix `*Content` —
and gives each one this ADR's shape or a reason it has none. 141 sites fold into 117 overlays, and the founder's rulings of 2026-09-05 added three owed sheets (120 rows):

| Status | Count | Meaning |
|---|---|---|
| Built | 31 | on the primitive today (the shell's eight, team's eleven, orders' three, settings' four, …) |
| Migrate | 10 | legacy overlays that render **inside a house-flagged page today** — eight of them on `/inventory`, whose flag turns on the same component (`App.tsx:311`), plus `ConsentDialog` and `BranchProviderTransferModal` under `/settings` |
| Owed | 9 | acts the legacy page had that the rebuilt page does not offer yet (a manual new order, a new vendor, the drafted reply's approval, the meeting-note prompt, the bell's approval panel, …) |
| Target | 7 | pages not yet rebuilt whose overlays take their shape now (promotions, distributors, studio, admin health, the camera) |
| Retires | 41 | acts that already live in something built, or — the dashboard figure — in an in-place expansion the founder chose over an overlay (F7) |
| Delete | 16 | files nobody imports (the reports dashboard-builder set, two dev-only wine modals, the recurring-orders page, the template library, …) |

Three findings the census surfaced, none of which changes the decision:

- **Two bells and two user menus exist** — `Header.tsx`'s house branch and `HouseHeader`'s
  `HouseBell`/`HouseUserMenu`. One survives when the house header lands everywhere (fork F6).
- **The studio invite is the same act as the team invite.** Reusing `InviteTeamDialog`'s
  `Popover modal` with a second opener keeps the policy at one exception; a second *component*
  would be the "second anchored surface" this ADR's revisit clause names (fork F2).
- **The seal appears in the specimens exactly where the ration says**: publish a week, replace a
  week, write off stock, record a count, send a letter, approve from the bell. Never in a popover.

The seven forks (F1 ratify the three shapes · F2 the studio invite · F3 a delivery without an
order — sheet or route · F4 the acts nothing recreates · F5 where a manual order starts · F6 the
two bells · F7 the figure behind a dashboard number) are stated in full in the sketch's README. Published gallery: <https://claude.ai/code/artifact/23f77c68-7766-40c8-934a-cfa7148c7508>.

## Founder answers (2026-09-05, at the census review)

- **F1 — the three shapes are ratified.** This ADR moves from Proposed to **Locked**. The
  alternatives were put again with their costs (two shapes: the invite form loses its anchored
  position and the bell and switcher get no house shape; one shape: a scrim on a theme toggle and
  the list under a record disappears) and refused.
- **F2 — the studio invite reuses `InviteTeamDialog`** with a second opener. The rule this
  records: *one component, however many openers, is one exception.* A second **component**
  needing `Popover modal` is still the signal that collapses the policy.
- **F5 — a manual order starts in the owed 'A new order' sheet** on `/orders` (search the
  register, lines carrying the agreed price and unit from the vendor's row, a vendor; nothing is
  sent by saving a draft). Rejected: starting only from a register row, or only through Ask AI.
- **F7 — a dashboard figure expands in place** ('show the working' under the KPI row, like
  DayDetail under the sales calendar). No overlay. The expansion is still to build on
  `pages/dashboard/next/KpiRow.tsx`.
- **F3 — a delivery without an order is a 640 sheet on `/inventory`**, not a route.
- **F4 — every legacy act gets rebuilt, and the founder attached a bar to it, verbatim:**
  *"everything we touch, they have must all fully serve to their purpose to their max capacity
  meaning functionality, endpoints, UI UX, smoothness, and most importantly the design."* So:
  pause/resume the AI on a thread becomes a control on the responses sheet; a person's own
  one-tap action, an auction lot (a fourth start of the carry sheet) and certifications on file
  are owed sheets, drawn in sketch 102; assigning a recommendation to a person follows the same rule
  and was confirmed on 2026-09-06 — all five acts are built, none is deleted.
- **F6 — `HouseHeader`'s `HouseBell` and `HouseUserMenu` survive.** `Header.tsx`'s house branch
  (lines 147 and 351) is deleted; its legacy branch stays byte-identical.
- All seven forks are answered. Migration order: the ten `migrate` rows first (they render legacy
  inside house-flagged pages today), then the owed sheets, then the sixteen deletions.

## Behaviours (2026-09-05, from the sketch 102 research — F8–F11 decided by the founder the same day; F12 open)

The founder asked for SOTA overlay behaviours and "more access"; DESIGN-FOUNDATION §6f records
the research and its adversary. Sixteen behaviours are drawn in sketch 102; they need four
decisions, each a fork for the founder. None changes the three shapes.

- **F8 — the non-modal class, named.** Peek-beside-the-list, the hover card, the undo toast,
  the bulk-select bar, the standard bottom sheet on a phone and the expanded ledger row are
  **not shapes**: no scrim, no focus trap, dismissed by moving or by Esc; never a form, never the
  seal. This ADR's Options already allowed exactly this carve-out; the amendment would state it so
  four separate requests do not become six shapes.
- **F9 — the sheet on a phone.** The right sheet's phone form is a bottom sheet with detents
  (peek · half · full; the grabber appears only when there is more than one), and stacked sheets
  (a vendor from an order from a notification) are capped at three with a breadcrumb — one
  decision covering Apple's detents, Material's sheets and Vaul's snap points together.
- **F10 — undo after, for what can be undone.** Dismiss, archive, remove a shift, a note:
  fire the act, offer Undo for a few seconds. Money, sends and ledger rows keep the seal before.
  The adversary's warning is recorded: the line must be written down or the toast creeps into
  what needs wax.
- **F11 — a second authority.** Two ceremonies the research surfaced and the house has not chosen
  between: a manager's passcode at the point of action (Toast) for staff → manager acts, and
  presence on shared records (Figma) so a split count is safe.

Two rules the research confirmed rather than proposed, restated here so they are cited from the
house and not from a product: **a proposal is a layer, never an applied change** (the composer,
the config assistant, vendor terms); **approving from a notification lands in the panel with the
seal, never on the tap**. And one the adversary struck: nothing here is attributed to Linear's
agent resolving its own threads — that claim did not survive re-fetch; the rule is ADR 0113's.

### Founder answers (2026-09-05, evening)

- **F8 — the non-modal class is named.** Peek beside the list · the hover card · the undo toast ·
  the bulk-select bar · the standard bottom sheet on a phone · the expanded ledger row. Two
  constraints: no scrim and no focus trap; never a form and never the seal. They are not shapes
  and do not count against the three.
- **F9 — yes to both.** On a phone the right sheet is a bottom sheet with detents (peek · half ·
  full; the grabber only when there is more than one). Stacked sheets are capped at three and
  show their path. One decision covering Apple's detents, Material's sheets and Vaul's snap
  points; `Sheet.tsx` gains the phone form and the stack, nothing else.
- **F10 — undo after, with that exact line.** Dismiss an entry, archive a thread, remove a shift,
  a note: the act fires and Undo is offered for a few seconds. Money, sends and ledger rows keep
  the seal before. The list is closed; adding to it is an amendment here, not a builder's call.
- **F11 — all three, as the house's own rules.** A manager's passcode at the point of action for
  staff → manager acts (the manager's name goes on the line); presence on shared records; and a
  two-person rule for money — the initiator is mechanically excluded from approving their own
  payment (adopted on the house's word, not Mercury's unconfirmed page). The founder added:
  *"any other possible security like that"* — opened as **F12**, a security-ceremonies research
  pass (step-up re-authentication, passkeys, transaction binding, cooling-off release, limits per
  role, break-glass with a reason, recall windows, tamper-evident audit, device trust) whose
  output is a catalogue with a fit per act, to be decided act by act.

### F12 — the security ceremonies (2026-09-05, decided act by act the same evening)

Research `sketches/102-modal-census/research/F-security-ceremonies.md` (24 ceremonies, sourced)
and the lead's own adversarial pass `G-security-adversary.md` (3 rejected: a retired ledger
product, time-boxed elevated sessions for staff, an out-of-band call per payment; Mercury's
scheduling page 403s and is not cited). Six are drawn in sketch 102. The proposal, per act:

| Act | Ceremonies proposed |
|---|---|
| Approve an order | the seal (built) · a second person above the tier threshold (ADR 0128) · a passkey-backed seal for owners and managers on their own devices |
| Release a payment | the seal bound to amount and payee, with a receipt that shows what was bound and its chain link · the two-person rule (F11) · step-up re-authentication when the session is older than two hours · a velocity hold that names its reason on the row · every owner told on every move |
| Add or change a vendor's bank detail | a call to the number on file (never the number in the letter) · the first payment to the new detail held 24 hours and needing a second person · whoever confirms the detail cannot release that payment |
| Write off stock | the seal · above a per-role daily limit, a manager's passcode · the tamper-evident trail |
| A price override by staff | the manager's passcode at the point of action (F11) · the device lock as its precondition |
| Publish a week | the seal, kept — not on F10's closed list · re-publish exists · the trail marks a republished week |
| A config change by the assistant | the seal on the proposal (ADR 0113) · step-up when the session is old · the sealed batch revocable for seven days (built 2026-09-04) |
| A door delivery on a shared tablet | an idle lock returning to the passcode screen · a count correction within ten minutes as undo-after — an explicit addition to F10's list, the founder's to make |
| A tool write | challenge-and-redeem (ADR 0107, built) · break-glass: owner-only, a written reason, every owner told, the trail marks it |

Kept from the research's own fights: no blanket delay on every new vendor (they are known
distributors); no mandatory comment on every second approval; no out-of-band call per payment.

**Founder rulings on F12 (2026-09-05, evening).** Every ceremony in the table above was adopted,
with three amendments, verbatim where it matters:

1. *"make sure the customer part is adapted to the high paced operating environment"* — every
   ceremony is measured in seconds at the point of action; nothing becomes a chain.
2. *"for 2 person seal → if it needs two person to go along, change it to one man approval if
   the authority is valid — owner/manager or authorized personnel (owner can give access),
   otherwise double approval is needed."* The two-person rule of F11 becomes the **authority
   rule**: one approval when the approver holds valid authority — an owner, a manager, or a person
   the owner has authorized — and double approval otherwise. Separation of duties survives inside
   it: whoever confirms a vendor's bank detail cannot release the first payment to it.
3. *"check for any security changes"* — a security change is always told to every owner: a bank
   detail, an authority grant or revocation, a passcode reset, a limit change, a device added to
   the house. A producer, not a ceremony.

Also decided: a door count may be corrected within ten minutes as undo-after (an explicit
addition to F10's closed list — the list is now dismiss, archive, a removed shift, a note, a door
count within ten minutes); publishing a week stays sealed. And *"research more, dig deep and then
understand more of these"* on the assistant's and tool-write ceremonies (step-up, break-glass,
the passkey-backed seal) — a deeper pass is running as `research/H-…`; its output amends this
section, it does not reopen the rulings.

### The deep pass on the assistant's and tool-write ceremonies (2026-09-05, night — Proposed where marked)

`research/H-assistant-security-deep.md` (five sections, sourced) checked by the lead in
`research/I-deep-pass-check.md`. What it established, and the house design it implies:

- **Step-up in this stack.** Supabase Auth documents two second factors — a TOTP app and phone —
  and defines AAL1/AAL2; the JWT carries an `amr` array of methods used and **no `auth_time`**.
  WebAuthn/passkeys are not in the MFA docs. So the two-hour gate (GitHub's rolling window,
  verified: any sensitive action resets it) is enforced by the gateway from a timestamp the house
  persists itself, keyed by `session_id`, on every apply — never from the client's clock. The
  panel says one line, only when the gate trips, with the prompt inline; a successful seal both
  authorizes and re-arms the window.
- **The passkey-backed seal** is a house-owned WebAuthn ceremony, not Supabase's MFA path: the
  hold begins → the server mints a single-use challenge encoding hash(nonce ‖ amount ‖ payee ‖
  order ‖ expiry) → the hold's release calls `navigator.credentials.get` with `userVerification:
  "required"` → the server verifies the signature and consumes the challenge. Secure Payment
  Confirmation (the browser shows merchant, instrument, amount and the authenticator signs them —
  MDN, verified) is a Chromium enhancement later, not the baseline. **The mobile app must not
  build the seal on `expo-local-authentication`**: a device-local prompt proves nothing to the
  server; a real WebAuthn library is required on any device the seal is used from.
- **Break-glass** follows the healthcare model (a reason, a real-time notice to every owner, an
  audited review), not the cloud "primary auth is down" model: owner-only, never blocked, always
  loud, marked in the trail.
- **Authorized personnel** is a first-class grant row — grantor, grantee, scope, limit, expiry,
  revoked-at — with *granted by* visible wherever the authority is used, expiry enforced at check
  time, and grantor ≠ approver enforced in the database (an owner cannot approve twice through a
  self-issued grant). This is more explicit than Ramp, Brex, Mercury or Rippling document, which
  is right for a house where the owner must be able to read who acts as owner.
- **Speed.** No vendor publishes a timing; the design rules that keep it to seconds are: one
  prompt (hold = intent, the OS prompt = identity, never a third), the reason field only on
  break-glass, no chain.

**Questions put to the founder (2026-09-05, night):** the launch factor and the mobile timing
(TOTP now with the house's own passkey seal on web, mobile when a real WebAuthn library ships —
or wait); the break-glass review (a stated window, who reviews when all owners were only told,
and whether the outcome is told); grants (any owner may revoke, and grantor ≠ approver enforced
structurally); one security ledger for step-up, break-glass and grants or three tables.

**Founder answers (2026-09-05, night):**

- **Everything at once, web and mobile.** The two-hour step-up and the house's passkey seal ship
  together on web and in the mobile app; the seal waits for a real WebAuthn library on mobile
  (react-native-passkeys or equivalent) rather than shipping on web first. Nothing ships on a
  device-local prompt.
- **Break-glass is reviewed within 48 hours by any other owner, and the outcome is told to all
  owners.** The reviewer marks it justified or a concern; a single-owner house records its own
  note within the window. The window is this ADR's number.
- **Any owner may revoke any grant.** Every revocation is told to the owners as a security change.
- **One security ledger.** Step-up verifications, break-glass uses and grant checks write to one
  tamper-evident `security_events` chain that the trail and the owners' notices read from; a
  guard asserts every ceremony writes its row.

The build brief that carries all of this to whoever builds it is
`sketches/102-modal-census/BUILD-PROMPT.md` — generated from the census, so the work list cannot
drift from the drawing: the rules, the primitive's exact contract, the non-modal class, the
ceremonies, five packets (10 migrations · 12 owed acts · 7 targets · 15 deletions · the
behaviours) and what "done" means for one overlay.

With these, F12 is closed. The build order this implies: the ledger first (everything else
writes to it), then the authority rule and grants, then step-up, then the seal ceremony on both
platforms together, then break-glass.

## Sketch 103 applied to the primitive (2026-09-06)

The founder reviewed the ten-sketch overlay-experience canvas in Claude Design on 2026-09-06
and **accepted it as the experience layer** (`sketches/103-overlay-experience/`, `winner:
accepted`; his comments on 1b and 1c are applied in the file). That acceptance is the decision
evidence for this section. Nothing here adds a shape, a second chromatic colour or a glyph —
the policy above is unchanged. What changes is what the reader can DO inside the three shapes,
and it is built in `apps/web/src/components/mudavym/`.

The measurement it was built against is finder B's pass over the census
(§2.0 invariants, D1–D27) and finder C's usage/coverage measurement. Five defects it names
were uniform across all sixty live rows, which is why they are fixed once, here, rather than
sixty times.

**The prop surface, and every default.** Additive only — every existing prop and default is
untouched, so a page written against the old primitive still compiles and still behaves the
same, with the one deliberate exception marked ⚠.

| Prop | Where | Default | What it does |
|---|---|---|---|
| `label` | all three | *(required, unchanged)* | **Now always the accessible name.** It was discarded whenever `title` was set, and all sixty live rows carry a title, so the required prop reached no ear on any of them (D1). It is the contract sentence: what it asks · what sealing or saving writes · what leaving costs. |
| `contract` | all three | `undefined` | The same sentence, rendered in the header and wired to `aria-describedby`. Absent ⇒ **no** `aria-describedby` at all: an absence shown as one, never a description invented from the title (ADR 0020). |
| ⚠ `scrim` | all three | **`false` for Sheet**, `true` for Panel, unchanged for Popover | 1a. A sheet takes width, never light; a question dims the page. **This changes what a Sheet looks like** — it is the one behavioural default this pass altered, and it is the point of 1a. It is PAINT only: focus still moves in and returns, Tab still cycles, Esc still works, the body still locks, the scrim element still catches the click. |
| `layout` | Sheet | `'overlay'` | 1a's other half. While a Sheet is open the primitive sets `data-sheet-open="overlay\|compress"` and `--sheet-width` (440px, 640px when `wide`) on every `.mudavym` **page** root; the page's own CSS decides whether its list gives up columns. No page is edited by this pass, and a page with no rule renders as before. |
| `dirty` | Sheet, Panel | `false` | 1b and 1d. Esc and an outside click stop destroying work. |
| `onTear` | Sheet, Panel | `undefined` | Fired at the gesture with `'esc' \| 'outside'`, before the surface is gone, so the caller can put the stub on the row in the same frame. |
| `denied` | Sheet, Panel | `undefined` | `{ who, grant?, verb? }` — replaces the action row with the authority rule's own sentence. |
| `spine` | Sheet | `title` when it is a string, else `label` | 1c. The word this level puts on the spine. |
| `detents` | Sheet | `['peek','half','full']` | F9's phone form. The grabber is drawn only when there is more than one. |
| `boundSummary` | `HoldToApprove` | `undefined` | 1d. What the seal bound, read back under the wax. |
| `onSealed` | `HoldToApprove` | `undefined` | `({ summary, challenge })` — the receipt the ledger line is written from, carrying the same words the reader can see. |

**What was built, and the defect each answers.**

1. **Announced (1e) — D1.** `aria-label` is always `label`; `aria-labelledby` is gone. The
   visible contract line is `contract`, wired to `aria-describedby`. A dev-time warning fires,
   once per distinct label and only while the surface is open, when `label` is fewer than four
   words — four is the floor at which a sentence can carry three clauses.
2. **The Pass (1a) — D2.** `scrim`, defaulting off for a Sheet, plus the page-root hooks above.
3. **The Stub (1b) — D3.** A dirty Sheet leaves on `tuck` and calls `onTear`;
   `components/mudavym/Stub.tsx` renders "Held here · unwritten" with Resume and Discard.
   Discard is **undo-after** (F10): `onDiscard` fires at the click and "Put it back" stands for
   ten seconds — and the undo is drawn only when the caller passed `onRestore`, because a button
   that cannot restore anything is an absence reported as health.
4. **Weight (1d) — D3, D17.** A dirty Panel does not lift on a stray click: it leans (`settle`,
   6px) and says what it is holding in a polite live region, because a lean is a movement and a
   movement reaches no screen reader. Only Close, or Escape said twice within six seconds,
   leaves. `HoldToApprove` gains the read-back — the census draws a failure line on four of sixty
   rows and nothing at all on success.
5. **The Spindle (1c) + F9 — D4.** `components/mudavym/SheetStack.tsx`, mounted by `PageGate`.
   The top sheet draws the named spine ("Order 118 › Öküzgözü › Answers") with "Depth 3 of 3";
   every level before the last is a control that closes back to it. A fourth level opens no
   fourth sheet and is not a silent no-op: *"Three sheets are open. Close one to open this."*
   lands on the paper the reader is looking at, in an assertive live region. Under 640px the same
   three levels are detented bottom sheets with one breadcrumb; a **tap** on the grabber cycles
   the detents, because drag-only fails WCAG 2.2 SC 2.5.7 on the one form where every reader is
   using a thumb.
   The provider is mounted by `PageGate` and nowhere else: depth is a fact about a PAGE, not
   about the document, and a Sheet mounted outside a page is uncapped and unspined exactly as
   before.
6. **Permission-denied, and one wording for "why not" — D24, D25, D23.**
   `components/mudavym/Denied.tsx` carries F11–F12's authority rule verbatim in shape: *"You can
   see this, but only an owner or a manager may change it. Ask <name> to grant it."* The optional
   grant line says F12's third amendment out loud — every owner is told when a grant is made,
   because a grant is a security change. `Refused` is the one wording for what did not happen:
   the thing, the verb, **"It is unchanged"**, then the server's own sentence, then the one thing
   to do.
7. **The policy is now a guard.** `housePolicy.test.ts` reads the primitive family's own source
   and holds it to the seven rules — close in words, no glyph, no emoji, one chromatic colour,
   colour from tokens, motion from a token and never a number, reduced motion renders none. It
   was proven able to fail against a deliberately broken copy of the tree.

**Fork left open (recorded, not decided).** Sketch 1a says the list keeps its pulse behind a
scrim-less sheet, which can be read as "an outside click should act on the list, not close the
sheet". This pass kept the existing behaviour — an outside click closes a clean sheet and tears
a dirty one — because changing it would alter every one of the sixty live rows for a reading
the canvas does not state. See `OPEN-DECISIONS.md`.

**Not built by this pass, deliberately:** no page's overlay was edited (packets 1 and 2 own
those), so the sixty live rows still pass title-shaped labels and none yet passes `contract`,
`dirty` or `denied`. The dev warning is what will surface each of them as its page is touched.
