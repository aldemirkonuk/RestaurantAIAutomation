import { computeMatch, isDiscrepancy, MatchInput } from "./invoice-match";

/**
 * Three-way match (PO <-> Invoice <-> Receipt) verdict rules.
 *
 * One case per row of the edge-case catalog in the plan. The load-bearing one is
 * "damaged units" vs "short ship": both leave 22 bottles in stock out of 24 billed, but they
 * are different vendor failures and must not collapse into the same verdict.
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
      expect(r.checks.every((c) => c.ok)).toBe(true);
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
      const r = computeMatch({ ...base, invoiceUnitPrice: 24, priceOverrideReason: "   " });

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
      const damaged = computeMatch({ ...base, acceptedQty: 22, rejectedQty: 2 });
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
    it("blends the unit cost across the bottles actually in hand (11 for the price of 10)", () => {
      const r = computeMatch({
        orderedQty: 10,
        poUnitPrice: 22,
        invoiceQty: 10,
        invoiceUnitPrice: 22,
        acceptedQty: 11,
      });

      expect(r.effectiveUnitCost).toBeCloseTo(20); // 10 x $22 / 11 bottles
      expect(r.verdict).toBe("qty_over");
      expect(r.ledgerDelta).toBe(1);
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
      const r = computeMatch({ ...base, poUnitPrice: null, invoiceUnitPrice: null });

      expect(r.requiresOverride).toBe(false);
      expect(r.priceVerified).toBe(false);
      expect(check(r, "price").ok).toBe(true);
      expect(r.verdict).toBe("matched");
    });
  });
});
