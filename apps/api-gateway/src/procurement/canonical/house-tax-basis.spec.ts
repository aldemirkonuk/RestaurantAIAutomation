/**
 * ADR 0359 C2/C3, lane 3.5a: the house's tax answers reach the lot cost, and
 * a posted invoice cost is stamped with what it holds for tax.
 *
 * Fixtures are SYNTHETIC.
 */
import { DatabaseService } from "../../database/database.service";
import { makeMockDb, MockDb } from "./delivery-mock";
import { DeliveryStockService } from "./delivery-stock.service";
import * as paper from "./paper-landed-cost";
import { houseTaxForLotCost } from "./paper-landed-cost";

const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const USER = "u1";

describe("houseTaxForLotCost reads the house's two answers", () => {
  it("is unset with no row, an empty row, or a basis it does not know", () => {
    for (const row of [undefined, null, {}, { tax_basis: "kdv_inside", reclaims_input_tax: true }])
      expect(houseTaxForLotCost(row as never)).toEqual({ tax_basis: "unset", reclaims_input_tax: null });
  });

  it("never reads a reclaim answer without a basis beside it", () => {
    expect(houseTaxForLotCost({ tax_basis: "unset", reclaims_input_tax: true })).toEqual({
      tax_basis: "unset",
      reclaims_input_tax: null,
    });
  });

  it("keeps each stated basis and its reclaim answer", () => {
    expect(houseTaxForLotCost({ tax_basis: "prices_include_tax", reclaims_input_tax: true })).toEqual({
      tax_basis: "prices_include_tax",
      reclaims_input_tax: true,
    });
    expect(houseTaxForLotCost({ tax_basis: "prices_exclude_tax", reclaims_input_tax: false })).toEqual({
      tax_basis: "prices_exclude_tax",
      reclaims_input_tax: false,
    });
    expect(houseTaxForLotCost({ tax_basis: "prices_include_tax", reclaims_input_tax: null })).toEqual({
      tax_basis: "prices_include_tax",
      reclaims_input_tax: null,
    });
  });

  it("reads a house that charges no VAT as reclaiming nothing, whatever the column says", () => {
    expect(houseTaxForLotCost({ tax_basis: "not_vat_charging", reclaims_input_tax: true })).toEqual({
      tax_basis: "not_vat_charging",
      reclaims_input_tax: false,
    });
  });

  it("reads a reclaim answer that is not a yes or a no as not answered", () => {
    expect(houseTaxForLotCost({ tax_basis: "prices_exclude_tax", reclaims_input_tax: "yes" as never })).toEqual({
      tax_basis: "prices_exclude_tax",
      reclaims_input_tax: null,
    });
  });
});

describe("DeliveryStockService at VERIFIED — the house's tax and the cost's stamp", () => {
  let db: MockDb;
  let service: DeliveryStockService;
  const stamps = () => db.rpcCalls.filter((c) => c.fn === "stamp_delivery_cost_tax_basis");
  const posts = () => db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost");

  /** What the landed rule would return for one item costed at 100. */
  const landedAt = (costTaxBasis: "net" | "gross_cost" | null) => {
    const real = paper.landDelivery;
    return jest.spyOn(paper, "landDelivery").mockImplementation((input) => {
      const out = real(input);
      out.byItem.set(ITEM, {
        unitCost: 100,
        basis: "SYNTHETIC landed",
        costTaxBasis,
        taxSaid: "",
        landed: {
          netLineValue: 1000,
          chargeShare: 0,
          discountShare: 0,
          acceptedBottles: 10,
          landedCostPerBottle: 100,
          costTaxBasis,
          basis: "SYNTHETIC landed",
          taxSaid: "",
          leftOut: "",
        },
      });
      out.held.delete(ITEM);
      return out;
    });
  };

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
    db.answers.deliveries = { data: { id: DEL, state: "VERIFIED", order_id: null }, error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1", currency: "TRY" }], error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: "inv-1", line_no: 1, inventory_id: ITEM, qty_bottles: 10, uom: "bottle", pack_size: 1, unit_price: 100, line_total: 1000 }],
      error: null,
    };
    db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 10 }], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
  });
  afterEach(() => jest.restoreAllMocks());

  it("hands the landed rule the house's own answers, read beside its currency", async () => {
    const spy = jest.spyOn(paper, "landDelivery");
    // Record what the house read ASKS for: the mock answers any select alike.
    const asked: string[] = [];
    const real = db.client.getClient;
    db.client.getClient = () => {
      const c = real();
      return {
        ...c,
        from: (t: string) => {
          const chain = c.from(t) as { select: (...a: unknown[]) => unknown };
          if (t !== "restaurants") return chain;
          const select = chain.select;
          chain.select = (...a: unknown[]) => {
            asked.push(String(a[0]));
            return select(...a);
          };
          return chain;
        },
      };
    };
    db.answers.restaurants = {
      data: { currency: "TRY", tax_basis: "prices_include_tax", reclaims_input_tax: true },
      error: null,
    };
    await service.finaliseAtVerified(REST, DEL, USER);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].houseTax).toEqual({ tax_basis: "prices_include_tax", reclaims_input_tax: true });
    expect(spy.mock.calls[0][0].houseCurrency).toBe("TRY");
    expect(asked).toEqual(["currency, tax_basis, reclaims_input_tax"]);
  });

  it("a house that has not answered is costed as printed, as before", async () => {
    db.answers.restaurants = { data: { currency: "TRY" }, error: null };
    const r = await service.finaliseAtVerified(REST, DEL, USER);
    expect(posts().map((c) => c.args.p_unit_cost)).toEqual([100]);
    expect(r.ok && r.value.finalised[0].costTaxBasis).toBeNull();
    expect(r.ok && r.value.finalised[0].basis).toMatch(/since the house has not set its tax basis/);
    expect(stamps()).toEqual([]);
  });

  it("an unreadable house posts nothing: its reclaim answer is never guessed", async () => {
    db.answers.restaurants = { data: null, error: { message: "timeout" } };
    const r = await service.finaliseAtVerified(REST, DEL, USER);
    expect(!r.ok && r.status).toBe(500);
    expect(!r.ok && r.error).toMatch(/Whether the house reclaims the tax it pays is in the same read/);
    expect(posts()).toEqual([]);
  });

  it("stamps the lots with what the posted cost holds, at the cost it posted", async () => {
    landedAt("net");
    db.answers.restaurants = { data: { currency: "TRY", tax_basis: "prices_include_tax", reclaims_input_tax: true }, error: null };
    db.rpcAnswers.stamp_delivery_cost_tax_basis = { data: { lots_stamped: 1 }, error: null };
    const r = await service.finaliseAtVerified(REST, DEL, USER);
    expect(posts()).toHaveLength(1);
    expect(stamps().map((c) => c.args)).toEqual([
      { p_restaurant_id: REST, p_delivery_id: DEL, p_inventory_id: ITEM, p_unit_cost: 100, p_cost_tax_basis: "net" },
    ]);
    // The stamp follows the cost it describes, never before it.
    const order = db.rpcCalls.map((c) => c.fn).filter((f) => f !== "apply_stock_movement");
    expect(order.indexOf("finalise_delivery_cost")).toBeLessThan(order.indexOf("stamp_delivery_cost_tax_basis"));
    expect(r.ok && r.value.finalised[0].costTaxBasis).toBe("net");
    expect(r.ok && r.value.finalised[0].taxStampError).toBeUndefined();
  });

  it("a cost whose stamp could not be written still posts, and says its lots read not stated", async () => {
    landedAt("gross_cost");
    db.answers.restaurants = { data: { currency: "TRY", tax_basis: "prices_exclude_tax", reclaims_input_tax: false }, error: null };
    db.rpcAnswers.stamp_delivery_cost_tax_basis = { data: null, error: { message: "connection reset" } };
    const r = await service.finaliseAtVerified(REST, DEL, USER);
    expect(r.ok).toBe(true);
    expect(posts()).toHaveLength(1);
    expect(r.ok && r.value.finalised[0].costTaxBasis).toBeNull();
    expect(r.ok && r.value.finalised[0].taxStampError).toMatch(
      /the cost posted, but what it holds for tax \(with tax\) could not be written on its lots, so they read "not stated": connection reset/,
    );
  });

  it("a cost the paper does not state is not stamped at all", async () => {
    landedAt(null);
    db.answers.restaurants = { data: { currency: "TRY", tax_basis: "prices_include_tax", reclaims_input_tax: true }, error: null };
    await service.finaliseAtVerified(REST, DEL, USER);
    expect(posts()).toHaveLength(1);
    expect(stamps()).toEqual([]);
  });

  it("a settled proposal's price is never stamped: a person typed it, and no paper says what it holds", async () => {
    landedAt("net");
    db.answers.restaurants = { data: { currency: "TRY", tax_basis: "prices_include_tax", reclaims_input_tax: true }, error: null };
    db.answers.delivery_proposals = {
      data: [{ document_id: "inv-1", line_no: 1, unit_price_proposed: 90, status: "accepted" }],
      error: null,
    };
    const r = await service.finaliseAtVerified(REST, DEL, USER);
    expect(posts().map((c) => c.args.p_cost_provenance)).toEqual(["manual"]);
    expect(stamps()).toEqual([]);
    expect(r.ok && r.value.finalised[0].costTaxBasis).toBeNull();
  });
});
