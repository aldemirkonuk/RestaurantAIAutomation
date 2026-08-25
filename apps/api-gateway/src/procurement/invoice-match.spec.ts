import {
  computeMatch,
  isClaimable,
  isDiscrepancy,
  MatchInput,
} from "./invoice-match";

/**
 * Four-way match (PO <-> Packing slip <-> Receipt <-> Invoice) verdict rules.
 *
 * One case per row of the edge-case catalog in the plan. Two load-bearing ones:
 *  - "damaged units" vs "short ship": both leave 22 bottles in stock out of 24
 *    billed, but they are different vendor failures and must not collapse.
 *  - "overbilled vs ship": the vendor's own two documents disagreeing. It is the
 *    only discrepancy that needs no argument, so it outranks everything else.
 *
 * A check's `ok` is TRI-state. `null` means the document needed to evaluate it
 * never arrived, and that is not the same as passing — inferring agreement from
 * a missing document is how a price gets marked verified that nobody ever read.
 */

// A clean 24-bottle order at the agreed $22, fully delivered and accepted.
const base: MatchInput = {
  orderedQty: 24,
  poUnitPrice: 22,
  invoiceQty: 24,
  invoiceUnitPrice: 22,
  acceptedQty: 24,
  rejectedQty: 0,
};

const check = (r: ReturnType<typeof computeMatch>, id: string) =>
  r.checks.find((c) => c.id === id)!;

describe("computeMatch", () => {
  describe("exact match", () => {
    it("passes every check and needs no ledger correction", () => {
      const r = computeMatch(base);

      expect(r.verdict).toBe("matched");
      // No packing slip here, so the two ship checks are null (unknown), not false.
      expect(r.checks.every((c) => c.ok !== false)).toBe(true);
      expect(r.ledgerDelta).toBe(0);
      expect(r.backorderQty).toBe(0);
      expect(r.priceVerified).toBe(true);
      expect(r.requiresOverride).toBe(false);
      expect(r.creditDue).toBe(false);
      expect(r.effectiveUnitCost).toBe(22);
      expect(isDiscrepancy(r.verdict)).toBe(false);
    });

    it("treats float noise as an exact price match", () => {
      const r = computeMatch({ ...base, invoiceUnitPrice: 22.000000001 });

      expect(r.priceVerified).toBe(true);
      expect(r.verdict).toBe("matched");
    });
  });

  describe("price variance (exact-match rule, D-B)", () => {
    it("blocks completion when billed above the agreed price", () => {
      const r = computeMatch({ ...base, invoiceUnitPrice: 24 });

      expect(r.verdict).toBe("price_variance");
      expect(r.requiresOverride).toBe(true);
      expect(r.priceVerified).toBe(false);
      expect(check(r, "price").ok).toBe(false);
    });

    it("flags even a one-cent deviation — there is no tolerance band", () => {
      const r = computeMatch({ ...base, invoiceUnitPrice: 22.01 });

      expect(r.verdict).toBe("price_variance");
      expect(r.requiresOverride).toBe(true);
    });

    it("clears the override requirement once a reason is given, but never marks the price verified", () => {
      const r = computeMatch({
        ...base,
        invoiceUnitPrice: 24,
        priceOverrideReason: "agreed surcharge over the phone",
      });

      expect(r.requiresOverride).toBe(false);
      expect(r.verdict).toBe("matched");
      // The price did NOT match; it was accepted anyway. price_verified must stay honest.
      expect(r.priceVerified).toBe(false);
    });

    it("ignores a whitespace-only override reason", () => {
      const r = computeMatch({
        ...base,
        invoiceUnitPrice: 24,
        priceOverrideReason: "   ",
      });

      expect(r.requiresOverride).toBe(true);
      expect(r.verdict).toBe("price_variance");
    });
  });

  describe("short ship", () => {
    it("reports qty_short when fewer bottles arrive than were billed", () => {
      const r = computeMatch({ ...base, acceptedQty: 22 });

      expect(r.verdict).toBe("qty_short");
      expect(r.ledgerDelta).toBe(-2); // stocked 24 at delivery, only 22 accepted
      expect(r.backorderQty).toBe(2);
      expect(r.creditDue).toBe(true);
      expect(check(r, "physical_vs_bill").ok).toBe(false);
    });
  });

  describe("damaged units", () => {
    it("reports rejected — not qty_short — when everything arrived but some was refused", () => {
      // 24 billed, 24 physically arrived, 2 broken -> the vendor shipped in full.
      const r = computeMatch({ ...base, acceptedQty: 22, rejectedQty: 2 });

      expect(r.verdict).toBe("rejected");
      expect(check(r, "physical_vs_bill").ok).toBe(true); // 22 + 2 === 24 billed
      expect(check(r, "damage").ok).toBe(false);
      expect(r.creditDue).toBe(true);
      expect(r.ledgerDelta).toBe(-2); // only the 22 good bottles stay in stock
      expect(r.backorderQty).toBe(2);
    });

    it("distinguishes damage from a short ship even though both leave 22 in stock", () => {
      const damaged = computeMatch({
        ...base,
        acceptedQty: 22,
        rejectedQty: 2,
      });
      const short = computeMatch({ ...base, acceptedQty: 22, rejectedQty: 0 });

      expect(damaged.ledgerDelta).toBe(short.ledgerDelta); // same stock outcome
      expect(damaged.verdict).not.toBe(short.verdict); // different vendor failure
    });

    it("reports qty_short when the shipment was both short AND damaged", () => {
      // 24 billed, only 21 arrived (1 of them broken) -> short ship dominates.
      const r = computeMatch({ ...base, acceptedQty: 20, rejectedQty: 1 });

      expect(r.verdict).toBe("qty_short");
      expect(check(r, "damage").ok).toBe(false);
      expect(r.backorderQty).toBe(4);
    });
  });

  describe("over delivery", () => {
    it("reports qty_over and never silently absorbs the extra", () => {
      const r = computeMatch({ ...base, acceptedQty: 26 });

      expect(r.verdict).toBe("qty_over");
      expect(r.ledgerDelta).toBe(2);
      expect(r.backorderQty).toBe(0);
      expect(r.creditDue).toBe(false);
    });
  });

  describe("partial delivery (D-C)", () => {
    it("keeps a backorder when the invoice honestly bills less than was ordered", () => {
      // Vendor billed 20 of the 24 ordered and shipped exactly 20: bill and receipt agree.
      const r = computeMatch({ ...base, invoiceQty: 20, acceptedQty: 20 });

      expect(r.verdict).toBe("partial");
      expect(check(r, "physical_vs_bill").ok).toBe(true);
      expect(check(r, "bill_vs_po").ok).toBe(false);
      expect(r.backorderQty).toBe(4);
      expect(r.ledgerDelta).toBe(0); // stocked at invoice qty, accepted the same
    });
  });

  describe("free goods", () => {
    const elevenForTen: MatchInput = {
      orderedQty: 10,
      poUnitPrice: 22,
      invoiceQty: 10,
      invoiceUnitPrice: 22,
      acceptedQty: 11,
      freeGoodsQty: 1,
    };

    it("blends the unit cost across the bottles actually in hand (11 for the price of 10)", () => {
      const r = computeMatch(elevenForTen);

      expect(r.effectiveUnitCost).toBeCloseTo(20); // 10 x $22 / 11 bottles
      expect(r.ledgerDelta).toBe(1);
    });

    it("treats a declared deal as a clean match, not an overage", () => {
      const r = computeMatch(elevenForTen);

      // The previous version reported qty_over here and fired a CRITICAL alert
      // on an ordinary negotiated bonus. A manager alarmed about good news
      // stops reading alarms, which costs far more than the bottle.
      expect(r.verdict).toBe("matched");
      expect(r.creditDue).toBe(false);
      expect(isDiscrepancy(r.verdict)).toBe(false);
    });

    it("still reports an overage when the extra bottle was NOT declared free", () => {
      const r = computeMatch({ ...elevenForTen, freeGoodsQty: 0 });

      // An undeclared extra is an anomaly until a human says it was a deal.
      expect(r.verdict).toBe("qty_over");
    });
  });

  /**
   * Free goods x packing slip. The slip is a PHYSICAL count of bottles on the
   * truck and includes the free ones; the invoice is a BILLING count and does
   * not. Netting free goods out of the physical side made the two axes share a
   * number, and the deal that `qty_over` had already been taught to accept came
   * back as `short_shipped` the moment a slip was attached — the same false
   * alarm on a new axis. These cases pin both axes down separately.
   */
  describe("free goods with a packing slip", () => {
    const deal: MatchInput = {
      orderedQty: 10,
      poUnitPrice: 22,
      invoiceQty: 10,
      invoiceUnitPrice: 22,
      acceptedQty: 11,
      freeGoodsQty: 1,
    };

    it("stays matched when the slip counts the free bottle it put on the truck", () => {
      // The regression: slip 11, invoice 10, 11 bottles on the pallet. Every one
      // of them arrived. Comparing the billing count (10) to the slip (11)
      // reported "1 lost between the warehouse and the door" on a delivery where
      // nothing was lost.
      const r = computeMatch({ ...deal, shippedQty: 11 });

      expect(r.verdict).toBe("matched");
      expect(isDiscrepancy(r.verdict)).toBe(false);
      expect(check(r, "physical_vs_ship").ok).toBe(true);
      expect(check(r, "physical_vs_ship").detail).toBe("Both 11");
      // Billing axis still nets the free bottle out, and still agrees.
      expect(check(r, "physical_vs_bill").ok).toBe(true);
      expect(r.creditDue).toBe(false);
    });

    it("stays matched when no slip came with the deal", () => {
      const r = computeMatch(deal);

      expect(r.verdict).toBe("matched");
      // Unknown, not agreement — there was no slip to compare against.
      expect(check(r, "physical_vs_ship").ok).toBeNull();
    });

    it("does not raise an alarm when the slip counted only the billable bottles", () => {
      // Vendor listed 10 and quietly put 11 on the truck. The extra is declared
      // free, so it is good news: the check records the difference, the headline
      // stays clean. Alarming here is how a manager learns to ignore alarms.
      const r = computeMatch({ ...deal, shippedQty: 10 });

      expect(r.verdict).toBe("matched");
      expect(check(r, "physical_vs_ship").ok).toBe(false);
      expect(check(r, "physical_vs_ship").detail).toBe("Slip says 10, 11 arrived");
    });

    it("still catches a real transit loss on a delivery that carried free goods", () => {
      // Slip 11, only 10 on the dock. A bottle genuinely went missing, and the
      // deal must not launder it.
      const r = computeMatch({ ...deal, shippedQty: 11, acceptedQty: 10 });

      expect(check(r, "physical_vs_ship").ok).toBe(false);
      expect(check(r, "physical_vs_ship").detail).toBe("Slip says 11, 10 arrived");
      expect(r.creditDue).toBe(true);
    });

    it("reports the true shortfall in the summary, not the free-goods-inflated one", () => {
      // Ordered 24, slip 24, 22 on the dock of which 1 was free, billed 21.
      // Billing agrees (21 === 21); 2 bottles are genuinely missing. Reading the
      // shortfall off the billing count claimed 3 were lost.
      const r = computeMatch({
        orderedQty: 24,
        poUnitPrice: 22,
        shippedQty: 24,
        invoiceQty: 21,
        invoiceUnitPrice: 22,
        acceptedQty: 22,
        freeGoodsQty: 1,
      });

      expect(r.verdict).toBe("short_shipped");
      expect(r.summary).toBe(
        "Packing slip says 24, only 22 arrived — 2 lost between the warehouse and the door.",
      );
      expect(check(r, "physical_vs_bill").ok).toBe(true);
    });

    it("surfaces damage rather than hiding it behind a phantom short ship", () => {
      // Slip 11, all 11 arrived, 1 broken, 1 free. The old comparison made the
      // free bottle look lost and `short_shipped` outranked the real problem, so
      // the manager was told to chase the carrier instead of claiming the break.
      const r = computeMatch({
        ...deal,
        shippedQty: 11,
        acceptedQty: 10,
        rejectedQty: 1,
      });

      expect(r.verdict).toBe("rejected");
      expect(check(r, "physical_vs_ship").ok).toBe(true);
      // "1 of 11", not "1 of 10": the denominator is what the manager counted.
      expect(r.summary).toBe("1 of 11 rejected on arrival — credit due.");
      expect(r.creditAmount).toBe(22);
    });
  });

  describe("packing slip — the vendor's own two documents disagreeing", () => {
    it("reports overbilled_vs_ship and marks it self-evidenced", () => {
      // Their slip says 22 left the warehouse; their invoice bills 24.
      const r = computeMatch({
        ...base,
        shippedQty: 22,
        invoiceQty: 24,
        acceptedQty: 22,
      });

      expect(r.verdict).toBe("overbilled_vs_ship");
      expect(r.selfEvidenced).toBe(true);
      expect(r.creditDue).toBe(true);
      expect(r.creditAmount).toBe(44); // 2 bottles x $22
      expect(check(r, "bill_vs_ship").ok).toBe(false);
      expect(isClaimable(r.verdict)).toBe(true);
    });

    it("outranks a price variance — the provable claim leads", () => {
      const r = computeMatch({
        ...base,
        shippedQty: 22,
        invoiceQty: 24,
        invoiceUnitPrice: 26, // also overpriced
        acceptedQty: 22,
      });

      expect(r.verdict).toBe("overbilled_vs_ship");
      expect(r.requiresOverride).toBe(true); // still true, just not the headline
    });

    it("separates goods lost in transit from goods never shipped", () => {
      // Slip and invoice agree at 24; only 22 made it to the door.
      const r = computeMatch({ ...base, shippedQty: 24, acceptedQty: 22 });

      expect(r.verdict).toBe("qty_short");
      expect(check(r, "bill_vs_ship").ok).toBe(true); // vendor's paperwork is consistent
      expect(check(r, "physical_vs_ship").ok).toBe(false); // it went missing en route
      expect(r.selfEvidenced).toBe(false);
    });

    it("reports unknown, never agreement, when no packing slip arrived", () => {
      const r = computeMatch(base);

      expect(check(r, "bill_vs_ship").ok).toBeNull();
      expect(check(r, "physical_vs_ship").ok).toBeNull();
      expect(r.verdict).toBe("matched");
    });
  });

  describe("landed cost", () => {
    it("folds allocated freight into what the bottle actually cost", () => {
      const r = computeMatch({ ...base, allocatedCharges: 48 });

      // (24 x $22 + $48) / 24 = $24. Freight is a cost component, not a price
      // variance, so it moves the cost basis rather than raising an alarm.
      expect(r.effectiveUnitCost).toBeCloseTo(24);
      expect(r.verdict).toBe("matched");
      expect(r.priceVerified).toBe(true);
    });
  });

  describe("claimability", () => {
    it("does not raise a claim on an unfinished delivery", () => {
      // `partial` and `unmatched` are states of paperwork still in flight, not
      // vendor errors. Claiming on them puts a restaurant in front of its
      // distributor asking for money over an invoice that has not arrived.
      expect(isClaimable("partial")).toBe(false);
      expect(isClaimable("unmatched")).toBe(false);
      expect(isClaimable("matched")).toBe(false);
    });
  });

  describe("goods before invoice", () => {
    it("reports unmatched rather than blocking the receipt", () => {
      const r = computeMatch({
        orderedQty: 24,
        poUnitPrice: 22,
        invoiceQty: null,
        invoiceUnitPrice: null,
        acceptedQty: 24,
      });

      expect(r.verdict).toBe("unmatched");
      expect(r.requiresOverride).toBe(false);
      expect(r.effectiveUnitCost).toBeNull();
      expect(r.ledgerDelta).toBe(0); // stocked at ordered qty in the absence of an invoice
      expect(isDiscrepancy(r.verdict)).toBe(true);
    });
  });

  describe("ledger delta", () => {
    it("corrects against what was actually stocked at delivery, not the invoice", () => {
      // Delivery stocked 20 (a partial receipt was recorded), invoice says 24, 22 accepted.
      const r = computeMatch({ ...base, acceptedQty: 22, stockedQty: 20 });

      expect(r.ledgerDelta).toBe(2);
    });
  });

  describe("input hardening", () => {
    it("clamps negative quantities instead of trusting the caller", () => {
      const r = computeMatch({ ...base, acceptedQty: -5, rejectedQty: -2 });

      expect(r.backorderQty).toBe(24);
      expect(r.effectiveUnitCost).toBeNull(); // nothing accepted
    });

    it("does not compare prices when the order never carried one", () => {
      const r = computeMatch({
        ...base,
        poUnitPrice: null,
        invoiceUnitPrice: null,
      });

      expect(r.requiresOverride).toBe(false);
      expect(r.priceVerified).toBe(false);
      // Unknown, not passed: there was nothing to compare.
      expect(check(r, "price").ok).toBeNull();
      expect(r.verdict).toBe("matched");
    });
  });
});
