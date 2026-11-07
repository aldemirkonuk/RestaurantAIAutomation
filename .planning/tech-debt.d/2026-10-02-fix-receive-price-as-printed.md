## Price as printed at the receiving door (F-103): what it left — OPEN — 2026-10-02

Filed from `fix/receive-price-as-printed`. It builds the founder's ruling RECEIPTS-W56 (2026-10-02, "Price as printed (Recommended)"; the ADR is the R3 sim-rulings ADR, its number assigned in the door PR). `verifyReceipt` now takes the invoice price as printed, with an optional `invoicePriceUom` + `invoicePricePackSize` pair (ADR 0119 words; absent = per bottle). It converts the price once in `computeMatch` (`readInvoicePrice`), and both forms send the pair. The claims are in `decisions/claims.d/fix-receive-price-as-printed.jsonl`. These are the parts it did not do. Line numbers are at this branch's head.

- **The shared web client type still says "PER BOTTLE".** `apps/web/src/services/api/orders.ts:548-549` is a shared part and was left untouched. `ReceivingWorkspace` sends the two new fields by spreading them, so they type-check without being named. The change it needs:
  - change the comment to `/** As printed, in invoicePriceUom; absent = per bottle. */`;
  - add `invoicePriceUom?: string; invoicePricePackSize?: number;` beside `invoiceUnitPrice`.
- **Paper or order line: which one starts the pick? Not decided.** On both forms the pick starts at the order line's price unit (the ruling). A document that pre-fills the price puts its figure in without the unit it was read in. The parsed line carries that unit: `priceBaseQty`/`priceBaseUom`, BT-149/150, `procurement/documents/parsed-document.ts:115-117`. So a per-bottle figure read off the paper can land beside a "per case of 24" pick:
  - The screen shows this as a variance.
  - If the desk then accepts it with an override, the gateway books the figure divided by 24.
  - Before this branch the same thing could happen the other way round: a case figure read as per bottle.
  - Whether the paper's own price unit should start the pick is the founder's call.
- **Keg and litre invoice prices are refused, not converted.** If an invoice price is stated per keg or per litre, `readInvoicePrice` refuses it with a 400 (`not_comparable`). Neither form offers that unit, so a keg-priced line gets no pick and behaves as before. This waits for the ADR 0115 door work. The mobile screen still divides a keg line's agreed price by a pack of 1 (`apps/mobile/app/(tabs)/cellar/receive/[orderId].tsx:54-57`). That is how it was before, and this branch did not touch it.
- **The printed figure has no column of its own.** `procurement_orders.invoice_unit_price` is `numeric(10,2)` and is written per bottle, so $44.00 a case of 24 is stored as 1.83. The printed figure and its unit are kept only in two places:
  - on the register sighting (`raw_price`, `pack_size`, and the `statedUnit` copy in `raw`);
  - in the `price_history` note ("Invoice price $44.00 a case of 24, read per bottle.").
  - Keeping them on the order would need a migration, and this branch adds none.
- **The comparison is exact to the cent only for packs up to 100.** The agreed per-bottle figure is rounded to 4 dp at the door (`perBottleFromAgreedPrice`) and then scaled back up by the invoice's pack. The scaled figure stays within half a cent of the true one only while the pack is 100 or fewer bottles.
- **The whole-pack web count still has two earlier faults (not fixed here).**
  - When it counts in cases, "Real cost … /btl" divides the allocated charges by the case count (`ReceivingWorkspace.tsx`, verdict block).
  - A document pre-fill sets `invoiceQty` from `qtyBottles` and does not declare `invoiceUom: 'bottle'`.
  - The price part of "Real cost" is now per bottle.
- **The note on the door's agreed price is out of date.** `agreedPricePerBottleForDoor`'s note still reads "compared per bottle at $X". The comparison now scales that per-bottle figure to the invoice's pack. The figure is right; the wording is stale.
