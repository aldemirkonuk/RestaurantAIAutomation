# ReceivingNext — motion map

Per-page motion inventory for `/receiving` (Mudavym redesign). Every motion
below runs on a token from `lib/mudavym/motion.ts` (sketch 059's vocabulary,
sampled springs included). Reduced motion collapses every entry to its end
state (the `animate()` wrapper and each component's own reduced path); the
hold-to-approve gesture becomes a two-step press-to-arm / press-to-confirm.

| # | motion id | name | where it fires | curve · duration |
|---|-----------|------|----------------|------------------|
| 1 | `receiving.risk.tally` | The at-risk and recovered figures arrive | `RcManagerQueue` (total at risk) and `RcOwnerLedger` (recovered) via `RcTally` — a figure changes while the page is open. Never on first paint; never from an em dash (knowledge arriving is not a value changing). | `tally` — overdamped spring `linear(…)` · 840ms |
| 2 | `receiving.lane.select` | Outcome lane select | `RcManagerQueue`/`LaneSpine` — accepted · short · refused lane press: text colour, count colour, and the 2px underline. | `ink` — house cubic-bezier(0.16,1,0.3,1) · 160ms |
| 3 | `receiving.row.settle` | Queue row expand / collapse | `RcManagerQueue`/`QueueRow` — `grid-template-rows` 0fr→1fr and the chevron turning 0→90° **on the same token**, so the row and its pointer are one event. The expanded body carries the facts (the match sentence, claims, backorder) and the two hand-offs (/orders, /receipts). | `settle` — cubic-bezier(0.16,1,0.3,1) · 320ms |
| 4 | `receiving.credit.pour` | Hold-to-send fill | `RcCreditDrafts`/`DraftCard` — the `HoldToApprove` die on a drafted-unsent credit request, wired to the REAL `open → requested` transition. | `pour` — **linear** · 620ms (the operator is timing it against their own thumb) |
| 5 | `receiving.credit.tuck` | Early release retreat | Same die — the fill retreats and the status line states what did **not** happen ("Released at N% — nothing sent"). | `tuck` — near-critically-damped spring · 300ms |
| 6 | `receiving.credit.stamp` | The seal lands on a sent request | `HoldToApprove` completion in `DraftCard`: the pressed Seal lands (scale 0.8→1). The **only** motion in the system allowed to overshoot (~11%). A gateway refusal resets the die with the refusal stated in place — still drafted, nothing sent. | `stamp` — spring `linear(…)` w/ overshoot · 360ms |
| 7 | `receiving.draft.turn` | The draft's working turns in | `RcCreditDrafts`/`DraftCard` — "Show the working" reveals what the house knows (notes, amount, whether a document is attached), slower than settle on purpose. | `turn` — cubic-bezier(0.32,0.72,0,1) · 420ms |
| 8 | `receiving.outbox.pin` | Nothing vanishes; the drop becomes a pin | `RcOutboxRail`/`PinnedDrop` — a receipt `flushDoorOutbox` permanently dropped (4xx, or 8 attempts — the `failed` count the legacy page throws away) arrives in the rail: it travels in on `turn`, then lands on the house `stamp` (inv-09's spec, verbatim). Only a drop pinned THIS session moves; one restored from storage was already landed when you walked in. It stays until a person unpins it. | `turn` 420ms, then `stamp` at reduced amplitude (scale 0.97→1) · 360ms |
| 9 | `receiving.micro.ink` | Micro-states | Hovers, the staff hand-off's pressed state (brightness only), the retry buttons, the attempt counter's colour as it climbs toward 8/8. Nothing travels more than 2px. | `ink` — house curve · 160ms |

Deliberate non-motions on this page:

- **The queue item that stops existing gets no animation** (inv-09's rule: the
  absence is the defect, and animating it would dress it up). The drop's whole
  motion budget is spent on the PIN arriving, never on the item leaving.
- **No shake, no bouncing checkmarks, no skeleton shimmer** — loading is the
  sentence "Reaching the gateway…", an unknown is an em dash, a refusal is a
  stated fact in place.
- **The staff hand-off does not animate a transition** — it navigates to the
  door flow immediately; a porter next to a double-parked truck is not an
  audience.
