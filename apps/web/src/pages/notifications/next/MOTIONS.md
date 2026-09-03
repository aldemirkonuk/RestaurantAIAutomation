# NotificationsNext — motions, canonical

Every motion below is a token from `src/lib/mudavym/motion.ts` (or the CSS
equivalent of the same curve, written from the token's own `easing`/`ms` in
`PAGE_CSS` so the numbers on screen ARE the token). Nothing on this page moves
that is not in this table.

`prefers-reduced-motion` is honoured twice over: the WAAPI motions collapse to
their end state through `animate()`'s reduced branch, the CSS transitions are
disabled by the `@media (prefers-reduced-motion: reduce)` block at the end of
`PAGE_CSS`, and `Tally` lands its figure instantly via `useReducedMotion()`.

| id | token | curve · ms | fires |
|---|---|---|---|
| `nt-open-arrive` | `settle` | HOUSE `cubic-bezier(.16,1,.3,1)` · 320ms | the opening line ("What the house noticed.") on mount, once — opacity + 6px rise |
| `nt-expand` | `settle` | HOUSE · 320ms | `grid-template-rows: 0fr → 1fr` on three things: a day-book line opening into its facts, the **Ruled off** register opening under the double rule, and the "write a new one-tap action" form |
| `nt-chev` | `settle` | HOUSE · 320ms | the line's chevron turning 90° as it opens — same token as the expansion it belongs to, so they arrive together |
| `nt-ink` | `ink` | HOUSE · 160ms | hover/focus micro-states: a line's ground lifts one paper step, a control's border warms toward the seal ring. Nothing translates, nothing scales |
| `nt-tally` | `tally` | sampled overdamped spring (120/26, `linear(…)`) · 840ms | the rail's per-register open counts, and "Showing N of …", counting to each new figure as the page is worked. Driven off `springs.tally.samples`, so the on-screen curve is the token |
| `nt-hold-pour` | `pour` | `linear` · 620ms | the İznik fill under **Hold to mark it done** on a one-tap action, while the operator holds. Deliberately linear — they are timing it against their own thumb. An early release retreats on `tuck` and says what did not happen |
| `nt-seal-stamp` | `stamp` | sampled spring (500/26, ~11% overshoot) · 360ms | the seal landing when the execute has actually been recorded by the gateway. The only motion here allowed to overshoot, and the only wax on the page |

## Deliberate non-motions

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
