# TeamNext — motions, canonical

Every token here is from `src/lib/mudavym/motion.ts`. A schedule under
construction is a working document: the only things allowed to move are a
surface arriving and a control answering a finger. Nothing on the grid itself
translates, ever.

| id | token | curve · ms | fires |
|---|---|---|---|
| `tm-ink` | `ink` | HOUSE · 160ms | control hover/focus, chip border and background state, member-row and roster-row hover — colour only, nothing translates |
| `mdv-sheet-tuck` | `tuck` | spring 380/32 · 300ms | a `Sheet` opens: the roster, a member, a shift, the crew note, the time-off file, the trail. Inherited from the house primitive (`components/mudavym/MOTIONS.md`), not re-declared here |
| `mdv-panel-settle` | `settle` | HOUSE · 320ms | a `Panel` opens: publish, re-publish, copy last week |
| `mdv-popover-ink` | `ink` | HOUSE · 160ms | a `Popover` opens: the right-click shift menu, the export menu |
| `pour` → `stamp` | `pour`, then `stamp` | linear 620ms, then spring 500/26 · 360ms | `HoldToApprove` on the two acts that DELETE before they write — re-publish (clears every read receipt) and copy-week (deletes the target week). The seal lands on completion; an early release retreats on `tuck` and says what did not happen |

## Deliberate non-motions

- **Gap rows never animate in.** An unfilled shift is a standing fact, not an
  arrival.
- **The labour figure never tallies.** It is a sum of record that changes only
  when a shift changes; a ticking number would imply it is being computed live.
- **The row expander does not slide.** Selecting a shift, or opening a roster
  row, swaps content in place under the row. The `settle` height animation was
  considered and dropped: the grid is a table, and a table whose rows change
  height under the cursor is a table you lose your place in.
- **A first publish is not a ceremony.** It destroys nothing, so it gets a plain
  confirm — the die pressed dry. Only the two destructive acts earn the wax.
- **"Sent", "assigned" and "requested" are a change of words, in place.** No
  toast: this half of the page mounts no toaster, and a confirmation that flies
  in from a corner is a confirmation you can miss.

`prefers-reduced-motion` is honoured everywhere: `team-next.css` sets
`transition: none !important` on every control, chip and row, and the overlay
primitive renders its surface at the end state with no animation scheduled at
all.
