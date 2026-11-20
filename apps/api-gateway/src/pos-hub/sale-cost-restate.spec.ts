import {
  checkMarginFromRows,
  pickSaleCostSource,
  snapshotLineCost,
} from "./sale-cost";

/**
 * r102: a verified invoice restates what the sales from that delivery cost.
 * The SQL (restate_sale_cost) moves the rows; these pin the two halves the
 * gateway owns: a sale costed at the last price paid names its delivery and
 * the unit cost it sold at, and the check says in words that it was restated.
 */
describe("a sale from an unchecked delivery can be restated later (r102)", () => {
  const lots = [
    {
      id: "lot-1",
      qty: 6,
      unit_cost: 10,
      cost_provenance: "estimated",
      source_order_id: "order-1",
      received_at: "2026-11-01",
      stock_state: "live",
    },
  ];

  it("a line at the last price paid names its delivery and its unit cost", () => {
    const source = pickSaleCostSource({ last_purchase_price: 10 }, null, lots);
    expect(source).toMatchObject({
      basis: "last_purchase_price",
      lotId: "lot-1",
      orderId: "order-1",
    });
    const snap = snapshotLineCost(source, "whole_bottle", 750, 750, 2);
    expect(snap).toMatchObject({
      cost_at_sale: 20,
      cost_unit_at_sale: 10,
      cost_source_order_id: "order-1",
    });
  });

  it("a pour keeps the bottle's cost, so the restatement scales it exactly", () => {
    const source = pickSaleCostSource({ last_purchase_price: 12 }, null, lots);
    const snap = snapshotLineCost(source, "volume", 150, 750, 1);
    expect(snap.cost_unit_at_sale).toBe(12);
    expect(snap.cost_at_sale).toBe(2.4);
  });

  it("an item with no cost keeps none, and no unit cost", () => {
    const snap = snapshotLineCost(null, "whole_bottle", 750, 750, 1);
    expect(snap.cost_at_sale).toBeNull();
    expect(snap.cost_unit_at_sale).toBeNull();
  });

  it("the check says in words how many lines the invoice restated", () => {
    const m = checkMarginFromRows([
      { wine_name: "A", quantity: 1, volume_ml: 750, total_revenue: 40, cost_at_sale: 12, cost_basis: "invoice_restated" },
      { wine_name: "B", quantity: 1, volume_ml: 750, total_revenue: 40, cost_at_sale: 10, cost_basis: "invoice_lot_wac" },
    ]);
    expect(m.restatedLines).toBe(1);
    expect(m.lines[0].restated).toBe(true);
    expect(m.lines[0].costNote).toBe("cost restated to the invoice");
    expect(m.lines[1].restated).toBe(false);
    expect(m.sentence).toContain("1 line was restated to the invoice cost");
  });

  it("a check nothing restated reads as before", () => {
    const m = checkMarginFromRows([
      { wine_name: "A", quantity: 1, volume_ml: 750, total_revenue: 40, cost_at_sale: 10, cost_basis: "last_purchase_price" },
    ]);
    expect(m.restatedLines).toBe(0);
    expect(m.sentence).toBe("Every line's cost was kept when it sold.");
  });
});
