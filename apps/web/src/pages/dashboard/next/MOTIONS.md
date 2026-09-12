# DashboardNext — motion map

The per-page motion inventory the founder asked for. Every motion below uses
the ADR-0042/sketch-059 tokens from `@/lib/mudavym` (or the CSS equivalent of
the same curve) and collapses to its end state under `prefers-reduced-motion`
— via the `animate()` wrapper for WAAPI motions and the `@media` guard in
`dashboard-next.css` for CSS transitions. Nothing on this page moves that is
not in this table.

| Motion id / name | Where it fires on this page | Curve |
|---|---|---|
| `open-arrive` — opening line entrance (ent lineage) | The serif "Good evening / before service" header, once on mount | `settle` easing `cubic-bezier(.16,1,.3,1)` · 420ms · opacity + 6px rise |
| `cal-arrive` — staggered arrival (ent-01 lineage) | Every real day cell of the sales calendar, on each month's first paint (initial load and month navigation) | `cubic-bezier(.16,1,.3,1)` · 420ms per cell · clip wipe + 6px rise · delay decays from 16ms × 0.94 per cell |
| `kpi-tally` — figures arrive (num-01 lineage) | All five KPI figures and the "Waiting on you" count, on first data arrival and on refetch deltas; an unknown (em dash) never counts | `tally` sampled overdamped spring (stiffness 120 / damping 26, `linear(…)`) · 840ms · driven off `springs.tally.samples` so the on-screen curve IS the token |
| `day-open` — settle expansion (the founder's named favourite) | The day-detail panel under the month grid when a day is clicked, each "Waiting on you" row when expanded to its HoldToApprove, and (added 2026-09-03) the "write a new one-tap action" form in the **One-tap actions** rail panel | CSS `grid-template-rows: 0fr → 1fr` · `cubic-bezier(.16,1,.3,1)` · 320ms (`settle`) |
| `day-scrub` — scrub the day (sig-d lineage) | The tape strip inside the day detail: one bar per day of the month; dragging (or arrow keys) moves the selected day under the needle and every figure/section snaps to that day | **un-eased on purpose** — live `pointermove`, no easing, no interpolation between days: the samples are per-day and easing between them would fabricate data |
| `hold-pour` — hold-to-approve fill | The `HoldToApprove` control inside an expanded "Waiting on you" row; on the ONE card in the **One-tap actions** rail panel whose act is real — a delivery confirmation — while the operator holds; and (added 2026-09-05, later the same day) on a hand-written note in the **`die` arm of `note_close_control`**, which is 20% of houses. It was on every card until the first real action landed, then rationed to a write that leaves the page, and the founder then asked for the note to be tried both ways: *"lets try both, 80 percent simple 20 percent signature"* (ADR 0127). **The same motion, deliberately, for two different weights of act** — which is the objection the experiment is measuring, not an oversight | `linear` · 620ms (`pour`) — the operator is timing it against their own thumb; release retreats on `tuck` (spring 380/32, ~300ms) |
| `seal-stamp` — the seal lands | Inside `HoldToApprove` when the hold completes and the server-bound write is committed: an order approval, or (2026-09-05) a delivery the gateway booked into stock after redeeming the seal minted when the hold began. It never lands on a mint that failed — `HoldToApprove` returns to rest and says "The seal could not be issued — nothing sent." **On the note's `die` arm the same stamp lands over NO seal at all** — no `onChallenge` is passed, nothing is minted and nothing is redeemed — so the card carries the distinction in words instead: *"this die is a gesture rather than a seal"*. At rest the two are indistinguishable; that is the measured cost, recorded in ADR 0116's 2026-09-05 status line | `stamp` sampled spring (500/26, ~11% overshoot) · 360ms — the only motion on the page allowed to overshoot |
| `ink-micro` — micro-states | Hover/focus borders and text colour on KPI tiles, calendar cells, queue rows, links, the Close button, and the one-tap panel's controls; nothing moves more than 2px | `ink` — `cubic-bezier(.16,1,.3,1)` · 160ms (CSS `.dn-ink`) |
| `skel-sheen` — honest skeletons | Loading bars in the calendar cells, KPI tiles, queue, and rail panels while a fetch is genuinely in flight (never shown for "unknown" — that is the em dash, static) | `cubic-bezier(.45,0,.55,1)` · 1.9s loop (ent-02's shimmer timing) |

## Deliberate non-motions

- **Unknowns do not animate.** An em dash appears instantly and never counts,
  rolls, eases, or shimmers — a skeleton means "in flight", a dash means
  "failed/unknown", and the two are never the same element.
- **Month navigation does not slide.** The new month's cells re-run
  `cal-arrive`; there is no carousel motion between months.
- **Scrubbed figures do not tween.** See `day-scrub` — the tape head is
  honest about the resolution of the data under it.
- **A card whose act is not built has no motion at all.** Its control is disabled and
  the sentence above it says why; a disabled control that animates is a control that
  looks pressable.
- **The one-tap panel's dashed cards never pulse.** An action the house raised
  and did not carry out must look *inert*. It gets the `settle` expansion and
  the `ink` micro-states like everything else on the rail, and no motion of its
  own; the only thing that moves on that card is the fill under the die, and
  only while a person's thumb is on it.
- **Reduced motion**: every row above lands on its end state with zero
  duration; the settle expansions and ink transitions are disabled in CSS,
  WAAPI motions collapse via `animate()`'s reduced-motion branch, and the
  skeleton sheen stops (the static bar remains).
