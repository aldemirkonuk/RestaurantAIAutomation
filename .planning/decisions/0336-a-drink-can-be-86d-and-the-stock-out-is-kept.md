# 0336 — A drink can be 86'd, and the stock-out is kept

- **Status:** Locked
- **Date:** 2026-10-11
- **Decider:** coordinator under founder delegation 2026-10-11 (industry standard)
- **Keywords:** F-145, 86, eighty-six, sold out, stock-out, availability, stock_outs, stock_outs_one_open_per_item, par, house item
- **Links:** migration `20261231900000_a_drink_can_be_86d_and_the_stock_out_is_kept.sql` (the table, coordinator shape D1); `apps/api-gateway/src/inventory/inventory.service.ts` (its gateway reader and writer); [ADR 0115](0115-the-house-item-is-the-ledgers-key.md); sim ledger F-145 and S195

## Context

F-145 (owner-quarter sim): three stock-outs had nowhere to go. They were a Moscofilero by the glass at about 17:30, a Xinomavro by the glass, and Tito's after a breakage. No page could mark a drink sold out, and nothing recorded when a stock-out started, what ran out, or why. So "par too thin for the week" could never be learned.

The schema half shipped as a coordinator shape (D1) in `20261231900000`. It adds one `stock_outs` row per stock-out of a house item, and the item is 86'd exactly while it has an open row (`stock_outs_one_open_per_item`, partial unique on `ended_at IS NULL`). It was never recorded as a decision.

### The delegation (verbatim)

The founder, 2026-10-11: *"If your decision is high industry standard, just do it. Do not ask me. If there is architecture decision to be made, then ask me in simple list form ever."* (in full in [ADR 0335](0335-a-house-brings-its-vendors-and-opening-stock-in-from-a-spreadsheet.md))

## Options considered

1. **No 86 (as built in the web).** The floor keeps a paper list, and the record never learns.
2. **An availability flag on the item.** Simple. But the flag and its history can disagree, and nothing says when or why the item ran out.
3. **The stock-out row is the flag.** The item is 86'd while a row is open. Who, when and why are on the row, and closing the row puts the item back. Every POS has an 86 button, and this one keeps the record behind it. **Chosen.**

## Decision

**A house item can be 86'd and put back. The 86 is the open `stock_outs` row, which records who, when and why (ran out, broken, pulled, other). Putting the item back closes the row. A stock-out never moves stock.**

1. **Anyone on the house's roster may 86 an item.** The person on the floor is the one who knows it ran out. Putting it back is also open to the roster. Both acts name their person.
2. **One open stock-out per item**, held by the database's partial unique index, so the flag and its record cannot disagree.
3. **Covers lost are not recorded.** Nobody in service knows the number, and a typed guess would later read as evidence (ADR 0020).
4. **The stock-out history feeds par advice.** An item that runs out often in a week is named as a par that is too thin.

## Consequences

- The floor can say "we're out" in the app, and the owner can see how often and why.
- Sending the 86 to the till is not covered. It needs a POS that accepts availability writes, and it is a separate decision per POS.
- Revisit if staff leave 86s open after a restock (the signal is open stock-outs on items with a receipt after the stock-out started).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-11 | — | Created under the founder's delegation (sim S195) |
