# DoorNext — motion map

Per-page motion inventory for `/receiving/:orderId/door` (Mudavym redesign).
Every motion runs on a token from `lib/mudavym/motion.ts` (sketch 059's
vocabulary, sampled springs included). Reduced motion collapses every entry to
its end state (the `animate()` wrapper and each component's own reduced path);
the door-seal gesture becomes a two-step press-to-arm / press-to-seal.

This page's one deviation from the house gesture is deliberate: the DOOR
FORGIVENESS on the seal (sig-a lineage). A receiver at a loading dock has
cold, possibly gloved hands — past 60% of the pour, an early lift still seals.
Below it, the fill retreats and the status line states what did not happen.

| # | motion id | name | where it fires | curve · duration |
|---|-----------|------|----------------|------------------|
| 1 | `door.head.settle` | Header entrance | The chrome bar, once on mount — 6px, quiet. | `settle` — cubic-bezier(0.16,1,0.3,1) · 320ms |
| 2 | `door.count.tally` | The boxes figure ticks | `DoorCount`'s big figure — a stepper tap or the paper's pre-fill retargets it; tabular figures, overdamped, it arrives and never bounces past. Never on first paint. | `tally` — overdamped spring `linear(…)` · 840ms |
| 3 | `door.match.ink` | The match line restates itself | `DoorMatch` — when "14 of 16 — two short" becomes "15 of 16 — one short", a 160ms crossfade. The delta is stated in WORDS; colour only underlines it. | `ink` — house curve · 160ms |
| 4 | `door.rows.settle` | Rows open and close | The refusal-reason row, the credit-draft card, and the visibly-broken count (which collapses when the whole delivery is refused) — `grid-template-rows` 0fr→1fr. | `settle` — house curve · 320ms |
| 5 | `door.seal.pour` | Hold-to-seal fill | `DoorSeal` — deliberately **linear**: the operator is timing it against their own thumb. | `pour` — linear · 620ms |
| 6 | `door.seal.forgive` | The thumb seals even lifted early | `DoorSeal`, release at ≥60% of the pour — the remaining fill runs out on `settle` and the seal commits. The door edition's one act of mercy for a gloved hand; below 60% nothing is saved. | `settle` — house curve · 320ms |
| 7 | `door.seal.tuck` | Early release retreat | `DoorSeal`, release below 60% — the fill retreats and the status line is honest: "Released at N% — nothing saved." | `tuck` — near-critically-damped spring · 300ms |
| 8 | `door.seal.stamp` | The seal lands | `DoorSeal` completion — the pressed Seal lands (scale 0.8→1). The **only** motion on the page allowed to overshoot (~11%). Wired to the real door-receipt submission; a gateway refusal remounts the die with the refusal stated in place. | `stamp` — spring `linear(…)` w/ overshoot · 360ms |
| 9 | `door.micro.ink` | Micro-states | Outcome and reason chips selecting, the offline chip, button pressed states. Nothing travels more than 2px. | `ink` — house curve · 160ms |

Not used on this page, on purpose: no spinner theatre around the offline queue
(a queued receipt is SAVED, and the copy says so — "saved on this phone, will
send when you're back inside"); no shake on a gateway refusal (the refusal is
stated as a sentence in place); no tick on first paint (a count that was
already 14 when the screen drew is just 14); and no animated celebration on
"done" — the pressed seal at rest IS the done state.
