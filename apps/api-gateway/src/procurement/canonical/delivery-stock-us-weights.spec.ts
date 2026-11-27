import { DatabaseService } from "../../database/database.service";
import { comparableUnits, inItemUnit, normalizeUom, withStatedUnit } from "../documents/document-types";
import { computeMatch } from "../invoice-match";
import { makeMockDb, MockDb } from "./delivery-mock";
import { DeliveryStockService, shelfQuantity } from "./delivery-stock.service";
import { perBottleLotCost } from "./lot-unit-cost";

/**
 * r36 invoices R4: a US invoice's lb and oz book and cost in the metric unit
 * the house item is kept in. Before this, `10 LB` was filed as `each` and
 * booked into an item kept in grams as 10 g.
 */
const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const DOC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

describe("normalizeUom reads a US weight", () => {
  it.each([
    ["LB", "lb"],
    ["lbs.", "lb"],
    ["#", "lb"],
    ["Pounds", "lb"],
    ["LBR", "lb"],
    ["OZ", "oz"],
    ["ounces", "oz"],
    ["ONZ", "oz"],
    ["KGM", "kg"],
    ["şişe", "bottle"],
    ["kutu", null],
  ])("%s reads as %s", (raw, want) => {
    expect(normalizeUom(raw)).toBe(want);
  });

  it("a pound compares only with itself, never as pieces", () => {
    expect(comparableUnits("lb", "each")).toBe(false);
    expect(comparableUnits("oz", "bottle")).toBe(false);
    expect(comparableUnits("lb", "lb")).toBe(true);
  });

  it("10 each ordered and 10 LB invoiced are not a clean match", () => {
    expect(() =>
      computeMatch({
        orderedQtyInOrderedUom: 10,
        orderedUom: "each",
        poUnitPrice: 2.99,
        invoiceQtyInInvoiceUom: 10,
        invoiceUom: "LB",
        invoiceUnitPrice: 2.99,
        acceptedQtyInCountedUom: 10,
      }),
    ).toThrow(/weight is not a count of eachs/i);
  });
});

describe("inItemUnit: exact definitions, rounding only a US line into the finest unit", () => {
  it.each([
    // 10 lb is 4535.9237 g: rounded to 4536, and it says it rounded.
    [10, "lb", "g", { ok: true, qty: 4536, rounded: true }],
    [16, "oz", "g", { ok: true, qty: 454, rounded: true }],
    [1, "lb", "mg", { ok: true, qty: 453592, rounded: true }],
    // An ounce is exactly 1/16 of the pound.
    [16, "oz", "mg", { ok: true, qty: 453592, rounded: true }],
    [3, "kg", "g", { ok: true, qty: 3000, rounded: false }],
    [5, "liter", "ml", { ok: true, qty: 5000, rounded: false }],
  ])("%d %s into %s", (n, from, to, want) => {
    expect(inItemUnit(n as number, from as string, to as string)).toMatchObject(want as object);
  });

  it.each([
    // 10 lb is 4.536 kg: 5 kg would be 10% wrong, so it is refused.
    [10, "lb", "kg"],
    // A metric line is never rounded (ADR 0070), not even into g.
    [2.5, "kg", "kg"],
    [2.0005, "kg", "g"],
  ])("%d %s into %s is refused", (n, from, to) => {
    expect(inItemUnit(n as number, from as string, to as string).ok).toBe(false);
  });

  it("a weight never converts into a volume", () => {
    expect(inItemUnit(1, "oz", "ml")).toEqual({ ok: false, exact: null });
  });
});

describe("withStatedUnit: a row read before the US units existed", () => {
  it("an `each` line whose paper printed LB counts in lb", () => {
    expect(withStatedUnit({ uom: "each", printed: { uom: "LB" } }).uom).toBe("lb");
  });

  it("any other line is left as it is", () => {
    expect(withStatedUnit({ uom: "each", printed: { uom: "kutu" } }).uom).toBe("each");
    expect(withStatedUnit({ uom: "each", printed: { uom: "pcs" } }).uom).toBe("each");
    expect(withStatedUnit({ uom: "bottle", printed: { uom: "LB" } }).uom).toBe("bottle");
    expect(withStatedUnit({ uom: "each", printed: null }).uom).toBe("each");
  });
});

describe("shelfQuantity and perBottleLotCost in pounds and ounces", () => {
  it.each([
    [{ qty_bottles: 10, uom: "lb" }, "g", 4536],
    [{ qty_bottles: 16, uom: "oz" }, "g", 454],
  ])("%j into an item kept in %s puts %d on the shelf", (line, unit, want) => {
    expect(shelfQuantity(line, unit)).toEqual({ ok: true, qty: want });
  });

  it.each([
    [{ qty_bottles: 10, uom: "lb" }, "kg", "not a whole number of kg"],
    [{ qty_bottles: 10, uom: "lb" }, "bottle", "a weight is not a number of bottles"],
    [{ qty_bottles: 12, uom: "oz" }, "ml", "a weight is not a volume"],
  ])("%j into an item kept in %s is refused: %s", (line, unit, why) => {
    const r = shelfQuantity(line, unit);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(why);
  });

  it("10 lb @ 2.99 a pound into g is 2.99 / 453.59237 a gram; 4536 g carry the paper's 29.90", () => {
    const c = perBottleLotCost({ unit_price: 2.99, uom: "lb", qty_bottles: 10, line_total: 29.9 }, { uom: "g" });
    expect(c).toMatchObject({ ok: true, per: "g", unitCost: 0.006592 });
    if (c.ok) {
      expect(c.perBottle).toBeCloseTo(2.99 / 453.59237, 12);
      expect(Math.round(c.perBottle * 4536 * 100)).toBe(2990);
    }
  });

  it("a row stored as `each` with LB printed is costed per pound, not refused as an unknown glyph", () => {
    const c = perBottleLotCost({ unit_price: 2.99, uom: "each", printed: { uom: "LB" }, qty_bottles: 10, line_total: 29.9 }, { uom: "g" });
    expect(c).toMatchObject({ ok: true, per: "g", unitCost: 0.006592 });
  });

  it("a total that is not 10 lb at 2.99 says the price's unit was misread", () => {
    const c = perBottleLotCost({ unit_price: 2.99, uom: "lb", qty_bottles: 10, line_total: 65.92 }, { uom: "g" });
    expect(c.ok).toBe(false);
    if (!c.ok && c.kind === "refused") expect(c.reason).toContain("the price's unit is not what the line says");
  });
});

describe("DeliveryStockService: a door count and an invoice in pounds", () => {
  let db: MockDb;
  let service: DeliveryStockService;
  const doorLine = { document_id: DOC, line_no: 1, inventory_id: ITEM, qty_bottles: 10, unit_price: null, description: "Chicken thigh", vendor_sku: null };

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
    db.answers["restaurant_inventory[]"] = { data: [{ id: ITEM, uom: "g" }], error: null };
  });

  it.each([
    ["10 lb", { uom: "lb" }],
    ["a row read before this change (`each`, LB printed)", { uom: "each", printed: { uom: "LB" } }],
  ])("the door books %s of chicken into g as 4536, not 10", async (_, unit) => {
    db.answers.deliveries = { data: { id: DEL, state: "DELIVERED", order_id: null }, error: null };
    db.answers.procurement_document_lines = { data: [{ ...doorLine, ...unit }], error: null };
    db.answers.inventory_transactions = { data: [], error: null };
    db.rpcAnswers.apply_stock_movement = { data: "txn-1", error: null };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, "u1");
    expect(res.ok).toBe(true);
    const call = db.rpcCalls.find((c) => c.fn === "apply_stock_movement");
    expect(call?.args).toMatchObject({ p_inventory_id: ITEM, p_delta: 4536 });
  });

  it("VERIFIED posts the paper's 29.90 over the 4536 g the door booked; nothing is held", async () => {
    db.answers.deliveries = { data: { id: DEL, state: "AGREED", order_id: null }, error: null };
    db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 4536 }], error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1" }], error: null };
    db.answers.procurement_document_lines = {
      data: [{ ...doorLine, document_id: "inv-1", unit_price: 2.99, uom: "lb", pack_size: 1, line_total: 29.9 }],
      error: null,
    };
    db.rpcAnswers.finalise_delivery_cost = { data: { lots_matched: 1, lots_finalised: 1, bottles_finalised: 4536 }, error: null };
    const res = await service.finaliseAtVerified(REST, DEL, "u1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.stillProvisional).toEqual([]);
    const call = db.rpcCalls.find((c) => c.fn === "finalise_delivery_cost");
    expect(Math.round(Number(call?.args.p_unit_cost) * 4536 * 100)).toBe(2990);
    // The paper lists the 4536 g the door booked, not 4535.9237 and a sliver over.
    expect(String(call?.args.p_reason)).toContain("4536 grams accepted");
    expect(String(call?.args.p_reason)).not.toContain("more than the invoice lists");
  });
});
