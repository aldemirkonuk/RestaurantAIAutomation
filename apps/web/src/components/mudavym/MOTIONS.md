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
