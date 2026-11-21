import { computeMatch, MatchInput } from "./invoice-match";

/**
 * r28 invoices audit, G6: a bottle claimed back is not also a cost.
 *
 * Verify on /orders writes `effectiveUnitCost` onto the lot (`revalue_lot`)
 * and drafts `creditAmount` for the units not usably received. The cost used
 * to divide the WHOLE bill by the accepted bottles, so the same broken or
 * missing bottles were paid for twice: once inside the good bottles' cost,
 * once as the credit. Invariant, whenever both are priced:
 *
 *   effectiveUnitCost x accepted + creditAmount = billed x price + charges
 */
const twelveAtTen: MatchInput = {
  orderedQty: 12,
  poUnitPrice: 10,
  invoiceQty: 12,
  invoiceUnitPrice: 10,
  acceptedQty: 12,
  rejectedQty: 0,
};

describe("a credit is not also a cost (r28 G6)", () => {
  it("two broken of twelve: the ten good bottles cost 10.00 each, and 20.00 is claimed", () => {
    const r = computeMatch({ ...twelveAtTen, acceptedQty: 10, rejectedQty: 2 });
    expect(r.creditAmount).toBe(20);
    expect(r.effectiveUnitCost).toBeCloseTo(10, 10);
  });

  it("two missing of twelve billed: the same", () => {
    const r = computeMatch({ ...twelveAtTen, acceptedQty: 10 });
    expect(r.creditAmount).toBe(20);
    expect(r.effectiveUnitCost).toBeCloseTo(10, 10);
  });

  it("charges still land on the good bottles: (120 + 12 - 20) / 10", () => {
    const r = computeMatch({ ...twelveAtTen, acceptedQty: 10, rejectedQty: 2, allocatedCharges: 12 });
    expect(r.effectiveUnitCost).toBeCloseTo(11.2, 10);
  });

  it("free goods still lower the cost, and a broken billed bottle is claimed once", () => {
    const deal: MatchInput = {
      orderedQty: 10,
      poUnitPrice: 22,
      invoiceQty: 10,
      invoiceUnitPrice: 22,
      acceptedQty: 11,
      freeGoodsQty: 1,
    };
    expect(computeMatch(deal).effectiveUnitCost).toBeCloseTo(20, 10);
    const broken = computeMatch({ ...deal, acceptedQty: 10, rejectedQty: 1 });
    expect(broken.creditAmount).toBe(22);
    // 9 billed good bottles and the free one: 198.00 over 10.
    expect(broken.effectiveUnitCost).toBeCloseTo(19.8, 10);
  });

  it("a clean delivery is unchanged", () => {
    const r = computeMatch(twelveAtTen);
    expect(r.creditAmount).toBeNull();
    expect(r.effectiveUnitCost).toBe(10);
  });

  it("never goes below zero, and stays null when nothing usable arrived or nothing is priced", () => {
    expect(computeMatch({ ...twelveAtTen, acceptedQty: 0, rejectedQty: 12 }).effectiveUnitCost).toBeNull();
    expect(computeMatch({ ...twelveAtTen, acceptedQty: 10, invoiceUnitPrice: null }).effectiveUnitCost).toBeNull();
    // Two free bottles declared, one kept and one broken: the claim (11 units)
    // runs past the 10 billed, and the kept bottle is not given a negative cost.
    const r = computeMatch({ ...twelveAtTen, invoiceQty: 10, acceptedQty: 1, rejectedQty: 1, freeGoodsQty: 2 });
    expect(r.creditAmount).toBe(110);
    expect(r.effectiveUnitCost).toBe(0);
  });

  describe("an unknown cost is never written as 0 (DD-r103-11)", () => {
    // A zero cost is a claim (a free bottle the paper declared); no price at all
    // is unknown and must stay null, whatever else the delivery says.
    const unknownPrice = [null, undefined] as const;
    for (const price of unknownPrice)
      it.each([
        [12, 12, 0, 0],
        [12, 10, 2, 0],
        [12, 5, 1, 0],
        [12, 11, 0, 2],
      ])(`price ${price}: billed %d, accepted %d, rejected %d, free %d keeps no cost`, (billed, accepted, rejected, free) => {
        const r = computeMatch({
          orderedQty: billed,
          poUnitPrice: 10,
          invoiceQty: billed,
          invoiceUnitPrice: price as null,
          acceptedQty: accepted,
          rejectedQty: rejected,
          freeGoodsQty: free,
          allocatedCharges: 7.5,
        });
        expect(r.effectiveUnitCost).toBeNull();
        expect(r.effectiveUnitCost).not.toBe(0);
      });

    it("a declared free bottle is a real 0, and only when the paper declared it", () => {
      const declared = computeMatch({ ...twelveAtTen, invoiceQty: 10, acceptedQty: 1, rejectedQty: 1, freeGoodsQty: 2 });
      expect(declared.effectiveUnitCost).toBe(0);
      const undeclared = computeMatch({ ...twelveAtTen, invoiceQty: 10, acceptedQty: 1, rejectedQty: 1 });
      expect(undeclared.effectiveUnitCost).not.toBe(0);
    });
  });

  describe("the books hold the bill exactly once", () => {
    const cases: [number, number, number, number, number][] = [];
    for (const billed of [6, 12, 24])
      for (const accepted of [1, 5, billed - 1, billed])
        for (const rejected of [0, 1, 3])
          for (const charges of [0, 7.5]) cases.push([billed, accepted, rejected, charges, 13.37]);

    it.each(cases)("billed %d, accepted %d, rejected %d, charges %d at %d", (billed, accepted, rejected, charges, price) => {
      if (accepted + rejected > billed) return; // over-delivery is not claimed (r28 G11)
      const r = computeMatch({
        orderedQty: billed,
        poUnitPrice: price,
        invoiceQty: billed,
        invoiceUnitPrice: price,
        acceptedQty: accepted,
        rejectedQty: rejected,
        allocatedCharges: charges,
      });
      const owedUnits = billed - accepted;
      const claimed = owedUnits > 0 ? (r.creditAmount as number) : 0;
      expect(owedUnits > 0 ? r.creditAmount : null).toBe(owedUnits > 0 ? Math.round(owedUnits * price * 100) / 100 : null);
      // cent-exact (DD-r102-17): the kept bottles carry the bill plus charges less
      // the claim, to the cent. A tolerance of 0.05 hid a claim off by 4 cents.
      expect(Math.round(((r.effectiveUnitCost as number) * accepted + claimed) * 100)).toBe(
        Math.round((billed * price + charges) * 100),
      );
      expect(r.effectiveUnitCost as number).toBeCloseTo(price + charges / accepted, 8);
    });
  });
});
