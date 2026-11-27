/**
 * WHICH ITEMS ON A PAPER HOLD THEIR COST, READ BACK TO THE PAGE (r107, DD-r106-23).
 *
 * `agreedPrices` decided this all along and never said it. These cases fail
 * with the route's house scope removed, with a failed read turned into an
 * empty list, and with the tax-basis flag hard-coded.
 */
import { DatabaseService } from "../../database/database.service";
import { makeMockDb, MockDb } from "./delivery-mock";
import { DeliveryStockService } from "./delivery-stock.service";

const REST = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const DOC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

describe("DeliveryStockService.heldCostsOfDocument", () => {
  let db: MockDb;
  let service: DeliveryStockService;
  let eqs: [string, string, unknown][];

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    eqs = [];
    const raw = db.client.getClient();
    const spy = {
      ...db.client,
      getClient: () => ({
        rpc: raw.rpc,
        from: (t: string) => {
          const chain = raw.from(t) as Record<string, (...a: unknown[]) => unknown>;
          const proxy: unknown = new Proxy(chain, {
            get: (target, p: string) => (...a: unknown[]) => {
              if (p === "eq") eqs.push([t, String(a[0]), a[1]]);
              const out = target[p](...a);
              return out === target ? proxy : out;
            },
          });
          return proxy;
        },
      }),
    };
    service = new DeliveryStockService(spy as unknown as DatabaseService);
    db.answers.deliveries = { data: { id: DEL, state: "AGREED", order_id: null }, error: null };
    db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 10 }], error: null };
    db.answers.document_deliveries = {
      data: [{ document_id: DOC, role: "invoice", delivery_id: DEL }],
      error: null,
    };
    db.answers.delivery_proposals = { data: [], error: null };
    db.answers.procurement_documents = { data: [{ id: DOC, doc_number: "A-1" }], error: null };
    // A case price with no stated pack: the cost cannot be said per bottle.
    db.answers.procurement_document_lines = {
      data: [
        {
          document_id: DOC, line_no: 1, inventory_id: ITEM, qty: 2, qty_bottles: 24, uom: "case",
          pack_size: 1, unit_price: 264, price_base_qty: null, price_base_uom: null, line_total: null,
        },
      ],
      error: null,
    };
    db.answers.restaurants = { data: { currency: "USD", tax_basis: "unset", reclaims_input_tax: null }, error: null };
  });

  it("lists the item whose cost is held, with the sentence, and says the tax basis is unknown", async () => {
    const res = await service.heldCostsOfDocument(REST, DOC);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.taxBasisKnown).toBe(false);
    expect(res.value.held).toHaveLength(1);
    expect(res.value.held[0]).toMatchObject({ deliveryIds: [DEL], inventoryId: ITEM });
    expect(res.value.held[0].why).toMatch(/provisional/);
  });

  it("a hold that has nothing to do with tax is not blamed on the tax basis", async () => {
    // The fixture is a case price with no stated pack, held while the tax basis
    // is unknown. Answering the tax question would not release it.
    const res = await service.heldCostsOfDocument(REST, DOC);
    expect(res.ok && res.value.taxBasisKnown).toBe(false);
    expect(res.ok && res.value.held.map((h) => h.cause)).toEqual(["other"]);
  });

  it("a hold that clears under a known tax answer is tagged tax_basis; one that does not stays other", async () => {
    const other = "99999999-9999-9999-9999-999999999999";
    const real = new Map([[ITEM, "tax held. The lot stays provisional."], [other, "pack held. The lot stays provisional."]]);
    db.answers.procurement_document_lines = {
      data: [
        { document_id: DOC, inventory_id: ITEM },
        { document_id: DOC, inventory_id: other },
      ],
      error: null,
    };
    const spy = jest
      .spyOn(service as unknown as { agreedPrices: (...a: unknown[]) => unknown }, "agreedPrices")
      .mockImplementation(async (...a: unknown[]) => ({
        ok: true,
        // Under the hypothetical (4th argument) only the pack hold remains.
        value: { held: a[3] ? new Map([[other, real.get(other)]]) : real },
      }));
    const res = await service.heldCostsOfDocument(REST, DOC);
    spy.mockRestore();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.fromEntries(res.value.held.map((h) => [h.inventoryId, h.cause]))).toEqual({
      [ITEM]: "tax_basis",
      [other]: "other",
    });
  });

  it("holds on another paper of the same delivery are not this paper's, and an item held on two deliveries is one entry", async () => {
    const DOC_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const DEL_2 = "d2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2";
    const X = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    // Paper A (the one asked about) has only ITEM; paper B has X, and X is the held one.
    db.answers.procurement_document_lines = {
      data: [
        { document_id: DOC, inventory_id: ITEM },
        { document_id: DOC_B, inventory_id: X },
      ],
      error: null,
    };
    db.answers.document_deliveries = {
      data: [
        { document_id: DOC, role: "invoice", delivery_id: DEL },
        { document_id: DOC_B, role: "invoice", delivery_id: DEL },
      ],
      error: null,
    };
    const held = new Map([[X, "no pack. The lot stays provisional."]]);
    const spy = jest
      .spyOn(service as unknown as { agreedPrices: (...a: unknown[]) => unknown }, "agreedPrices")
      .mockImplementation(async () => ({ ok: true, value: { held } }));
    const forA = await service.heldCostsOfDocument(REST, DOC);
    expect(forA.ok && forA.value.held).toEqual([]);

    // The same item held on this paper's two deliveries is counted once.
    db.answers.procurement_document_lines = { data: [{ document_id: DOC, inventory_id: X }], error: null };
    db.answers.document_deliveries = {
      data: [
        { document_id: DOC, role: "invoice", delivery_id: DEL },
        { document_id: DOC, role: "invoice", delivery_id: DEL_2 },
      ],
      error: null,
    };
    const twice = await service.heldCostsOfDocument(REST, DOC);
    spy.mockRestore();
    expect(twice.ok && twice.value.held).toHaveLength(1);
    expect(twice.ok && twice.value.held[0].deliveryIds).toEqual([DEL, DEL_2]);
  });

  it("says the tax basis is known when the house has said how it treats tax", async () => {
    db.answers.restaurants = {
      data: { currency: "USD", tax_basis: "prices_include_tax", reclaims_input_tax: true },
      error: null,
    };
    const res = await service.heldCostsOfDocument(REST, DOC);
    expect(res.ok && res.value.taxBasisKnown).toBe(true);
  });

  it("scopes the document read to the asking house, and another house's id is a 404", async () => {
    const res = await service.heldCostsOfDocument(OTHER, DOC);
    // The FIRST filter on the document read is the house; later reads of the
    // same table (the invoice heads) are not the guard.
    expect(eqs.find(([t]) => t === "procurement_documents")).toEqual(["procurement_documents", "restaurant_id", OTHER]);
    // The double has no tenancy of its own: no row for that house = not found.
    db.answers.procurement_documents = { data: [], error: null };
    const foreign = await service.heldCostsOfDocument(OTHER, DOC);
    expect(res.ok).toBe(true);
    expect(foreign).toEqual({ ok: false, status: 404, error: "Document not found" });
  });

  it("a failed read is a 500 in words, never an empty list", async () => {
    db.answers.document_deliveries = { data: null, error: { message: "connection reset" } };
    const res = await service.heldCostsOfDocument(REST, DOC);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(500);
    expect(res.error).toMatch(/could not be read: connection reset/);
  });

  it("a failed read of the house's tax settings is not 'tax basis known'", async () => {
    db.answers.restaurants = { data: null, error: { message: "timeout" } };
    const res = await service.heldCostsOfDocument(REST, DOC);
    expect(res.ok).toBe(false);
  });
});
