# Motions — the house overlay primitive (ADR 0112)

Three shapes, three motion tokens, all from `lib/mudavym/motion.ts`. Nothing here
introduces a curve; each shape borrows the token whose meaning already matches
what the shape is for.

| id | token | curve / ms | fires |
|---|---|---|---|
| `mdv-sheet-tuck` | `tuck` | spring 380/32 sampled to `linear(…)`, 300ms | a `Sheet` opens — 28px from the right + opacity. `tuck` is "an object that moved under a finger", which is exactly what a record pulled in from the list is. |
| `mdv-panel-settle` | `settle` | `cubic-bezier(0.16, 1, 0.3, 1)`, 320ms | a `Panel` opens — 6px up + opacity. The house curve, because a question arriving is the ordinary case, not a ceremony. |
| `mdv-popover-ink` | `ink` | `cubic-bezier(0.16, 1, 0.3, 1)`, 160ms | a `Popover` opens — 4px up + opacity. `ink` is the micro-state token: nothing moves more than a couple of pixels, because the menu belongs to a control that has not moved. |

Deliberate non-motions:

- **No exit animation.** An overlay closes instantly. Everything here is a
  detour from the page, and a detour that takes 300ms to end is a detour you
  notice twice.
- **No scrim fade.** The scrim appears with its surface. Fading it separately
  reads as two events for one action.
- **No `stamp`.** The seal overshoot is reserved for real commitment
  (`HoldToApprove`). Opening a window is not a commitment.

`prefers-reduced-motion` renders **no animation at all**, not a shorter one: the
panel carries `data-motion="none"` and `animate()` is never called. The test
`Sheet.test.tsx` asserts both the token name and the `none`.
**[AMENDED 2026-09-21 by ADR 0134 §6 (locked): the three entrances above now
cross on `REDUCED_FADE` under reduced motion -- 120ms, linear, opacity only,
no movement -- so the panel carries `data-motion="fade"` and `animate()` is
called once per entrance, with `respectReducedMotion: false`. `Sheet.test.tsx`
asserts the `fade` and that single call. 120ms is not an eighth token; it is
allow-listed by file:line in `scripts/check_motion_tokens.py`.]**

---

## The experience layer (2026-09-06 — sketch 103, accepted; ADR 0112)

Four motions were added and no curve was. Each one borrows a token that already
means what the moment means.

| id | token | curve / ms | fires |
|---|---|---|---|
| `mdv-sheet-tear` | `tuck` | spring 380/32 sampled to `linear(…)`, 300ms | a **dirty** Sheet leaves on Esc, an outside click or a spine jump (1b; the spine joined 2026-09-17) — 28px to the right + opacity (28px down in the phone form), the enter motion run backwards. Clicking Close during the tuck finishes the leave at once rather than starting a second one. This is the system's one exit animation, and it is deliberate: everywhere else a close is a detour ending, and a detour that takes 300ms to end is a detour you notice twice. A tear is something happening TO the paper, so the reader has to see it happen. `onTear` fires at the gesture; `onClose` when the motion has run. |
| `mdv-panel-lean` | `settle` | `cubic-bezier(0.16, 1, 0.3, 1)`, 320ms | a **dirty** Panel refuses a stray click (1d) — 6px left, 6px right, back. The house curve, because the panel is not going anywhere; it is answering. The sentence in `.mdv-ovl__weight` is the part that must reach everyone — a lean is a movement, and a movement reaches no screen reader. |
| `mdv-sheet-tuck-bottom` | `tuck` | as above, 300ms | a Sheet opens in the **phone form** (F9) — 28px from the bottom edge instead of the right one. Same token, same distance, the axis the form actually moves on. |
| `mdv-bound-ink` / `mdv-stub-ink` | `ink` | `cubic-bezier(0.16, 1, 0.3, 1)`, 160ms | "What the seal bound" arrives under a completed hold (1d), and the stub arrives on its row (1b). Both are micro-states on something that has not moved, which is exactly what `ink` is for. |

Deliberate non-motions, added:

- **The detents do not animate.** Moving a bottom sheet between peek, half and
  full changes a height class and nothing else. A height that eases while the
  thumb is still on the grabber lags behind the hand, and the reader reads that
  as the app being slow rather than as a curve.
- **The spine does not animate.** A level appearing on the breadcrumb is a fact
  about where you are, and a fact that slides in asks to be watched.
- **The refusal does not animate.** "Three sheets are open" is an answer, not an
  alarm; it appears where the reader is already looking.

`prefers-reduced-motion` renders none of the four. The tear closes at once, the
lean speaks without moving, and the read-back and the stub are simply there —
the end state, never a shorter version of it. `housePolicy.test.tsx` asserts
that every `animate()` call in the primitive family is handed one of the seven
tokens and never a `{ easing, ms }` literal, and — since 2026-09-17, by
rendering them rather than by reading their source — that under reduced motion
the open, the tear, the lean, the stub and the seal call `Element.animate`
zero times, including the seal's `stamp`.
**[AMENDED 2026-09-21 by ADR 0134 §6: `REDUCED_FADE` is the one named,
disclosed exception to the token check, and under reduced motion the open now
calls `Element.animate` once -- the 120ms opacity-only fade, asserted by its
duration, easing and keyframes. The tear, the lean, the stub and the seal
still call it zero times.]**

---

## The page's own width (2026-09-06 — sketch 103 · 1a)

Not a motion, but it belongs beside them because it is the other half of what a
Sheet does to a page. While a Sheet is open the primitive sets, on every
`.mudavym` **page** root (never on the overlay's own root):

    data-sheet-open="overlay" | "compress"     ← the sheet's `layout` prop
    --sheet-width: 440px | 640px | 0px         ← 640 for a `wide` sheet; 0 in the phone form

The primitive edits no page. A page that wants 1a's compression writes its own
rule and opts in by asking the sheet for `layout="compress"`:

    .mudavym[data-sheet-open='compress'] .my-list { padding-right: var(--sheet-width); }

A page with no such rule renders exactly as it did. Both hooks are counted like
the scroll lock — with two sheets open the topmost one sets the width — and
both are removed when the last Sheet closes. A page root that mounts while a
sheet is already open is painted when it arrives (a `MutationObserver` that
lives only while a sheet is open).

**The scrim follows the layout (2026-09-17, interim while OD-123 is open).** A
Sheet with `layout="compress"` paints no scrim; any other Sheet keeps the dim
it always had. The first cut turned the scrim off for every Sheet, which left
the fourteen live Sheet callers — none of them `compress` — over a fully lit
page that the still-present scrim kept unscrollable and unclickable. `scrim`
still overrides either way.

---

## The house header (2026-09-04)

`HouseHeader` adds no new curve. Everything in the bar is a colour or a border
crossing `ink` (`cubic-bezier(0.16, 1, 0.3, 1)`, 160ms) — chrome that animates
is chrome you look at, and the bar's job is to be looked *past*.

| id | token | curve / ms | fires |
|---|---|---|---|
| `mdv-hdr-ink` | `ink` | `cubic-bezier(0.16, 1, 0.3, 1)`, 160ms | hover on the mark, the search trigger, any of the four right-hand controls — background and border only, no movement. |
| `mdv-hdr-hairline` | `ink` | `cubic-bezier(0.16, 1, 0.3, 1)`, 160ms | the bottom hairline appears once the page has scrolled more than 4px under it. It is a fact (there is something above), not a flourish, and it is the bar's only state. |
| the four popovers | `ink` | (the primitive's) | the bell, the branch switcher, the theme menu and the account menu all open the house `Popover`, so they inherit `mdv-popover-ink` above rather than defining anything. |

Deliberate non-motions:

- **The bar never moves.** No slide-in on mount, no shrink on scroll. A header
  that resizes as you read re-flows the page under it.
- **No badge animation.** A new unread count appears; it does not pulse. The
  bell is a register, and a register that flashes is asking to be believed.

`prefers-reduced-motion` drops every transition in `house-header.css` (the
`@media (prefers-reduced-motion: reduce)` block sets `transition: none`), and
the popovers' own reduced-motion behaviour is the primitive's, unchanged.

---

## The house day strip (2026-09-04)

`DayStrip` adds no new curve either, and it deliberately adds no movement at
all: a month of thirty-one cells that shifts under the pointer is a month you
cannot read. Everything is a colour or a border crossing `ink`
(`cubic-bezier(0.16, 1, 0.3, 1)`, 160ms).

| id | token | curve / ms | fires |
|---|---|---|---|
| `mdv-ds-ink` | `ink` | `cubic-bezier(0.16, 1, 0.3, 1)`, 160ms | hover and selection on a day, and hover on the two month controls — background, border and colour only, no movement. |

Deliberate non-motions:

- **Nothing tallies.** A day's mark is a count, and a count that counts itself
  up asks to be watched rather than read. The bars appear at their height.
- **No month transition.** Walking to the previous month replaces the cells; it
  does not slide them. A strip that animates its own contents makes the reader
  wait to find out what changed, and what changed is *everything*.
- **No hatch animation.** The hatch is the component's one load-bearing claim
  ("this day was read and held nothing"); drawing attention to it with motion
  would make an honest absence look like an alert.

The page that owns a mark owns that mark's motion — `/recommendations` draws
bars into the cell slot and gives them none either.
`prefers-reduced-motion` drops every transition in `day-strip.css`.
