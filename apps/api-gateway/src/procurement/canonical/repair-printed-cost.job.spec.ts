import { makeMockDb } from "./delivery-mock";
import { runCostRepair } from "./repair-printed-cost.job";

// QA round 10a (7): the one-off walk is a dry run unless told otherwise.
describe("runCostRepair", () => {
  const REST = "r-1";
  const DEL = "d-1";
  const ITEM = "i-1";
  const setUp = () => {
    const db = makeMockDb();
    db.answers.deliveries = { data: [{ id: DEL, restaurant_id: REST, state: "VERIFIED", order_id: null }], error: null };
    db.answers.inventory_lots = { data: [{ inventory_id: ITEM, unit_cost: "264.0000", cost_state: "final", cost_provenance: "invoice", qty: 24 }], error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: "inv-1", line_no: 1, inventory_id: ITEM, qty_bottles: 24, uom: "case", pack_size: 12, unit_price: 264, price_base_qty: null, price_base_uom: null, line_total: null }],
      error: null,
    };
    db.answers.delivery_proposals = { data: [], error: null };
    return db;
  };
  const posts = (db: ReturnType<typeof makeMockDb>) => db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost");

  it("by default reports the 264 → 22 correction and posts nothing", async () => {
    const db = setUp();
    const report = await runCostRepair(db.client as never);
    expect(report).toMatchObject({ mode: "dry-run", deliveries: 1, errors: [] });
    expect(report.changes).toEqual([{ restaurantId: REST, deliveryId: DEL, inventoryId: ITEM, from: 264, to: 22, source: "invoice_line" }]);
    expect(posts(db)).toEqual([]);
    // It only ever walks VERIFIED deliveries.
    expect(db.verbs).toContain("deliveries.not");
  });

  it("posts the correction only with apply", async () => {
    const db = setUp();
    const report = await runCostRepair(db.client as never, { apply: true });
    expect(report.mode).toBe("apply");
    expect(posts(db).map((c) => c.args.p_unit_cost)).toEqual([22]);
  });

  it("stops on a failed read instead of reporting an empty walk", async () => {
    const db = setUp();
    db.answers.deliveries = { data: null, error: { message: "boom" } };
    await expect(runCostRepair(db.client as never)).rejects.toThrow(/verified deliveries could not be read: boom/);
  });
});
