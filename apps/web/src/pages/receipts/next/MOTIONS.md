# ReceiptsNext — motions, canonical

Four motions from `src/lib/mudavym/motion.ts`. The founder named the first:
*"especially with the motions we're going to add… a swipe-up confirm."*

| id | token | curve · ms | fires |
|---|---|---|---|
| `rc-swipe-confirm` | `pour` (fill) + `tuck` (return) | linear 620ms · tuck-spring 300ms | the SwipeToConfirm ceremony: the fill tracks the finger 1:1 during drag; the keyboard hold fills at the pour rate, LINEAR — a countdown never eases; early release tucks back |
| `rc-swipe-seal` | `stamp` (seal) + a 1.6s opacity pulse (wait sign) | spring 360ms · ease-in-out 1600ms, repeating | the swipe completing: the house's pressed Seal lands in the handle on `stamp`, the one motion allowed to overshoot (the same landing as HoldToApprove); if the answer takes over 400ms, a thin seal line under "Confirming…" breathes until it comes. It marks the GESTURE and the WAIT, never the verification; nothing spins or counts; reduced motion shows both still (walk-through W21, 2026-10-01) |
| `rc-doc-settle` | `settle` | HOUSE · 320ms | the selected document's panel settling open |
| `rc-ink` | `ink` | HOUSE · 160ms | queue-row and control hover/focus — one paper step, nothing translates |

Deliberate non-motions: tie-out changes after an edit swap TEXT, never
animate — arithmetic moving smoothly would imply continuity a correction does
not have; the no-paperwork strip never pulses (it is standing fact, not an
alarm); verified documents leave the queue on refetch, without an exit
flourish.
