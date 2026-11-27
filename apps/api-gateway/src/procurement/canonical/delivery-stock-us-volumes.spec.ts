import { DatabaseService } from "../../database/database.service";
import { comparableUnits, inItemUnit, normalizeUom, withStatedUnit } from "../documents/document-types";
import { computeMatch, MatchUnitError } from "../invoice-match";
import { makeMockDb, MockDb } from "./delivery-mock";
import { DeliveryStockService, shelfQuantity } from "./delivery-stock.service";
import { perBottleLotCost } from "./lot-unit-cost";

/** r36 invoices R4: a US invoice's gallons and fluid ounces book and cost in ml, as a liter does. */
const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

describe("a US volume reads, converts and stays apart from bottles", () => {
  it.each([
    ["GAL", "gal"],
    ["Gallons", "gal"],
    ["GLL", "gal"],
    ["FL OZ", "floz"],
    ["fl. oz.", "floz"],
    ["FL-OZ", "floz"],
    ["OZA", "floz"],
  ])("%s reads as %s", (raw, want) => {
    expect(normalizeUom(raw)).toBe(want);
  });

  it("compares only with itself, and a stored `each` row with FL OZ printed reads as floz", () => {
    expect(comparableUnits("gal", "bottle")).toBe(false);
    expect(comparableUnits("floz", "case")).toBe(false);
    expect(comparableUnits("gal", "gal")).toBe(true);
    expect(withStatedUnit({ uom: "each", printed: { uom: "FL OZ" } }).uom).toBe("floz");
  });

  it.each([
    [4, "gal", "ml", { ok: true, qty: 15142, rounded: true }],
    [64, "floz", "ml", { ok: true, qty: 1893, rounded: true }],
    [1, "gal", "l", { ok: false }],
    [1, "floz", "g", { ok: false, exact: null }],
  ])("%d %s into %s", (n, from, to, want) => {
    expect(inItemUnit(n as number, from as string, to as string)).toMatchObject(want as object);
  });

  it("3 each ordered and 3 GAL invoiced are not a clean 3 against 3", () => {
    expect(() =>
      computeMatch({
        orderedQtyInOrderedUom: 3,
        orderedUom: "each",
        poUnitPrice: 18,
        invoiceQtyInInvoiceUom: 3,
        invoiceUom: "GAL",
        invoiceUnitPrice: 18,
        acceptedQtyInCountedUom: 3,
      }),
    ).toThrow(MatchUnitError);
  });
});

describe("shelfQuantity and perBottleLotCost in gallons and fluid ounces", () => {
  it.each([
    [{ qty_bottles: 4, uom: "gal" }, "ml", 15142],
    [{ qty_bottles: 64, uom: "floz" }, "ml", 1893],
  ])("%j into an item kept in %s puts %d on the shelf", (line, unit, want) => {
    expect(shelfQuantity(line, unit)).toEqual({ ok: true, qty: want });
  });

  it.each([
    [{ qty_bottles: 1, uom: "gal" }, "l", "not a whole number of l"],
    [{ qty_bottles: 4, uom: "gal" }, "g", "a gal is not a number of gs"],
    [{ qty_bottles: 64, uom: "floz" }, "bottle", "measured in fl oz"],
  ])("%j into an item kept in %s is refused: %s", (line, unit, why) => {
    const r = shelfQuantity(line, unit);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(why);
  });

  it("4 gal @ 18 a gallon into ml is 18 / 3785.411784 a ml", () => {
    const c = perBottleLotCost({ unit_price: 18, uom: "gal", qty_bottles: 4, line_total: 72 }, { uom: "ml" });
    expect(c).toMatchObject({ ok: true, per: "ml" });
    if (c.ok) {
      expect(c.perBottle).toBeCloseTo(18 / 3785.411784, 12);
      expect(c.basis).toContain("per gal = ");
    }
  });

  it("64 fl oz priced per gallon converts between the two volumes (half a gallon is 9)", () => {
    const c = perBottleLotCost(
      { unit_price: 18, uom: "floz", price_base_qty: 1, price_base_uom: "gal", qty_bottles: 64, line_total: 9 },
      { uom: "ml" },
    );
    expect(c).toMatchObject({ ok: true, per: "ml" });
    if (c.ok) expect(c.perBottle).toBeCloseTo(18 / 3785.411784, 12);
  });

  it("with no item unit, a gallon is priced per gallon, never per bottle", () => {
    expect(perBottleLotCost({ unit_price: 18, uom: "gal", qty_bottles: 4, line_total: 72 })).toMatchObject({ ok: true, per: "gal" });
  });

  it.each([
    [{ unit_price: 18, uom: "gal", qty_bottles: 4 }, "bottle", "a gal is not a number of bottles"],
    [{ unit_price: 18, uom: "gal", price_base_uom: "bottle", qty_bottles: 4 }, "ml", "a gal is not a number of bottles"],
  ])("%j into an item kept in %s is refused: %s", (line, unit, why) => {
    const c = perBottleLotCost(line, { uom: unit });
    expect(c.ok).toBe(false);
    if (!c.ok && c.kind === "refused") expect(c.reason).toContain(why);
  });
});

describe("DeliveryStockService: a free gallon beside bottles", () => {
  let db: MockDb;
  let service: DeliveryStockService;

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
  });

  it("VERIFIED posts 4 gal @ 18 over the 15142 ml the door booked; nothing is held", async () => {
    db.answers["restaurant_inventory[]"] = { data: [{ id: ITEM, uom: "ml" }], error: null };
    db.answers.deliveries = { data: { id: DEL, state: "AGREED", order_id: null }, error: null };
    db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 15142 }], error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1" }], error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: "inv-1", line_no: 1, inventory_id: ITEM, qty_bottles: 4, unit_price: 18, uom: "gal", pack_size: 1, line_total: 72, description: "Whole milk", vendor_sku: null }],
      error: null,
    };
    db.rpcAnswers.finalise_delivery_cost = { data: { lots_matched: 1, lots_finalised: 1, bottles_finalised: 15142 }, error: null };
    const res = await service.finaliseAtVerified(REST, DEL, "u1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.stillProvisional).toEqual([]);
    const call = db.rpcCalls.find((c) => c.fn === "finalise_delivery_cost");
    expect(Math.round(Number(call?.args.p_unit_cost) * 15142 * 100)).toBe(7200);
    expect(String(call?.args.p_reason)).toContain("15142 milliliters accepted");
  });

  it("is not read as one more bottle: the item is held", async () => {
    db.answers["restaurant_inventory[]"] = { data: [{ id: ITEM, uom: "bottle" }], error: null };
    db.answers.deliveries = { data: { id: DEL, state: "AGREED", order_id: null }, error: null };
    db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 5 }], error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1" }], error: null };
    const line = { document_id: "inv-1", inventory_id: ITEM, pack_size: 1, description: "Syrup", vendor_sku: null };
    db.answers.procurement_document_lines = {
      data: [
        { ...line, line_no: 1, qty_bottles: 4, unit_price: 10, uom: "bottle", line_total: 40 },
        { ...line, line_no: 2, qty_bottles: 1, unit_price: 0, uom: "gal", line_total: 0 },
      ],
      error: null,
    };
    db.rpcAnswers.finalise_delivery_cost = { data: { lots_matched: 1, lots_finalised: 1, bottles_finalised: 5 }, error: null };
    const res = await service.finaliseAtVerified(REST, DEL, "u1");
    // Read as a bottle, the free gallon made 40 over 5 = 8.00 a bottle.
    const call = db.rpcCalls.find((c) => c.fn === "finalise_delivery_cost");
    expect(call?.args.p_unit_cost).not.toBe(8);
    if (res.ok) expect(res.value.stillProvisional.length).toBeGreaterThan(0);
  });
});
