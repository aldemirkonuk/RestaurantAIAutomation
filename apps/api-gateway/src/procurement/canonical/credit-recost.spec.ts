/**
 * r110 (DD-r109-29), part 2: the move to credited re-costs the claimed line's
 * lots and restates the sales made from them. Fixtures are SYNTHETIC. The
 * costing itself, invariants (a)-(c), is credit-costing.spec.ts (part 1).
 *
 *  (d) replaying the same credit posts the same arguments
 *  (e) another house's credit is a 404 and posts nothing
 *  (f) the restated sales and the lots carry one cost per bottle, so their sum
 *      is the corrected landed total (the database half is NOT pinned here)
 */
import { DatabaseService } from "../../database/database.service";
import { CreditsController } from "../documents/credits.controller";
import { makeMockDb, MockDb } from "./delivery-mock";
import { DeliveryStockService } from "./delivery-stock.service";

const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ORD = "abababab-abab-abab-abab-abababababab";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const ITEM2 = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const DOC = "inv-1";
const CR = "cr-1";
const USER = "u1";

describe("DeliveryStockService.recostAfterCredit (r110, DD-r109-29)", () => {
  let db: MockDb;
  let service: DeliveryStockService;

  const line = (over: Record<string, unknown> = {}) => ({
    id: "L1", document_id: DOC, line_no: 1, inventory_id: ITEM, qty: 10, qty_bottles: 10,
    uom: "bottle", pack_size: 1, unit_price: 60, line_total: 600, ...over,
  });
  const claim = (over: Record<string, unknown> = {}) => ({
    id: CR, restaurant_id: REST, state: "credited", reason: "price_variance", document_id: DOC,
    document_line_id: "L1", credited_amount: "55.55", currency: "USD", ...over,
  });
  const given = (o: {
    head?: Record<string, unknown>;
    lines?: Record<string, unknown>[];
    claims?: Record<string, unknown>[];
    booked?: { inventory_id: string; quantity_change: number }[];
    house?: Record<string, unknown>;
    orderId?: string | null;
  } = {}) => {
    db.answers.procurement_documents = { data: [{ id: DOC, doc_number: "A-1", ...(o.head ?? {}) }], error: null };
    db.answers.procurement_document_lines = { data: o.lines ?? [line()], error: null };
    db.answers.procurement_credits = { data: o.claims ?? [claim()], error: null };
    db.answers.inventory_transactions = { data: o.booked ?? [{ inventory_id: ITEM, quantity_change: 10 }], error: null };
    db.answers.deliveries = { data: { id: DEL, state: "VERIFIED", order_id: o.orderId === undefined ? ORD : o.orderId }, error: null };
    // A house that charges no VAT: its tax answer is known, and a cost is as printed.
    db.answers.restaurants = { data: { currency: "USD", tax_basis: "not_vat_charging", ...(o.house ?? {}) }, error: null };
  };
  const posted = () => db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost");
  const restated = () => db.rpcCalls.filter((c) => c.fn === "restate_sale_cost");
  const run = () => service.recostAfterCredit(REST, CR, USER);

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

  it("(a) the re-cost posts verify's credited cost with the credit's own reason", async () => {
    given();
    const r = await run();
    expect(r.ok).toBe(true);
    expect(Math.abs(Number(posted()[0].args.p_unit_cost) * 10 - (600 - 55.55))).toBeLessThanOrEqual(10 * 5e-7);
    expect(String(posted()[0].args.p_reason)).toMatch(new RegExp(`^credit ${CR} of document ${DOC}`));
  });

  it("(b) a credit larger than the line's billed net moves nothing and keeps the lots' cost", async () => {
    given({ claims: [claim({ credited_amount: "600.01" })] });
    const r = await run();
    expect(posted()).toEqual([]);
    expect(restated()).toEqual([]);
    const kept = r.ok ? r.value.deliveries[0].kept : [];
    expect(kept[0].reason).toMatch(/credited \S*600\.01, more than the \S*600\.00 it billed/);
    expect(kept[0].reason).toMatch(/Its lots keep the cost they had; nothing was revalued\.$/);
  });

  it("(d) replaying the same credit posts the same arguments", async () => {
    given();
    await run();
    await run();
    const [a, b] = posted().map((c) => c.args);
    expect(b).toEqual(a);
  });

  it("(e) another house's credit is a 404 and posts nothing", async () => {
    given({ claims: [claim({ restaurant_id: "other-house" })] });
    // The claim read must name the house: a read without it would find the row.
    const real = db.client.getClient;
    (db.client as { getClient: () => unknown }).getClient = () => {
      const c = real() as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> };
      return {
        ...c,
        from: (t: string) => {
          if (t !== "procurement_credits") return c.from(t);
          const eqs: [string, unknown][] = [];
          const b: Record<string, (...a: unknown[]) => unknown> = {};
          for (const v of ["select", "in", "order", "range"]) b[v] = () => b;
          b.eq = (k: unknown, v: unknown) => (eqs.push([String(k), v]), b);
          b.maybeSingle = () => {
            const rows = (db.answers.procurement_credits.data as Record<string, unknown>[]).filter((r) => eqs.every(([k, v]) => r[k] === v));
            return Promise.resolve({ data: rows[0] ?? null, error: null });
          };
          return b;
        },
      };
    };
    const r = await run();
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(posted()).toEqual([]);
  });

  it("(f) the sales are restated at the very cost the lots now carry", async () => {
    given({ booked: [{ inventory_id: ITEM, quantity_change: 10 }] });
    db.rpcAnswers.finalise_delivery_cost = {
      data: { lots_matched: 1, lots_finalised: 1, bottles_matched: 6, bottles_finalised: 6 },
      error: null,
    };
    const r = await run();
    const u = Number(posted()[0].args.p_unit_cost);
    expect(restated().map((c) => [c.args.p_inventory_id, c.args.p_source_order_id, c.args.p_unit_cost])).toEqual([[ITEM, ORD, u]]);
    // 4 bottles drawn before + 6 on the shelf, one cost per bottle: their sum is the landed total.
    const d = r.ok ? r.value.deliveries[0] : null;
    expect(d?.drawnBefore).toBe(4);
    expect(Math.abs(((d?.drawnBefore ?? 0) + 6) * u - (600 - 55.55))).toBeLessThanOrEqual(10 * 5e-7);
  });

  it("only the claimed line's item is posted", async () => {
    given({
      lines: [line(), line({ id: "L2", line_no: 2, inventory_id: ITEM2 })],
      booked: [{ inventory_id: ITEM, quantity_change: 10 }, { inventory_id: ITEM2, quantity_change: 10 }],
    });
    await run();
    expect(posted().map((c) => c.args.p_inventory_id)).toEqual([ITEM]);
  });

  it("a claim for bottles short does not move a bottle's cost", async () => {
    given({ claims: [claim({ reason: "qty_short" })] });
    const r = await run();
    expect(posted()).toEqual([]);
    expect(r.ok && r.value).toMatchObject({ costField: false, note: expect.stringMatching(/not on the shelf/) });
  });

});

describe("POST /procurement/credits/:id/transition to credited (r110)", () => {
  const row = { id: CR, restaurant_id: REST, state: "promised", claimed_amount: "60.00", credited_amount: null, credit_document_id: null, opened_at: "2026-11-01", self_evidenced: false };
  const db = {
    getClient: () => {
      const b: Record<string, (...a: unknown[]) => unknown> = {};
      for (const v of ["select", "eq", "update"]) b[v] = () => b;
      b.maybeSingle = () => Promise.resolve({ data: row, error: null });
      b.single = () => Promise.resolve({ data: { ...row, state: "credited" }, error: null });
      return { from: () => b };
    },
  };
  const user = { userId: USER, restaurantId: REST } as never;
  const body = { to: "credited", creditedAmount: 55.55, creditDocumentId: "cm-1" } as never;

  it("re-costs on the move to credited, and a failed re-cost is said while the credit stands", async () => {
    const stock = { recostAfterCredit: jest.fn().mockResolvedValue({ ok: false, status: 503, error: "boom" }) };
    const c = new CreditsController(db as never, {} as never, stock as never);
    const out: any = await c.transition(CR, body, user);
    expect(stock.recostAfterCredit).toHaveBeenCalledWith(REST, CR, USER);
    expect(out).toMatchObject({ state: "credited", recost: { ok: false, error: "boom" } });
  });

  it("a thrown re-cost is a failure in words, never a 500 that hides the credit", async () => {
    const stock = { recostAfterCredit: jest.fn().mockRejectedValue(new Error("down")) };
    const c = new CreditsController(db as never, {} as never, stock as never);
    const out: any = await c.transition(CR, body, user);
    expect(out.recost).toEqual({ ok: false, error: "down" });
  });
});
