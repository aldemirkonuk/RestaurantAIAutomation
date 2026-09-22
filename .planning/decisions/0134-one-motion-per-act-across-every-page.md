# 0134 — A motion answers an act, and every page answers with the same motion

- **Status:** Locked — the eleven rules below, as recommended by sketch 116 and locked by the
  founder 2026-09-21. Landed on `main` from `docs/motions-and-overlays-per-page`, where this ADR
  sat unmerged since 2026-09-06 while the founder watched the motion first (sketch 116).
  **[2026-09-21, round 6: §4, §5, §7's SC 3.3.8 bullet, §8, §9, fork 14 and sketch 116's founder
  question 6 (`ResponsesSheet`'s `wide`) are now locked too, with his words — see "Round 6
  answers — locked 2026-09-21" below. Nothing this ADR drafted is still Proposed.]**
  **[2026-09-22, round 6y: the three residues round 6 put back to the founder — §4's flag-off
  reach, §5(c)'s reduced-motion reach over the rail collapse, and where fork 14's two stores
  land — are now answered too, docs-only (the tree already matched both motion answers). See
  "Round 6y answers — locked 2026-09-22" below.]**
- **Date:** 2026-09-06 (drafted) · **Locked:** 2026-09-21
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** motion, tokens, overlays, ceremony, wax, ration, reduced motion, WCAG, sidebar, guard, census
- **Links:** [[0112-one-modal-policy-three-shapes-one-primitive]] (the overlay policy this builds on),
  [[0042-mudavym-design-language]] (byte-identical off), [[0127-a-house-sees-one-arm-and-the-arm-it-saw-is-written-down]],
  [[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]], [[0125]] (the sealed cancel
  rule 4 rests on), [[0138]] (warm-charcoal ground the sketch's canvas defaults to),
  [`06-pages/DESIGN-FOUNDATION.md`](../06-pages/DESIGN-FOUNDATION.md) §6g, the `§1c Motions decided`
  section now in all eighteen rebuilt-page notes, and
  [`.planning/sketches/116-motion-rules/README.md`](../sketches/116-motion-rules/README.md) — the
  canvas the founder watched before locking, whose "Recommendation" and "For the record" sections
  are what §Locked below actually enacts


## Locked, 2026-09-21

The founder, asked to watch the motion first (sketch 116) rather than read fourteen forks in
prose, answered on 2026-09-21, verbatim:

> Lock as recommended

**[CORRECTED 2026-09-21, lane last call: this block first quoted, as his verbatim words, the whole
paragraph of the session brief that carried his answer to this lane. Only the three words above are
his; the rest was the brief's reading of them, and it is kept below as that.]** The brief read "as
recommended" as sketch 116's own Recommendation (`README.md`, "## Recommendation"): the eleven
locked as recommended; rule 4 as road (a), the orders reject hold keeping its cancel seal because
main mints and redeems it (`ResponsesSheet` + `DELETE orders/:id`, ADR 0125); rule 3 as the deletion
of the cover-offer popover item, the shift row expander already sending; one ration rule for the wax
(rule 2) with rules 3, 4 and 8 as its consequences; and the critic's corrections recorded in that
README taken with it (rule 6's 120 ms fade against rule 1's "no eighth token", resolved explicitly;
rule 11's wait sentence changing at named thresholds, never counting every second, per WCAG 2.2.2).

This section is the enacted decision. It is stated against **sketch 116's own numbering** (its
"eleven specimens" table, `README.md:63-75`), not this ADR's original §1-10 / fork numbering,
because that is the frame the founder watched and answered against. Each row below names which of
this ADR's original sections or forks it resolves, and where sketch 116 found this ADR's own
drafted recommendation wrong, that correction is what is now locked — the original text below is
kept as the historical record of what was proposed and why (CLAUDE.md §0.2: "the rationale and the
rejected alternatives matter as much as the outcome"), not edited to match.

| # | Rule | Locked road | Resolves (this ADR) | Corrects this ADR's own drafted text? |
|---|---|---|---|---|
| 1 | The eighth literal folds | All four `{ easing: settle.easing, ms: 420 }` sites become the bare `settle` token (320ms). No eighth token, no `rise`. | §1 | No — locks the drafted recommendation as-is |
| 2 | One ration rule for the wax | `/profile`'s rule, both clauses, applied literally: wax where a server redeems a seal, or where nothing can undo the act. Rules 3, 4 and 8 are this rule's **consequences**, not separate arguments. | §2 | No |
| 3 | A send inside a `/team` popover | **Corrected.** Delete the "Offer cover" menu item; the shift row's expander already sends with its candidates in view. **Not** the ADR's originally-drafted road (a Panel the item opens) — sketch 116 found the expander is a second, undocumented send surface the ADR's fork 5 never named, and that the panel road would duplicate it. | Fork 5 | **Yes** — supersedes fork 5's drafted recommendation ("the popover offers, a panel sends") |
| 4 | Hold-to-reject | **Corrected.** Road (a): the reject **keeps** its cancel seal (census row 19 flips to `seal: true`; no code changes — `ResponsesSheet.tsx`'s hold and `DELETE orders/:id`'s 403-without-a-seal already mint and redeem it, ADR 0125, 2026-09-05). **Not** road (b) or the fork's own as-drafted road, both of which would strip a seal ADR 0125 already shipped eleven days before this ADR was drafted. | Fork 6 | **Yes** — supersedes fork 6's premise, which cited a "redeems no seal" note ADR 0125 had already retired before this ADR was drafted |
| 5 | The 96px swipe | Keep 96px. Add the resistance curve `p(1 - 0.22p)`, the ghost seal, the `stamp` landing on commit, and a non-dragging Confirm (arm, then confirm) as the WCAG 2.5.7 single-pointer alternative. Its arm window, which this lock did not settle (sketch 116's founder question 4), was answered the same day: **no timer** — his words, *"Until Esc or click away"*. Built in the shared `HoldToApprove`; see "Rule 5's arm window — locked" below. | Fork 8 | No |
| 6 | Reduced motion | A Sheet/Panel/Popover **entrance** crosses on a 120ms, opacity-only cross-fade under `prefers-reduced-motion`; every other motion in the house (the tear, the lean, the seal) still renders none. **The §1/§7 collision, resolved explicitly, per the founder's instruction above:** 120ms is disclosed by an ALLOW line in `scripts/check_motion_tokens.py`, cited by file:line to this section — it is **not** promoted to an eighth token, so §1's "no eighth token" stays literally true, and §7's guard is told about the one exception rather than going red on this rule's own shipped line. | §6, fork 9 | Clarifies (the ADR named the collision as a fork's *cost*, `README.md:70`, without stating which road; the founder's answer picks the ALLOW-line road over the named-constant road) |
| 7 | The CI motion guard | Ship it, re-specified: resolve every `MUDAVYM_PAGES` slug's directory from `App.tsx`'s own routing (never a `pages/*/next` guess); scan `components/layout/` and `components/mudavym/` as well as every resolved page directory; allow-list a disclosed exception by file:line, citing this ADR; exit 2 when a slug cannot be resolved. Built this session as `scripts/check_motion_tokens.py`, mutation-tested against synthetic fixture trees (`--self-test`), proven PASS against the real, now-fixed tree (20/20 slugs resolved, `/inventory` and `/documents/:id` among them, `components/layout/Sidebar.tsx` scanned) with exactly three disclosed exceptions: rule 6's fade and rule 11's two sheens. **Built in part:** it checks the `animate()` wrapper's token argument and plain-CSS `animation:`/`transition:` pairings, which is the class rule 1 folded. It does **not** yet produce three of the seven reds §10 and the sketch's drawn run require on the pre-fix tree — `/inventory`'s missing reduced-motion guard, `/documents/:id`'s missing `MOTIONS.md`, `Sidebar.tsx`'s framer-motion transition — all three still standing on the current tree **[2026-09-21, round 6: two no longer stand — `/inventory` has its guard (§8) and the house hint moves in CSS (§5(b)); the guard still cannot see either, and `/documents/:id`'s red stands]**, and §10's second guard, `scripts/check_no_emoji.py`, is not built. Both are owed under this lock ("NOT built here" below). `ci.yml` wiring is **done**, on the founder's word ("Motion token check" - yes, 2026-09-21) — see "Built in this lane" below. | §10, fork 10 | No — but built in part |
| 8 | `/calendar`'s delete | Keeps the wax, under rule 2's second clause (an act nothing can undo). Not the day-book undo-after alternative. | Fork 12 | No |
| 9 | Two wide sheets | Both forced to 440px — the census row 59 template sheet and (once packet 1's migration lands) row 33's delivery sheet. Not a third width, not an amended "or a table a person reconciles" clause. **[2026-09-21, round 6: a third `wide` caller this row did not name, `orders/next/ResponsesSheet.tsx`, stays at 640 on the founder's word — "Stays 640, it's letters" — because vendor replies are letters, the width's own case; this row's two sheets are unchanged. See "Round 6 answers", 4.]** | Fork 13 | No |
| 10 | Esc, the scrim and unsaved work | Keep packet 0's shipped shapes (a Sheet tears and leaves a Stub; a Panel leans and stays behind a plain footer button), split by SHAPE, and add primitive-internal `input`/`change` detection as a fallback to the `dirty` prop rather than requiring every call site to pass it correctly. | Fork 3 | No |
| 11 | The 1.9s shimmer (SC 2.2.2) | Two cycles (3.8s), then still, then the wait **in words, changing at named thresholds only** — 3.8s and 20s — **never a sentence that counts or ticks**. A counting sentence ("— 7s", updating every second) is itself an SC 2.2.2 auto-updating-information violation with no five-second exemption; that is the critic correction the founder's answer names explicitly. | §7 (first bullet) | Clarifies (the ADR's own text already said "the wait in words"; sketch 116's first pass drew a counting sentence against that text and its own critique caught the contradiction before this lock) |

### Built in this lane, now (cross-cutting, house-wide)

Rules **1, 6 and 7** touch no single page — they are the shared token file, the shared overlay
primitive, and a repo-wide guard — and are built in this same commit:

- **Rule 1:** `pages/dashboard/next/DashboardNext.tsx`, `SalesCalendar.tsx`,
  `pages/reports/next/ReportsNext.tsx`, `pages/calendar/next/CalendarNext.tsx` — the literal folded
  into `settle`; each page's own `MOTIONS.md` corrected from 420ms to 320ms.
- **Rule 6:** `apps/web/src/lib/mudavym/motion.ts` (the `animate()` wrapper gains an opt-in
  `respectReducedMotion` option, default `true` — every existing call site is unaffected);
  `apps/web/src/components/mudavym/Sheet.tsx` (`REDUCED_FADE`, `FADE_ENTER`, the entrance effect,
  `data-motion` now reads `'fade'` under reduced motion); `Sheet.test.tsx` and
  `housePolicy.test.tsx` updated to assert the new, correct behaviour rather than the old "renders
  none of it" claim (CLAUDE.md §5b — a corrected claim is struck and replaced, not left standing).
- **Rule 7:** `scripts/check_motion_tokens.py` (new), a `CLAIMS.jsonl` row that runs it, **and now
  wired into `ci.yml`** — `ci.yml` is gate-owned (`pr-audit-gate`), and the founder's word,
  2026-09-21: **"Motion token check" - yes**, one of exactly two `ci.yml` additions he authorized
  that day (the other is the migration order check). **One** new step in the `decision-claims`
  job, named `Motion token check -- …`, beside that job's other stdlib-only `check_*.py` guards:
  it runs `--self-test`, then the plain run, and fails on either. Nothing else in `ci.yml` changes.
  The `CLAIMS.jsonl` row (`ADR-0134-MOTION-GUARD-RULES-1-6-7`) is kept as a second, independent check
  — `ci.yml` blocks a PR that regresses the guard; the CLAIMS row blocks a PR that regresses this
  ADR's own text about what the guard does.
- **Disclosed limitation, rule 7:** the guard checks the house `animate()` wrapper and plain CSS
  only. `components/layout/Sidebar.tsx`, `Header.tsx`, `RestaurantBranchSwitcher.tsx` and
  `pages/cellar/next/WineRegister.tsx` animate through **framer-motion** (`transition={{ duration:
  0.15, ease: […] }}` JSX props), a second, older motion system this ADR does not fold into the
  token vocabulary and this guard cannot see. Sidebar's own migration was never one of the eleven
  rules the founder was asked to watch (sketch 116 does not draw it) and is not decided here —
  it remains this ADR's original §5, unlocked, open for a future pass. **[CORRECTED 2026-09-21,
  round 6: §5 is now locked ("Lock all four (Recommended)") and built — the house hint moves in
  CSS on `ink`, and the rail has its reduced-motion guard; see "Round 6 answers", 1. The guard's
  blindness to framer-motion stands: the legacy hint, the rail's width and the label reveals
  still animate through it at full motion, and this script still cannot see them.]**
- **Also invisible to the guard, measured 2026-09-21** (and named in its docstring): Tailwind motion
  utilities in `className` strings — `transition-colors duration-150` at
  `pages/receiving/next/DoorNext.tsx:652` (150 ms on Tailwind's own curve, not a token) and seven
  `transition-*` / `animate-spin` classes in `pages/inventory/command` — and the native
  `el.animate()` call (`pages/orders/next/DraftRail.tsx:65`, `:191`; today a timer drain and a
  `turn`-derived call, so neither is a violation). The guard's green therefore covers the `animate()`
  wrapper and plain CSS only.

### NOT built here — page-specific, owned by other lanes right now

Rules **2, 3, 4, 5, 8, 9, 10, 11** each live on one page (or two), several of which other lanes
are actively building on. Locking the rule here means a builder no longer re-litigates the wax —
it does not mean the code changes ship in this commit. In this ADR's own §"What it costs to build"
build order:

| # | Files it will touch |
|---|---|
| 2 | `pages/team/next/MOTIONS.md`, `pages/reports/next/MOTIONS.md`, `pages/reports/next/ReportsNext.tsx:366` (the dry die becomes the sentence), `pages/dashboard/next/OneTapPanel.tsx:560-570` (the die arm becomes a plain "Write it down" button), `BUILD-PROMPT.md` rule 3 (corrected: the bulk bar is a dry emboss, not a plain button) |
| 3 | `pages/team/next/WeekGrid.tsx:466-476` (delete the menu item), `WeekGrid.tsx:591-598` (one contract line above the expander's "Offer cover to N" button), `WeekGrid.tsx:391,565-569` (`coverSent` reads `notified` back from the mutation instead of `isSuccess`) |
| 4 | `.planning/07-reference/` census row 19 (`seal: false` → `true`) — no application code changes under road (a) |
| 5 | `pages/receipts/next/SwipeToConfirm.tsx:27` (`TRAVEL` stays 96px) — the resistance map, the ghost `Seal`, the handle fading on `ink` at commit, `stamp` on the seal landing, a non-dragging arm-then-confirm control reusing `HoldToApprove`'s (now untimed) arm window. The arm window itself is no longer owed here — see "Rule 5's arm window — locked" below |
| 8 | No file changes — the wax stays as-is under rule 2's clause 2; nothing to build |
| 9 | `apps/web/src/pages/communications/next/TemplateSheet.tsx:135` (`wide` removed), the delivery sheet once packet 1's migration lands (currently a legacy, untouched `ManualReceiptWorkspace.tsx` modal) |
| 10 | `feat/overlays-packet-0-primitive` (not yet an ancestor of `main`) — one `input`/`change` listener on the panel node the primitive already owns, as a fallback to the `dirty` prop |
| 11 | `pages/dashboard/next/dashboard-next.css:44`, `pages/reports/next/reports-next.css:391` (`animation-iteration-count: 2`, a `data-still` end state, two static sentences at 3.8s and 20s from the skeleton host — no interval, no counting) |
| 7 (rest) | `scripts/check_no_emoji.py` (new — §10's second guard; sketch 116's cost row 7 names both scripts); `scripts/check_motion_tokens.py` widened to the three §10 reds it does not produce (`pages/inventory/command` has no reduced-motion guard; `pages/documents/next` has no `MOTIONS.md`; `components/layout/Sidebar.tsx`'s framer-motion transitions) and to Tailwind motion utilities; each line it then fails on either fixed by its page's lane or allow-listed by file:line with this ADR cited. `.github/workflows/ci.yml` wiring is **done** (2026-09-21, lane last call — the founder's "Motion token check" - yes) — no longer owed. **[2026-09-21, round 6: two of the three reds are now fixed in the tree — `/inventory` has its reduced-motion guard (§8) and the house hint no longer moves through framer-motion (§5(b)) — so a widened guard would find them green; widening it, so that a regression of either goes red, is still owed. `/documents/:id`'s missing `MOTIONS.md` is untouched.]** |


### Rule 5's arm window — locked 2026-09-21, lane last call

Sketch 116's founder question 4 (rule 5's non-dragging Confirm) asked whether the control's
inherited 3 s arm window stays as-is, lengthens, or becomes untimed. Put to the founder directly in
this lane (`wt-motions` / `feat/motion-rules-locked`); his answer, verbatim:

> Until Esc or click away

**Status of this rule: Locked, with his words.** No timer. The two-step Confirm — one press arms
it, the next confirms — stays armed until the reader disarms it explicitly: **Escape**, a
**pointerdown outside the control**, or (page-owned, wherever the control is mounted inside an
overlay) **the sheet closing**. A fixed auto-disarm is itself the kind of timed gesture WCAG 2.2.1
Timing Adjustable (Level A) requires a way to turn off, extend or adjust — the criterion sketch
116's founder question 4 named without resolving; "no timer" removes the exposure rather than
adding a control for it.

**Built here:** `apps/web/src/components/mudavym/HoldToApprove.tsx` — the shared primitive rule 5's
own Confirm control is specified to reuse (§"What it costs to build", row 5, above). `ARM_WINDOW_MS`
and its `setTimeout` are removed from `arm()`. While `phase === 'armed'`, two document listeners
disarm it: `keydown` Escape, wherever focus is (a pointer arm under reduced motion leaves focus
where it was, and Safari does not focus a clicked button), and a capture-phase `pointerdown` whose
target the button does not contain (capture, so an element that stops propagation cannot keep it
armed; the button itself excluded, so the press that confirms is never read as a click away). The
sheet closing disarms it by unmount: `Sheet` renders null when closed, and no timer outlives the
component. `HoldToApprove.test.tsx` gains six cases — armed past 3 s with no input, Escape on the
control, Escape with focus elsewhere, a pointerdown outside, a pointerdown outside on an element
that stops propagation, and a pointerdown on the control itself that confirms rather than disarms.
Three mutations were each caught by exactly one case: the timer reinstated, the document Escape
listener removed, the pointerdown listener moved to the bubble phase (CLAUDE.md's "a NO-OP mutation
is a failed test").

**Not touched here, page-owned:** two page-local copies of the identical `ARM_WINDOW_MS = 3000`
pattern sit outside this primitive — `pages/receiving/next/DoorSeal.tsx` and
`pages/orders/next/BulkApproveBar.tsx` — each its own hand-rolled arm/confirm, not an instance of
`HoldToApprove`. Whether this same ruling reaches them is each page's own lane's call to make and
record; they are named here so neither lane re-derives the question sketch 116 already asked.

### Round 6 answers — locked 2026-09-21

Everything "Not locked by this answer" (below) held open was put to the founder in this lane
(`wt-motions` / `feat/motion-rules-locked`, PR #433) as four questions. His picks, verbatim — each
is the label of the option he chose; what each option meant is the orchestrating session's brief
relaying it to this lane, not his words, and is written below as that:

> Lock all four (Recommended)

> Passkey + paste (Recommended)

> Bring back, real switches (Recommended)

> Stays 640, it's letters (Recommended)

Before building, each was checked against what packets 0-2 already shipped (grep over the merged
tree, 2026-09-21): none of it was there — no no-enter-animation option on the primitive, no
`prefers-reduced-motion` read anywhere under `components/layout/` or `pages/inventory/command/`, no
`line-height` on `.mdv-chip`, no passcode field. So everything under 1 below is new in this lane.

**1. "Lock all four (Recommended)" — §4, §5, §8 and §9, exactly as this ADR drafted them.**
Status: **Locked, and built.**

- **§4.** One boolean on the primitive, `instant` (`components/mudavym/Sheet.tsx:268`, default
  `false` at `:475`): the entrance effect schedules nothing (`:730`) and `data-motion` reads
  `'none'` (`:1069`) — in both motion settings, so neither the shape's token nor §6's 120 ms fade.
  Passed per surface, never per opener: `components/command/CommandPalette.tsx:264`,
  `components/askai/AskAiBar.tsx:170`, `components/command/RecentlyViewed.tsx:73`,
  `components/command/ShortcutsSheet.tsx:71`. The palette does not animate its filtering: its
  listbox carries `mdv-list-still` (`CommandPalette.tsx:308`), which sets `transition: none` on its
  rows (`sheet.css:488`) — the 160 ms seal-tint fade a surviving row re-ran on every keystroke. No
  FLIP existed to remove. **Not reached, and put back to the founder rather than decided here:**
  the flag-off (legacy) branches of the palette and Ask AI still enter on their own 120 ms
  `motion-safe:animate-[popIn…]` (`CommandPalette.tsx:387`, `AskAiBar.tsx:312`), over a 120 ms
  scrim `motion-safe:animate-[fadeIn…]` (`CommandPalette.tsx:384`, `AskAiBar.tsx:309`) **[the scrim
  half added 2026-09-21, lane last call — the first pass named only the popIn]**; removing them
  would be a removal of motion for flag-off tenants, which §4's text does not name either way.
  **[Answered 2026-09-22, round 6y: "Leave legacy alone (Recommended)" — they stay, and go with
  the legacy branch at the cutover. See "Round 6y answers" below.]**
  Flag-off Recently viewed and Keyboard shortcuts carry no entrance animation to remove.
- **§5.** (a) The rail's reduced-motion guard, on every route and ungated, in three halves keyed
  on one `useReducedMotion()` read (`components/layout/Sidebar.tsx:421-428`): the rail carries
  `data-reduced-motion` (`:558`) and `components/mudavym/reduced-motion.css` (new) removes every
  CSS transition and animation under it (the drawer slide, the colour fades);
  `lib/mudavym/ReducedMotionScope.tsx` (new) lands the rail's framer-motion children with no frames
  (the four label reveals, the Learn & Help panel); and the two framer elements that name their own
  transition, which beats any scope, are switched where they are named — the width (`:556`) and
  the legacy hint, which starts at its end state (`:289`). For a reader who has not asked for less
  none of it is present: no attribute, a scope handed nothing. (b) The house branch's hint is a
  plain element that enters on `ink` 160 in CSS, inside `@media (prefers-reduced-motion:
  no-preference)` only (`sheet.css:693-707`); the legacy branch keeps framer's 150 ms. Its
  `-translate-y-1/2` is dropped because framer's inline `transform` always overrode it, so its
  geometry is unchanged (pinned by test). (c) The 260-to-72 collapse keeps its 200 ms Material
  curve at full motion, recorded as the last unmigrated chrome. **A reading, disclosed and put back
  to the founder:** (a)'s guard does reach (c) under reduced motion — the width lands with no
  frames. "Left alone" was read against its own rejected alternative (migrating it to `settle`),
  not as "exempt from the guard"; a founder question asks whether he meant untouched even then.
  **[Answered 2026-09-22, round 6y: "Reduced motion wins (Recommended)" — the reading stands; the
  guard reaches the collapse. See "Round 6y answers" below.]**
  The false "Tokens only (ADR 0112)" comment is corrected in place, bracketed
  (`Sidebar.tsx:254-265`).
- **§8.** `/inventory`'s guard, inside the component (`pages/inventory/command/
  InventoryCommandPage.tsx:124-152`), a pure removal: the page root carries the same attribute
  (`:860`) and stylesheet (its Tailwind `transition-*` / `animate-spin` classes), and the same
  `ReducedMotionScope` wraps the page, because the four legacy modals it opens
  (`AddWineSelectionModal`, `AddWineToInventoryModal`, `AutoLocatePreviewModal`,
  `RemoveFromInventoryModal`) animate through framer-motion, some portalled out of the root where
  CSS cannot follow. **Residue, named:** `AutoLocatePreviewModal` names its own opacity
  transitions (200/220 ms), which beat any scope, so under reduced motion it still fades — it no
  longer scales or rises. The `ink` swap and the `settle` row expand stay deferred, unbuilt.
- **§9.** `.mdv-chip` declares `line-height: 1.5` (`sheet.css:658`) — the value it already
  inherited, so nothing moves. Measured 2026-09-21 in headless Chromium (Playwright 1.59.1) on a
  harness loading the real `styles/mudavym.css` and `sheet.css`: **24.5 px** tall on its own
  line-height; the same chip at `line-height: normal` (no Tailwind preflight) is **22.0 px**, the
  fail the dependency hid; the shortest, one-letter chip is 43.47 x 24.5 px. **The spacing between
  adjacent chips: there are none.** `apps/web/src` holds exactly one `.mdv-chip`
  (`askai/AskAiBar.tsx:222`), and its only neighbour is a non-interactive `<span>` 8 px away. The
  Spacing exception never arises: the chip passes SC 2.5.8 on size, in both axes, by itself.

Tests: `Sheet.test.tsx` "an instant surface" (with the non-instant control), `shellOverlays.test.tsx`
(the four surfaces, `data-motion="none"`), `components/mudavym/motionRules0134.test.ts` (the CSS
halves, read from the stylesheets because jsdom cannot cascade), `layout/Sidebar.motion.test.tsx`,
`lib/mudavym/ReducedMotionScope.test.tsx` and `InventoryCommandPage.reduced-motion.test.tsx` — every
framer case beside its full-motion control. **Mutation-tested, 24 mutations, none a no-op:** each of
the four `instant` props, the effect's and `data-motion`'s `instant` reads, the listbox class, the
chip's line-height (dropped, and 1.4), the palette rows' `transition: none`, the hint's duration and
its media query, the guard stylesheet's media query and its `animation: none`, both surfaces'
attribute and scope, the rail's width switch, the legacy hint's start state, the house hint's
geometry, and the scope's two halves and its reduced gate — each failed its suite, and the source
was restored byte-identically.

**2. "Passkey + paste (Recommended)" — §7's SC 3.3.8 bullet.** Status: **Locked.**

- **Paste, nothing to build, measured.** There is no manager passcode field to fix: `git grep -i
  passcode` returns 0 hits under `apps/` and `supabase/` (2026-09-21) — the passcode is still
  ADR 0112 F11's ceremony, unbuilt. Nothing in `apps/web/src`, `apps/mobile/app` or
  `apps/mobile/src` blocks paste: 0 `onPaste`, 0 `contextMenuHidden`, 0 native `paste` listeners.
  The `autoComplete="off"` sites are not passcodes — three model-context-server credential fields
  (`connections/next/HouseServerControls.tsx:268`, `profile/next/McpRegister.tsx:196` and `:549`, a
  third party's bearer token, not the reader authenticating, so 3.3.8 does not reach them), search
  and palette inputs, the door's initials and driver's name. **[Corrected 2026-09-21, lane last
  call: this said "two" credential fields and cited only `:549`; `McpRegister.tsx:196` is the same
  field on each stored server's replace form.]** The sign-in and current-password fields
  (web `pages/Login.tsx`, `pages/Profile.tsx`, `profile/next/SecurityRegister.tsx`; mobile
  `app/login.tsx`) carry `current-password`, which a password manager fills. So nothing is removed. The rule binds the
  field the day F11 builds it: it accepts paste and turns no password manager away (no paste
  block, no `autocomplete` that refuses one). Two `CLAIMS.jsonl` rows hold it:
  `ADR-0134-SC338-NOTHING-BLOCKS-PASTE` (resolved — fails the build on a paste block) and
  `ADR-0134-SC338-MANAGER-PASSCODE-UNBUILT` (open — the day a manager passcode lands in code it
  fails the build, so its builder meets this rule and flips the row with the field's own check).
- **Passkey — a named later lane, not built here.** Its scope as recorded: **WebAuthn**; **per
  user** (each owner or manager enrols their own credential — never per house, never per device);
  **owner and manager only**; a **peer path** beside the passcode, neither replacing the other;
  enrolment and revocation on **`/profile`**; **audited** — who enrolled or revoked which
  credential and when, and each use at a point of action written as the passcode's use would be.
  It waits on F11's point-of-action ceremony existing, since a peer path needs the path it sits
  beside.

**3. "Bring back, real switches (Recommended)" — fork 14.** Status: **Locked; a named later lane,
not built here.** The consent panel comes back, opened from the rebuilt `/settings`, and holds
**only switches the product actually reads**: the per-house ask-training opt-out, Jev scoring on or
off, and any legacy consent once something is wired to read it. **Owner only; every flip audited.**
The four legacy consents are **not** shown as switches, because nothing reads them
(`pages/settings/next/ServicesSection.tsx:4`, that page's own four-runtime re-grep). Why recorded
and not built: it is not a pure UI move — measured 2026-09-21, neither switch has a store the
product reads (0 hits for an ask-training opt-out or a Jev setting under `apps/` or
`supabase/migrations/`). The brief names PR #430 as building the opt-out store; `gh pr diff 430`
(open, `feat/finish-authorize-consent`) carries 0 hits for `opt.out` / `opt_out` / `optOut`, and its
own ADR 0145 amendment lists training consent as still open — so this lane waits on whichever
change lands that store, and the discrepancy is reported back rather than resolved here.
**[Answered 2026-09-22, round 6y: #430's head now carries the opt-out store, and the Jev switch
is #435's — see "Round 6y answers" below, fork 14's stores.]**

**4. "Stays 640, it's letters (Recommended)" — sketch 116's founder question 6, under rule 9 /
fork 13.** Status: **Locked.** `pages/orders/next/ResponsesSheet.tsx:359`'s `wide` stays at 640,
because vendor replies are letters a person reads back — the width's own case ("A LETTER only",
`Sheet.tsx`'s `wide` doc), not a third width, so rule 9's two forced-to-440 sheets are unchanged.
Recorded at the call site (`:356-358`) and in that doc (`Sheet.tsx:251-255`), which now names both
letter callers, the composer and the vendor answers. No guard checks `wide` — measured, no script
and no test checks which callers pass it (`Sheet.test.tsx` exercises the primitive's own `wide`,
not its callers) **[corrected 2026-09-21, lane last call: this said "no test … reads the prop",
which `Sheet.test.tsx` does]** — so there is no allow-list to name it in; the call-site note is the
record. `communications/next/TemplateSheet.tsx:135`'s `wide` is rule 9's own, still owed by its
lane.

### Not locked by this answer

**[CORRECTED 2026-09-21, round 6: every item below is now answered — see "Round 6 answers —
locked 2026-09-21" above. The list is kept as it stood, for the record of what was open.]**

"Lock as recommended" answers the eleven rules sketch 116 drew. It does not reach what the sketch
did not draw or drew without a recommendation, so these stay **Proposed** until the founder answers
them, and no builder should read the Status line above as covering them:

- **Sections of this ADR outside the eleven:** §4 (a keyboard-opened overlay does not animate), §5 /
  fork 1 (the sidebar), §7's SC 3.3.8 bullet (the manager passkey and paste into the passcode
  field), §8 / fork 2 (`/inventory`'s gating and deferred swaps), §9 (the chip's explicit
  `line-height`), fork 14 (the unreachable consent panel, "not defaulted here" in its own text).
  Rule 2's lock does answer fork 4 and §3: wax versus nothing, the bulk bar a dry emboss.
  **[Answered 2026-09-21: §4, §5, §8, §9 — "Lock all four (Recommended)"; §7's SC 3.3.8 bullet —
  "Passkey + paste (Recommended)"; fork 14 — "Bring back, real switches (Recommended)".]**
- **Raised by sketch 116 with no recommendation, still open** (its founder question 6): whether
  `ResponsesSheet.tsx:356`'s `wide` stays at 640 as letters or is a third sheet under rule 9.
  Founder question 4 — rule 5's arm window — is now answered; see "Rule 5's arm window — locked"
  above, not here. **[Answered 2026-09-21: "Stays 640, it's letters (Recommended)". The prop now
  sits at `:359`.]**

### Round 6y answers — locked 2026-09-22

The three residues round 6 put back to the founder (its own review-trail row: "whether §4 reaches
the flag-off palette and Ask AI, whether §5(a)'s guard may reach the collapse under reduced
motion, and where the opt-out store PR #430 was named for actually lands") were put to him by the
orchestrating session as two picks; fork 14's stores came back to this lane (`wt-motions` /
`feat/motion-rules-locked`, PR #433) as facts to cite, not as a pick. His picks, verbatim — each
is the label of the option he chose; what each meant is the orchestrating session's brief
relaying it, not his words, per this record's own discipline:

> Leave legacy alone (Recommended)

> Reduced motion wins (Recommended)

**1. "Leave legacy alone (Recommended)" — §4's flag-off residue.** Status: **Locked; no code
change.** The palette's and Ask AI's legacy (flag-off) entrance stays exactly as round 6 found it,
because the legacy branch is deleted whole at the cutover rather than migrated piece by piece —
removing its entrance now would be work thrown away with the branch it sits in. Re-verified in this
lane, 2026-09-22, byte-identical to round 6's own citations: the scrim `motion-safe:animate-
[fadeIn_120ms_ease-out]` at `CommandPalette.tsx:384` / `AskAiBar.tsx:309`, the surface
`motion-safe:animate-[popIn_120ms_ease-out]` at `CommandPalette.tsx:387` / `AskAiBar.tsx:312`.
§4's Locked road (the four `instant` house-branch surfaces) is untouched by this answer.

**2. "Reduced motion wins (Recommended)" — §5(a)'s residue over §5(c)'s collapse.** Status:
**Locked; already built, now confirmed rather than changed.** Round 6 disclosed a reading it had
not settled: "(a)'s guard does reach (c) under reduced motion — the width lands with no frames,"
against "left alone" possibly meaning untouched even then. The founder's pick keeps the guard's
reach: re-measured in this lane, 2026-09-22, at the same line, the rail's 260-to-72 width collapse
(`Sidebar.tsx:556`) still reads `transition={reduced ? NO_MOTION : { duration: 0.2, ease: [0.4, 0,
0.2, 1] }}` — instant under `prefers-reduced-motion`, the 200 ms Material curve at full motion,
exactly the "as built" state this answer names. Nothing in code changes; "left alone" in §Decision
5 is now settled to mean "exempt from migrating to `settle`," never "exempt from the
reduced-motion guard."

**3. Fork 14's stores — reported as facts, not decided as a fork.** Round 6 measured neither
switch had a store the product read (2026-09-21: "0 hits for an ask-training opt-out or a Jev
setting under `apps/` or `supabase/migrations/`"). Each now has an owning branch, open, which this
lane does not own and did not build; the rebuilt consent panel reads both:

- **The ask-training opt-out store — PR #430** (`feat/finish-authorize-consent`, OPEN, head
  `a04aaa4e1`, checked 2026-09-22): `ask_training_opt_outs` (migration
  `20260921171200_ask_training_opt_out_and_reask_labels.sql`), one row per house, RLS on,
  `set_by_role` constrained to `owner` by a CHECK, written through `PUT /settings/ask-training`
  (`house-ask-training.controller.ts`, owner only) and audited (`ask_training_opt_out_changed`).
  Built at that head; this confirms round 6's own citation of PR #430 for this store.
- **The owner's acceptance that turns Jev on — PR #435** (`feat/vendor-scorecard`, OPEN, ADR
  0207), not #430. The founder ruled it in the same round, on ADR 0207, which owns the answer; his
  words, verbatim as relayed to that lane:

  > owner only, but also we're going to use this as complete data and privacy usage, they have to accept that, and when they do they'd accept the jev too with their names and sensitive topics redacted

  So the switch is the **owner's** acceptance of the house's complete data and privacy usage
  terms; accepting them is what turns Jev on, with names and sensitive topics redacted before
  anything leaves. That matches fork 14's own locked line above — **owner only; every flip
  audited**. Where the acceptance is kept, how it is versioned, and what withdrawing it does are
  ADR 0207's to decide and are not restated here. **Not built at #435's pushed head yet:** measured
  2026-09-22 at `a7898464c`, that head still carries the switch the ruling replaces —
  `restaurants.vendor_tone_scoring_enabled` (default `false`, set by owner **or manager**, audited
  `vendor_tone_scoring_changed`), with ADR 0207's question 13 still asking "owner only, or owner
  and manager (built: both, the house-settings rule)?". Read this bullet against #435 after its
  round-6y build lands, never against `a7898464c`. The retention of what Jev receives here stays on
  **OD-133**, which the same round widens to name TypeSafe (ADR 0207's lane, not this one).

No consent panel reads either store yet (#430's is read by its own training export,
`ask_folio_training_export`, in the same migration, and by the settings service): the rebuilt
consent panel fork 14 locked in round 6 ("Bring back, real switches") is still that round's "named
later lane, not built here." What this round changes is only that the panel, once built, has two
stores with owners to read and write — #430's, built, and #435's, being built — rather than none;
the panel itself is not this lane's to build and stays unbuilt here.

**4. Docs only — the tree agreed with the founder before anything was written.** Both motion
answers were checked against the tree first, and §4 and §5(c) already matched their "as built"
claims verbatim, so nothing in this branch's code changes. Fork 14's stores are facts about two
other branches, recorded above with the head each was read at; neither is this lane's to build, so
neither is a must_fix here.

**5. Migration band for this lane: none.** No file under `supabase/` is touched here — fork 14's
stores belong to their own lanes (PR #430, PR #435), not this one.

## Context

ADR 0112 settled what shape an overlay takes. Nothing settled what a *motion* means, and the
founder asked for agents to decide the best motion and the best overlay design **for each page**,
with no shortcuts: *"everything we touch must fully serve its purpose to its max capacity —
functionality, endpoints, UI UX, smoothness, and most importantly the design."*

Four passes ran per CLAUDE.md §3 — a motion finder over every act on every page, an overlay finder
over every census row, a measurement pass over what the code actually carries, and an adversarial
pass that tried to kill the first two from six angles they had not used (the floor, the founder's
existing rulings, byte-identical-off, accessibility beyond what they cited, the evidence itself, and
the three passes' contradictions with each other). This ADR is the judged result. The reports are
named in the review trail; nothing below is asserted from a finder's text alone.

**Three things happened between the finders reading the tree and this decision, and they change
what is still open.** Packet 0 rebuilt the primitive to sketch 103 (`label` is always the accessible
name plus a new `contract` sentence wired to `aria-describedby`; **a Sheet's default scrim is now
off**; `dirty` / `onTear` / `Stub`; a Panel that leans under weight; `HoldToApprove.boundSummary`;
`SheetStack` capped at three with a spoken refusal and the phone detents; `Denied` and `Refused`; a
house-policy test read from source; and it filed the outside-click fork rather than defaulting it).
Packet 1 built the ten migrations, **gated inside the component** on `/inventory`. Packet 2 built the
twelve owed acts. Four of the adversary's ten forks are therefore answered by shipped work, and this
ADR records which.

**One correction to the adversary's own standing note.** It recorded that the code tree carried the
168-line *Proposed* copy of ADR 0112 without F1-F12. On `feat/mudavym-design-p4` at the tip this
session read, `.planning/decisions/0112-one-modal-policy-three-shapes-one-primitive.md` is the
**387-line Locked copy**, ratified 2026-09-05, F1-F12 and the authority rule included. The merge that
brought it across landed after the finders read. Verdicts that said "matches ADR 0112" were checked
against the short copy and now have the long one to be checked against.

## Options considered

For each rule change the alternatives are recorded beside the decision in §Decision; they are not
repeated here. The one structural option worth naming and rejecting up front:

1. **Decide motion per page, as each page is next opened.** Cheapest, and it is what produced the
   state being corrected — fifteen measured cross-page disagreements, three incompatible rules for
   the same ceremony, and one act answered five different ways.
2. **Decide motion once, house-wide, and let pages record exceptions with reasons.** More expensive
   now; it is what the seven tokens were for. **Taken.**
3. **Do nothing.** Costs: the four raw `{ easing: settle.easing, ms: 420 }` literals stay invisible
   to CI; three live WCAG exposures stay open, one of them **Level A**; and the next page pass
   re-litigates the wax.

## Decision

**A motion answers an act. Every page answers the same act with the same motion, and a page that
answers differently records the exception, in its own note, with its reason.** The act table, the
vocabulary as measured and the full argument are in
[`06-pages/DESIGN-FOUNDATION.md`](../06-pages/DESIGN-FOUNDATION.md) §6g. Ten things change a house
rule, and each is the founder's to lock:

### 1. The eighth literal is folded, not promoted

`{ easing: settle.easing, ms: 420 }` — the house curve at `turn`'s duration, a pairing in no token —
is a raw literal in four files: `pages/dashboard/next/DashboardNext.tsx:68`,
`pages/dashboard/next/SalesCalendar.tsx:75`, `pages/reports/next/ReportsNext.tsx:139`,
`pages/calendar/next/CalendarNext.tsx:212`. Two pages already animate the identical keyframes for
the identical act at 320 with the token proper.
**Decided: all four become `settle` 320. No eighth token.** Pages that change: `/`, `/reports`,
`/calendar`. Stated cost: the sales calendar's month stagger gets ~100 ms faster per cell; its
identity is its 16 ms x 0.94 delay decay, which is unchanged.
*Rejected:* mint `rise = { easing: HOUSE, ms: 420 }` and move all five opening lines to it. It is a
defensible answer and it is the founder's fork; what is not defensible is leaving a literal repeated
four times, because that is how the next divergence starts.

### 2. One ration rule for the wax, replacing three

Three rules were in force and they disagree on live cases: `/profile`'s **mechanical** rule,
`/team`'s **consequence** rule, `/reports`' **counter-party** rule.
**Decided: `/profile`'s, both clauses, applied literally — the seal appears exactly where a server
redeems one, plus an act that is irreversible in this house and has no server to ask.**
Consequences, applied without exception: `/orders`' reject loses the wax **and** the hold, keeping a
required reason; the dashboard's un-sealed `die` arm (ADR 0127) becomes a plain button;
`/calendar`'s delete **keeps** the wax under clause 2; `/team`'s publish and copy-week keep it.
*Rejected:* the counter-party rule (true of `/reports`, false of `/team`); the consequence rule
(true of `/team`, silent on `/profile`'s gateway acts); and the recommendation that adopted the
mechanical rule and then demoted `/calendar`'s delete while keeping `/team`'s two destructive acts
sealed by the same clause — the same rule applied two ways in one paragraph.

### 3. The dry emboss is not a second ceremony

**Decided: it stays where it is — `/orders`' bulk bar — and it is named the *plural rendering of the
wax*, not a lesser one.** It appears only where the wax would have appeared, many times over, so it
cannot dilute the ration.
*Rejected:* promote `<Seal pressed dry />` to a general second ceremony for every non-wax act. The
argument against it is the one neither report made: if every non-wax act embosses, the wax no longer
stands against *nothing*, it stands against *a smaller stamp*, and "rationed" collapses in the other
direction. **Consequence: `BUILD-PROMPT.md` rule 3 ("Bulk gets a plain button") is false today —
the shipped bulk bar is a dry emboss — and must be amended to say what this rule says.**

### 4. A keyboard-opened overlay does not animate — per surface, not per opener

**Decided: the command palette, Ask AI, Recently viewed and Keyboard shortcuts render with no enter
animation at all, always, whatever the motion setting.** **[2026-09-22, round 6y, "Leave legacy
alone (Recommended)": in the house branch. The flag-off palette and Ask AI keep their 120 ms
entrance until the cutover deletes the legacy branch.]** One boolean on the component. And **the
palette does not animate its filtering either**: a FLIP on survivors with every keystroke is the
textbook case the source rule names ("never animate keyboard initiated actions… repeated sometimes
hundreds of times a day").
*Rejected:* decide at runtime from how this particular open happened — the same trigger would then
give two different products depending on mouse or keyboard, and a phone with a Bluetooth keyboard is
undefined.

### 5. The sidebar migrates inside the house branch only, byte-identical off

`components/layout/DashboardLayout.tsx:68` renders `<Sidebar />` on **every** route, so a motion
change here reaches a flag-off tenant. **Decided, in three parts:** (a) the **reduced-motion guard
goes in now, ungated**, because it only ever removes motion; (b) the **hover hint**
(`Sidebar.tsx:256-260` and `:275-280`) takes `ink` 160 in CSS **inside the `.mudavym` branch only** —
the branch already exists at `:254` for colour and only the motion was left behind; (c) the
**260-to-72 width collapse** (`Sidebar.tsx:512-515`) is **left alone** and recorded as the last
unmigrated chrome, to die with the legacy pages. **[2026-09-22, round 6y, "Reduced motion wins
(Recommended)": "left alone" means not migrated to `settle`; (a)'s guard still reaches the
collapse, which lands with no frames under reduced motion (now at `Sidebar.tsx:556`).]**
*Rejected:* animating `width` on `settle` 320 — a layout property, 60 % longer than today, on every
legacy page. The comment at `Sidebar.tsx:250-251` claiming the hint is "Tokens only (ADR 0112)" is
false about the motion in both branches and is corrected in the same commit.

### 6. Under reduced motion, arriving surfaces cross-fade; everything else renders none

**Decided: keep "nothing" as the default and add one exception — a 120 ms opacity-only cross-fade
for a Sheet, Panel or Popover *entrance*.** A modal that appears with zero frames is genuinely
harder to notice, and noticing it is functional. WCAG 2.3.3 is **Level AAA** and lists "avoid
unnecessary animation" as one conforming technique, so the exception costs no conformance; the
field's most-cited practitioner's own reduced-motion example is `animation: fade 0.2s`, and Apple's
guidance is a cross-dissolve, not a removal. Everything that expands in place keeps zero.
**Stated cost, and it is why this is a fork:** it contradicts one of the seven rules packet 0 just
shipped as a guard — `components/mudavym/housePolicy.test.ts` asserts the primitive renders *none*
of it. The rule must become "renders **no movement** — opacity only, one duration, named", and
`Sheet.test.tsx`'s `data-motion="none"` assertion changes with it.

### 7. The three accessibility criteria, each decided

- **SC 2.2.2 Pause, Stop, Hide (Level A) — live, and all three passes marked it clean.** A 1.9 s
  infinite shimmer runs in parallel with interactive content (`dashboard-next.css:44`,
  `reports-next.css:391`); the preload exception needs "interaction cannot occur", and on both pages
  the header, the rail and the other tiles are live. **Decided: two cycles (3.8 s), then still, then
  the wait in words** — under the five-second trigger, so the criterion is met with no control, and
  the result is the house's own anti-spinner idiom. The `prefers-reduced-motion` exemption both files
  carry is a **2.3.3 (AAA) technique**, not a 2.2.2 mechanism.
- **SC 2.5.7 Dragging Movements (Level AA) — live.** `SwipeToConfirm` has a keyboard path and **no
  single-pointer non-dragging alternative**. **Decided: `TRAVEL` stays at 96 px
  (`SwipeToConfirm.tsx:19`)**; the control gains the resistance curve `p(1 - 0.22p)`, the ghost seal,
  the `stamp` landing **and a plain Confirm that arms and confirms**. The same rule binds `/team`'s
  two unbuilt drag behaviours and the phone sheet's detent grabber (a tap cycles peek, half, full —
  which packet 0 already built).
- **SC 3.3.8 Accessible Authentication, Minimum (Level AA).** A remembered four-digit manager
  passcode is a cognitive function test; the criterion names memorisation and transcription
  explicitly and none of the sketch 102 research files cites it. **Decided: the manager's own passkey
  is a peer path, and the passcode field accepts paste from a password manager.** Enrolment lives on
  `/profile` and does not exist yet.

### 8. `/inventory` reaches the tokens through its overlays, gated inside the component

`App.tsx:311` renders the **same component** in both arms of the gate, with a comment saying so.
**Decided, and already executed by packet 1: gate inside the component.** The `ink` micro-state swap
and the `settle` row expand are **deferred, not refused** — both need `.mudavym`-scoped CSS beating a
Tailwind utility on a page with no page CSS file, so neither is the one-line swap it was described
as, and both carry all of the byte-identical risk with none of the accessibility benefit. **What this
page needs first is its reduced-motion guard**, which is a pure removal and is the only safe change.

### 9. The chip is not a target-size failure, and it becomes one the house controls

`.mdv-chip` (`components/mudavym/sheet.css:441-454`) sets 11 px font, 3 px padding, a 1 px border and
**no `line-height`**, so it inherits Tailwind 3.4 preflight's unitless `1.5`: 16.5 + 6 + 2 =
**24.5 px**, which **passes** SC 2.5.8. The reported ~21 px failure assumed `normal` without saying
so. **Decided: set `line-height` explicitly** — a 24 px pass that depends on a framework's preflight
is a pass the house does not control — **and measure the Spacing exception between adjacent chips**,
which nobody has.

### 10. Two guards exist, or the rest of this is prose

`ls scripts/ | grep -iE 'motion|token|overlay|modal|emoji'` returns nothing across 53 `check_*`
scripts. **`scripts/check_motion_tokens.py`**, written the way `check_money_routes_are_sealed.py` is
— reading the call graph, not a directory convention. It must **enumerate the rebuilt slugs from
`MUDAVYM_PAGES` and resolve each slug's directory from `App.tsx`** (`/inventory` lives at
`pages/inventory/command`, so a guard written against `pages/*/next` **cannot see the page it was
written for**); it must scan **`components/layout/` and `components/mudavym/`** as well as `pages/`
(`Sidebar.tsx` is in neither `pages/` nor `next/`); it must **allow-list the two disclosed sheens by
file and line, with the ADR that approved them** (a guard that goes red on an approved exception is
disabled within a week); it must **exit 2 when it cannot resolve a slug**; and it must be **proven
against the pre-fix tree**, going red on all four `ms: 420` literals, on `/inventory`, on
`/documents/:id` and on `Sidebar.tsx`, and **not** on the two sheens.
**`scripts/check_no_emoji.py`.** `BUILD-PROMPT.md` rule 8 reads "No emoji, anywhere — a guard
checks", `git grep -l emoji -- scripts .github` returns nothing, and none of the 53 scripts is named
for it: a rule that asserts its own enforcement without it is this house's named fault class, inside
the document written to prevent it. Packet 0 has since added an emoji assertion inside
`components/mudavym/housePolicy.test.ts`, which covers the **primitive family's own source only**;
the repo-wide guard rule 8 claims is still owed.

## The founder's forks

The adversary ranked ten. Four are answered by packets 0-2 and are recorded as such; six are live.
Four more are raised here.

| # | Fork | Recommendation |
|---|---|---|
| 1 | **The sidebar** — fix it, gate it, or name it as the last legacy chrome | **Split it three ways** (§Decision 5). The guard now, ungated; the hint in the house branch; the collapse left alone and recorded. Fixing the comment's false claim costs one line and is not optional |
| 2 | **`/inventory`** — how does the packet get built without breaking flag-off | **Answered by packet 1: gated inside the component.** What remains is my call and I have taken it — **drop the `ink` swap and the row expand from this pass**, do the reduced-motion guard |
| 3 | **Esc, the scrim, and unsaved work** | **Answered by packet 0** (`dirty` / `onTear` / `Stub`, Panel weight, Sheet scrim default off). Two residues for you: packet 0 splits the behaviour **by shape** (a Sheet tears, a Panel leans) where the adversary argued for splitting **by dirtiness**, because on a floor the reader must otherwise know the shape to predict what Esc does; and packet 0 takes `dirty` as a prop on sixty call sites where the primitive could detect it with one `input`/`change` listener on the panel node it already owns. **Recommend: keep packet 0's shipped shapes, and add the primitive-internal detection as a fallback** so a caller who forgets the prop still gets the tear |
| 4 | **Is "rationed" wax-versus-nothing, or wax-versus-dry?** | **Wax versus nothing** (§Decision 2 and 3). The demoted acts get the sentence, not a smaller stamp; the bulk emboss stays and is named the plural rendering |
| 5 | **A send lives inside a popover** — census row 105, `/team` "Shift actions", body item "Offer cover", `seal: false`, refusing with "The cover offer did not send. Nobody was asked." | **The popover offers; the panel sends** — exactly the bell's shape. One extra surface on one row, and your ratified rule of 2026-09-04 stays literally true, which matters more than the row does |
| 6 | **Is "Hold to reject" a send?** — census row 19 draws a hold and carries `seal: false`; 8 rows draw a hold, 7 carry the flag | **Lose the hold, keep the required reason.** It is the answer both rules agree on: a rejection is a send that redeems nothing and destroys nothing. Whichever way it goes, **the flag and the drawing must be made to agree, because a guard reads the flag** |
| 7 | **Permission-denied — build the panel now or after the grants table?** | **Answered by packet 0** (`Denied.tsx`, with the grant line drawn only when a grant is named). The order stands as ADR 0112 has it: ledger, grants, step-up, seal, break-glass — and **never a guessed list of names**; where the server cannot say who holds the authority, the sentence says so |
| 8 | **The swipe** — rebuild at 150 px, rebuild smaller, or replace it | **Keep 96 px.** Add the resistance, the ghost seal, the `stamp` landing and a non-dragging pointer path. You should see the arithmetic before you choose: **68 % of 150 px is 102 px of thumb travel, more than today's full 96 px commit** — the "easier" threshold is the longer gesture, on a one-handed phone at the pass. If you want 150 px having seen that, it is your call |
| 9 | **Under reduced motion — nothing, or a cross-fade?** | **The cross-fade, 120 ms, opacity only, entrances only** (§Decision 6). It changes a rule packet 0 shipped as a guard four days ago, which is why it is yours and not a builder's |
| 10 | **The motion guard** — fix the specification or do not ship one | **Ship it, re-specified** (§Decision 10). As originally drafted it could see neither `/inventory` nor `Sidebar.tsx` — the two defects it was written for — while going red on two approved exceptions. A green guard over a standing defect is worse than no guard |
| 11 | **The eighth token** (raised here) | **Fold into `settle` 320.** The alternative — mint `rise` at the house curve and 420 ms and move all five opening lines onto it — is defensible; leaving the literal is not |
| 12 | **`/calendar`'s delete** (raised here) | **Keeps the wax** under the ration rule's second clause. The alternative is to put a day-book entry on F10's undo-after list, which makes it reversible and drops it to a plain control. Both are coherent; the current state (wax, no undo) is the one the rule produces |
| 13 | **`wide` on two sheets that are not letters** — census rows 33 and 59 (`Sheet.tsx:161-174` reserves 640 for "A LETTER only… a third width needs an ADR") | **Force both to 440**, which is what packet 1 did to the cellar's carry sheet when it caught itself. Amending the rule to "prose a person reads back, **or a table a person reconciles**" is a content-volume test in different words, which is exactly what the rule forbids |
| 14 | **F13 — the consent panel is built and unreachable** | Its only opener is mounted solely by the legacy settings page, and the rebuilt page renders the four consents as records with no switches because nothing in any runtime branches on them. **Either something reads a consent and the control comes back, or the act is a deletion.** Not defaulted here |

## The SOTA additions, kept and killed

**Kept** (each is now a row in a page's §13, with its citation): consequence-scaled press, with the
unknown-threshold clause added; hold-the-read behind a rail, **applied on an explicit act and never
on idle** (the original spec applied after 4 s of no movement, which fires precisely into the fault
it was written to prevent — a person reading a line is not moving); the scrub ghost read-out;
"an arrival is not a poll result", with the floor caveat that the row must say which it was;
interruptibility as a stated property, **re-specified** (cancelling every animation on an element
would revert a `fill:'both'` end state that is holding a layout, so it must cancel only what it
started — the "two lines, no page changes" cost claim is false across ~40 call sites); timed
gestures need a non-timed twin, **strengthened to SC 2.5.7**; no enter animation on the four
keyboard surfaces, **per surface**; peek inside the command menu; a claimable queue with an
assignment history; risk insights and related rows on the held object; an offline queue that states
its deadline, its ceiling and who carries the risk; author-name indicators that survive the merge;
a summary above the per-line ticks; "nothing is hidden, only moved", **on the house's own rule**;
the policy check before the approver's queue, **citation downgraded**; the spoken depth cap;
`repositionInputs` / `handleOnly` / `dismissible`; the description as a separate ARIA slot; and the
negative evidence against a per-hunk gate that never resolves.

**Killed, and why:**

- **The dry emboss as a general second ceremony** — §Decision 3.
- **"The travel that says where it went"** (a 460 ms FLIP with a drawn trail when a receipt is
  verified) — its own reduced-motion path is "the card is removed and the lane count changes", which
  is exactly the behaviour it calls the defect. If that is acceptable for a reduced-motion reader it
  is acceptable for everyone. **The sentence is the fix: "Filed under Verified."**
- **The command palette's subtraction FLIP** — the same source that gives the no-animation rule
  forbids it in the same sentence, and the palette is the textbook case.
- **The toggle thumb's "contradiction" with `tuck`** — the thumb snaps after a discrete click, so
  `tuck`'s stated condition ("objects that move under a finger") is not met; the overshoot would be
  ~0.17 px on 18 px of travel, bought at 300 ms instead of 160; and the selector is `.st-ink *`, so
  the swap would move every transition in every settings control to a 300 ms spring. **The docstring
  over-claims; the page is right.**
- **The chip's SC 2.5.8 failure** — §Decision 9. The class of problem survives as a dependency; the
  instance does not.
- **The swipe rebuilt at 150 px with a 68 % commit** — the arithmetic runs the wrong way (fork 8).
- **"`ink` is used by 19 of 19 pages"** — the same section says two pages have zero house motion, and
  the measurement pass confirmed both. **The count is 17.**

## Census corrections, for the census owner

`census.py` is **not edited here**: packet 1 already rewrites its ten `migrate` rows to `built` and
regenerates the page subsections on its own branch, so an edit on this branch would collide with
work already done. The corrections are recorded instead.

1. **Row 105, `/team` "Shift actions"** — a **send** ("Offer cover") from inside an anchored popover,
   `seal: false`. A shape violation of the ratified rule, not a flag one (fork 5).
2. **Row 19, `/orders` "Vendor answers"** — draws a `hold` and carries `seal: false`. Measured:
   **8 live rows draw a hold, 7 carry the flag.** Any count, guard or report reading `seal`
   undercounts the wax by one (fork 6).
3. **F13** — the `/settings` consent row's stated reason does not hold: its only opener is mounted
   solely by the legacy page, so the house branch built for it is correct and unreachable (fork 14).
4. **Ten `migrate` rows are `built`** after packet 1, and **twelve `owed` rows are built** after
   packet 2.
5. **ADR 0112's own census table (`:182-187`) disagrees with `census.json` in three cells** — the
   table says `Owed 9 · Retires 41 · Delete 16`; the file computes **`owed 12 · retire 42 ·
   delete 15`**, and the ADR's own review-trail row two paragraphs earlier says 12/42/15. The table
   is the wrong half, and anyone planning the work from it plans **three owed acts too few**.
6. **No row for `/profile` and no row for `/connections`** — both carry live `HoldToApprove`
   ceremonies (`ProfileNext.tsx:412`, `PaymentRegister.tsx`, `AttachmentRow.tsx:181`,
   `HouseServerControls.tsx:332`) and the shared `StripeCardPanel` mounted inline. The census's 23
   route keys do not include either page, so any analysis run over the file silently excludes two
   pages' worth of ceremony.
7. **Row 41 "Photograph the label"** should be a **route** under 640 px, not a fourth geometry: a
   620 px panel capped at 76 vh is roughly a 200 px viewfinder on the device the flow exists for.
8. **Rows 33 and 59** carry `wide` and are not letters (fork 13).
9. **Seven live rows carry no eyebrow**, including both ask surfaces.
10. **0 of 120 rows draw permission-denied; 4 of 60 draw a failure.** Under the authority rule,
    permission-denied is the commonest state a staff member will meet.
11. **Two `source` fields point one line off the mount they name.** `/providers` "The vendor's twin"
    cites `pages/providers/next/TwinSheet.tsx:68`; the `<Sheet` is at **:69** (`:68` is the `return (`).
    `/orders` "What was agreed" cites `pages/orders/next/AgreementSheet.tsx:349`, which is an error
    string; the `<Panel` is at **:356**. Not corrected here, because those cells are generated from
    `census.py` and this branch does not edit generated files.
12. **`build.py` silently deletes hand-added sections of its own `README.md`.** Running it once
    (with no arguments, which is what `--help` does) stripped a hand-written `## Next` section
    pointing at sketch 103. Reverted here, and named because the next person to run the builder will
    do it again without noticing.

## Consequences

_(Written 2026-09-06, alongside the original ten decisions; kept as-written. As of the 2026-09-21 lock, rules 1 and 6 below are built — the calendar's arrival is already faster and the reduced-motion cross-fade already amends the two test files named. Rules 2-5 and 8-11's costs below remain open, owned by their pages' own lanes; see §Locked's build-order table.)_

- **Easier.** One act has one answer, so a page pass stops re-litigating motion. Three live WCAG
  exposures close, one of them Level A. The two guards make every defect above visible to CI, and
  the motion guard is written so it cannot report green over the defects it exists for.
- **Harder, or given up.** The sales calendar's month arrival gets faster and the founder may not
  want that. The reduced-motion cross-fade contradicts a rule packet 0 shipped four days ago and
  costs an amendment to `housePolicy.test.ts` and `Sheet.test.tsx`. `/inventory` gets its
  reduced-motion guard and **not** its house curve, so the page the house runs on all day keeps
  Material's easing under a house header for at least one more pass. `/orders`' reject loses a
  gesture some readers will have learned.
- **Revisit when.** The socket step of the bell's staircase lands (rule 6 of §6g's shell table
  becomes live). `/inventory` gets a page CSS file (the deferred `ink` swap becomes cheap). A second
  page asks for a 640 px sheet that is not a letter (fork 13 becomes a third width by increments,
  which is what the primitive's own comment warns about).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-06 | motion finder (per act, per page) | Seven tokens measured with their springs re-integrated; the eighth literal found at four sites; fifteen cross-page disagreements; eight SOTA additions; ten decisions proposed |
| 2026-09-06 | overlay finder (per census row) | Nine house invariants; D1-D27, five of them counted by script over `census.json`; the per-row spec for all sixty live rows; ten acts owed a surface; fourteen SOTA additions; thirteen questions |
| 2026-09-06 | measurement pass (what the code carries) | Motion and overlay coverage for nineteen pages plus the shell; the doc-versus-code divergences; the reduced-motion gaps; the test gaps; the census's two missing pages |
| 2026-09-06 | adversary | Six angles the finders did not use. Killed five items, adapted twenty-two, found five things none of the three found (a Level A shimmer, a Level AA drag, an X glyph inside a hand-rolled dialog on a rebuilt page, a send inside a popover, and a rule citing a guard that does not exist), and ranked ten forks |
| 2026-09-06 | judge (this ADR) | Ten rule changes decided; fourteen forks put to the founder; two SOTA additions killed and six others adapted; ten census corrections filed; per-page decisions written into eighteen page notes and `DESIGN-FOUNDATION.md` §6g |
| 2026-09-06 | — | Created (Proposed). **Founder review open.** |
| 2026-09-17 | sketch 116 (design critic, 4 passes) | Drew all eleven rules today-vs-proposed at token speed; found two of this ADR's own decisions resting on stale premises (fork 6's cancel-seal retirement by ADR 0125, fork 5's second, undocumented send path) and one drawing failing the criterion it cited (rule 11's counting sentence against SC 2.2.2); recommended locking the eleven with those three corrections |
| 2026-09-21 | Aldemir (founder) | **Locked**, as recommended by sketch 116, verbatim quote and per-rule roads in §Locked above. Rules 1 and 6 built same-day, rule 7 in part (`wt-motions` / `feat/motion-rules-locked`); rules 2, 3, 4, 5, 8, 9, 10, 11 remain to build, owned by their pages' own lanes |
| 2026-09-21 | lane last call (Opus) | Four records corrected before merge: the quote cut to his three words (the rest was the brief's gloss); rule 7 marked built in part (`check_no_emoji.py` and three §10 reds owed; Tailwind and native `el.animate()` blind spots measured and named); rule 5's 3 s arm window and six sections outside the eleven marked not locked; the CLAIMS row's verify, which passed a guard blinded to object literals because it grepped the self-test's output for 'PASS', moved to exit status |
| 2026-09-21 | Aldemir (founder), round 2 + lane last call (Opus) | Three answers built: *"Waiver, drop screenshots"* (ADR 0032's PR #433 row; sketch 116's three captures removed from the branch); *"Motion token check"* - yes (one `ci.yml` step); rule 5's arm window, *"Until Esc or click away"* (no timer, built in `HoldToApprove`). Last call corrected rule 5's table row, which still called the arm window unsettled; made Escape disarm wherever focus is and the click-away listener capture-phase; and made the guard exit 2 on an empty `MUDAVYM_PAGES` or a missing scan root, where it had printed PASS over the two shared roots alone |
| 2026-09-21 | Aldemir (founder), round 6 + lane motions3b (Opus) | Four answers, his picks verbatim: *"Lock all four (Recommended)"* — §4, §5, §8, §9 built (`instant` on the primitive and the four keyboard surfaces, the palette's still list; the rail's and `/inventory`'s reduced-motion guards in CSS plus a shared `ReducedMotionScope` for their framer-motion, the house hint on `ink` in CSS, the chip's own line-height, measured 24.5 px with no adjacent chip in the product); *"Passkey + paste (Recommended)"* — no passcode field exists and nothing blocks paste, so nothing to remove, two CLAIMS rows hold the rule, the passkey recorded as a named later lane; *"Bring back, real switches (Recommended)"* — fork 14 recorded as a named later lane waiting on a switch store that does not exist yet; *"Stays 640, it's letters (Recommended)"* — `ResponsesSheet` keeps `wide`, recorded at the call site. 24 source mutations, none a no-op. Three things put back to the founder rather than decided: whether §4 reaches the flag-off palette and Ask AI, whether §5(a)'s guard may reach the collapse under reduced motion, and where the opt-out store PR #430 was named for actually lands |
| 2026-09-21 | round 6 last call (Opus) | Three records corrected and three `CLAIMS.jsonl` verifies tightened before merge. Records: the model-context credential fields are three, not two (`McpRegister.tsx:196` added); "no test reads" `wide` was false (`Sheet.test.tsx` does, of the primitive — no test checks its callers); §4's flag-off residue names the legacy scrim's 120 ms `fadeIn` beside the `popIn`. Verifies: `ADR-0134-ROUND6-KEYBOARD-GUARDS-CHIP` now pins the two `data-reduced-motion` attributes, the legacy hint's reduced start, the house hint's CSS and the guard stylesheet's body, which its sentence claimed and it did not check (8 mutations, 8 caught); `ADR-0134-SC338-NOTHING-BLOCKS-PASTE` also refuses a native `paste` listener (3 plants, 3 caught); `ADR-0134-SC338-MANAGER-PASSCODE-UNBUILT` trips on any `passcode` / `pass_code` / `pass-code`, not only a "manager passcode" phrase (4 plants, 4 trip). All on a scratch copy of the tree. |
| 2026-09-22 | Aldemir (founder), round 6y + lane motions4 (Sonnet) + last call (Opus) | Answered round 6's three residues, his picks verbatim: *"Leave legacy alone (Recommended)"* — §4's flag-off palette and Ask AI keep their 120 ms popIn and scrim fadeIn, gone with the legacy branch at the cutover; *"Reduced motion wins (Recommended)"* — §5(a)'s guard reaches the rail's 260-to-72 collapse, as already built (instant under reduced motion, the 200 ms curve at full motion). Fork 14's stores recorded as facts, with the head each was read at: PR #430 (`feat/finish-authorize-consent`, `a04aaa4e1`) carries the ask-training opt-out store; PR #435 (`feat/vendor-scorecard`, ADR 0207) owns the switch that turns Jev on, which the founder ruled the same round to be the owner's acceptance of the complete data and privacy usage terms, owner only, quoted verbatim in the section — not yet built at #435's pushed head `a7898464c`, which still carries the owner-or-manager `vendor_tone_scoring_enabled` toggle the ruling replaces. Last call withdrew the first pass's reading of that head as the answer (it had recorded the switch as owner-or-manager and "not a privacy-acceptance flow", against his words and fork 14's own "Owner only"), renamed the section from "Round 7" to the founder round's name, 6y, and bracketed the five sentences these answers close (§4 and §5(c) in round 6, fork 14's #430 discrepancy, §Decision 4's "always", §Decision 5's "left alone"). Docs only: no source, test, `CLAIMS.jsonl` or migration changed (band: none). |
