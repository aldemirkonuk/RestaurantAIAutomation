# PromotionsNext — motions, canonical

This page spends motion on almost nothing, deliberately. Every figure on it is
either a measured price or a labelled estimate, never a live meter, so
`tally` is unused here — the one thing sketch 113 asks the page to prove
(worth) is exactly the thing ADR 0020 forbids animating into being.

| id | token | curve · ms | fires |
|---|---|---|---|
| card hover/focus | `ink` (HOUSE `cubic-bezier(.16,1,.3,1)`) · 160ms | `.pn-card`'s border warming to the seal ring — matches direction-b.html's own `.card:hover` rule verbatim |
| Sheet (offer detail) | `tuck` · 300ms | built into `components/mudavym/Sheet.tsx` — this page passes no motion prop, the primitive owns it |
| Popover (card menu) | `ink` · 160ms | same — built into the primitive |

## Deliberate non-motions

- **No tab underline and no hold on this page.** Trusted senders and Strangers
  (with the hold-to-trust and add-vendor acts) moved to `/communications`
  (ADR 0160 §113, Open item 3, decided 2026-09-18); their motions are listed in
  `pages/communications/next/MOTIONS.md`. `/promotions` holds offers only.
- **A dismissed offer's card leaves with no exit animation.** ADR 0112 F10:
  dismiss is undo-after — the card is removed from `ranked`/`ungradable` only
  once `POST /promotions/:id/dismiss` resolves and the query refetches, never
  optimistically. The fold's "N put away for the house" line is the durable
  fact that makes it recoverable, not a transition implying reversibility.
- **The worth figure never counts up.** `about $31` appears at its value. It
  is a projection already rounded down to a coarse estimate
  (`roundEstimate`); animating it into being would dress an estimate as a
  measurement arriving in real time.
- **The bands do not animate a card between tiers** (sketch 124 direction A, 2026-09-25).
  A card's size is its rank, read once; when a refetch moves an offer from the large row
  to the compact row it simply re-renders there. Growing or shrinking a box in place would
  dress a re-ranking as a live meter, the thing the worth figure already refuses.
- **The docket does not stagger, tuck or re-lay-out on load.** Ranking is
  computed once from the read and rendered in place — there is no ribbon or
  filter here that changes which rows exist the way `/recommendations`'s day
  strip does, so there is nothing for a re-layout motion to explain.
- **Skeleton rows are static ruled boxes**, not the 1.9s sheen other pages use
  for "in flight" — kept intentionally plain here since the loading state is
  brief (one read, no per-section fan-out) and a second visual language for
  "loading" was judged not worth the page's motion budget.
- **`prefers-reduced-motion`** disables the `ink` transitions via this
  directory's own CSS media guard; the two primitive-owned motions collapse
  through their own components' reduced-motion branches.
