# RecommendationsNext — motions, canonical

Five motions, every one a token from `src/lib/mudavym/motion.ts`. This is a
page you work *down* — a book of standing business — so motion is spent on
two things only: opening the working, and turning a leaf. Nothing on the page
moves that is not in this table.

| id | token | curve · ms | fires |
|---|---|---|---|
| `rc-work-settle` | `settle` | HOUSE `cubic-bezier(.16,1,.3,1)` · 320ms | the working panel under an entry, `grid-template-rows: 0fr → 1fr` — the row-expand the founder named by hand in the wave-1 review (DESIGN-FOUNDATION §0a, 053 "show the working"). Fires on the entry's own control and on `e` |
| `rc-leaf-turn` | `turn` | `cubic-bezier(.32,.72,0,1)` · 420ms | changing leaf (Standing → Snoozed → Dismissed → Ruled off → History): the body fades in with a 5px rise, once per leaf. A leaf of a book turns; it does not slide like a carousel |
| `rc-ink` | `ink` | HOUSE · 160ms | micro-states only — an entry's left rule warming to the seal ring on hover/focus, a quiet button's border and text. Nothing translates, nothing scales, nothing moves more than 0px |
| `rc-hold-pour` | `pour` | `linear` · 620ms | the fill inside `HoldToApprove` while the operator holds **Hold to rule off** — deliberately linear, they are timing it against their own thumb. An early release retreats on `tuck` and says what did not happen |
| `rc-seal-stamp` | `stamp` | sampled spring 500/26, ~11% overshoot · 360ms | the seal landing when the hold completes and the entry is ruled off — the one motion on this page allowed to overshoot, and the only wax on the page |

Every value above is written once, at the bottom of `rec-next.css`, next to the
token name it came from. `prefers-reduced-motion: reduce` disables the CSS
transitions and the leaf animation outright (the `@media` guard in that file),
and the two WAAPI motions collapse to their end state through `animate()`'s
reduced-motion branch inside `HoldToApprove`.

## Second pass, 2026-09-03 — the dismissal sheet

The sheet added no motion, deliberately. It is the only control on the page
that stores a **standing instruction** ("never show me this again"), and it
asks three questions before it will act; a panel that slides, fades or grows
while a person is deciding what to silence is asking them to hurry. It appears
and disappears instantly, inside the entry, and the only motion anywhere near it
is `rc-ink` on its own buttons.

Two more non-motions came with it:

- **`Dismiss it` is disabled until a reason is picked**, and the disabled state
  does not pulse, shake or draw attention to itself. The sentence beside it says
  why. A control that jitters to tell you it is unhappy is a control that has
  given up on words.
- **The scope radios do not animate between states.** The promise sentence under
  them rewrites in place when the scope changes — instantly, because it is the
  claim the manager is agreeing to and a claim must not arrive by transition.

## Deliberate non-motions

- **The seal is rationed to one act.** Only *ruling an entry off* — asserting
  the work was done — gets the wax. Act, dismiss, snooze, pin, assign and the
  bulk bar are the same die pressed dry: plain controls, no ceremony. A page
  where every button is a ceremony has no ceremony.
- **A dismissed or snoozed entry leaves at once**, with no exit motion. What
  makes it recoverable is the undo line under the book, which is a fact on the
  screen for eight seconds — not an animation that implies reversibility.
- **Figures never tally.** There is exactly one counted figure on the page (the
  denominator, "17 rules were read") and it is a count of record, not a live
  meter; `tally` would make it perform.
- **Unknowns never animate.** An em dash appears instantly and never counts,
  shimmers or eases. The loading rows are static ruled ghosts with no sheen —
  a moving skeleton and a dash are different claims and must not look alike.
- **A collapsed working is not merely short.** The panel stays in the DOM so the
  grid-rows settle has something to animate, but it is `aria-hidden` and
  `visibility: hidden` while closed (the visibility flip is deferred by 320ms on
  the way out so it does not blink mid-collapse) — the transition never leaves a
  focusable control or an announced sentence behind a closed row.
- **The register does not animate.** `rc-leaf-turn` is keyed on the leaf, not
  on the stake filter, so picking Money out of the register re-renders the body
  in place — entries never fly between sections, and the page does not perform
  a filter you already know you applied.

## Fourth pass, 2026-09-03 — the two forward doors add no motion

`Make this a goal` and `See it in reports` were added to every standing entry,
and the controls were split into two labelled rows (**Carry it out** / **File
it**). Nothing here animates, deliberately:

- **The goal sheet does not slide.** It is the page's *second* standing
  instruction — after a dismissal — and the same rule applies: a panel that
  moves while someone decides what number their house will be judged against is
  asking them to hurry. It appears, like the dismissal sheet, at once.
- **The classified rows do not stagger in.** "Carry it out" and "File it" are a
  layout, not an event. A label that eases into place is a label that was not
  there when the eye arrived, which is precisely the confusion the
  classification exists to remove.
- **A refusal does not shake.** A dark *Make this a goal* (a stockout, an HHI, a
  Gini, a rule that is already a goal) and a dark *See it in reports* are static
  from first paint, with the reason in words beneath them. They are not errors
  and must not be dressed as ones.
- **The gateway's 400 arrives as a sentence, not a flash.** `targetValue must be
  > 0` is rendered into the sheet with `role="alert"` and no motion; the sheet
  stays open so the mistake is fixable in place.
- **`See it in reports` navigates without a transition of its own.** It is a
  route change, and the page it lands on owns whatever motion happens there.

## The rework, 2026-09-03 — the docket, and the ribbon's one motion

The page's spine changed (the register became the act) and a day strip arrived
above it. That is a large structural change and it added exactly **one** motion.

| id | token | curve · ms | fires |
|---|---|---|---|
| `rc-ribbon-ink` | `ink` | HOUSE `cubic-bezier(.16,1,.3,1)` · 160ms | a day cell's border, fill and text as it is hovered, focused or selected. A day **fills**; it never grows, slides or bounces. Written at the bottom of `rec-next.css` on the same rule as every other `rc-ink` micro-state |
| `rc-docket-tuck` | `tuck` | sampled spring 380/32, ~1% overshoot · 300ms | the docket settling once when the ribbon selects or clears a day, or the register rail changes what it holds. Applied through `animate()` in `RecommendationsNext.tsx` (opacity 0.55 → 1, translateY 4px → 0), which is also where `prefers-reduced-motion` collapses it to its end state |

### Why `tuck` on the docket, and why only on the whole thing

The docket is re-laid-out by two controls: the ribbon and the register. Both can
change which sections exist, not just which rows are inside them. Three ways to
show that were considered and two rejected:

- **Rows fly between sections (FLIP).** Rejected. It says "this row moved", and
  in a day selection no row moved — the set of rows on screen is a different
  set. A convincing animation of a false claim is worse than no animation.
- **Each section staggers in.** Rejected. It reads as loading, and nothing is
  loading; the entries were already in memory. It would also make a two-section
  docket feel slower than a five-section one, which is backwards.
- **The whole docket settles once, on `tuck`.** Chosen. One object, one motion,
  ~300ms: the eye is told "this is a different set of rows" without any row
  pretending to have travelled.

### Deliberate non-motions on the ribbon

- **A hatched day does not shimmer, pulse or fade in.** "No record at all" is a
  statement of fact about the house's own books, and the page's oldest rule is
  that unknowns and absences never animate — a moving skeleton and a hatch are
  different claims and must not look alike.
- **A bar never grows from zero.** The bars are counts of record, drawn at their
  height on first paint. `tally` exists for figures that arrive; nothing on this
  strip arrives, and a bar that counted up would make a count of two entries
  look like a measurement being taken.
- **The day panel appears at once**, like both sheets before it. It carries the
  control that rules a day out of every average in the product — the third
  standing instruction on this page — and the same rule applies: a panel that
  moves while someone decides is asking them to hurry.
- **Keyboard motion is focus only.** Arrow keys move the roving focus ring;
  nothing scrolls, tilts or eases as the selection walks the strip.

---

## Fifth pass, 2026-09-04 — the strip is the house's now

The ribbon's cells, and every motion listed under "Deliberate non-motions on
the ribbon" above, moved to `components/mudavym/DayStrip.tsx` when the founder
made one shared day strip. The rules did not change — they are now enforced in
one file for two pages instead of asserted twice — and the house component's
own `MOTIONS.md` carries them under *The house day strip*.

What this page still owns:

| id | token | curve / ms | fires |
|---|---|---|---|
| `rc-docket-tuck` | `tuck` | spring 380/32, 300ms | the docket re-lays out when the strip's day, the register, **or the month** changes what it holds. The month is new: walking to August replaces every row, which is exactly the "this is a different set of rows" the `tuck` was chosen to say. |
| the day marks | — | none | the fired/due bars this page draws into the strip's cell slot. They appear at their height; nothing tallies. |

Two more non-motions, both new with the two doors:

- **The day-book draft does not slide in.** It is a record you are about to
  copy into another page; a panel that moves while you read four fields off it
  is asking you to hurry.
- **The slipping-goal block never animates its levers.** A list of other
  entries is not a result arriving.
