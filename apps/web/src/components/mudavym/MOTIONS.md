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
