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
