import {
  COST_PARTS_CAP,
  NO_COST_SNAPSHOT,
  pickSaleCostSource,
  snapshotLineCost,
} from "./sale-cost";

/**
 * r109 g1: a sale keeps the shelf it was costed on. restate_sale_cost v2
 * replaces one order's part when its paper is checked, so the parts must be
 * exactly the live lots the WAC was read over, each with its own qty and cost.
 */
describe("a sale keeps the shelf it was costed on (r109 g1)", () => {
  const lot = (over: Record<string, unknown>) => ({
    qty: 1,
    unit_cost: 10,
    cost_provenance: "estimated",
    received_at: "2026-11-01",
    stock_state: "live",
    ...over,
  });

  it("two unchecked deliveries on hand become two parts, oldest first", () => {
    const lots = [
      lot({ id: "b", qty: 12, unit_cost: 9, source_order_id: "ob", received_at: "2026-11-10" }),
      lot({ id: "a", qty: 10, unit_cost: 8, source_order_id: "oa", received_at: "2026-11-01" }),
    ];
    const source = pickSaleCostSource({ last_purchase_price: 9 }, null, lots);
    expect(source?.parts).toEqual([
      { order_id: "oa", delivery_id: null, lot_id: "a", qty: 10, unit_cost: 8, invoiced: false },
      { order_id: "ob", delivery_id: null, lot_id: "b", qty: 12, unit_cost: 9, invoiced: false },
    ]);
    expect(source?.partsCapped).toBe(false);
    const snap = snapshotLineCost(source, "volume", 150, 750, 1);
    expect(snap.cost_parts).toEqual(source?.parts);
    expect(snap.cost_parts_capped).toBe(false);
    // the r102 single-order columns stay as they were
    expect(snap.cost_source_order_id).toBe("oa");
  });

  it("keeps only the lots the WAC reads: live, on hand, priced, not a sample", () => {
    const lots = [
      lot({ id: "ok", qty: 4, unit_cost: 8, source_order_id: "o1", cost_provenance: "invoice" }),
      lot({ id: "spent", qty: 0, source_order_id: "o2" }),
      lot({ id: "unpriced", qty: 3, unit_cost: null, source_order_id: "o3" }),
      lot({ id: "sample", qty: 1, unit_cost: 0, cost_provenance: "sample" }),
      lot({ id: "written-off", qty: 2, source_order_id: "o4", stock_state: "written_off" }),
    ];
    const rollup = { has_invoice_cost: true, wac: 8, wac_qty: 4, live_qty: 7 };
    const source = pickSaleCostSource({ last_purchase_price: 9 }, rollup, lots);
    expect(source?.basis).toBe("invoice_lot_wac_partial");
    expect(source?.parts).toEqual([
      { order_id: "o1", delivery_id: null, lot_id: "ok", qty: 4, unit_cost: 8, invoiced: true },
    ]);
  });

  it("a lot that arrived on no order is a part with no order", () => {
    const source = pickSaleCostSource({ last_purchase_price: 9 }, null, [
      lot({ id: "x", qty: 2, unit_cost: 7, source_order_id: null }),
    ]);
    expect(source?.parts).toEqual([
      { order_id: null, delivery_id: null, lot_id: "x", qty: 2, unit_cost: 7, invoiced: false },
    ]);
  });

  it("two deliveries of one order are two parts, each naming its delivery", () => {
    const source = pickSaleCostSource({ last_purchase_price: 35 }, null, [
      lot({ id: "l1", qty: 2, source_order_id: "o", delivery_id: "d1", received_at: "2026-11-01" }),
      lot({ id: "l2", qty: 3, source_order_id: "o", delivery_id: "d2", received_at: "2026-11-02" }),
    ]);
    expect(source?.parts?.map((p) => [p.order_id, p.delivery_id])).toEqual([
      ["o", "d1"],
      ["o", "d2"],
    ]);
  });

  it(`at ${COST_PARTS_CAP} lots it keeps them all; one more and it keeps none and says capped`, () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        lot({ id: `l${i}`, source_order_id: `o${i}`, received_at: `2026-11-${String(i + 1).padStart(2, "0")}` }),
      );
    const at = pickSaleCostSource({ last_purchase_price: 9 }, null, many(COST_PARTS_CAP));
    expect(at?.parts).toHaveLength(COST_PARTS_CAP);
    expect(at?.partsCapped).toBe(false);
    const over = pickSaleCostSource({ last_purchase_price: 9 }, null, many(COST_PARTS_CAP + 1));
    expect(over?.parts).toBeNull();
    expect(over?.partsCapped).toBe(true);
    const snap = snapshotLineCost(over, "whole_bottle", 750, 750, 1);
    expect(snap).toMatchObject({ cost_parts: null, cost_parts_capped: true, cost_at_sale: 9 });
  });

  it("no live lot keeps no parts, so the single-order rule applies", () => {
    const source = pickSaleCostSource({ last_purchase_price: 9 }, null, []);
    expect(source).toMatchObject({ parts: null, partsCapped: false, orderId: null });
  });

  it("a line with no cost keeps no parts either", () => {
    expect(snapshotLineCost(null, "volume", 150, 750, 1)).toEqual(NO_COST_SNAPSHOT);
    expect(NO_COST_SNAPSHOT).toMatchObject({ cost_parts: null, cost_parts_capped: false });
  });
});
