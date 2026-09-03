# CalendarNext — motions, canonical

Every motion below is a token from `src/lib/mudavym/motion.ts` (or the CSS
equivalent of the same curve, which is the same numbers written twice). Nothing
on this page moves that is not in this table.

The founder's verdict for `/calendar` was **KEEP** — *"I really prefer the new
version. That's for sure."* A KEEP is a brief to move *less*, not more: the page
is already liked, so motion here exists to make the book behave like a book, and
nowhere else.

| id | token | curve · ms | fires |
|---|---|---|---|
| `cn-open` | `settle` | HOUSE `cubic-bezier(.16,1,.3,1)` · 420ms | the opening block (wordmark, period line, standing sentence) on mount, once — opacity + 6px rise |
| `cn-turn` | `turn` | `cubic-bezier(.32,.72,0,1)` · 420ms | the view stage when the magnification changes (Month ↔ Week ↔ Day ↔ Agenda) — "show the working": the same book, a page turned. Opacity + 8px rise |
| `cn-day-settle` | `settle` | HOUSE · 320ms | the day ledger opening under the month grid — CSS `grid-template-rows: 0fr → 1fr` (`.cn-expand`). This is the row-expand the founder singled out by name on board 053 |
| `cn-sheet-tuck` | `tuck` | HOUSE · 300ms, spring 380/32 shape | the event sheet arriving from the right, 28px + fade (`@keyframes cn-sheet-in`) — an object that moved under a hand |
| `cn-drag` | **none, deliberately** | live `pointermove`, un-eased | a block dragged or resized in the Week/Day grid. Easing between 15-minute snaps would draw a time the operator never chose, so the block tracks the finger exactly and the ghost clock reads the snapped value |
| `cn-drop-tuck` | `tuck` | spring 380/32 `linear(…)` · 300ms | the same block settling into its committed `top`/`height` after the pointer lifts. Suppressed (`transition: none`) for as long as the finger is down |
| `cn-ink` | `ink` | HOUSE · 160ms | hover/focus micro-states on day cells, ribbons, ledger lines, tabs, chips and buttons — border, ground and ink only; nothing moves |
| `cn-hold-pour` | `pour` | `linear` · 620ms | the `HoldToApprove` fill while the operator holds to delete. Linear because they are timing it against their own thumb; an early release retreats on `tuck` and says what did not happen |
| `cn-seal-stamp` | `stamp` | spring 500/26, ~11% overshoot · 360ms | the seal landing when the delete hold completes. The only motion on this page allowed to overshoot, and the only place the wax is spent |

## Deliberate non-motions

- **The grid does not stagger in.** The dashboard's SalesCalendar earns a
  staggered arrival because each cell carries a *figure* that arrives; a
  schedule is a reference you scan, and thirty-five cells rippling on every
  month change would be decoration. Months change instantly; only the stage
  fades on `turn`.
- **Nothing tallies.** There is no `tally` on this page. The standing line's
  counts are counts of record, not live figures, and an unknown (`—`) must never
  animate — a moving number reads as a measurement being taken.
- **The day ledger does not close with a ceremony.** Deselecting collapses on
  the same `settle`; leaving is not an event.
- **Ruling off is drawn, not animated.** The double rule appears with the data.
  A delivery arriving is a fact the gateway already recorded, not something this
  page performs — animating it would claim the page did it.
- **The sheet closes instantly.** Only arrival is a motion.
- **`prefers-reduced-motion`**: every WAAPI motion above collapses to its end
  state through `animate()`'s reduced-motion branch, and every CSS motion is
  disabled by the `@media (prefers-reduced-motion: reduce)` block at the foot of
  `calendar-next.css` (`.cn-expand`, `.cn-ink`, `.cn-cell`, `.cn-block`,
  `.cn-sheet`). The changes still happen; they stop travelling. `HoldToApprove`
  additionally swaps its timed hold for a two-step confirm.
