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
  });

  describe("a credit never exceeds the bill (r30, the r28 G6 side finding)", () => {
    it("two free declared, one kept, one broken, ten billed: all ten are claimed, not eleven", () => {
      // The two bottles that came are the two free ones; none of the ten billed
      // arrived. The kept bottle is a free one, so it costs nothing, and the
      // books hold 0 x 1 + 100 = the bill.
      const r = computeMatch({ ...twelveAtTen, invoiceQty: 10, acceptedQty: 1, rejectedQty: 1, freeGoodsQty: 2 });
      expect(r.creditAmount).toBe(100);
      expect(r.effectiveUnitCost).toBe(0);
    });

    it("more free declared than arrived, none broken: the bill, never more", () => {
      const r = computeMatch({ ...twelveAtTen, invoiceQty: 10, acceptedQty: 2, rejectedQty: 0, freeGoodsQty: 3 });
      expect(r.creditAmount).toBe(100);
      expect(r.effectiveUnitCost).toBe(0);
    });

    it("free bottles kept on top of the billed ones claim nothing", () => {
      const r = computeMatch({ ...twelveAtTen, invoiceQty: 10, acceptedQty: 12, freeGoodsQty: 2 });
      expect(r.creditAmount).toBeNull();
      expect(r.effectiveUnitCost).toBeCloseTo(100 / 12, 10);
    });

    it("one billed bottle short with a free one kept: one claimed", () => {
      // 10 billed + 1 free; 10 arrive and are kept, so one billed bottle is missing.
      const r = computeMatch({ ...twelveAtTen, invoiceQty: 10, acceptedQty: 10, freeGoodsQty: 1 });
      expect(r.creditAmount).toBe(10);
      expect(r.effectiveUnitCost).toBeCloseTo(9, 10);
    });

    const grid: [number, number, number, number, number][] = [];
    for (const billed of [1, 6, 12])
      for (const accepted of [0, 1, 2, billed, billed + 2])
        for (const rejected of [0, 1, 4])
          for (const free of [0, 1, 2, 5])
            for (const charges of [0, 9.25]) grid.push([billed, accepted, rejected, free, charges]);

    it.each(grid)(
      "billed %d, kept %d, broken %d, free %d, charges %d: 0 <= credit <= bill, and the bill is held once",
      (billed, accepted, rejected, free, charges) => {
        const price = 13.37;
        const r = computeMatch({
          orderedQty: billed,
          poUnitPrice: price,
          invoiceQty: billed,
          invoiceUnitPrice: price,
          acceptedQty: accepted,
          rejectedQty: rejected,
          freeGoodsQty: free,
          allocatedCharges: charges,
        });
        const credit = r.creditAmount ?? 0;
        expect(credit).toBeGreaterThanOrEqual(0);
        expect(credit).toBeLessThanOrEqual(Math.round(billed * price * 100) / 100);
        if (accepted === 0) {
          expect(r.effectiveUnitCost).toBeNull();
          return;
        }
        const cost = r.effectiveUnitCost as number;
        expect(cost).toBeGreaterThanOrEqual(charges / accepted - 1e-9);
        expect(cost * accepted + credit).toBeCloseTo(billed * price + charges, 1);
      },
    );
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
      expect((r.effectiveUnitCost as number) * accepted + claimed).toBeCloseTo(billed * price + charges, 1);
      expect(r.effectiveUnitCost as number).toBeCloseTo(price + charges / accepted, 8);
    });
  });
});
