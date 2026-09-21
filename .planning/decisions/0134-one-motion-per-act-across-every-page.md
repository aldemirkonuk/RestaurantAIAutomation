# 0134 — A motion answers an act, and every page answers with the same motion

- **Status:** Locked — the eleven rules below, as recommended by sketch 116 and locked by the
  founder 2026-09-21. Landed on `main` from `docs/motions-and-overlays-per-page`, where this ADR
  sat unmerged since 2026-09-06 while the founder watched the motion first (sketch 116).
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
| 5 | The 96px swipe | Keep 96px. Add the resistance curve `p(1 - 0.22p)`, the ghost seal, the `stamp` landing on commit, and a non-dragging Confirm (arm, then confirm) as the WCAG 2.5.7 single-pointer alternative. **Not settled by this lock:** that Confirm inherits `HoldToApprove`'s 3 s arm window (`ARM_WINDOW_MS`), which sketch 116 flagged as itself a timed twin and put to the founder with no recommendation (its founder question 4) — see "Not locked by this answer" below. | Fork 8 | No |
| 6 | Reduced motion | A Sheet/Panel/Popover **entrance** crosses on a 120ms, opacity-only cross-fade under `prefers-reduced-motion`; every other motion in the house (the tear, the lean, the seal) still renders none. **The §1/§7 collision, resolved explicitly, per the founder's instruction above:** 120ms is disclosed by an ALLOW line in `scripts/check_motion_tokens.py`, cited by file:line to this section — it is **not** promoted to an eighth token, so §1's "no eighth token" stays literally true, and §7's guard is told about the one exception rather than going red on this rule's own shipped line. | §6, fork 9 | Clarifies (the ADR named the collision as a fork's *cost*, `README.md:70`, without stating which road; the founder's answer picks the ALLOW-line road over the named-constant road) |
| 7 | The CI motion guard | Ship it, re-specified: resolve every `MUDAVYM_PAGES` slug's directory from `App.tsx`'s own routing (never a `pages/*/next` guess); scan `components/layout/` and `components/mudavym/` as well as every resolved page directory; allow-list a disclosed exception by file:line, citing this ADR; exit 2 when a slug cannot be resolved. Built this session as `scripts/check_motion_tokens.py`, mutation-tested against synthetic fixture trees (`--self-test`), proven PASS against the real, now-fixed tree (20/20 slugs resolved, `/inventory` and `/documents/:id` among them, `components/layout/Sidebar.tsx` scanned) with exactly three disclosed exceptions: rule 6's fade and rule 11's two sheens. **Built in part:** it checks the `animate()` wrapper's token argument and plain-CSS `animation:`/`transition:` pairings, which is the class rule 1 folded. It does **not** yet produce three of the seven reds §10 and the sketch's drawn run require on the pre-fix tree — `/inventory`'s missing reduced-motion guard, `/documents/:id`'s missing `MOTIONS.md`, `Sidebar.tsx`'s framer-motion transition — all three still standing on the current tree, and §10's second guard, `scripts/check_no_emoji.py`, is not built. Both are owed under this lock ("NOT built here" below). `ci.yml` wiring is **not** done here — see "Built in this lane" below. | §10, fork 10 | No — but built in part |
| 8 | `/calendar`'s delete | Keeps the wax, under rule 2's second clause (an act nothing can undo). Not the day-book undo-after alternative. | Fork 12 | No |
| 9 | Two wide sheets | Both forced to 440px — the census row 59 template sheet and (once packet 1's migration lands) row 33's delivery sheet. Not a third width, not an amended "or a table a person reconciles" clause. | Fork 13 | No |
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
- **Rule 7:** `scripts/check_motion_tokens.py` (new), a `CLAIMS.jsonl` row that runs it. **Not**
  wired into `ci.yml` — `ci.yml` is gate-owned (`pr-audit-gate`); wiring this guard's invocation
  into it is named as a follow-up needing the founder's word, in `founder_questions`, not done
  silently here.
- **Disclosed limitation, rule 7:** the guard checks the house `animate()` wrapper and plain CSS
  only. `components/layout/Sidebar.tsx`, `Header.tsx`, `RestaurantBranchSwitcher.tsx` and
  `pages/cellar/next/WineRegister.tsx` animate through **framer-motion** (`transition={{ duration:
  0.15, ease: […] }}` JSX props), a second, older motion system this ADR does not fold into the
  token vocabulary and this guard cannot see. Sidebar's own migration was never one of the eleven
  rules the founder was asked to watch (sketch 116 does not draw it) and is not decided here —
  it remains this ADR's original §5, unlocked, open for a future pass.
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
| 5 | `pages/receipts/next/SwipeToConfirm.tsx:27` (`TRAVEL` stays 96px) — the resistance map, the ghost `Seal`, the handle fading on `ink` at commit, `stamp` on the seal landing, a non-dragging arm-then-confirm control reusing `HoldToApprove`'s `ARM_WINDOW_MS` |
| 8 | No file changes — the wax stays as-is under rule 2's clause 2; nothing to build |
| 9 | `apps/web/src/pages/communications/next/TemplateSheet.tsx:135` (`wide` removed), the delivery sheet once packet 1's migration lands (currently a legacy, untouched `ManualReceiptWorkspace.tsx` modal) |
| 10 | `feat/overlays-packet-0-primitive` (not yet an ancestor of `main`) — one `input`/`change` listener on the panel node the primitive already owns, as a fallback to the `dirty` prop |
| 11 | `pages/dashboard/next/dashboard-next.css:44`, `pages/reports/next/reports-next.css:391` (`animation-iteration-count: 2`, a `data-still` end state, two static sentences at 3.8s and 20s from the skeleton host — no interval, no counting) |
| 7 (rest) | `scripts/check_no_emoji.py` (new — §10's second guard; sketch 116's cost row 7 names both scripts); `scripts/check_motion_tokens.py` widened to the three §10 reds it does not produce (`pages/inventory/command` has no reduced-motion guard; `pages/documents/next` has no `MOTIONS.md`; `components/layout/Sidebar.tsx`'s framer-motion transitions) and to Tailwind motion utilities; each line it then fails on either fixed by its page's lane or allow-listed by file:line with this ADR cited; `.github/workflows/ci.yml` wiring on the founder's word (gate-owned) |


### Not locked by this answer

"Lock as recommended" answers the eleven rules sketch 116 drew. It does not reach what the sketch
did not draw or drew without a recommendation, so these stay **Proposed** until the founder answers
them, and no builder should read the Status line above as covering them:

- **Sections of this ADR outside the eleven:** §4 (a keyboard-opened overlay does not animate), §5 /
  fork 1 (the sidebar), §7's SC 3.3.8 bullet (the manager passkey and paste into the passcode
  field), §8 / fork 2 (`/inventory`'s gating and deferred swaps), §9 (the chip's explicit
  `line-height`), fork 14 (the unreachable consent panel, "not defaulted here" in its own text).
  Rule 2's lock does answer fork 4 and §3: wax versus nothing, the bulk bar a dry emboss.
- **Raised by sketch 116 with no recommendation** (its founder questions 4 and 6): whether rule 5's
  Confirm keeps the inherited 3 s arm window, lengthens it, or stays armed until Esc, a click
  elsewhere or the sheet closing; and whether `ResponsesSheet.tsx:356`'s `wide` stays at 640 as
  letters or is a third sheet under rule 9.

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
animation at all, always, whatever the motion setting.** One boolean on the component. And **the
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
unmigrated chrome, to die with the legacy pages.
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
