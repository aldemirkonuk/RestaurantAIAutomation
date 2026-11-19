Stacked on #1445 (OrdersNext.tsx owner).

## What changes
Design need N-11, /orders on a phone. The five stages are one scroll-snap strip of 112 x 72 tiles that scrolls inside itself (a pressed stage is brought into view) instead of 3 + 2; "Write a new order" is full width, 52 px, one line; "Write down an agreement" is a 44 px text link under it. From 640 px nothing changes. The old 3 + 2 grid test (ORD-W18) is replaced by one for the strip.

## Tests
- `StageSpine.phone.test.tsx` (6) + the ORD-W18 spec in `OrdersNext.deep-link.test.tsx` updated.
- Mutation (caught, 1 each): header class removed, text-link class removed, scrollIntoView effect off, tile height 72 to 60, button height 52 to 40.
- `vitest run src/pages/orders` 16 files / 252 tests pass; `tsc --noEmit` clean.

## Browser checks owed
/orders at 375: tiles 112 x 72, snap to the edge, pressing Recurring scrolls it in; the primary button 52 px on one line; the agreement link 44 px; no horizontal page scroll. 1440 unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
