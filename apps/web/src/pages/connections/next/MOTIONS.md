# Motions used — `/connections`

Flag `mudavym_design_connections` · localStorage override `mudavym.design.connections`

| id | token | curve / ms | when it fires |
|---|---|---|---|
| `cx-btn-hover` | `ink` | `cubic-bezier(0.16, 1, 0.3, 1)` · 160ms | the background of a live control settles in as the pointer enters it (`connections-next.css`, `.cx-btn`) |

## One motion, and why there is only one

This is a register of everything that can act in the house's name. It is read
when something has gone wrong, or before something is granted — both moments
where a page that moves is a page that is harder to read carefully. The house
idiom rations motion; here the ration is one, on the only element a reader
touches.

Three motions were considered and not built:

- **`tally` on the ledger counts.** The counting-up animation is the house's own
  and it is right on `/dashboard`, where a figure is a result. Here a figure is
  a *count of risks*, and animating "0 can spend today" upward from nothing
  would dramatise the reassuring reading of a number that is sometimes an em
  dash. A number that may be unknown must not perform.
- **`settle` on each register as it resolves.** Seven registers resolve
  independently, so this would have produced seven staggered arrivals and a page
  that never looks finished. Worse, an unread register renders as *words*, and
  animating those in gives a failure the same entrance as a success.
- **`stamp` on the seal for a granted write.** The seal ceremony belongs on the
  act itself — hold-to-approve on the call — not on the row that records a grant
  already given. Pressing it here would spend the house's one ceremonial gesture
  on a list.

`prefers-reduced-motion: reduce` drops the single transition entirely
(`connections-next.css`). Nothing on this page carries meaning in movement, so
there is no reduced-motion fallback to design — the page simply stops moving.

## The collapse, 2026-09-04

Still one motion in the table above. Two things arrived and neither adds one:

- **`HouseServerControls`** uses `cx-btn-hover` on its own controls and the shared
  `HoldToApprove` ceremony on revoke — the house's existing die, not a new gesture.
  Revoke earns it because it destroys a stored credential and re-declaring the same
  server does not undo it.
- **The register anchors** scroll with the browser's own `scrollIntoView`, `smooth`
  unless `prefers-reduced-motion: reduce` is set, in which case `auto`. It is not a
  house token because it is not a house gesture — it is the browser doing what a
  fragment link has always done, and inventing a token for it would imply the page
  had opinions about a scroll it does not drive.

## The payment register acts again, 2026-09-04 — and the hold's motions are named

Register II's two controls were disabled placeholders after the collapse; they
are live now, and both are `HoldToApprove` because the gateway REDEEMS a
one-time seal on each write (ADR 0110's addendum). That brings the shared
ceremony's three tokens onto this page in a second place — the first was the
re-consent hold, and the table above never named them, which this entry
corrects rather than leaves standing:

| id | token | curve / ms | when it fires |
|---|---|---|---|
| `cx-hold-pour` | `pour` | `linear` · 620ms | the İznik fill under a hold — **Charge this first**, **Remove**, **Re-consent `<tool>`** and **Hold to revoke `<server>`**. Linear on purpose: the operator times it against their own thumb |
| `cx-hold-tuck` | `tuck` | spring 380/32 · ~300ms | the fill retreating when the gesture is released early, beside the words "Released at N% — nothing sent" |
| `cx-hold-stamp` | `stamp` | sampled spring 500/26 · 360ms | the seal landing when a hold completes AND its one-time token was minted. A mint that fails resets the track instead and prints "The seal could not be issued — nothing sent", so the stamp is never drawn over an approval that did not happen |

**Still nothing new was invented.** These are the shared component's tokens,
listed here because a motions file that omits the only moving thing on a row is
the same omission this page exists to argue against. The refused-write line
(`.cx-ctl-alert`) does not animate: a refusal that faded in would be an event,
and it is a fact about the row that stays true until something changes.
