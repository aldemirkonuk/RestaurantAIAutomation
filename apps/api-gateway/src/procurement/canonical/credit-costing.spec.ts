/**
 * r110 (DD-r109-29), part 1: verify's costing takes a credited PRICE claim off
 * its line. Fixtures are SYNTHETIC. The re-cost on the move to credited is
 * credit-recost.spec.ts (stacked).
 *
 *  (a) |unit_cost x received - (net - credited + charges)| <= received x 5e-7
 *  (b) credited <= the line's billed net, or the lot stays provisional and says why
 *  (c) an unknown house tax basis holds; a known one treats the credit like its line
 */
import { DatabaseService } from "../../database/database.service";
import { landedCost } from "../landed-cost";
import { makeMockDb, MockDb } from "./delivery-mock";
import { DeliveryStockService } from "./delivery-stock.service";

const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const DOC = "inv-1";
const USER = "u1";

describe("verify costs a credited price claim off its line (r110, DD-r109-29)", () => {
  let db: MockDb;
  let service: DeliveryStockService;

  const line = (over: Record<string, unknown> = {}) => ({
    id: "L1", document_id: DOC, line_no: 1, inventory_id: ITEM, qty: 10, qty_bottles: 10,
    uom: "bottle", pack_size: 1, unit_price: 60, line_total: 600, ...over,
  });
  const claim = (over: Record<string, unknown> = {}) => ({
    id: "cr-1", restaurant_id: REST, state: "credited", reason: "price_variance", document_id: DOC,
    document_line_id: "L1", credited_amount: "55.55", currency: "USD", ...over,
  });
  const given = (o: {
    head?: Record<string, unknown>;
    lines?: Record<string, unknown>[];
    claims?: Record<string, unknown>[];
    booked?: { inventory_id: string; quantity_change: number }[];
    house?: Record<string, unknown>;
  } = {}) => {
    db.answers.procurement_documents = { data: [{ id: DOC, doc_number: "A-1", ...(o.head ?? {}) }], error: null };
    db.answers.procurement_document_lines = { data: o.lines ?? [line()], error: null };
    db.answers.procurement_credits = { data: o.claims ?? [claim()], error: null };
    db.answers.inventory_transactions = { data: o.booked ?? [{ inventory_id: ITEM, quantity_change: 10 }], error: null };
    db.answers.deliveries = { data: { id: DEL, state: "VERIFIED", order_id: null }, error: null };
    // A house that charges no VAT: its tax answer is known, and a cost is as printed.
    db.answers.restaurants = { data: { currency: "USD", tax_basis: "not_vat_charging", ...(o.house ?? {}) }, error: null };
  };
  const posted = () => db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost");
  const run = () => service.finaliseAtVerified(REST, DEL, USER);
  const held = (r: Awaited<ReturnType<typeof run>>) => (r.ok ? r.value.stillProvisional : []);

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
    db.answers.document_deliveries = { data: [{ document_id: DOC, delivery_id: DEL, role: "invoice" }], error: null };
    db.answers.document_corrections = { data: [], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
    db.rpcAnswers.finalise_delivery_cost = {
      data: { lots_matched: 1, lots_finalised: 1, bottles_matched: 10, bottles_finalised: 10 },
      error: null,
    };
    db.rpcAnswers.restate_sale_cost = { data: { rows_restated: 3 }, error: null };
  });

  describe("(a) |unit_cost x received - (net - credited + charges)| <= received x 5e-7", () => {
    for (const freight of [0, 10, 7.77]) {
      for (const credited of ["55.55", "0.01", "600.00"]) {
        it(`600.00 over 10 bottles, credited ${credited}, freight ${freight}`, async () => {
          given({ head: { freight }, claims: [claim({ credited_amount: credited })] });
          const r = await run();
          expect(r.ok).toBe(true);
          if (600 - Number(credited) + freight === 0) {
            // Credited in full with nothing else to carry: a lot is never booked at a cost of nothing.
            expect(posted()).toEqual([]);
            expect(held(r)).toHaveLength(1);
            return;
          }
          const u = Number(posted()[0].args.p_unit_cost);
          expect(Math.abs(u * 10 - (600 - Number(credited) + freight))).toBeLessThanOrEqual(10 * 5e-7);
        });
      }
    }
  });

  it("(a) two credits on one line add in cents", async () => {
    given({ claims: [claim({ credited_amount: "0.10" }), claim({ id: "cr-2", credited_amount: "0.20" })] });
    await run();
    expect(Number(posted()[0].args.p_unit_cost)).toBe(59.97);
  });

  it("(a) no credit, no change: 60.00 a bottle", async () => {
    given({ claims: [] });
    await run();
    expect(Number(posted()[0].args.p_unit_cost)).toBe(60);
  });

  it("(b) a credit larger than the line's billed net stays provisional and says why", async () => {
    given({ claims: [claim({ credited_amount: "600.01" })] });
    const r = await run();
    expect(posted()).toEqual([]);
    expect(held(r)[0].reason).toMatch(/credited \S*600\.01, more than the \S*600\.00 it billed/);
  });

  it("(c) a house whose tax basis is unset holds: whether the credit is before tax is not known", async () => {
    given({ house: { tax_basis: null } });
    const r = await run();
    expect(posted()).toEqual([]);
    expect(held(r)[0].reason).toMatch(/before or after tax is not known/);
  });

  it("(c) the credit takes the line's own tax treatment: before tax for a reclaiming house, with it otherwise", () => {
    const H = { subtotal: null, discount_total: null, freight: null, fuel_surcharge: null, split_case_fee: null, delivery_fee: null, other_charges: null, deposit_total: null, tax: null, charges_tax_basis: null, charges_vat_rate_percent: null };
    const L = { line_no: 1, qty: 12, uom: "bottle", pack_size: 1, price_base_qty: null, unit_price: 12, line_total: 144, allowance: null, deposit: null, price_tax_basis: "includes_tax" as const, vat_rate_percent: 20, listed_bottles: 12, accepted_bottles: 12, credit: 24 };
    const per = (reclaims: boolean) => {
      const r = landedCost({ header: H, lines: [L], house: { tax_basis: "prices_include_tax", reclaims_input_tax: reclaims } }) as any;
      return r.lines[0].landed_cost_per_bottle as number;
    };
    // (144 - 24) / 1.2 / 12 and (144 - 24) / 12.
    expect(per(true)).toBeCloseTo(100 / 12, 9);
    expect(per(false)).toBeCloseTo(10, 9);
  });

  it("a credit in another money is not taken off unconverted", async () => {
    given({ claims: [claim({ currency: "TRY" })] });
    const r = await run();
    expect(posted()).toEqual([]);
    expect(held(r)[0].reason).toMatch(/not in the invoice's money \(TRY against USD\)/);
  });

  it("a failed credits read posts nothing and says so", async () => {
    given();
    db.answers.procurement_credits = { data: null, error: { message: "boom" } };
    const r = await run();
    expect(r).toMatchObject({ ok: false, status: 500, error: expect.stringMatching(/credits on the invoices could not be read \(boom\)/) });
    expect(posted()).toEqual([]);
  });
});
