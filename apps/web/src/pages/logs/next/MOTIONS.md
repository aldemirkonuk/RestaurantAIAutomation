# LogsNext — motions, canonical

Every motion below is a token from `src/lib/mudavym/motion.ts`, or the CSS
equivalent of the same curve written from the token's own `easing`/`ms` in
`PAGE_CSS`, so the numbers on screen ARE the token. Nothing on this page moves
that is not in this table.

`prefers-reduced-motion` is honoured three times over: the WAAPI motions
collapse to their end state through `animate()`'s reduced branch, the CSS
transitions are disabled by the `@media (prefers-reduced-motion: reduce)` block
at the end of `PAGE_CSS`, and `Tally` lands its figure instantly via
`useReducedMotion()`. The entry sheet inherits the primitive's own reduced
branch (`components/mudavym/Sheet.tsx`: no animation, not a shorter one).

| id | token | curve · ms | fires |
|---|---|---|---|
| `lg-arrive` | `settle` | HOUSE `cubic-bezier(.16,1,.3,1)` · 320ms | the opening (wordmark, "Logs.", the italic line) on mount, once — opacity + 6px rise |
| `lg-turn` | `turn` | `cubic-bezier(.32,.72,0,1)` · 420ms | the ledger when a thread is entered or left — opacity + 5px rise. "Show the working" is literally what following a thread is; the page turns to it and back. **It fires on the frame the new reading LANDS, not on the frame the URL changed** — see the note below |
| `lg-ink` | `ink` | HOUSE · 160ms | hover/focus micro-states: a row's ground lifts one paper step, a register cell's ground lifts, a control's border warms toward the seal ring, a summary's ink turns seal-deep, and the keyboard cursor's left rule and ground come up as the reader walks. Nothing translates, nothing scales |
| `lg-tally` | `tally` | sampled overdamped spring (120/26, `linear(…)`) · 840ms | the six register counts, counting to each new figure as pages are read. Driven off `springs.tally.samples`, so the on-screen curve is the token |
| entry sheet | `tuck` | sampled spring (380/32) · 300ms | the primitive's own enter motion for `Sheet` (`components/mudavym/Sheet.tsx`); this page adds nothing to it |

## `lg-turn` fires on what arrived, not on what was asked for

Entering a thread changes the query key, so for one round trip `<main>` holds
the loading band. The effect used to depend on `correlationId` alone, which
meant the page's one signature motion **played on three skeleton bars**, and
the thread it was written for then appeared with no motion at all — the exact
inversion of what this table claims. It is now gated on the read being `ready`
and on a `turned` ref holding the reading it last landed on, so it fires once
per change of reading, in both directions, and never on the arrival (the
opening is `lg-arrive`'s). A thread already in cache turns on the same frame,
which is correct: the page turned, it simply did not have to wait.

## Deliberate non-motions

- **No wax.** There is no `pour` and no `stamp` on this page. It writes
  nothing; following a thread is a read, and a read is not a commitment.
- **Older entries do not arrive; they are there.** "Read older entries"
  appends rows below the fold with no stagger, no fade, no slide. A record is a
  record; animating its arrival would say "new" about rows that are, by
  construction, the oldest on the page.
- **An unknown never animates.** The em dash on a register that could not be
  read, was not read, or was not reached appears instantly and never counts,
  eases or shimmers. A skeleton means "the first page is in flight"; a dash
  means "asked, and there is no answer". They are never the same element —
  and the skeleton itself is static: three paper-2 bars that do not pulse,
  because a pulse asserts progress the page cannot measure.

  **This rule was written before the page kept it.** Every register cell
  rendered the dash for the whole of the first read, so for that second the
  two *were* the same element and the dash meant "asking". A cell whose
  register is still being asked now draws a `lg-figure--wait` bar in its
  figure slot — the same static paper-2 vocabulary as the band's skeleton,
  the same refusal to pulse — and the dash is kept for the three absences it
  was always for. The contract is pinned in `LogsNext.test.tsx`, where the
  case that used to assert the dash during loading now asserts against it.
- **The keyboard cursor does not slide.** `j`/`k` redraw the cursor on the row
  it lands on, through `lg-ink`'s 160ms border and ground. Nothing travels
  between rows: the cursor is where the reader is standing, not an object
  moving down the page, and a rail sliding between two rows would make the
  reader's attention look like a thing the page is animating.
- **Stepping inside the sheet does not re-open it.** Earlier/Later and `j`/`k`
  change the sheet's CONTENT; the sheet itself never re-runs `tuck`. The
  reader has not left the room, so the door does not swing again — the one
  thing that moves is the position line's own text.
- **The sticky day heading does not fade in or out.** It is either the day the
  rows under the eye belong to, or it is the next one. A cross-fade at the
  boundary would put a frame on screen in which the rows belong to no day.
- **The floor mark does not animate.** `≥` is drawn or not, on the same frame
  as the figure it qualifies. A mark that faded in would separate the figure
  from its qualification for 160ms, and in that window the figure would read
  as a total.
- **Choosing a register does not move the list.** Filtering the loaded rows
  to one register redraws the list in place. The rows that remain were
  already on the page; sliding them upward would claim a continuity between
  two lists that are simply different subsets of one read.
- **The thread does not build itself.** Its entries are drawn together, in
  order, under one `turn`. A ledger page is read as a whole, not watched being
  written; a stagger here would dramatise a lookup.
- **The double rule is not drawn on.** It is there when the thread is there.
- **Leaving the thread is the same `turn` as entering it**, not a reverse.
  Both are the page turning to a different reading of the same registers;
  neither is an undo.
