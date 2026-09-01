# OrdersNext — motion map

Per-page motion inventory for `/orders` (Mudavym redesign). Every motion below
runs on a token from `lib/mudavym/motion.ts` (sketch 059's vocabulary, sampled
springs included) except the two deliberately un-eased time rulers, which are
`linear` by contract. Reduced motion collapses every entry to its end state
(the `animate()` wrapper and each component's own reduced path); the
hold-to-approve gesture becomes a two-step press-to-arm / press-to-confirm.

| # | motion id | name | where it fires | curve · duration |
|---|-----------|------|----------------|------------------|
| 1 | `orders.spine.tally` | Station counts arrive | `StageSpine` / `Tally` — a stage count or the month figure changes while the page is open. Never on first paint; never from an em dash (knowledge arriving is not a value changing). | `tally` — overdamped spring `linear(…)` · 840ms |
| 2 | `orders.spine.select` | Station select | `StageSpine` — station background, count colour, and the 2px underline on press. | `ink` — house cubic-bezier(0.16,1,0.3,1) · 160ms |
| 3 | `orders.row.settle` | Row expand / collapse | `LedgerRow` and `DraftCard` — `grid-template-rows` 0fr→1fr, and the chevron turning 0→90° **on the same token**, so the row and its pointer are one event. The expanded body carries "the working" (qty × unit = total, plus the listed total when the two disagree). | `settle` — cubic-bezier(0.16,1,0.3,1) · 320ms |
| 4 | `orders.approve.pour` | Hold-to-approve fill | `HoldToApprove` in a pending `LedgerRow` (real approve mutation) and in `DraftRail` (real approve-draft mutation); also the bulk bar's own hold. | `pour` — **linear** · 620ms (the operator is timing it against their own thumb) |
| 5 | `orders.approve.tuck` | Early release retreat | Same controls — the fill retreats and the status line states what did **not** happen ("Released at N% — nothing sent"). | `tuck` — near-critically-damped spring · 300ms |
| 6 | `orders.approve.stamp` | The seal lands | `HoldToApprove` completion: the pressed Seal lands (scale 0.8→1) — the founder's "we show our logo as a stamp". The **only** motion in the system allowed to overshoot (~11%). Fires once per approval; wired to the real mutation, and a gateway refusal resets the die with the refusal stated in place. | `stamp` — spring `linear(…)` w/ overshoot · 360ms |
| 7 | `orders.bulk.emboss` | The dry emboss | `BulkApproveBar` — after the bulk run finishes, ONE ink-coloured impression (no wax, no accent, rotate −4°) lands bottom-right of the group bar at reduced travel (scale 0.94→1). Fourteen approvals, one impression; the rows underneath simply settle via cache invalidation. | `stamp` curve at ~⅓ amplitude · 360ms |
| 8 | `orders.draft.turn` | The draft turns in | `DraftRail` / `DraftDetail` — the drafted letter and its thread reveal on expand, slower than settle on purpose ("show the working" for the letter itself). | `turn` — cubic-bezier(0.32,0.72,0,1) · 420ms |
| 9 | `orders.draft.drain` | Auto-send countdown | `DraftRail` / `CountdownBar` — when a scheduled send exists (`scheduledSendAt`, no `sentAt`), the bar drains scaleX 1→0 over the exact remaining ms, with Cancel live (`cancel-scheduled-send`) and growing stronger under 30s. | **linear**, duration = ms remaining (an eased countdown lies about time) |
| 10 | `orders.micro.ink` | Micro-states | Hovers, chip borders, the deliver button's pressed/disabled states, the error banner's retry. Nothing travels more than 2px. | `ink` — house curve · 160ms |

Not used on this page, on purpose: no shake anywhere (a refusal is stated as a
fact in place), no bouncing checkmarks (the house spends its one emphatic
motion — the stamp — on the seal and nowhere else), and no skeleton shimmer
theatre (loading is the sentence "Reaching the gateway…", and an unknown is an
em dash, never a zero).
