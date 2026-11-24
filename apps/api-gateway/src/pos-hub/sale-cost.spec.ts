import { snapshotLineCost, type SaleCostSource } from "./sale-cost";

describe("a sale priced by an agreed lot WAC keeps that basis", () => {
  // analytics/inventory-cost.ts reads a final, hand-agreed lot cost as
  // "agreed_lot_wac"; SaleCostBasis lacked it (sale-cost.ts TS2322 once the
  // r103 inventory chain met feat/g1).
  const agreed: SaleCostSource = {
    unitCost: 20,
    basis: "agreed_lot_wac",
    lotId: "lot-1",
    orderId: null,
  };

  it("writes the basis it was costed at, on a whole bottle", () => {
    expect(snapshotLineCost(agreed, "whole_bottle", 0, 750, 2)).toEqual({
      cost_at_sale: 40,
      cost_basis: "agreed_lot_wac",
      cost_source_lot_id: "lot-1",
      cost_source_order_id: null,
      cost_unit_at_sale: 20,
    });
  });

  it("writes the basis it was costed at, on a pour", () => {
    const s = snapshotLineCost(agreed, "volume", 150, 750, 1);
    expect(s.cost_basis).toBe("agreed_lot_wac");
    expect(s.cost_at_sale).toBe(4);
  });
});
