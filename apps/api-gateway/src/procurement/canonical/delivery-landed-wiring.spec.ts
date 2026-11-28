/**
 * QA round 15 finding 6: the specs for the landed-cost wiring (#871) were weak,
 * reverting its code failed 5 of 33 tests. Each test here pins ONE seam of
 * `DeliveryStockService`'s wiring to `landDelivery`, so that undoing that seam
 * turns a test red on a WRONG VALUE or a WRONG SENTENCE.
 *
 * The seams, and the mutation each was proven against (one at a time, on a
 * restored copy of delivery-stock.service.ts):
 *   M1  agreedPrices posts the landed per-bottle cost, not the line's own price
 *   M2  a held item says its OWN reason, not the generic "no agreed price"
 *   M3  the invoice header read selects the charge and discount columns
 *   M4  an unreadable invoice header is an error, never "no charges"
 *   M5  landDelivery is given what the door booked (accepted bottles)
 *   M6  repairPrintedCost recognises a final lot at the printed case price
 *   M7  repairPrintedCost falls back to the line's per-bottle price when the
 *       paper's landed cost is held
 *   M8  the landed basis reaches finalise_delivery_cost's p_reason
 *
 * All fixtures are SYNTHETIC: ids, vendors, prices and quantities are invented.
 */

import { DatabaseService } from "../../database/database.service";
import { makeMockDb, MockDb } from "./delivery-mock";
import { DeliveryStockService } from "./delivery-stock.service";

const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const ITEM2 = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const USER = "u1";

describe("DeliveryStockService — landed-cost wiring is pinned seam by seam (QA round 15 (6))", () => {
  let db: MockDb;
  let service: DeliveryStockService;

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
    db.answers.deliveries = {
      data: { id: DEL, state: "AGREED", order_id: null },
      error: null,
    };
    db.answers.document_deliveries = {
      data: [{ document_id: "inv-1", role: "invoice" }],
      error: null,
    };
    db.answers.delivery_proposals = { data: [], error: null };
    db.rpcAnswers.finalise_delivery_cost = {
      data: { lots_matched: 1, lots_finalised: 1, bottles_finalised: 10 },
      error: null,
    };
  });

  const line = (over: Record<string, unknown> = {}) => ({
    document_id: "inv-1",
    line_no: 1,
    inventory_id: ITEM,
    qty_bottles: 10,
    uom: "bottle",
    pack_size: 1,
    unit_price: 60,
    line_total: 600,
    ...over,
  });
  const lineTwo = () =>
    line({ line_no: 2, inventory_id: ITEM2, unit_price: 40, line_total: 400 });

  const paper = (head: Record<string, unknown>) => {
    db.answers.procurement_documents = {
      data: [{ id: "inv-1", doc_number: "A-1", ...head }],
      error: null,
    };
  };
  const door = (booked: Record<string, number>) => {
    db.answers.inventory_transactions = {
      data: Object.entries(booked).map(([inventory_id, quantity_change]) => ({
        inventory_id,
        quantity_change,
      })),
      error: null,
    };
  };
  const posts = () =>
    db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost");
  const costs = () =>
    Object.fromEntries(
      posts().map((c) => [c.args.p_inventory_id, c.args.p_unit_cost]),
    );

  it("M1: freight 50 over lines 600 and 400 posts the LANDED 63 and 42, not the line prices 60 and 40", async () => {
    paper({ freight: 50 });
    db.answers.procurement_document_lines = { data: [line(), lineTwo()], error: null };
    door({ [ITEM]: 10, [ITEM2]: 10 });
    const res = await service.finaliseAtVerified(REST, DEL, USER);
    expect(costs()).toEqual({ [ITEM]: 63, [ITEM2]: 42 });
    expect(res.ok && res.value.finalised.map((f) => [f.inventoryId, f.unitCost])).toEqual([
      [ITEM, 63],
      [ITEM2, 42],
    ]);
  });

  it("M2: a short count over two lines says the count's own reason, not the generic 'no agreed price'", async () => {
    paper({});
    db.answers.procurement_document_lines = {
      data: [line({ qty_bottles: 12, unit_price: 10, line_total: 120 }), line({ line_no: 2, qty_bottles: 6, unit_price: 13, line_total: 78 }), lineTwo()],
      error: null,
    };
    door({ [ITEM]: 15, [ITEM2]: 10 });
    const res = await service.finaliseAtVerified(REST, DEL, USER);
    expect(res.ok).toBe(true);
    const held = res.ok ? res.value.stillProvisional.find((p) => p.inventoryId === ITEM) : undefined;
    expect(held?.reason).toMatch(/the door counted 15 bottles of this item, but its invoice lines list 18 across 2 lines/);
    expect(held?.reason).not.toMatch(/no agreed price reaches this item/);
    // The other item is untouched by the hold.
    expect(costs()).toEqual({ [ITEM2]: 40 });
  });

  it("M2b: with freight on the paper, an unpriced line holds its neighbour with that line's own sentence", async () => {
    paper({ freight: 100 });
    db.answers.procurement_document_lines = {
      data: [line({ uom: "case", pack_size: 1, unit_price: 264 }), lineTwo()],
      error: null,
    };
    door({ [ITEM]: 10, [ITEM2]: 10 });
    const res = await service.finaliseAtVerified(REST, DEL, USER);
    const second = res.ok ? res.value.stillProvisional.find((p) => p.inventoryId === ITEM2) : undefined;
    expect(second?.reason).toMatch(/Line 1 could not be priced, so this paper's charges and discount cannot be shared out/);
    expect(second?.reason).not.toMatch(/no agreed price reaches this item/);
  });

  it("M3: the invoice header read asks for every charge, the discount, the deposit and the tax", async () => {
    const selects: string[] = [];
    const real = db.client.getClient;
    db.client.getClient = () => {
      const client = real();
      return {
        ...client,
        from: (t: string) => {
          const chain = client.from(t) as { select: (...a: unknown[]) => unknown };
          if (t === "procurement_documents") {
            const original = chain.select.bind(chain);
            chain.select = (...a: unknown[]) => {
              selects.push(String(a[0]));
              return original(...a);
            };
          }
          return chain;
        },
      };
    };
    paper({ freight: 50 });
    db.answers.procurement_document_lines = { data: [line(), lineTwo()], error: null };
    door({ [ITEM]: 10, [ITEM2]: 10 });
    await service.finaliseAtVerified(REST, DEL, USER);
    expect(selects).toHaveLength(1);
    const columns = selects[0].split(",").map((c) => c.trim());
    for (const col of [
      "discount_total",
      "freight",
      "fuel_surcharge",
      "split_case_fee",
      "delivery_fee",
      "other_charges",
      "deposit_total",
      "tax",
      "currency",
      "subtotal",
    ])
      expect(columns).toContain(col);
  });

  it("M4: an unreadable invoice header is a 500 that names what could not be read, and posts nothing", async () => {
    db.answers.procurement_documents = { data: null, error: { message: "boom" } };
    db.answers.procurement_document_lines = { data: [line(), lineTwo()], error: null };
    door({ [ITEM]: 10, [ITEM2]: 10 });
    const res = await service.finaliseAtVerified(REST, DEL, USER);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(500);
      expect(res.error).toMatch(/could not be read for their charges and discount: boom/);
    }
    expect(posts()).toEqual([]);
  });

  it("M5: 12 listed @ 22 and the door booked 10, beside 10 @ 40, with freight 100: the cost is for the 10 bottles the door booked", async () => {
    paper({ freight: 100 });
    db.answers.procurement_document_lines = {
      data: [
        line({ qty_bottles: 12, unit_price: 22, line_total: 264 }),
        line({ line_no: 2, inventory_id: ITEM2, unit_price: 40, line_total: 400 }),
      ],
      error: null,
    };
    door({ [ITEM]: 10, [ITEM2]: 10 });
    const res = await service.finaliseAtVerified(REST, DEL, USER);
    // The freight is shared by the paper's listed value (264 : 400), so the
    // per-bottle cost does not move with the count; what the count changes is
    // the bottles the cost is for, and a count it cannot use holds the item.
    expect(costs()).toEqual({ [ITEM]: 25.313333, [ITEM2]: 46.024 });
    expect(res.ok && res.value.finalised.find((f) => f.inventoryId === ITEM)?.landed).toMatchObject({
      acceptedBottles: 10,
      netLineValue: 264,
      chargeShare: 39.76,
    });
  });

  it("M5b: an item over two lines that the door counted short is held with the count it saw", async () => {
    paper({});
    db.answers.procurement_document_lines = {
      data: [line({ qty_bottles: 12, unit_price: 10, line_total: 120 }), line({ line_no: 2, qty_bottles: 6, unit_price: 13, line_total: 78 })],
      error: null,
    };
    door({ [ITEM]: 15 });
    const res = await service.finaliseAtVerified(REST, DEL, USER);
    expect(posts()).toEqual([]);
    expect(res.ok && res.value.stillProvisional[0].reason).toMatch(/counted 15 bottles/);
  });

  describe("repairing a lot that was booked at the printed case price", () => {
    const caseLine = (over: Record<string, unknown> = {}) =>
      line({ qty_bottles: 24, uom: "case", pack_size: 12, unit_price: 264, line_total: 528, ...over });
    const finalLot = (unit_cost: number) => {
      db.answers.inventory_lots = {
        data: [{ inventory_id: ITEM, unit_cost, cost_state: "final", cost_provenance: "invoice", qty: 24 }],
        error: null,
      };
    };

    it("M6: a final lot at the printed 264 (a case of 12) is repaired to 22 a bottle", async () => {
      paper({});
      db.answers.procurement_document_lines = { data: [caseLine()], error: null };
      door({ [ITEM]: 24 });
      finalLot(264);
      const res = await service.repairPrintedCost(REST, DEL, USER);
      expect(res.ok && res.value.repaired.map((r) => [r.inventoryId, r.unitCost])).toEqual([[ITEM, 22]]);
      expect(res.ok && res.value.flagged).toEqual([]);
      expect(posts().map((c) => c.args.p_unit_cost)).toEqual([22]);
      expect(String(posts()[0].args.p_reason)).toMatch(/the printed 264 was booked as a bottle's cost/);
    });

    it("M7: with the paper's landed cost held, the repair still posts the line's own 22 and says the charges are not in it", async () => {
      paper({ freight: 50 });
      // The second line cannot be priced (a case of unknown size), so the
      // paper's freight cannot be shared out and ITEM's landed cost is held.
      db.answers.procurement_document_lines = {
        data: [caseLine(), line({ line_no: 2, inventory_id: ITEM2, uom: "case", pack_size: 1, unit_price: 264, line_total: 264, qty_bottles: 1 })],
        error: null,
      };
      door({ [ITEM]: 24, [ITEM2]: 1 });
      finalLot(264);
      const res = await service.repairPrintedCost(REST, DEL, USER);
      expect(res.ok && res.value.repaired.map((r) => [r.inventoryId, r.unitCost])).toEqual([[ITEM, 22]]);
      expect(res.ok && res.value.repaired[0].basis).toMatch(/charges and discount are not in this cost/);
      expect(res.ok && res.value.flagged).toEqual([]);
      expect(posts().map((c) => c.args.p_unit_cost)).toEqual([22]);
    });
  });

  it("M8: the landed basis reaches the ledger reason, not just the receipt", async () => {
    paper({ freight: 50 });
    db.answers.procurement_document_lines = { data: [line(), lineTwo()], error: null };
    door({ [ITEM]: 10, [ITEM2]: 10 });
    await service.finaliseAtVerified(REST, DEL, USER);
    const reason = String(posts().find((c) => c.args.p_inventory_id === ITEM)?.args.p_reason);
    expect(reason).toMatch(/^delivery .* verified \(ADR 0103 A1\); /);
    expect(reason).toMatch(/landed cost per accepted bottle/);
    expect(reason).toMatch(/10 bottles accepted across 1 line, landed at 630\.00: posted as 63(\.00)? a bottle/);
  });
});
