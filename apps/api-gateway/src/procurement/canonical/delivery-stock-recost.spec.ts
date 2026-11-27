/**
 * r109 (DD-r108-20): a correction to a paper's money re-costs the lots it
 * settled and restates the sales already made. Fixtures are SYNTHETIC.
 *
 * The database half (a replay writes no revaluation, a no-order delivery's
 * lot is revalued) is pinned in
 * supabase/tests/20271227100000_a_correction_revalues_its_lots_test.sql.
 */
import { DatabaseService } from "../../database/database.service";
import { makeMockDb, MockDb } from "./delivery-mock";
import { DeliveryStockService } from "./delivery-stock.service";

const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ORD = "abababab-abab-abab-abab-abababababab";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const ITEM_B = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const DOC = "inv-1";
const USER = "u1";

const env = (value: unknown) => ({ value, source: "human_corrected", revision: 2 });
const fix = (revision: number, field_path: string, value: unknown) => ({
  document_id: DOC,
  revision,
  kind: "correction",
  field_path,
  after: env(value),
});

describe("DeliveryStockService.recostAfterCorrection (r109, DD-r108-20)", () => {
  let db: MockDb;
  let service: DeliveryStockService;

  const line = (over: Record<string, unknown> = {}) => ({
    document_id: DOC,
    line_no: 1,
    inventory_id: ITEM,
    qty: 10,
    qty_bottles: 10,
    uom: "bottle",
    pack_size: 1,
    unit_price: 60,
    line_total: 600,
    ...over,
  });
  const given = (o: {
    head?: Record<string, unknown>;
    lines?: Record<string, unknown>[];
    corrections?: Record<string, unknown>[];
    booked?: number;
    state?: string;
    orderId?: string | null;
  }) => {
    db.answers.procurement_documents = { data: [{ id: DOC, doc_number: "A-1", ...(o.head ?? {}) }], error: null };
    db.answers.procurement_document_lines = { data: o.lines ?? [line()], error: null };
    db.answers.document_corrections = { data: o.corrections ?? [], error: null };
    db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: o.booked ?? 10 }], error: null };
    db.answers.deliveries = { data: { id: DEL, state: o.state ?? "VERIFIED", order_id: o.orderId ?? null }, error: null };
  };
  const recost = (path = "lines[0].netPrice", revision = 3) =>
    service.recostAfterCorrection(REST, DOC, revision, USER, path);
  const posted = () => db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost");
  const restated = () => db.rpcCalls.filter((c) => c.fn === "restate_sale_cost");

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
    db.answers.document_deliveries = {
      data: [{ document_id: DOC, delivery_id: DEL, role: "invoice" }],
      error: null,
    };
    db.answers.delivery_proposals = { data: [], error: null };
    db.answers.procurement_orders = { data: { inventory_id: ITEM }, error: null };
    db.rpcAnswers.finalise_delivery_cost = {
      data: { lots_matched: 1, lots_finalised: 1, bottles_matched: 4, bottles_finalised: 4 },
      error: null,
    };
    db.rpcAnswers.restate_sale_cost = { data: { rows_restated: 2 }, error: null };
  });

  it("a corrected price and total re-cost the lots, with the reason naming the revision", async () => {
    given({ corrections: [fix(2, "lines[0].netPrice", 55), fix(3, "lines[0].netAmount", 550)] });
    const r = await recost("lines[0].netAmount", 3);
    expect(posted().map((c) => c.args.p_unit_cost)).toEqual([55]);
    expect(String(posted()[0].args.p_reason)).toMatch(/^correction revision 3 of document inv-1;/);
    expect(r.ok && r.value.deliveries[0]).toMatchObject({ deliveryId: DEL, kept: [], drawnBefore: 6 });
  });

  describe("the invariant |unit_cost x received - (corrected net + charges)| <= received x 5e-7", () => {
    for (const freight of [0, 10]) {
      it(`100.00 over 3 bottles, freight ${freight}`, async () => {
        given({
          head: { freight },
          lines: [line({ qty: 3, qty_bottles: 3, unit_price: 30, line_total: 90 })],
          corrections: [fix(2, "lines[0].netPrice", 33.33), fix(3, "lines[0].netAmount", 100)],
          booked: 3,
        });
        await recost("lines[0].netAmount");
        const u = Number(posted()[0].args.p_unit_cost);
        expect(Math.abs(u * 3 - (100 + freight))).toBeLessThanOrEqual(3 * 5e-7);
        // Kept to the sixth place, never rounded to the cent.
        expect(u).toBe(freight ? 36.666667 : 33.333333);
      });
    }
  });

  it("a corrected quantity re-derives the bottles from the corrected count", async () => {
    // The paper printed 2 cases of 6 at 60 a case (line 120); it was 3 cases.
    given({
      lines: [line({ qty: 2, qty_bottles: 12, uom: "case", pack_size: 6, unit_price: 60, line_total: 120, price_base_qty: 1, price_base_uom: "case" })],
      corrections: [fix(2, "lines[0].quantity", 3), fix(3, "lines[0].netAmount", 180)],
      booked: 18,
    });
    await recost("lines[0].netAmount");
    expect(posted().map((c) => c.args.p_unit_cost)).toEqual([10]);
  });

  it("a replay of the same revision posts the same cost and reason (the database writes nothing new)", async () => {
    given({ corrections: [fix(2, "lines[0].netPrice", 55), fix(3, "lines[0].netAmount", 550)] });
    await recost("lines[0].netAmount", 3);
    await recost("lines[0].netAmount", 3);
    const [a, b] = posted().map((c) => c.args);
    expect(b).toEqual(a);
  });

  it("an unmappable unit revalues nothing and says why", async () => {
    given({ corrections: [fix(2, "lines[0].unit", "kg")] });
    const r = await recost("lines[0].unit");
    expect(posted()).toEqual([]);
    expect(restated()).toEqual([]);
    const kept = r.ok ? r.value.deliveries[0].kept : [];
    expect(kept).toHaveLength(1);
    expect(kept[0].reason).toMatch(/weigh|kg/);
    expect(kept[0].reason).toMatch(/Its lots keep the cost they had; nothing was revalued\.$/);
    expect(kept[0].reason).not.toMatch(/stays provisional/);
  });

  it("a price corrected without its total is kept: the paper now disagrees with itself", async () => {
    given({ corrections: [fix(2, "lines[0].netPrice", 55)] });
    const r = await recost();
    expect(posted()).toEqual([]);
    expect(r.ok && r.value.deliveries[0].kept[0].reason).toMatch(/nothing was revalued/);
  });

  it("restates the sales of an ordered delivery at the posted cost", async () => {
    given({ orderId: ORD, corrections: [fix(2, "lines[0].netPrice", 55), fix(3, "lines[0].netAmount", 550)] });
    const r = await recost("lines[0].netAmount");
    expect(restated().map((c) => c.args)).toEqual([
      { p_restaurant_id: REST, p_inventory_id: ITEM, p_source_order_id: ORD, p_unit_cost: 55, p_performed_by: USER, p_delivery_id: DEL },
    ]);
    expect(r.ok && r.value.deliveries[0].salesRestated).toBe(2);
  });

  describe("a line's correction revalues that line's item only", () => {
    const two = (over: { second?: Record<string, unknown> } = {}) => {
      given({
        orderId: ORD,
        lines: [line(), line({ line_no: 2, inventory_id: ITEM_B, unit_price: 40, line_total: 400, ...(over.second ?? {}) })],
        corrections: [fix(2, "lines[0].netPrice", 55), fix(3, "lines[0].netAmount", 550)],
      });
      db.answers.inventory_transactions = {
        data: [
          { inventory_id: ITEM, quantity_change: 10 },
          { inventory_id: ITEM_B, quantity_change: 10 },
        ],
        error: null,
      };
    };

    it("correcting line 1 posts line 1's item and leaves line 2's lot alone", async () => {
      two();
      await recost("lines[0].netAmount");
      expect(posted().map((c) => c.args.p_inventory_id)).toEqual([ITEM]);
      expect(restated().map((c) => c.args.p_inventory_id)).toEqual([ITEM]);
    });

    it("correcting line 2 posts line 2's item only", async () => {
      two();
      db.answers.document_corrections = { data: [fix(2, "lines[1].netPrice", 44), fix(3, "lines[1].netAmount", 440)], error: null };
      await recost("lines[1].netAmount");
      expect(posted().map((c) => c.args.p_inventory_id)).toEqual([ITEM_B]);
    });

    it("a header field can move every item, so it posts them all", async () => {
      two();
      await recost("totals.taxAmount");
      expect(posted().map((c) => c.args.p_inventory_id).sort()).toEqual([ITEM, ITEM_B].sort());
    });

    it("a line that names no item cannot narrow it: every item is posted", async () => {
      two({ second: {} });
      db.answers.procurement_document_lines = {
        data: [line({ inventory_id: null }), line({ line_no: 2, inventory_id: ITEM_B, unit_price: 40, line_total: 400 })],
        error: null,
      };
      await recost("lines[0].netAmount");
      expect(posted().length).toBeGreaterThanOrEqual(1);
    });

    it("freight is shared by value, so correcting line 1 re-posts line 2's item too (r100)", async () => {
      // A 10 x 10 (100), B 10 x 40 (400), freight 50: verify posted A at 11, B at 44.
      // Line 1 becomes 550: the corrected paper gives A 57.895 and B 42.105.
      two();
      db.answers.procurement_documents = { data: [{ id: DOC, doc_number: "A-1", freight: 50 }], error: null };
      db.answers.procurement_document_lines = {
        data: [line({ unit_price: 10, line_total: 100 }), line({ line_no: 2, inventory_id: ITEM_B, unit_price: 40, line_total: 400 })],
        error: null,
      };
      await recost("lines[0].netAmount");
      const cost = Object.fromEntries(posted().map((c) => [c.args.p_inventory_id, c.args.p_unit_cost]));
      expect(cost[ITEM]).toBe(57.895);
      expect(cost[ITEM_B]).toBe(42.105);
      expect(restated().map((c) => c.args.p_inventory_id).sort()).toEqual([ITEM, ITEM_B].sort());
    });

    it("a line that names no item posts the EXACT set of items the delivery prices: one from a second invoice, one from line 2 (r100)", async () => {
      // DOC line 1 names no item; DOC line 2 prices B; a second invoice prices A.
      // Narrowing to "the last named line's item" would post B alone.
      two();
      db.answers.document_deliveries = {
        data: [
          { document_id: DOC, delivery_id: DEL, role: "invoice" },
          { document_id: "inv-2", delivery_id: DEL, role: "invoice" },
        ],
        error: null,
      };
      db.answers.procurement_documents = {
        data: [
          { id: DOC, doc_number: "A-1" },
          { id: "inv-2", doc_number: "A-2" },
        ],
        error: null,
      };
      db.answers.procurement_document_lines = {
        data: [
          line({ inventory_id: null }),
          line({ line_no: 2, inventory_id: ITEM_B, unit_price: 40, line_total: 400 }),
          line({ document_id: "inv-2", line_no: 1, inventory_id: ITEM, unit_price: 12, line_total: 120 }),
        ],
        error: null,
      };
      db.answers.document_corrections = { data: [fix(2, "lines[0].netPrice", 55), fix(3, "lines[0].netAmount", 550)], error: null };
      await recost("lines[0].netAmount");
      expect(posted().map((c) => c.args.p_inventory_id).sort()).toEqual([ITEM, ITEM_B].sort());
      expect(Object.fromEntries(posted().map((c) => [c.args.p_inventory_id, c.args.p_unit_cost]))).toEqual({ [ITEM]: 12, [ITEM_B]: 40 });
    });

    it("a failed read of the paper's lines revalues nothing (ADR 0020)", async () => {
      two();
      db.answers.procurement_document_lines = { data: null, error: { message: "boom" } };
      const r = await recost("lines[0].netAmount");
      expect(r).toMatchObject({ ok: false, status: 500 });
      expect(posted()).toEqual([]);
    });
  });

  it("a delivery with no order re-costs its lots and restates nothing", async () => {
    given({ orderId: null, corrections: [fix(2, "lines[0].netPrice", 55), fix(3, "lines[0].netAmount", 550)] });
    const r = await recost("lines[0].netAmount");
    expect(posted()).toHaveLength(1);
    expect(restated()).toEqual([]);
    expect(r.ok && r.value.deliveries[0].salesRestated).toBe(0);
  });

  it("a delivery not yet verified is not posted: verify will cost the corrected paper", async () => {
    given({ state: "DELIVERED", corrections: [fix(2, "lines[0].netPrice", 55)] });
    const r = await recost();
    expect(posted()).toEqual([]);
    expect(r.ok && r.value.deliveries[0].note).toMatch(/not verified yet/);
  });

  it("a field that cannot move a cost reads nothing", async () => {
    given({});
    const r = await recost("lines[0].description");
    expect(r).toEqual({ ok: true, value: { costField: false, deliveries: [] } });
    expect(db.verbs).toEqual([]);
  });

  it("another house's paper is not found, and nothing is posted", async () => {
    given({ corrections: [fix(2, "lines[0].netPrice", 55)] });
    db.answers.procurement_documents = { data: null, error: null };
    const r = await recost();
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(posted()).toEqual([]);
  });

  it("a failed read of the corrections re-costs nothing (ADR 0067)", async () => {
    given({});
    db.answers.document_corrections = { data: null, error: { message: "boom" } };
    const r = await recost();
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(posted()).toEqual([]);
  });
});
