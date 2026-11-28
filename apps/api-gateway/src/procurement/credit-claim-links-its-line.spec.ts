/**
 * r110 fixer: a price claim names the invoice line it is about.
 *
 * The credit re-cost (DD-r109-29) acts only on a claim that carries document_id
 * and document_line_id, and the only writer of price_variance claims,
 * openCreditClaim, wrote neither, so every real credited price claim changed no
 * cost. This runs the writer, then credits the row it wrote, then re-costs,
 * with NO hand-seeded ids. Fixtures are SYNTHETIC.
 */
import { DatabaseService } from "../database/database.service";
import { DeliveryStockService } from "./canonical/delivery-stock.service";
import { makeMockDb, MockDb } from "./canonical/delivery-mock";
import { ProcurementService } from "./procurement.service";

const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ORD = "abababab-abab-abab-abab-abababababab";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const DOC = "inv-1";
const LINE = "L1";

const match = {
  verdict: "price_variance",
  creditDue: true,
  creditAmount: 10,
  selfEvidenced: false,
  summary: "Billed 8.00 a bottle against 7.00 agreed.",
} as any;
const order = { provider_id: "p1", currency: "USD", inventory_id: ITEM };

function writer(db: MockDb) {
  const svc = new ProcurementService(
    { supabase: db.client.getClient() } as unknown as DatabaseService,
    {} as any,
    {} as any,
  );
  return (o: typeof order | null = order) => (svc as any).openCreditClaim(REST, ORD, "u1", match, o);
}
const credits = (db: MockDb) =>
  db.writes.filter((w) => w.table === "procurement_credits" && w.verb === "insert");

describe("openCreditClaim links a price claim to its invoice line", () => {
  let db: MockDb;
  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    db.answers.deliveries = { data: [{ id: DEL }], error: null };
    db.answers.document_deliveries = { data: [{ document_id: DOC }], error: null };
    db.answers.procurement_document_lines = { data: [{ id: LINE, document_id: DOC }], error: null };
    db.insertAnswers.procurement_credits = { data: null, error: null };
  });

  it("writes document_id and document_line_id from the order's invoice", async () => {
    await writer(db)();
    expect(credits(db)).toHaveLength(1);
    expect(credits(db)[0].payload).toMatchObject({ reason: "price_variance", document_id: DOC, document_line_id: LINE });
  });

  it("verify, credit, recost with no seeded ids: the lot cost falls from 8.00 to 7.00", async () => {
    await writer(db)();
    const written = credits(db)[0].payload as Record<string, unknown>;

    const rdb = makeMockDb();
    rdb.reset();
    const svc = new DeliveryStockService(rdb.client as unknown as DatabaseService);
    rdb.answers.procurement_documents = { data: [{ id: DOC, doc_number: "A-1" }], error: null };
    rdb.answers.procurement_document_lines = {
      data: [{ id: LINE, document_id: DOC, line_no: 1, inventory_id: ITEM, qty: 10, qty_bottles: 10, uom: "bottle", pack_size: 1, unit_price: 8, line_total: 80 }],
      error: null,
    };
    rdb.answers.procurement_credits = {
      data: [{ ...written, id: "cr-1", state: "credited", credited_amount: "10.00", currency: "USD" }],
      error: null,
    };
    rdb.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 10 }], error: null };
    rdb.answers.deliveries = { data: { id: DEL, state: "VERIFIED", order_id: ORD }, error: null };
    rdb.answers.restaurants = { data: { currency: "USD", tax_basis: "not_vat_charging" }, error: null };
    rdb.answers.document_deliveries = { data: [{ document_id: DOC, delivery_id: DEL, role: "invoice" }], error: null };
    rdb.answers.document_corrections = { data: [], error: null };
    rdb.answers.delivery_proposals = { data: [], error: null };
    rdb.rpcAnswers.finalise_delivery_cost = {
      data: { lots_matched: 1, lots_finalised: 1, bottles_matched: 10, bottles_finalised: 10 },
      error: null,
    };
    rdb.rpcAnswers.restate_sale_cost = { data: { rows_restated: 0 }, error: null };
    const r = await svc.recostAfterCredit(REST, "cr-1", "u1");
    expect(r.ok).toBe(true);
    const post = rdb.rpcCalls.find((c) => c.fn === "finalise_delivery_cost");
    expect(Number(post?.args.p_unit_cost)).toBeCloseTo(7, 6);
  });

  it("leaves the claim unlinked when the item has two lines on the invoice, never a guess", async () => {
    db.answers.procurement_document_lines = {
      data: [{ id: "L1", document_id: DOC }, { id: "L2", document_id: DOC }],
      error: null,
    };
    await writer(db)();
    expect(credits(db)[0].payload).not.toHaveProperty("document_line_id");
  });

  it("opens the claim unlinked, and says so, when the invoice read fails", async () => {
    db.answers.document_deliveries = { data: null, error: { message: "boom" } };
    await writer(db)();
    expect(credits(db)).toHaveLength(1);
    expect(credits(db)[0].payload).not.toHaveProperty("document_id");
  });
});
