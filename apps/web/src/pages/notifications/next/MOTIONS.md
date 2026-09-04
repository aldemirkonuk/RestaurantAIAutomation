# NotificationsNext — motions, canonical

Every motion below is a token from `src/lib/mudavym/motion.ts` (or the CSS
equivalent of the same curve, written from the token's own `easing`/`ms` in
`PAGE_CSS` so the numbers on screen ARE the token). Nothing on this page moves
that is not in this table.

`prefers-reduced-motion` is honoured twice over: the WAAPI motions collapse to
their end state through `animate()`'s reduced branch, the CSS transitions are
disabled by the `@media (prefers-reduced-motion: reduce)` block at the end of
`PAGE_CSS`, and `Tally` lands its figure instantly via `useReducedMotion()`.

**Changed 2026-09-03.** `pour` and `stamp` are gone from this page: the wax
belonged to the one-tap die, and one-tap actions moved to the dashboard rail
(`pages/dashboard/next/OneTapPanel.tsx`; that page's `MOTIONS.md` carries them
now). Nothing on the day-book is a commitment ceremony any more — ruling a
line off is a record, not a seal — so the page is down to four motions and has
no wax at all. That is the correct reading of the rationing rule, not a loss.

| id | token | curve · ms | fires |
|---|---|---|---|
| `nt-open-arrive` | `settle` | HOUSE `cubic-bezier(.16,1,.3,1)` · 320ms | the opening line ("What the house noticed.") on mount, once — opacity + 6px rise |
| `nt-expand` | `settle` | HOUSE · 320ms | `grid-template-rows: 0fr → 1fr` on two things: a day-book line opening into its facts, and the **Ruled off** register opening under the double rule |
| `nt-chev` | `settle` | HOUSE · 320ms | the line's chevron turning 90° as it opens — same token as the expansion it belongs to, so they arrive together |
| `nt-ink` | `ink` | HOUSE · 160ms | hover/focus micro-states: a line's ground lifts one paper step, a control's border warms toward the seal ring. Nothing translates, nothing scales |
| `nt-tally` | `tally` | sampled overdamped spring (120/26, `linear(…)`) · 840ms | the rail's per-register open counts, and "Showing N of …", counting to each new figure as the page is worked. Driven off `springs.tally.samples`, so the on-screen curve is the token |

## Deliberate non-motions

- **No wax.** There is no `pour` and no `stamp` on this page. Every write it
  offers — rule off, reopen, archive, delete, set aside — is a bookkeeping
  entry, reversible in one click, and giving any of them the seal would spend
  the house's one ceremony on filing. The seal is for commitment; the day-book
  does not commit to anything.

- **A line does not travel from "Needs a hand" to "Ruled off".** It is redrawn
  in its new band by the next read. Animating the journey would assert a
  continuity the data does not have: between the optimistic update and the
  re-read, the server may have changed the row (another device, the 10s poll,
  a digest restack), and a row that slid smoothly into place would be claiming
  it is the same row unchanged. Subduing is done with ink, not with movement.
- **Nothing staggers in.** The book is a reference, not an arrival. A ten-line
  cascade on every 10-second poll would make a calm house look busy.
- **An unknown never animates.** The em dash appears instantly and never
  counts, eases or shimmers. A skeleton means "a request is in flight"; a dash
  means "asked, and there is no answer" — they are never the same element.
- **The `--calm` band does not pulse, glow or breathe.** A drafted-but-unsent
  reply must look *inert*; motion there would read as "in progress".
- **`turn` is unused, on purpose.** "Show the working" was the obvious token
  for the ruled-off register opening, and it is wrong: the account is being
  *consulted*, not revealed. `settle` says "this was already here"; `turn`
  would say "here is something new", which is the opposite of ruling off.

## Fourth pass, 2026-09-03 — five surfaces added, no motion added

The day rail, the register/status filter pills, the quick search, the hide-read
fold, the keyboard cursor and the market-price register all arrived in this pass
and the table above is unchanged. That is the intended result, not an oversight:

- **The rail's cells and the filter pills use `nt-ink` (the `ink` token, 160ms)**
  for their selected/hover states, which is the same micro-state every other
  control on the page already uses. A pill that animated differently from a line
  would be claiming to be a different kind of object.
- **A rail cell's bar does not animate.** The bar is a figure — how many lines
  that day holds — and this page does not animate a figure it did not measure.
  The bars count only the rows on screen; the rail says so, and an easing curve
  on a stated estimate would dress it up as a settled number. (The `tally` spring
  is used for the rail's per-register counts, which come back from a read and
  therefore do settle.)
- **The sleeping band and the market-price register reuse `nt-expand` /
  `nt-ink`.** A line going to sleep is not celebrated and does not slide away: it
  is redrawn in the band below by the next render, for the same reason a worked
  line does not travel between bands — the re-read may have changed it.
- **Nothing marks a line as "just woken".** A woken line is drawn exactly like a
  line that was never asleep, and the page states the fact once, in a sentence,
  above the book. A pulse or a highlight would be motion asserting recency about
  a row whose recency is already printed on it.
- **The keyboard cursor is a border and a ground, not a movement.** `j`/`k`
  change which line carries the ink-1 rule; nothing translates. Scrolling the
  cursor into view uses the browser's own `scrollIntoView`, which honours the
  reader's `prefers-reduced-motion` setting without this page mediating it, and
  is skipped entirely where it is not implemented.

---

## 2026-09-04 — the day rail became the house day strip

`DayRail.tsx` is deleted. The page now renders
`components/mudavym/DayStrip.tsx` through its own slot file `NoteDays.tsx`, so
the strip's motion is the house's (`components/mudavym/MOTIONS.md`, *The house
day strip*): `ink` on hover and selection, and nothing else — no month
transition, no tally, no animated hatch.

What this page gained by the merge, motion-wise: nothing moves that did not
move before. What it gained otherwise is the whole keyboard map (arrows,
Home/End, Enter/Space, Escape) and a visible focus ring, neither of which the
rail had.

The one motion this page still owns on the strip is **none**: the bar drawn in
a cell's mark slot is a proportion of the busiest day on screen, painted at its
height. A bar that grew would make a count of lines already loaded look like a
measurement being taken.
