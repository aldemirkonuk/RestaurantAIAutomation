---
sketch: 116
name: motion-rules
question: "ADR 0134 is Proposed and the founder asked to watch its motion rules before locking them. On each of the eleven, what is he choosing between, what does it look like at token speed, and what does each road cost?"
winner: null
tags: [motion, tokens, adr-0134, adr-0125, adr-0112, wax, seal, ration, reduced-motion, wcag, swipe, guard, sketch-087, mudavym, design-system]
---

# Sketch 116 · Eleven motion rules, watched before they are locked

## Design question

ADR 0134 (`docs/motions-and-overlays-per-page`, Proposed, unmerged) changes ten house
rules and puts fourteen forks to the founder. He asked to **review motion first**. Prose
cannot show a 320 ms curve against a 420 ms one, or a wax landing against a sentence, so
this canvas draws every rule change twice on the same act: **today on main** on the left,
**as proposed** on the right, both live, both replayable, with the token values under each.
Where today already equals the proposal (rules 4 and 8) the other stages draw the other
roads; where the drawing found a road the ADR did not name (rule 3) or a cost the ADR did
not state (rules 6 and 11), that road is drawn as its own stage with the cost under it.

The "directions" of this sketch are the eleven specimens. Nothing in it is imported by the
app; it is a viewing instrument for one decision.

**Two of the ADR's decisions rest on premises the code no longer holds** (rules 3 and 4,
below), and one of its recommended drawings fails the criterion it was written to meet
(rule 11). The canvas draws each as it stands on main, not as the ADR wrote it, and this
README says what has to be recorded against the ADR before it is locked.

## How to view

```
open .planning/sketches/116-motion-rules/index.html
```

One file, inline CSS and JS, renders from `file://`. The control bar carries **Replay all**,
a **reduced-motion** switch (it starts from the OS query and can be flipped by hand), a
**speed** control (1x · 1/2x · 1/4x, so a 160 ms `ink` can be watched) and the **ground**
(warm charcoal by default per ADR 0138; paper is the declared exception). Every drawn hold
is really holdable (`pour` fills against your own thumb; under the reduced-motion switch the
first press arms and the second approves, as `HoldToApprove.tsx:169-172` does), all four
swipe pills are really draggable, rule 4's reason field really gates its controls, and rule
10 tears only while the field holds words (it starts with some; clear it and Replay to watch
the plain close; type and Replay to watch the tear come back). Below 700 px the bar stops
being sticky; each rule keeps its own Replay. Fonts load from Google for the drawing; the
product self-hosts them.

The seven tokens are ported verbatim from `apps/web/src/lib/mudavym/motion.ts`, springs
re-integrated with the same sampler, so the dot on each token card runs the curve the code
runs. The sampler gives `stamp` a **10.4 %** overshoot; the docstring at `motion.ts:99`
says "~11.1 %", which the sampler it documents does not produce. The canvas uses the
measured figure everywhere. Three values on the page sit outside the seven and are named
where they appear: the 420 ms literal rule 1 folds away, the 120 ms reduced-motion fade
rule 6 adds (which rule 7's guard has to be told about), and rule 8's other road, a ten-second
undo window, which is a clock run by a timer and not a motion.

Every overlay drawn inside a stage is at **one scale, 0.65x of ADR 0112's widths**: sheet
440 → 286 (`sheet.css:113`), panel 620 → 403 (`sheet.css:141`), popover 320 → 208
(`Sheet.tsx:282`, the default). The stage labels say so wherever two shapes meet.

## The eleven specimens, and what the founder is choosing between

| # | Rule (ADR 0134) | Today on main | Proposed | Choosing between |
|---|---|---|---|---|
| 1 | The eighth literal folds | `{easing: settle.easing, ms: 420}` at four sites (`DashboardNext.tsx:76`, `SalesCalendar.tsx:75`, `ReportsNext.tsx:139`, `CalendarNext.tsx:212`); the month grid staggers on it. The left stage is labelled as what road 2 would feel like, because it is | all four become `settle` 320; the 16 ms x 0.94 stagger is untouched (642 → 542 ms to the last cell, 29 gaps) | **fold into `settle`** (recommended) · mint `rise` = house curve at 420 as an eighth token · leaving the literal is not on the table |
| 2 | One ration rule for the wax | three rules live: `/profile` mechanical (a sealed hold), `/team` consequence (its first publish is already a plain confirm, `TeamOverlays.tsx:128-136`), `/reports` counter-party (a dry die on "Ruled off.", `ReportsNext.tsx:366`, drawn as it renders: `--paper-2` on `--paper-0`, **1.15:1 on charcoal, 1.25:1 on paper**, captioned as such); the dashboard's die arm holds to "write it down" and lands wax with no seal minted (`OneTapPanel.tsx:560-570`) | `/profile`'s rule, both clauses: wax where a server redeems a seal, or where nothing can undo the act. **Two of the four drawn acts change** (the dry die and the die arm become sentences); two are drawn to show they do not | **mechanical rule, wax versus nothing** (recommended) · consequence rule · counter-party rule · wax versus dry (every non-wax act embosses; at 1.15:1 the founder is choosing between a mark nobody can see and no mark) |
| 3 | A send inside a `/team` popover | **two surfaces send on main**, both drawn: the menu item calls `cover.mutate` from the popover (`WeekGrid.tsx:467-476`), and the shift's row expander (`ShiftDetail`, `:507-611`) lists the candidates with "no account" marked (`:560`) and carries **Offer cover to 3** beside Edit shift (`:591-598`). The failure sentence renders only inside the expander (`:606-610`), so a send from the menu with the row closed fails silently. The gateway returns `{offered, notified}` (`schedule.service.ts:678`) and the web reads only `cover.isSuccess` (`:391`) | the ADR's road: the item opens a Panel whose contract says who is reached ("Offers to 3. Two have accounts and are notified now; Selin A. has no account and hears nothing from this"). The other road, drawn as its own stage: **delete the menu item; the expander already sends with its candidates in view**, plus one contract line and a success sentence that reads `notified` back. A fourth stage draws what neither surface says today | **delete the item; the expander sends** (recommended here; departs from the ADR's text) · the popover offers, a panel sends (the ADR's decision; a second surface repeating the expander's list) · amend ADR 0112 so a popover may send one item · under every road, read `{offered, notified}` back and say it |
| 4 | Hold-to-reject: **the premise moved** | the hold mints a cancel seal when it starts (`ResponsesSheet.tsx:283-305, 433`, `onChallenge` → `mintOrderCancelSeal`) and `DELETE orders/:id` refuses without it (403) and without a reason (400) (`procurement.controller.ts:264-308`, ADR 0125, 2026-09-05). The code retired the old "redeems no seal" note itself (`:88-95`) | under rule 2's clause 1 the reject **keeps the wax**. Three stages: today = road (a); ADR 0134 fork 6 as written (a plain Reject the gateway refuses with a 403 on every press); road (b) | **(a) keep the hold, flip census row 19 to `seal: true`** (recommended: rule 2 produces it; nothing on main changes but the flag) · **(b) take the seal off the gateway's DELETE and lose the hold** (reverses ADR 0125 and `SealedRejectDie.tsx` with it) · not on the table: fork 6 as written, or keeping `seal: false` with the hold |
| 5 | The 96 px swipe | `TRAVEL = 96` (`SwipeToConfirm.tsx:27`), fill 1:1 with the thumb, pill fills solid at rest, keyboard path only, no single-pointer alternative (WCAG 2.5.7) | the same 96 px felt through `p(1 - 0.22p)`, a ghost seal rising with p; at commit the handle gives way on `ink` and the seal lands on `stamp` where the handle is not, the fill staying tint so the wax reads as wax; a plain Confirm that arms then confirms. **The 3 s arm window is inherited**, not chosen: `HoldToApprove`'s `ARM_WINDOW_MS` (`HoldToApprove.tsx:64`, used at `:169-172`). **A third, draggable pill at 150 px with a 68 % commit** sits beside them so the fork can be felt | **keep 96 px + resistance + ghost + `stamp` + Confirm** (recommended) · rebuild at 150 px with a 68 % commit (102 px of thumb, six more than today's whole travel) · replace with `HoldToApprove` · **open, raised by the drawing:** a two-press Confirm whose second press must land within 3 s is itself a timed twin; ADR 0134 keeps "timed gestures need a non-timed twin, strengthened to 2.5.7" |
| 6 | Reduced motion | the primitive renders none of it: `data-motion="none"`, zero frames (`Sheet.tsx:479`, asserted by `Sheet.test.tsx`; `sheet.css:240-244` is `animation: none !important`) | a 120 ms opacity-only cross-fade for a Sheet, Panel or Popover entrance; everything in place keeps zero. The canvas itself follows this: sentences, the tear and the stub get zero frames under the switch, and rule 8's undo window is a timer the switch cannot shorten. **120 ms is a duration no token carries**, and rule 7's guard scans `components/mudavym/**`: locked as written, the guard fails rule 6's own line | **the cross-fade** (recommended; amends two tests packet 0 shipped) · keep "nothing" · **if the cross-fade, how the guard learns it:** (a) an ALLOW line by file:line citing ADR 0134 §6, as the two sheens are carried (recommended: the mechanism and the disclosure both exist; cost: 120 is then written in sheet.css, motion.ts and the allow-list) · (b) a named reduced-motion constant exported from `motion.ts`, with rule 1's text amended to "no eighth *motion* token; one reduced-motion constant" |
| 7 | The CI motion guard | 58 `check_*` scripts, none for motion, tokens, overlays or emoji; `ms: 420` is valid TypeScript and invisible | a drawn run of `check_motion_tokens.py` against the pre-fix tree: 20 slugs from `MUDAVYM_PAGES` (`useMudavymDesign.ts:34-65`), seven FAILs, two ALLOWs by ADR, a hypothetical exit-2 case (none of the 20 slugs lacks a route today), and **a second run after rule 6 lands** that FAILs `sheet.css:242` until rule 6's fork 3 is answered; `check_no_emoji.py` beside it | **ship it, re-specified** (recommended) · no guard, motion stays in review · the original draft is not on the table |
| 8 | `/calendar`'s delete | the wax, under the mechanical rule's second clause (`calendar MOTIONS.md:21-22`); the entry is Sat 26 Sept | unchanged; the right-hand stage draws the other road: undo-after (ADR 0112 F10) with a ten-second linear window and no wax. The drain is written by a timer into `scaleX`, never an `animate()` call, so no duration literal exists for rule 7's guard to read | **keep the wax** (recommended) · put a day-book entry on F10's undo-after list |
| 9 | Two wide sheets | row 59 "Templates" is `wide` on main (`TemplateSheet.tsx:135`). Row 33 "A delivery without an order" is on main a legacy framer-motion centred modal (`ManualReceiptWorkspace.tsx:228-242`, max-w-6xl, 94vh, white, blurred scrim); the `wide` Sheet exists only in packet 1's unmerged migration, and the left frame is labelled as that target | both at 440: a line becomes a two-row item, the template becomes the object with its list beneath; the composer alone keeps 640 (`Compose/ComposeSheet.tsx:212`). Frames are cropped to the sheet and drawn at one scale (0.8) so 640 and 440 keep their ratio; below 700 px they open at their left edge (the wine names, the template list) with the width tag repeated under the box | **force both to 440** (recommended) · amend the rule to "or a table a person reconciles" · an ADR for a third width |
| 10 | Esc, the scrim and unsaved work | Esc closes from anywhere, topmost only (`Sheet.tsx:388-401`); no dirty state exists on main; packet 0 (unmerged) adds `dirty` as a prop on ~60 call sites | keep packet 0's shapes (a Sheet tears and leaves a Stub under the row name, a Panel leans and stays behind a plain footer button) and let the primitive detect dirtiness from its own `input`/`change` events. The other road, split by dirtiness, is drawn as its own stage: a dirty Sheet leans exactly as a dirty Panel does. Every sentence resets to its markup on Replay, so the field decides the sentence every time | **shapes + primitive-internal detection** (recommended) · split by dirtiness, not shape · prop only, as packet 0 shipped |
| 11 | The 1.9 s shimmer | `dn-sheen` / `rp-sheen` run `infinite` beside live content (`dashboard-next.css:44`, `reports-next.css:391`): WCAG 2.2.2, Level A | two cycles (3.8 s), then still, then **the words, static**: "Still fetching the ledger." lands once at 3.8 s and changes once more at 20 s ("The ledger has not answered. Nothing here is a figure yet."). The ADR decides only "the wait in words"; the counting sentence the first pass of this sketch drew ("— 7 s", every second) is auto-updating information beside live content, which 2.2.2 covers with no five-second exemption, so it is drawn as a third stage with that cost under it | **two cycles then static words, two thresholds** (recommended) · the counting words (needs a pause or frequency control, or an "essential" claim that does not hold for a placeholder) · a pause control on every skeleton · leave it infinite and claim the preload exception (it does not hold) |

Below the eleven: **the sketch 087 shortlist mapped to where each motion would live** (47
rows: the hero and twenty-seven more signature ceremonies, plus the nineteen the founder
marked on 2026-08-29, in the five groups `shortlist.html` itself uses), each given a state,
with the tally counted from the rows by the page rather than typed (shipped 9 · partial 2 ·
0134 proposes 4 · needs packet 0 1 · refused 4 · no home yet 27); below 700 px the table
becomes stacked cards (id and motion on one line, where below, the state on the right).
**At 390 px**, two true-size phone frames for the two rules the phone decides (the swipe,
and the reduced-motion entrance as a bottom sheet); and **the states each rule has to
survive** (refused, partial, silent, empty, the seal refused, mint failed, released early,
loading, cannot check, write failed, partial), eleven of them.

## What each specimen optimises

Rules 1, 7 and 9 optimise for **one answer per act**: a literal that no token names, a
guard that cannot see the page it was written for, and a width that drifts by increments
are the three ways the vocabulary stops meaning anything. Rules 2, 3, 4 and 8 optimise for
**the wax meaning exactly one thing**: a seal the server redeemed, or an act nothing can
undo; everything else gets a sentence. Rule 4 is the clearest case of the rule doing its
own work: applied to the code as it stands, it keeps the seal the ADR would have thrown
away. Rule 3 is the clearest case of the drawing doing its own work: the surface the ADR
would build already exists on main, and the defect worth fixing is one neither the ADR nor
the surface names (offered is not told). Rules 5, 6 and 11 optimise for **conformance the
house controls**: 2.5.7 by a Confirm that is not a drag, 2.3.3 by a cross-dissolve that
moves nothing, 2.2.2 by a sheen that stops itself and words that do not tick. Rule 10
optimises for **a reader on the floor who does not know the shape**: whichever way the
founder splits it, the sixty-first caller must not lose someone's words.

## What it costs to build

Nothing here needs a new gateway endpoint. Every cost is client-side, in CI, or in a census.

| # | Files touched | New surface or script |
|---|---|---|
| 1 | four `animate()` calls take `settle` instead of the literal; `SalesCalendar.tsx` and `CalendarNext.tsx` page notes record the ~100 ms change | none |
| 2 | `pages/team/next/MOTIONS.md:26-27`, `pages/reports/next/MOTIONS.md:59-62` rewritten to the mechanical rule; `ReportsNext.tsx:366`'s dry die becomes the sentence; the dashboard's die arm (`OneTapPanel.tsx:560-570`, ADR 0127) becomes a plain "Write it down"; `/team`'s first publish is untouched; `BUILD-PROMPT.md` rule 3 corrected (the bulk bar is a dry emboss, not a plain button) | none |
| 3 | recommended road: delete the menu item (`WeekGrid.tsx:466-476`); one contract line above the expander's button (`:591-598`); `coverSent` reads `notified` from the mutation's data instead of `isSuccess` (`:391`, `:565-569`). The ADR's road instead: the item opens a `Panel` that calls the same `cover` mutation, and the failure sentence at `:606-610` moves into it. Under either, `schedule.service.ts:642-679` is untouched: it already returns the split | recommended road: none · the ADR's road: one Panel on one row, the first popover→panel shape in the product |
| 4 | road (a): census 102 row 19 `seal: false` → `true`; no code changes; `Responses.test.tsx:389` keeps passing. Road (b): the seal comes off `DELETE orders/:id` (`procurement.controller.ts:295-308`), `onRejectChallenge` and the `HoldToApprove` at `ResponsesSheet.tsx:283-305, 427-434` become a plain control, and `components/orders/SealedRejectDie.tsx` loses its hold; ADR 0125 is superseded for this act | (a) none · (b) a gateway change and a superseding ADR |
| 5 | `pages/receipts/next/SwipeToConfirm.tsx` (`TRAVEL` at `:27`): the resistance map on the rendered handle, a ghost `Seal`, the handle fading on `ink` at commit, `stamp` on the seal, the fill kept at tint, and an arm-then-confirm button that reuses the `onChallenge` contract at arm time and `HoldToApprove`'s `ARM_WINDOW_MS` (`:64`) unless the open question changes it | none |
| 6 | `components/mudavym/Sheet.tsx:479` and `sheet.css:240-244`: `data-motion="fade"` with a 120 ms opacity keyframe; `Sheet.test.tsx:170,220` and packet 0's `housePolicy.test.ts` amended to "no movement"; plus fork 3's answer: an allow-list entry for the sheet.css line citing ADR 0134 §6, or a named constant in `motion.ts` and an amendment to rule 1's text | none |
| 7 | `scripts/check_motion_tokens.py` and `scripts/check_no_emoji.py`, wired into CI, with the allow-list carrying the two sheens (and, under rule 6 road (a), the fade) by file, line and ADR; proven red on the pre-fix tree | two scripts |
| 8 | none if the wax stays; the other road adds a day-book entry to F10's list and a ten-second undo window on `/calendar`, driven by a timer, not `animate()` | none, or one undo window |
| 9 | `wide` removed from `TemplateSheet.tsx:135`; packet 1's migrated delivery sheet lands without it (on main the modal is legacy and untouched by this rule until packet 1 merges); two sheet bodies restructured (a line as two rows; the template as the object) | none |
| 10 | on `feat/overlays-packet-0-primitive` (not an ancestor of main): one listener on the panel node the primitive already owns, setting `dirty` unless the prop overrides it | none; depends on packet 0 landing |
| 11 | `dashboard-next.css:38-50`, `reports-next.css:387-397`: `animation-iteration-count: 2`, a `data-still` end state, and two static sentences at two named thresholds (3.8 s, 20 s) from the skeleton host; no interval writes into the sentence | none |

Citations re-measured against `wt-finish` (= `origin/main` at 60ed83a7, confirmed
`git merge-base --is-ancestor` on 2026-09-17) and corrected on the canvas: `DashboardNext.tsx:76`
(the ADR wrote `:68`); the `wide` docstring at `Sheet.tsx:171-184` (the ADR wrote
`:161-174`); `TemplateSheet.tsx:135`; `Compose/ComposeSheet.tsx:212`; `App.tsx:312` for the
`/inventory` route; 20 slugs in `MUDAVYM_PAGES`, not 19; `SwipeToConfirm.tsx:27` (the
second pass wrote `:26`, a blank line); `WeekGrid.tsx:606-610` for the cover failure
sentence (the second pass wrote `:602-606`, which is the call-out sentence). The emoji
sample in rule 7 is a real scan of `apps/web/src` on 2026-09-17: 159 lines in 30 files carry
an emoji code point, one of them inside a rebuilt page (`pages/notifications/next/nt-format.ts:197`,
a comment).

## For the record: what this canvas found against ADR 0134

These are not the founder's calls; they are corrections the ADR needs before any of its
forks is locked, and they belong in the ADR's own corrections list and, where a fork
changes, in `OPEN-DECISIONS`. This sketch could not edit either file; the parent session
should file them.

1. **Fork 6's premise is stale.** "A hold that redeems nothing" and its citation (orders
   `MOTIONS.md:50-58`) were retired by ADR 0125 on 2026-09-05, before ADR 0134 was drafted.
   On main the reject hold mints a cancel seal and the gateway redeems it. The ADR's
   consequence list ("`/orders`' reject loses the wax and the hold") follows the stale
   premise, not the rule it states; the rule, applied, keeps the wax. The fork is (a) flip
   row 19 to `seal: true`, keep the hold, versus (b) unseal the DELETE and lose the hold,
   which reverses ADR 0125. A plain Reject against the sealed DELETE, as fork 6 draws it,
   would be refused with a 403 on every press.
2. **Fork 5 names one send path; main has two, and the second is the surface the ADR
   would build.** `ShiftDetail` (`WeekGrid.tsx:507-611`) already lists the cover candidates,
   marks "no account", and sends from "Offer cover to N" beside Edit shift. "Exactly the
   bell's shape" also names an offer→panel precedent that does not exist: `HouseBell.tsx:127`
   renders only a Popover. The decision can stand on ADR 0112 alone; the drawing suggests
   it should stand on deleting the item instead.
3. **Two live defects under fork 5 that no road in the ADR addresses.** The gateway
   returns `{offered, notified}` (`schedule.service.ts:678`; push goes only to linked
   accounts) and the web discards it (`coverSent = cover.isSuccess`, `:391`), so "Offered
   just now" is said to a manager whose third candidate was never told. And the failure
   sentence lives inside the expander (`:606-610`), so a send from the menu with the row
   closed fails with nothing on screen.
4. **§7's "the wait in words", drawn as a counter, fails 2.2.2 through its other clause.**
   The five-second trigger belongs to the moving/blinking/scrolling clause; the
   auto-updating clause has none. Words that tick every second beside live content need a
   pause or frequency control. The ADR's text is fine; the first pass of this sketch was
   not, and the corrected drawing changes the sentence at most twice at named thresholds.
5. **§6's 120 ms and §1's "no eighth token" collide in §10's guard.** Rule 6 adds a named
   duration outside the seven in `sheet.css`; rule 7's guard scans `components/mudavym/**`
   and its drawn allow-list carries only the two sheens. Locked together as recommended,
   the guard fails rule 6's own implementation. The fork (allow-list by ADR §6, or a named
   reduced-motion constant with rule 1's text amended) is stated under rule 6.
6. **The decision text under rule 2 overstates the visible change.** The dashboard's die arm
   is "Hold to write it down" on a hand-written note, not a money approval, and `/team`'s
   first publish is already a plain confirm. Two of the four acts the ADR names change; the
   others already comply. And the dry die the decision demotes is drawn at 1.15:1 on
   charcoal, which is to say it was never visible.
7. **`motion.ts:99` documents an overshoot the sampler does not produce** (~11.1 % written,
   10.4 % measured). A one-line docstring fix, but a guard that quotes the docstring would
   assert a number the curve never reaches.

## Honesty traps it handles

- **A drawn hold is a real hold.** The fill is `pour` against the pointer, an early release
  retreats on `tuck` and says "Released at N % — nothing sent", so the ceremony cannot be
  judged from a looping animation that never fails. Under the reduced-motion switch the
  control is two-step, as the house control is: the first press arms for 3 s, the second
  approves, Esc or the window's end disarms and says so. Rule 4's hold refuses to begin
  without a reason, as `onRejectChallenge` does.
- **The wax lands only where the sentence can say which seal the server redeemed.** Rule 2's
  today stage draws the dashboard's un-sealed arm landing wax on nothing, labelled as such;
  rule 4's today stage names the seal the cancel redeemed.
- **The premise is drawn as found, not as written.** Rule 4 shows the ADR's own control
  being refused by the gateway; rule 3 shows the second send surface the ADR did not name,
  with the page's own success sentence ("Offered just now. Nothing records the offer
  against the shift").
- **Offered is not told.** Rule 3's panel and its other road both say who is reached and who
  is not; the states strip carries the partial ("Offered to 3; 2 were notified") and the
  silent failure (a state whose sentence is blank, because on main nothing renders).
- **Received is not verified.** Rule 5's proposed stages and the phone frame all end on
  "Confirmed as received — not yet the verified invoice cost". A swipe is a confirmation,
  so its early-release sentence says "nothing confirmed", not "nothing sent".
- **Missing is not zero, and a wait is not a count.** Rule 11's proposed tile holds an
  absent figure and says that it is waiting in a sentence that does not tick; the small
  clock under each tile is labelled as the canvas's instrument, not part of the drawing.
  Rule 1's calendar draws unknown days as em dashes and never animates them as a value.
- **A guard that cannot check goes red.** Rule 7 draws the exit-2 case and marks it as
  hypothetical inside the output, because none of the 20 slugs is in that state today; it
  also draws the run that fails rule 6's own line, so the conflict cannot be locked unseen.
- **Reduced motion is forced, not assumed**, on rule 6 and the phone frame, whatever the
  canvas toggle says; the rest of the page honours the OS query and the toggle, and a
  functional timer (rule 8's undo window) is never shortened by a motion setting.
- **A label says what is unmerged, and a tally is counted, not typed.** Rule 9's row 33
  frame is labelled as packet 1's target; the shortlist's sig-22 is tagged "needs packet 0"
  and nav-05 "partial" because the surfaces exist only there; the tally under the shortlist
  heading is computed from the rows by the page.
- **A sentence never outlives the state that produced it.** Rule 10 resets every sentence
  to its markup at the start of a replay, so "nothing tore" cannot stand next to a torn
  sheet (the second pass's defect, verified gone by driving the sequence in Playwright).
- **Two houses, two currencies, two receipts.** The Copper Pot (Austin, $, receipt 4471) and
  Meyhane Sim (Kadıköy, ₺, receipt 0913) are invented for the drawing, and the footer says so.

## The founder questions it embodies

The eleven forks above, each stated on the rule with its roads and the recommended one
marked, plus six the drawing raised that the ADR did not:

1. **Rule 3 has a cheaper road than the ADR's.** The expander already sends with its
   candidates in view; deleting the menu item leaves ADR 0112 literally true with no new
   surface. Does the founder want the panel anyway, for the contract sentence a modal can
   carry, or the deletion plus one line in the expander?
2. **Rule 3, under every road: should the web read `notified` back?** Today it says
   "Offered just now" to a manager whose third candidate has no account. This is a fix
   outside the ADR and worth a line in it.
3. **Rule 4 is now a different fork from the one the ADR wrote.** Road (a) costs nothing but
   a census flag; road (b) supersedes an ADR eleven days old. Does the founder want the
   reject to prove a cancellation (ADR 0125's position) or to record a decision?
4. **Rule 5's Confirm inherits a 3 s window.** `ARM_WINDOW_MS` is the house's; a second
   press that must land within it is a timed twin for exactly the readers 2.5.7 serves.
   Keep the house's 3 s, lengthen it, or arm until Esc, a click elsewhere, or the sheet
   closes?
5. **Rule 6's 120 ms has to be taught to rule 7's guard.** An ALLOW line by ADR (the
   mechanism exists; the value is then written in three places) or a named reduced-motion
   constant (rule 1's "no eighth token" needs a clause)?
6. **`ResponsesSheet.tsx:356` also carries `wide`** and is not one of the ADR's two. The
   census justifies it as letters (a vendor's reply is prose read back as prose). If that
   reading holds it stays at 640; if it does not, rule 9 has a third sheet.
7. **Rule 1's alternative is a real token.** `rise` at the house curve and 420 ms would keep
   today's feel on all five opening lines and give it a name; the left stage is labelled as
   how it would feel.
8. **Twenty-seven of the forty-seven shortlisted motions have no home**: the surface they
   need is not built or carries no tokens (`/inventory` has zero references to `motion.ts`).
   The founder's own KEEP+ on `/invite/:code` (sig-17) is one of them.

## Recommendation

Lock the eleven as recommended, with rule 4 locked as road (a) and rule 3 locked as the
deletion rather than the panel. The strongest single reason is rule 2: with one ration
rule, rules 3, 4 and 8 stop being separate arguments and become its consequences, and rule
4 is the proof — the rule applied to the code as it stands reaches the opposite answer from
the ADR's draft, and the right one. Rule 3 is the case for drawing against main before
locking: the panel the ADR would build repeats a surface that already exists, and the
defect worth a line in the ADR (offered is not told; a send that can fail with nothing on
screen) is one no road in the ADR names. Rule 5 is the one to feel before deciding: drag
all three pills; the resistance makes 96 px read as a gesture without adding a millimetre,
and the 150 px pill beside it is longer on a one-handed phone by six pixels of thumb, which
the hand notices before the arithmetic does. Rule 6 is the one that changes shipped tests
and the one that needs its guard fork answered in the same breath, or rule 7 goes red on
rule 6. Rule 11's words must not tick.

## Declared honestly

- **This is the third pass on this sketch**, applying a twelve-point critique in full. The
  majors were rule 3's missing second send path (the expander) and the honest reach count,
  rule 10's sentence outliving its state on replay, rule 11's counting sentence failing
  2.2.2's auto-updating clause, and the rule 1 / rule 6 / rule 7 collision nobody had put to
  the founder. The minors were the 390 px rule 9 frames opening scrolled to the wrong edge
  and the shortlist table unreadable at 390, two citations one line off
  (`SwipeToConfirm.tsx:27`, `WeekGrid.tsx:606-610`), weekdays that did not match their dates
  (18 Sept is a Friday, 26 Sept a Saturday), a reduced-motion hold that sealed on one press,
  three shortlist tags contradicting their rows, an invisible dry die drawn without saying so,
  two unlabelled roads, and overlays scaled by three different factors. Every `file:line` the
  critique cited was re-read on `wt-finish` before the canvas was changed; all held, and the
  gateway's `{offered, notified}` return and the web's `cover.isSuccess` read were found in
  the process. **This pass's own account of itself was wrong on one point:** it listed stale
  "Sketch 105" captures as fixed, but only the masthead text in `index.html` had changed —
  `shots/*.png` still carried the old render and went uncorrected until the fourth pass,
  below, actually re-ran the script. Declaring a fix done because the source line changed,
  without regenerating the artifact the line describes, is the failure this file's own
  process rules exist to catch.
- **This is the fourth pass**, closing a design-critic sweep against the same twelve-point
  list. Eleven of the twelve items were already correct in `index.html` and this pass
  re-verified each by reading the file, not by trusting the third pass's own account: rule 3's
  expander and `notified`-read-back copy (:603-756), rule 10's `dataset.orig` reset at the top
  of its replay (:1848), rule 11's static two-threshold stage plus its separate counting-cost
  stage (:1262-1318), rule 6 fork 3's ALLOW/named-constant choice for the 120 ms fade
  (:938-950), rule 8's weekday (Sat 26 Sept, correct for 2026), the reduced-motion two-step
  hold (`holdCeremony`/`armHold` at :1483-1530), the three shortlist retags (`sig-06`,
  `sig-22`, `prc-02`), the dry-die contrast caption (:549), the two unlabelled-road fixes
  (rule 1's left stage, rule 5's inherited `ARM_WINDOW_MS` note), and the one 0.65x scale
  label repeated at every overlay meeting point. The twelfth — stale "Sketch 105" masthead in
  all three `shots/*.png`, the sketch having been renamed after those were captured — was the
  one still open; this pass re-rendered all three with `render-sketch.mjs` and confirmed the
  masthead now reads "Sketch 116 · 2026-09-17 · third pass" in every one. Every rule section
  was cropped from the fresh stitched captures and read with no new defect found.
- **Verified with Playwright in Chrome at 1440 and 390 on 2026-09-17: 0 console errors, no
  horizontal overflow** at either width, measured (`scrollWidth == innerWidth`). Driven and
  read back, not eyeballed: rule 10's clear → Replay → type → Replay → clear → Replay
  sequence (the sentence, the torn class and the stub follow the field every time); the
  reduced-motion hold with real mouse input (first press arms and the label says "Tap again
  to approve", second press seals, a press left 3.4 s disarms and restores the label, Esc
  disarms); rule 11's proposed stage reading "Still fetching the ledger." at 5 s and 8 s and
  changing once at 21 s while the counting stage ticks; rule 3's three sentences; the
  overlay widths (208 / 403 / 286); at 390 the rule 9 boxes at `scrollLeft 0` with the
  width tag under each, the shortlist rows as a grid with the head hidden and the state
  tag inside the row, and rule 3's popover inside its own column.
- **Captured** with `render-sketch.mjs`, re-measured on this pass: the 1440 page is 18,031 px
  at 800 ms and 18,070 px settled, the 390 page 44,028 px, all past Chrome's 16,384 px
  ceiling, so all three are banded and stitched by the script (it exits 3 rather than write a
  broken image). Every rule was cropped from the stitched captures and looked at, at both
  widths; no new defect found. The third pass had found and fixed two: a line under rule 3's
  other-road chip sitting behind its popover, and at 390 that popover spilling over the
  expander beneath it.
- **Not verified here:** real touch hardware on the four pills; the guard's output is a drawn
  run, not a script that exists; packet 0's code was not executed (rule 10's middle stage is
  drawn from its description in the ADR); the shortlist "state" column is this sketch's
  placement, not the founder's; any browser other than Chrome; the exact wording of the
  gateway's 403 body (the canvas paraphrases the controller's `ApiResponse` description and
  cites it); the push service's behaviour beyond what `schedule.service.ts:660-677` shows
  (linked accounts only).
- The canvas is a specimen, not a spec: durations and curves are the tokens' own; overlay
  geometry is at one declared scale (0.65x) and the pills at page size.

## Screenshots

**Not committed** (founder, 2026-09-21: "Waiver, drop screenshots" — see
[0032](../../decisions/0032-vault-cleanup-cut-line.md#retire-to-write-waiver--pr-433-motion-rules-locked-2026-09-21)).
The three captures below are regenerable from `index.html` — open it per "How
to view" above (or drive it headlessly, e.g. Playwright, at the given width
and wait) — never restored from this file's git history:

- `shots/index-1440.png` — the canvas at 1440, 800 ms after load (entrances mid-flight)
- `shots/index-1440-settled.png` — the same 7 s after load (the ceremonies landed, rule 3's
  panel and rule 6's overlays drawn open, rule 8's undo window still draining, rule 11 past
  its two cycles and saying the wait)
- `shots/index-390.png` — the canvas at 390, 7 s after load, banded and stitched (44,028 px)

## Related

- ADR 0134 (Locked 2026-09-21; drafted Proposed on `docs/motions-and-overlays-per-page`) · ADR 0125 (the sealed
  cancel that rule 4 now rests on) · ADR 0112 (Locked) · ADR 0138
- `087-mudavym-motion-canvas/shortlist.html` — the 47 the mapping section places
- `099-modal-shapes`, `102-modal-census`, `103-overlay-experience` — the overlay lineage
  rules 3, 6, 9 and 10 sit on
- `apps/web/src/lib/mudavym/motion.ts` — the seven tokens, verbatim
- `apps/web/src/pages/team/next/WeekGrid.tsx` — the two send paths rule 3 draws
