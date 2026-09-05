# 0112 — One modal policy: three shapes, one primitive, and the overlay wears the page's ground

- **Status:** Proposed — built behind the existing per-page design flags, founder review open
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
- **Revisit when:** a *second* anchored surface needs `modal`. One exception is a seam; two
  means the third shape is a spectrum and the policy should collapse to two modal shapes
  (Sheet, Panel), with menus staying as plain anchored elements inside their trigger's own
  stacking context — which is what they are today.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-03 | — | Created (Proposed). Built, gated, 19 tests green. Founder ratification open. |
| 2026-09-04 | — | **Migration complete for the two held pages.** `pages/calendar/next/EventSheet.tsx` → `Sheet`, `pages/reports/next/AskTheBook.tsx` → `Panel`; the per-page scrim/panel/keyframe CSS named above is deleted. Status unchanged (**Proposed**) — the founder has still not ratified the three-shape policy itself. Tests: `Sheet.test.tsx` 15, `shellOverlays.test.tsx` 25, `InviteTeamDialog.test.tsx` 5, calendar 44, reports 77, all green. |
| 2026-09-05 | — | **Census (sketch 102).** Every overlay in the web app read and given a shape or a reason: 141 sites folded into 117 overlays — 31 built, 10 migrate, 10 owed, 7 target, 40 retire, 16 delete, 3 not a shape. Seven forks for the founder (F1–F7). Status unchanged (**Proposed**). |

## Founder answers (2026-09-04)

- **The seal never appears inside an anchored popover.** Anything sealed opens a sheet or a
  panel; a one-click approval from the bell opens the panel first. The third shape stays a
  choice, not a commitment. (Sketch 099's rule, ratified.)

## Census (2026-09-05, sketch 102)

`.planning/sketches/102-modal-census/` reads every place `apps/web/src` opens something over the
page — a house `<Sheet>`/`<Panel>`/`<Popover>`, a `fixed inset-0` wrapper, or a Radix `*Content` —
and gives each one this ADR's shape or a reason it has none. 141 sites fold into 117 overlays:

| Status | Count | Meaning |
|---|---|---|
| Built | 31 | on the primitive today (the shell's eight, team's eleven, orders' three, settings' four, …) |
| Migrate | 10 | legacy overlays that render **inside a house-flagged page today** — eight of them on `/inventory`, whose flag turns on the same component (`App.tsx:311`), plus `ConsentDialog` and `BranchProviderTransferModal` under `/settings` |
| Owed | 10 | acts the legacy page had that the rebuilt page does not offer yet (a manual new order, a new vendor, the drafted reply's approval, the meeting-note prompt, the figure detail, the bell's approval panel, …) |
| Target | 7 | pages not yet rebuilt whose overlays take their shape now (promotions, distributors, studio, admin health, the camera) |
| Retires | 40 | acts that already live in something built |
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

