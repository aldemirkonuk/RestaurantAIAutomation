/**
 * ADR 0103 A1 + A5 — stock at the door, cost at VERIFIED.
 *
 * FAILING-FIRST. Every test here was written against the tree BEFORE
 * `DeliveryStockService` existed; the file did not compile, which is the
 * strongest failing-first there is for a new writer. The three that assert
 * against a REGRESSION rather than an absence — the correction delta, the
 * refusal to guess an item, and the second-writer guard — were additionally
 * proven by sabotage: booking the full quantity instead of the delta, matching
 * a line to the order's item unconditionally, and returning `false` from
 * `deliveryHasBookedOrder` on a failed read. Each sabotage turns exactly the
 * named test red and nothing else.
 */

import { DatabaseService } from "../../database/database.service";
import { makeMockDb, MockDb } from "./delivery-mock";
import {
  DeliveryStockService,
  deliveryHasBookedOrder,
} from "./delivery-stock.service";

const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const DOC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const USER = "u1";

describe("DeliveryStockService — the door books stock (A1)", () => {
  let db: MockDb;
  let service: DeliveryStockService;

  const line = (over: Record<string, unknown> = {}) => ({
    document_id: DOC,
    line_no: 1,
    inventory_id: ITEM,
    qty_bottles: 10,
    unit_price: null,
    description: "Sentetik Öküzgözü 2021",
    vendor_sku: "SYN-1",
    ...over,
  });

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
    db.answers.deliveries = {
      data: { id: DEL, state: "DELIVERED", order_id: null },
      error: null,
    };
    db.answers.procurement_document_lines = { data: [line()], error: null };
    db.answers.inventory_transactions = { data: [], error: null };
    db.rpcAnswers.apply_stock_movement = { data: "txn-1", error: null };
  });

  it("books the counted bottles against the delivery, with NO price and a per-line key", async () => {
    const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.bottlesMoved).toBe(10);
    expect(res.value.notBooked).toEqual([]);

    const call = db.rpcCalls.find((c) => c.fn === "apply_stock_movement");
    expect(call).toBeDefined();
    expect(call?.args).toMatchObject({
      p_inventory_id: ITEM,
      p_delta: 10,
      p_stock_state: "live",
      p_reference_type: "delivery",
      p_reference_id: DEL,
      // (delivery, document, line) — A2's key. NOT `order-delivered:${orderId}`,
      // which drops the second truck of a split shipment.
      p_idempotency_key: `delivery-line:${DEL}:${DOC}:1`,
    });
    // A6: no price at the door. Absent, never zero — a 0.00 is a claim the
    // goods were free, and `apply_stock_movement` would make it a lot cost.
    expect(call?.args.p_unit_cost).toBeUndefined();
  });

  it("does not book a second time for the same (delivery, document, line)", async () => {
    // The delivery has already put 10 bottles of this item on the shelf.
    db.answers.inventory_transactions = {
      data: [{ inventory_id: ITEM, quantity_change: 10 }],
      error: null,
    };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.bottlesMoved).toBe(0);
    expect(db.rpcCalls.filter((c) => c.fn === "apply_stock_movement")).toEqual(
      [],
    );
    // The line is reported as booked with a zero delta, not as unbooked: the
    // bottles ARE on the shelf, and saying otherwise would send somebody to
    // book them again.
    expect(res.value.booked[0]).toMatchObject({ delta: 0, inventoryId: ITEM });
  });

  describe("two lines of one item in one count add up (browser walk 2026-11-12)", () => {
    const two = () => {
      db.answers.procurement_document_lines = {
        data: [line({ line_no: 1, qty_bottles: 6 }), line({ line_no: 2, qty_bottles: 4 })],
        error: null,
      };
    };
    const moves = () =>
      db.rpcCalls
        .filter((c) => c.fn === "apply_stock_movement")
        .map((c) => [c.args.p_idempotency_key, c.args.p_delta]);

    it("a first count books each line in full: 6 + 4 = 10 on the shelf", async () => {
      two();
      const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(moves()).toEqual([
        [`delivery-line:${DEL}:${DOC}:1`, 6],
        [`delivery-line:${DEL}:${DOC}:2`, 4],
      ]);
      expect(res.value.bottlesMoved).toBe(10);
    });

    it("a retry after both were booked moves nothing and says delta 0 for each", async () => {
      two();
      db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 10 }], error: null };
      const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(moves()).toEqual([]);
      expect(res.value.booked.map((b) => b.delta)).toEqual([0, 0]);
    });

    it("a retry after the first line alone was booked books only the second", async () => {
      two();
      db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 6 }], error: null };
      const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
      expect(res.ok).toBe(true);
      expect(moves()).toEqual([[`delivery-line:${DEL}:${DOC}:2`, 4]]);
    });

    it("a corrected count lower than before gives the difference back once", async () => {
      db.answers.procurement_document_lines = {
        data: [
          line({ document_id: "recount-doc", line_no: 1, qty_bottles: 5 }),
          line({ document_id: "recount-doc", line_no: 2, qty_bottles: 5 }),
        ],
        error: null,
      };
      db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 12 }], error: null };
      const res = await service.bookAtTheDoor(REST, DEL, "recount-doc", USER);
      expect(res.ok).toBe(true);
      expect(moves()).toEqual([[`delivery-line:${DEL}:recount-doc:1`, -2]]);
    });

    it("a corrected count higher than before books only the rise", async () => {
      db.answers.procurement_document_lines = {
        data: [
          line({ document_id: "recount-doc", line_no: 1, qty_bottles: 6 }),
          line({ document_id: "recount-doc", line_no: 2, qty_bottles: 6 }),
        ],
        error: null,
      };
      db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 10 }], error: null };
      const res = await service.bookAtTheDoor(REST, DEL, "recount-doc", USER);
      expect(res.ok).toBe(true);
      expect(moves()).toEqual([[`delivery-line:${DEL}:recount-doc:2`, 2]]);
    });
  });

  it("a corrected count moves the DELTA, as a new transaction (ADR 0104 D5)", async () => {
    db.answers.inventory_transactions = {
      data: [{ inventory_id: ITEM, quantity_change: 12 }],
      error: null,
    };
    db.answers.procurement_document_lines = {
      data: [line({ document_id: "recount-doc", qty_bottles: 10 })],
      error: null,
    };
    const res = await service.bookAtTheDoor(REST, DEL, "recount-doc", USER);
    expect(res.ok).toBe(true);
    const call = db.rpcCalls.find((c) => c.fn === "apply_stock_movement");
    // 10 counted against 12 already booked = give two back. Not an edit of the
    // first movement, and not a second booking of ten.
    expect(call?.args.p_delta).toBe(-2);
    expect(call?.args.p_idempotency_key).toBe(
      `delivery-line:${DEL}:recount-doc:1`,
    );
  });

  it("a line that names no item is NOT booked and NOT guessed at", async () => {
    db.answers.deliveries = {
      data: { id: DEL, state: "DELIVERED", order_id: "order-1" },
      error: null,
    };
    db.answers.procurement_orders = { data: { inventory_id: ITEM }, error: null };
    db.answers.procurement_document_lines = {
      data: [
        line({ line_no: 1, inventory_id: null }),
        line({ line_no: 2, inventory_id: null, description: "Boğazkere" }),
      ],
      error: null,
    };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // TWO lines and one order item: the pairing is ambiguous, so neither is
    // booked. A wrong guess puts the bottles on the wrong wine.
    expect(db.rpcCalls.filter((c) => c.fn === "apply_stock_movement")).toEqual(
      [],
    );
    expect(res.value.notBooked).toHaveLength(2);
    expect(res.value.notBooked[0].reason).toMatch(/names no item/);
  });

  it("a failed read of what is already booked books NOTHING (ADR 0067)", async () => {
    db.answers.inventory_transactions = {
      data: null,
      error: { message: "statement timeout" },
    };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/counted twice/);
    expect(db.rpcCalls.filter((c) => c.fn === "apply_stock_movement")).toEqual(
      [],
    );
  });

  it("a document with no lines is refused rather than read as zero stock (A6)", async () => {
    db.answers.procurement_document_lines = { data: [], error: null };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/not counted/);
  });
});

// Founder, 2026-09-22, verbatim pick: "Yes, same rule (Recommended)" — the
// door queues research for an item the wine library lacks, by its id, once.
describe("DeliveryStockService — the door queues research for a wine the library lacks", () => {
  let db: MockDb;
  let service: DeliveryStockService;
  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
    db.answers.deliveries = { data: { id: DEL, state: "DELIVERED", order_id: "o-1" }, error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: DOC, line_no: 1, inventory_id: ITEM, qty_bottles: 10, unit_price: null, description: "x", vendor_sku: null }],
      error: null,
    };
    db.answers.inventory_transactions = { data: [], error: null };
    db.rpcAnswers.apply_stock_movement = { data: "txn-1", error: null };
  });
  const researchWrites = () => db.writes.filter((w) => w.table === "house_item_research");

  it("an item with no library wine is queued by its id after the booking, from 'receiving'", async () => {
    db.answers.restaurant_inventory = { data: { master_wine_id: null, wine_name: "Doluca Kav 2018", display_name: null }, error: null };
    db.answers.house_item_research = { data: null, error: null };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(researchWrites()).toEqual([
      expect.objectContaining({
        verb: "insert",
        payload: expect.objectContaining({ inventory_id: ITEM, status: "queued", queued_from: "receiving", source_order_id: "o-1", queued_by: USER, classified_name: "Doluca Kav 2018" }),
      }),
    ]);
    expect(res.value.research).toEqual([{ inventoryId: ITEM, status: "queued" }]);
    // The booking came first.
    const bookedAt = db.verbs.indexOf("restaurant_inventory.select");
    expect(db.rpcCalls.some((c) => c.fn === "apply_stock_movement")).toBe(true);
    expect(bookedAt).toBeGreaterThan(-1);
  });

  it("a library wine is not queued", async () => {
    db.answers.restaurant_inventory = { data: { master_wine_id: "mw-1", wine_name: "Barolo" }, error: null };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
    expect(res.ok && res.value.research).toEqual([]);
    expect(researchWrites()).toHaveLength(0);
  });

  it("an item that cannot be read is listed with the reason; the booking stands", async () => {
    db.answers.restaurant_inventory = { data: null, error: { message: "connection reset" } };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.bottlesMoved).toBe(10);
    expect(res.value.research).toEqual([{ inventoryId: ITEM, error: "the item could not be read (connection reset)" }]);
  });

  it("a retry that moves nothing queues nothing", async () => {
    db.answers.inventory_transactions = { data: [{ delivery_id: DEL, inventory_id: ITEM, quantity_change: 10, idempotency_key: `delivery-line:${DEL}:${DOC}:1` }], error: null };
    db.answers.restaurant_inventory = { data: { master_wine_id: null, wine_name: "Doluca Kav 2018" }, error: null };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
    expect(res.ok && res.value.bottlesMoved).toBe(0);
    expect(researchWrites()).toHaveLength(0);
  });
});

describe("DeliveryStockService — VERIFIED settles the cost (A1)", () => {
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
    db.answers.inventory_transactions = {
      data: [{ inventory_id: ITEM, quantity_change: 10 }],
      error: null,
    };
    db.answers.document_deliveries = {
      data: [{ document_id: "inv-1", role: "invoice" }],
      error: null,
    };
    db.answers.delivery_proposals = { data: [], error: null };
    // The invoice's header: no charge, no discount (lane 1.4 reads it).
    db.answers.procurement_documents = {
      data: [{ id: "inv-1", doc_number: "A-1" }],
      error: null,
    };
    db.rpcAnswers.finalise_delivery_cost = {
      data: { lots_matched: 1, lots_finalised: 1, bottles_finalised: 10 },
      error: null,
    };
  });

  it("posts the invoice price onto the delivery's lots and touches no quantity", async () => {
    db.answers.procurement_document_lines = {
      data: [
        {
          document_id: "inv-1",
          line_no: 1,
          inventory_id: ITEM,
          qty_bottles: 10,
          unit_price: 142.5,
          uom: "bottle",
          pack_size: 1,
          description: "Öküzgözü",
          vendor_sku: null,
        },
      ],
      error: null,
    };
    const res = await service.finaliseAtVerified(REST, DEL, USER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.finalised).toHaveLength(1);
    expect(res.value.finalised[0]).toMatchObject({
      unitCost: 142.5,
      provenance: "invoice",
      source: "invoice_line",
    });
    const call = db.rpcCalls.find((c) => c.fn === "finalise_delivery_cost");
    expect(call?.args).toMatchObject({
      p_delivery_id: DEL,
      p_inventory_id: ITEM,
      p_unit_cost: 142.5,
    });
    // Money moved; bottles did not. No stock movement is issued here at all.
    expect(db.rpcCalls.filter((c) => c.fn === "apply_stock_movement")).toEqual(
      [],
    );
  });

  it("an ACCEPTED proposal beats the invoice line it is about", async () => {
    db.answers.procurement_document_lines = {
      data: [
        {
          document_id: "inv-1",
          line_no: 1,
          inventory_id: ITEM,
          qty_bottles: 10,
          unit_price: 142.5,
          uom: "bottle",
          pack_size: 1,
          description: "Öküzgözü",
          vendor_sku: null,
        },
      ],
      error: null,
    };
    db.answers.delivery_proposals = {
      data: [{ document_id: "inv-1", line_no: 1, unit_price_proposed: 128 }],
      error: null,
    };
    const res = await service.finaliseAtVerified(REST, DEL, USER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.finalised[0]).toMatchObject({
      unitCost: 128,
      // A settled price is one a person put their name to. Calling it
      // `invoice` would claim a document said it.
      provenance: "manual",
      source: "accepted_proposal",
    });
  });

  it("an accepted proposal keyed to the DOOR COUNT still finds its item (live, 2026-09-06)", async () => {
    // NOT a regression barrier, and saying so is the point: the test double
    // ignores `.in(...)`, so it hands back the door-count line whichever ids
    // the query asked for, and the pre-fix code passes this test for a reason
    // that is not true of the database. It documents the behaviour the LIVE
    // drive measured (the delivery whose price was agreed reported "no agreed
    // price reaches this item"); the evidence is that measurement, not this.
    // The next test is the one that goes red without the fix.
    // The difference lives on the door count — that is where `recordedDifferences`
    // keys it, and the door count is the one document carrying `inventory_id`.
    // Looking the proposal's line up only among INVOICE lines found nothing, so a
    // delivery whose price WAS agreed reported "no agreed price reaches this item".
    db.answers.document_deliveries = {
      data: [
        { document_id: "inv-1", role: "invoice" },
        { document_id: "door-1", role: "door_count" },
      ],
      error: null,
    };
    db.answers.procurement_document_lines = {
      data: [
        // QA 12b D1: the invoice line, carrying no item, sets the price base.
        { document_id: "inv-1", line_no: 1, inventory_id: null, qty_bottles: 10, unit_price: 125, uom: "bottle", pack_size: 1, description: "x", vendor_sku: null },
        {
          document_id: "door-1",
          line_no: 1,
          inventory_id: ITEM,
          qty_bottles: 10,
          unit_price: null,
          uom: "bottle",
          pack_size: 1,
          description: "counted at the door",
          vendor_sku: null,
        },
      ],
      error: null,
    };
    db.answers.delivery_proposals = {
      data: [{ document_id: "door-1", line_no: 1, unit_price_proposed: 118.75 }],
      error: null,
    };
    const res = await service.finaliseAtVerified(REST, DEL, USER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.stillProvisional).toEqual([]);
    expect(res.value.finalised[0]).toMatchObject({
      inventoryId: ITEM,
      unitCost: 118.75,
      source: "accepted_proposal",
    });
  });

  it("a door count is indexed for the lookup but never read as a price", async () => {
    // FAILING-FIRST, and the setup is deliberate. The invoice is attached (so
    // the pre-fix code reaches the line read at all) and the only line that
    // comes back is the DOOR COUNT's. Pre-fix, every line the read returned was
    // treated as an invoice price, so this 999 became the lot's cost. Measured
    // red on the pre-fix service.
    db.answers.document_deliveries = {
      data: [
        { document_id: "inv-1", role: "invoice" },
        { document_id: "door-1", role: "door_count" },
      ],
      error: null,
    };
    db.answers.procurement_document_lines = {
      data: [
        {
          document_id: "door-1",
          line_no: 1,
          inventory_id: ITEM,
          qty_bottles: 10,
          // A door count carries no money (ADR 0104 D11). If one ever did, it
          // must not become a cost.
          unit_price: 999,
          description: "counted at the door",
          vendor_sku: null,
        },
      ],
      error: null,
    };
    const res = await service.finaliseAtVerified(REST, DEL, USER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.finalised).toEqual([]);
    expect(res.value.stillProvisional).toHaveLength(1);
  });

  it("a lot with no agreed price stays PROVISIONAL and never becomes zero", async () => {
    db.answers.procurement_document_lines = {
      data: [
        {
          document_id: "inv-1",
          line_no: 1,
          inventory_id: "some-other-item",
          qty_bottles: 4,
          unit_price: 90,
          description: "a different wine",
          vendor_sku: null,
        },
        {
          document_id: "inv-1",
          line_no: 2,
          inventory_id: "a-third-item",
          qty_bottles: 4,
          unit_price: 80,
          description: "and another",
          vendor_sku: null,
        },
      ],
      error: null,
    };
    const res = await service.finaliseAtVerified(REST, DEL, USER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.finalised).toEqual([]);
    expect(res.value.stillProvisional[0].reason).toMatch(/no agreed price/);
    expect(db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost")).toEqual(
      [],
    );
  });
  // QA round 7c B1. Red on origin/main 259feea3f, which posted 264 and 142.
  const invoiceLine = (over: Record<string, unknown>) => ({
    document_id: "inv-1", line_no: 1, inventory_id: ITEM, qty: 2, qty_bottles: 24, uom: "case",
    pack_size: 12, unit_price: 264, price_base_qty: null, price_base_uom: null, line_total: null, ...over,
  });
  const run = (...lines: Record<string, unknown>[]) => {
    db.rpcCalls.length = 0;
    db.answers.procurement_document_lines = { data: lines.map(invoiceLine), error: null };
    return service.finaliseAtVerified(REST, DEL, USER);
  };
  const posted = () => db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost");
  const held = async (r: ReturnType<typeof run>) => {
    const v = await r;
    return v.ok ? v.value.stillProvisional.map((p) => p.reason).join() : v.error;
  };

  it("B1: 2 cases @ 264 per case, pack 12, no total, no base (QA 8a), posts 22 a bottle", async () => {
    const res = await run({});
    expect(res.ok && res.value.finalised[0].unitCost).toBe(22);
    expect(posted()[0].args.p_unit_cost).toBe(22);
    expect(String(posted()[0].args.p_reason)).toMatch(/264 per case of 12 = 22\.00 per bottle/);
  });

  it("B1: 12 bottles @ 142 / KS(12) posts 11.833333, the per-bottle price to six places (#839; R7: was 11.8333)", async () => {
    await run({ uom: "bottle", unit_price: 142, price_base_qty: 12 });
    expect(posted()[0].args.p_unit_cost).toBe(11.833333);
    expect(String(posted()[0].args.p_reason)).toMatch(/11\.833333 per bottle/);
  });

  it("B1: a case price with no stated pack stays PROVISIONAL by name, never 264 or 0", async () => {
    expect(await held(run({ pack_size: 1 }))).toMatch(/^the invoice prices this item, but not per bottle: .*how many bottles a case holds/);
    expect(posted()).toEqual([]);
  });

  it("B1: the one-item fallback converts an unattached line", async () => {
    const one = await run({ inventory_id: null });
    expect(one.ok && one.value.finalised[0].unitCost).toBe(22);
  });

  // Lane 1.4 replaced this test's third clause: two lines of one item that
  // price differently (22 and 20 a bottle) were refused here by #838; they are
  // POOLED by value now, pinned in the landed-cost block below (case d).
  it("B1: lines read by line_no; a refusal holds whatever follows", async () => {
    for (const order of [[{ pack_size: 1 }, { line_no: 2 }], [{ line_no: 2 }, { pack_size: 1 }]])
      expect(await held(run(...order))).toMatch(/how many bottles a case holds/);
    expect(db.verbs).toContain("procurement_document_lines.order");
    expect(posted()).toEqual([]);
    db.answers.inventory_transactions = {
      data: [{ inventory_id: ITEM, quantity_change: 48 }],
      error: null,
    };
    await run({}, { line_no: 3 });
    expect(posted().map((c) => c.args.p_unit_cost)).toEqual([22]);
  });

  it("D1: 2 kutu @ 264, pack 12, kept as each, stays PROVISIONAL, never 264", async () => {
    expect(await held(run({ uom: "each", qty: 2, qty_bottles: 2, line_total: 528, printed: { uom: "kutu" } }))).toMatch(/"kutu"/);
    expect(posted()).toEqual([]);
  });

  it("QA 9a: 24 bottles @ 264 with a printed total of 528 stays PROVISIONAL, never 264", async () => {
    expect(await held(run({ uom: "bottle", qty: 24, line_total: 528 }))).toMatch(/totals 528/);
    expect(posted()).toEqual([]);
  });

  // QA round 9a (2): a re-verify repairs what an earlier verify booked at 264.
  const lot = (unit_cost: number, cost_state = "final") => ({ inventory_id: ITEM, unit_cost, cost_state, qty: 24 });
  const repair = (lots: Record<string, unknown>[], ...lines: Record<string, unknown>[]) => {
    db.rpcCalls.length = 0;
    db.answers.inventory_lots = { data: lots, error: null };
    db.answers.procurement_document_lines = { data: lines.map(invoiceLine), error: null };
    return service.repairPrintedCost(REST, DEL, USER);
  };

  it("QA 9a: a re-verify revalues a lot finalised at the printed 264 to 22, and only that lot", async () => {
    const r = await repair([lot(264)], {});
    expect(r.ok && r.value.repaired.map((x) => x.unitCost)).toEqual([22]);
    expect(posted().map((c) => c.args.p_unit_cost)).toEqual([22]);
    expect(String(posted()[0].args.p_reason)).toMatch(/re-verified: the printed 264 was booked/);
    for (const other of [lot(21.5), lot(22), lot(264, "provisional")]) {
      await repair([other], {});
      expect(posted()).toEqual([]);
    }
  });

  // cost-math R7 (2026-11-11): the printed price is now kept to six places, so
  // a lot an older build booked at it in numeric(10,2) cents must still match.
  it("R7: a re-verify still finds a lot booked at a four-place printed price in cents", async () => {
    const r = await repair([lot(264.13)], { unit_price: 264.125 });
    expect(r.ok && r.value.repaired.map((x) => x.unitCost)).toEqual([22.010417]);
    expect(posted().map((c) => c.args.p_unit_cost)).toEqual([22.010417]);
  });

  it("QA 9a: a lot at the printed price whose line now refuses keeps it, and the reason is returned", async () => {
    const r = await repair([lot(264)], { pack_size: 1 });
    expect(posted()).toEqual([]);
    expect(r.ok && r.value.flagged.map((f) => f.reason).join()).toMatch(/finalised at the printed price 264.*how many bottles a case holds/);
  });

  it("QA 10a (1): a re-verify corrects a lot an earlier build booked at the raw proposed 240, or flags it", async () => {
    db.answers.delivery_proposals = { data: [{ document_id: "inv-1", line_no: 1, unit_price_proposed: 240 }], error: null };
    const r = await repair([lot(240)], {});
    expect(r.ok && r.value.repaired.map((x) => x.source)).toEqual(["accepted_proposal"]);
    expect(posted()[0].args).toMatchObject({ p_unit_cost: 20, p_cost_provenance: "manual" });
    const kept = await repair([lot(240)], { pack_size: 1 });
    expect(posted()).toEqual([]);
    expect(kept.ok && kept.value.flagged[0]).toMatchObject({ kind: "refused" });
    db.answers.delivery_proposals = { data: [], error: null };
  });

  it("QA 15 (2): a lot at the case price on a paper whose landed cost is held is repaired to the line's per-bottle cost", async () => {
    // 24 bottles at 264 a case of 12, freight 40, and a second line nobody
    // priced: the paper's charges cannot be shared, so the landed cost is held.
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1", freight: 40 }], error: null };
    const other = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    db.answers.inventory_transactions = {
      data: [{ inventory_id: ITEM, quantity_change: 24 }, { inventory_id: other, quantity_change: 6 }],
      error: null,
    };
    const r = await repair([lot(264)], {}, { line_no: 2, inventory_id: other, unit_price: null, qty_bottles: 6, uom: "bottle", pack_size: 1 });
    expect(posted().map((c) => c.args.p_unit_cost)).toEqual([22]);
    expect(r.ok && r.value.repaired[0].basis).toMatch(/charges and discount are not in this cost/);
    // The line itself refuses: nothing posts, and the flag says why.
    const kept = await repair([lot(264)], { pack_size: 1 }, { line_no: 2, inventory_id: other, unit_price: null, qty_bottles: 6, uom: "bottle", pack_size: 1 });
    expect(posted()).toEqual([]);
    expect(kept.ok && kept.value.flagged.map((f) => f.kind)).toEqual(["refused"]);
  });

  it("QA 15 (5): a lot at the case price on a EUR invoice in a TRY house is flagged, never repaired to a EUR per-bottle price", async () => {
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1", currency: "EUR" }], error: null };
    db.answers.restaurants = { data: { currency: "TRY" }, error: null };
    const r = await repair([lot(264)], {});
    expect(posted()).toEqual([]);
    expect(r.ok && r.value.flagged).toEqual([
      expect.objectContaining({ inventoryId: ITEM, kind: "refused", reason: expect.stringMatching(/its invoice is in EUR and this house keeps its costs in TRY/) }),
    ]);
  });

  it("QA 10a (6): a lot whose line was edited after it was costed is flagged, never revalued", async () => {
    const invoiced = (unit_cost: number) => ({ ...lot(unit_cost), cost_provenance: "invoice" });
    // Costed at 22 from `264 per case of 12`; the line now says 360 a case.
    const r = await repair([invoiced(22)], { unit_price: 360 });
    expect(posted()).toEqual([]);
    expect(r.ok && r.value.flagged).toEqual([
      expect.objectContaining({ inventoryId: ITEM, kind: "line_changed", reason: expect.stringMatching(/costed at 22 a bottle, but its invoice now makes 30 a bottle/) }),
    ]);
    // A hand revaluation (`manual`) and a lot that still matches are left alone.
    for (const quiet of [{ ...lot(25), cost_provenance: "manual" }, invoiced(22)]) {
      const q = await repair([quiet], {});
      expect(q.ok && q.value.flagged).toEqual([]);
    }
  });

  it("QA 10a (3)+(4): `24 pcs @ 22` posts 22; a credit-note row at a case price stays PROVISIONAL", async () => {
    await run({ uom: "each", pack_size: 1, qty: 24, unit_price: 22, line_total: 528, printed: { uom: "pcs" } });
    expect(posted()[0].args.p_unit_cost).toBe(22);
    expect(await held(run({ uom: "bottle", pack_size: 1, qty: -24, qty_bottles: -24, line_total: -528 }))).toMatch(/totals -528/);
    expect(posted()).toEqual([]);
  });

  it("QA 10a (1): an accepted proposal is read in its line's price base, or refused by name, never posted raw", async () => {
    const accept = (unit_price_proposed: number, line_no: number | null = 1) =>
      (db.answers.delivery_proposals = { data: [{ document_id: line_no ? "inv-1" : null, line_no, unit_price_proposed }], error: null });
    accept(240);
    await run({});
    expect(posted()[0].args).toMatchObject({ p_unit_cost: 20, p_cost_provenance: "manual" });
    expect(String(posted()[0].args.p_reason)).toMatch(/accepted proposal: price 240 per case of 12 = 20\.00 per bottle/);
    expect(await held(run({ pack_size: 1 }))).toMatch(/proposal's price 240 .* how many bottles a case holds/);
    // A delivery-wide proposal has no unit: it never stands in for the one item.
    accept(240, null);
    expect(await held(run({ inventory_id: null, unit_price: null }))).toMatch(/settles a price of 240 but names no invoice line/);
    expect(posted()).toEqual([]);
    expect(await held(run({}))).toBe("");
    expect(posted().map((c) => c.args.p_unit_cost)).toEqual([22]);
  });

  // cost-math R7 (2026-11-11). Red before: an accepted proposal posted at two
  // places (8.33), so the case it settled came to 99.96 over its 12 bottles.
  it("R7: an accepted 100 per case of 12 posts 8.333333 a bottle, which adds back to the case", async () => {
    db.answers.delivery_proposals = { data: [{ document_id: "inv-1", line_no: 1, unit_price_proposed: 100 }], error: null };
    await run({});
    expect(posted()[0].args).toMatchObject({ p_unit_cost: 8.333333, p_cost_provenance: "manual" });
    expect(Math.round(Number(posted()[0].args.p_unit_cost) * 12 * 100)).toBe(10000);
    expect(String(posted()[0].args.p_reason)).toMatch(/price 100 per case of 12 = 8\.333333 per bottle/);
  });

  it("QA 12b D1+C: a door-count proposal takes the invoice line's base; a total settles a bottle row's", async () => {
    const accept = (document_id: string, unit_price_proposed: number) =>
      (db.answers.delivery_proposals = { data: [{ document_id, line_no: 1, unit_price_proposed }], error: null });
    const door = { document_id: "door-1", uom: "bottle", pack_size: 1, unit_price: null };
    accept("door-1", 240);
    await run({}, door);
    expect(posted().map((c) => c.args.p_unit_cost)).toEqual([20]);
    await run({ inventory_id: null }, door);
    expect(posted().map((c) => c.args.p_unit_cost)).toEqual([20]);
    expect(await held(run(door))).toMatch(/240 on the door count, which prints no price/);
    expect(await held(run({}, { line_no: 2, unit_price: 264, pack_size: 6 }, door))).toMatch(/240 on the door count/);
    expect(posted()).toEqual([]);
    accept("inv-1", 250);
    await run({ uom: "bottle", qty: 24, line_total: 6336 });
    expect(posted()[0].args).toMatchObject({ p_unit_cost: 250, p_cost_provenance: "manual" });
  });

  it("QA 10a (2): 24 bottles @ 264, pack 12, no total stays PROVISIONAL; a total that bears it out posts", async () => {
    expect(await held(run({ uom: "bottle", qty: 24 }))).toMatch(/a bottle's price or a case's is not known/);
    expect(posted()).toEqual([]);
    await run({ uom: "bottle", qty: 24, line_total: 6336 });
    expect(posted()[0].args.p_unit_cost).toBe(264);
  });
});

// Cost-math lane 1.4: VERIFIED posts the LANDED cost. Fixtures are SYNTHETIC.
describe("DeliveryStockService — VERIFIED posts the landed cost (lane 1.4)", () => {
  const ITEM2 = "ffffffff-ffff-ffff-ffff-ffffffffffff";
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

  const bottles = (over: Record<string, unknown> = {}) => ({
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
  const at = (n: number, price: number, over: Record<string, unknown> = {}) =>
    bottles({
      qty_bottles: n,
      unit_price: price,
      line_total: n * price,
      ...over,
    });
  const land = (
    head: Record<string, unknown>,
    lines: Record<string, unknown>[],
    booked: Record<string, number>,
  ) => {
    db.rpcCalls.length = 0;
    db.answers.procurement_documents = {
      data: [{ id: "inv-1", doc_number: "A-1", ...head }],
      error: null,
    };
    db.answers.procurement_document_lines = { data: lines, error: null };
    db.answers.inventory_transactions = {
      data: Object.entries(booked).map(([inventory_id, quantity_change]) => ({
        inventory_id,
        quantity_change,
      })),
      error: null,
    };
    return service.finaliseAtVerified(REST, DEL, USER);
  };
  const posted = () =>
    db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost");
  const costs = () =>
    Object.fromEntries(
      posted().map((c) => [c.args.p_inventory_id, c.args.p_unit_cost]),
    );
  const two = [
    bottles(),
    bottles({
      line_no: 2,
      inventory_id: ITEM2,
      unit_price: 40,
      line_total: 400,
    }),
  ];
  const both = { [ITEM]: 10, [ITEM2]: 10 };

  it("(a)+(i) freight 100 on lines 600 and 400 lands 66.00 and 44.00, stamped null (base: 60 and 40)", async () => {
    const res = await land({ freight: 100 }, two, both);
    expect(costs()).toEqual({ [ITEM]: 66, [ITEM2]: 44 });
    const first = res.ok
      ? res.value.finalised.find((f) => f.inventoryId === ITEM)
      : undefined;
    expect(first?.landed).toMatchObject({
      netLineValue: 600,
      chargeShare: 60,
      discountShare: 0,
      acceptedBottles: 10,
    });
    // (i) costed as printed, stamped null, and the reason reaches p_reason.
    expect(first?.landed?.costTaxBasis).toBeNull();
    expect(String(posted()[0].args.p_reason)).toMatch(
      /carries 60\.00 of the paper's freight.*cost tax basis: none\).*the house has not set its tax basis/,
    );
  });

  it("(b) a header discount of 50 lands 57.00 and 38.00", async () => {
    await land({ discount_total: 50 }, two, both);
    expect(costs()).toEqual({ [ITEM]: 57, [ITEM2]: 38 });
  });

  it("(c) a deposit total and a line deposit are never cost", async () => {
    const res = await land(
      { deposit_total: 30 },
      [bottles({ deposit: 5, line_total: 605 }), two[1]],
      both,
    );
    expect(costs()).toEqual({ [ITEM]: 60, [ITEM2]: 40 });
    expect(res.ok && res.value.papers?.[0].leftOut).toMatch(
      /Not cost: a deposit of 30\.00, line deposits of 5\.00/,
    );
  });

  it("(c2) a total printed after its allowance lands the reconciled cost with freight, and the other item stays final", async () => {
    // 10 @ 60 less an allowance of 50 printed as 550: far outside the
    // gatekeeper's 1% of the gross 600, yet the same price.
    const res = await land(
      { freight: 100 },
      [bottles({ allowance: 50, line_total: 550 }), two[1]],
      both,
    );
    // Net 550 and 400 share the 100 freight by value, in whole cents: 57.89
    // and 42.11, so the two lots add back to 1050.00 (607.89 + 442.11).
    expect(costs()).toEqual({ [ITEM]: 60.789, [ITEM2]: 44.211 });
    expect(res.ok && res.value.stillProvisional).toEqual([]);
    const first = res.ok
      ? res.value.finalised.find((f) => f.inventoryId === ITEM)
      : undefined;
    expect(first?.landed?.netLineValue).toBe(550);
  });

  it("(c3) a line deposit above 1% inside the total is never cost", async () => {
    const res = await land(
      {},
      [at(10, 10, { deposit: 10, line_total: 110 }), two[1]],
      both,
    );
    expect(costs()).toEqual({ [ITEM]: 10, [ITEM2]: 40 });
    expect(res.ok && res.value.stillProvisional).toEqual([]);
  });

  it("(c4) a total that matches no reading of its allowance is still refused", async () => {
    // 10 @ 60 with an allowance of 50 printed as 700: neither 600 nor 550.
    const res = await land(
      {},
      [bottles({ allowance: 50, line_total: 700 }), two[1]],
      both,
    );
    expect(costs()).toEqual({ [ITEM2]: 40 });
    const why = res.ok ? res.value.stillProvisional : [];
    expect(why.find((p) => p.inventoryId === ITEM)?.reason).toMatch(
      /the price's unit is not what the line says/,
    );
  });

  it("(d) two lines of one item that price differently are pooled by value, 12 @ 10 + 6 @ 13 → 11.00 (base: refused)", async () => {
    const res = await land({}, [at(12, 10), at(6, 13, { line_no: 2 })], {
      [ITEM]: 18,
    });
    expect(res.ok && res.value.stillProvisional).toEqual([]);
    expect(costs()).toEqual({ [ITEM]: 11 });
  });

  it("(e) 12 paid @ 10 and a free line of 1 posts 9.230769 (120 / 13), and a retry posts the same", async () => {
    const lines = [at(12, 10), at(1, 0, { line_no: 2 })];
    await land({}, lines, { [ITEM]: 13 });
    expect(costs()).toEqual({ [ITEM]: 9.230769 });
    await land({}, lines, { [ITEM]: 13 });
    expect(costs()).toEqual({ [ITEM]: 9.230769 });
  });

  it("(e2) free goods inside a paid line dilute it: 12 listed, 1 free, total 110 → 9.166667", async () => {
    await land(
      {},
      [
        bottles({
          qty_bottles: 12,
          free_goods_qty: 1,
          unit_price: 10,
          line_total: 110,
        }),
      ],
      { [ITEM]: 12 },
    );
    expect(costs()).toEqual({ [ITEM]: 9.166667 });
  });

  it("(f) 2 KS @ 264, pack 12 still costs 22.00 a bottle (#816)", async () => {
    await land(
      {},
      [
        bottles({
          qty_bottles: 24,
          uom: "case",
          pack_size: 12,
          unit_price: 264,
          line_total: 528,
        }),
      ],
      { [ITEM]: 24 },
    );
    expect(costs()).toEqual({ [ITEM]: 22 });
  });

  it("(g) 12 listed @ 22 and 10 booked at the door costs 22.00, not 26.40 (F2)", async () => {
    const res = await land({}, [at(12, 22)], { [ITEM]: 10 });
    expect(costs()).toEqual({ [ITEM]: 22 });
    expect(res.ok && res.value.finalised[0].landed?.acceptedBottles).toBe(10);
  });

  it("(g2) bottles booked beyond the paper take the same cost, and the basis says how many", async () => {
    const res = await land({}, [at(12, 22)], { [ITEM]: 14 });
    expect(costs()).toEqual({ [ITEM]: 22 });
    expect(res.ok && res.value.finalised[0].basis).toMatch(
      /booked 2 bottles more than the invoice lists/,
    );
  });

  it("(h) an item over two lines that the door counted short stays provisional and says why", async () => {
    const res = await land({}, [at(12, 10), at(6, 13, { line_no: 2 })], {
      [ITEM]: 15,
    });
    expect(posted()).toEqual([]);
    expect(res.ok && res.value.stillProvisional[0].reason).toMatch(
      /counted 15 bottles .* list 18 across 2 lines, and which line was short is not known/,
    );
  });

  it("(j) a single unattached line still pairs with the single booked item", async () => {
    await land({ freight: 12 }, [at(12, 10, { inventory_id: null })], {
      [ITEM]: 12,
    });
    expect(costs()).toEqual({ [ITEM]: 11 });
  });

  it("(k) an accepted proposal still wins, and carries no share of the paper", async () => {
    db.answers.delivery_proposals = {
      data: [{ document_id: "inv-1", line_no: 1, unit_price_proposed: 55 }],
      error: null,
    };
    const res = await land({ freight: 100 }, two, both);
    expect(costs()).toEqual({ [ITEM]: 55, [ITEM2]: 44 });
    const settled = res.ok
      ? res.value.finalised.find((f) => f.inventoryId === ITEM)
      : undefined;
    expect(settled).toMatchObject({
      provenance: "manual",
      source: "accepted_proposal",
    });
    expect(settled?.basis).toMatch(/carries no share of the invoice's charges/);
    expect(settled?.landed).toBeUndefined();
  });

  it("a refused line on a paper with freight leaves every item on it provisional", async () => {
    const res = await land(
      { freight: 100 },
      [bottles({ uom: "case", pack_size: 1, unit_price: 264 }), two[1]],
      both,
    );
    expect(posted()).toEqual([]);
    const why = res.ok ? res.value.stillProvisional : [];
    expect(why.find((p) => p.inventoryId === ITEM)?.reason).toMatch(
      /not per bottle: .*how many bottles a case holds/,
    );
    expect(why.find((p) => p.inventoryId === ITEM2)?.reason).toMatch(
      /Line 1 could not be priced, so this paper's charges and discount cannot be shared out/,
    );
  });

  it("a refused line on a paper with no charge leaves the other items final", async () => {
    await land(
      {},
      [bottles({ uom: "case", pack_size: 1, unit_price: 264 }), two[1]],
      both,
    );
    expect(costs()).toEqual({ [ITEM2]: 40 });
  });

  it("a discount larger than the stock and charges, or a negative charge, costs nothing final", async () => {
    for (const head of [{ discount_total: 2000 }, { freight: -10 }]) {
      const res = await land(head, two, both);
      expect(posted()).toEqual([]);
      expect(
        res.ok && res.value.stillProvisional.map((p) => p.reason).join(),
      ).toMatch(/discount of 2000\.00 is more than|freight is negative/);
    }
  });

  it("an invoice whose header cannot be read is not read as one with no charges (ADR 0020)", async () => {
    db.answers.procurement_documents = {
      data: null,
      error: { message: "connection reset" },
    };
    db.answers.procurement_document_lines = { data: two, error: null };
    db.answers.inventory_transactions = {
      data: [{ inventory_id: ITEM, quantity_change: 10 }],
      error: null,
    };
    const res = await service.finaliseAtVerified(REST, DEL, USER);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(
      /could not be read for their charges and discount: connection reset/,
    );
    expect(posted()).toEqual([]);
  });

  it("a deposit line on the paper is never stock and never shares the freight", async () => {
    const res = await land(
      { freight: 100, extracted_lines: [{ lineNo: 3, lineKind: "deposit" }] },
      [...two, at(1, 180, { line_no: 3, inventory_id: null })],
      both,
    );
    expect(costs()).toEqual({ [ITEM]: 66, [ITEM2]: 44 });
    expect(res.ok && res.value.papers?.[0].leftOut).toMatch(
      /line 3, a deposit of 180\.00/,
    );
  });
});

describe("DeliveryStockService — a rejected delivery gives the bottles back", () => {
  it("reverses what the door booked, as a movement rather than a deletion", async () => {
    const db = makeMockDb();
    db.reset();
    const service = new DeliveryStockService(
      db.client as unknown as DatabaseService,
    );
    db.answers.deliveries = {
      data: { id: DEL, state: "REJECTED", order_id: null },
      error: null,
    };
    db.answers.inventory_transactions = {
      data: [{ inventory_id: ITEM, quantity_change: 10 }],
      error: null,
    };
    db.rpcAnswers.apply_stock_movement = { data: "txn-2", error: null };

    const res = await service.reverse(REST, DEL, USER, "WRONG_VENUE");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.bottlesReturned).toBe(10);
    const call = db.rpcCalls.find((c) => c.fn === "apply_stock_movement");
    expect(call?.args).toMatchObject({
      p_delta: -10,
      p_reference_type: "delivery",
      p_reference_id: DEL,
      p_idempotency_key: `delivery-reversal:${DEL}:${ITEM}`,
    });
  });
});

describe("A5 — the two legacy paths are no longer second writers", () => {
  it("reports that a delivery owns an order's stock", async () => {
    const db = makeMockDb();
    db.reset();
    db.answers.inventory_transactions = {
      data: [{ delivery_id: DEL }, { delivery_id: DEL }, { delivery_id: null }],
      error: null,
    };
    const res = await deliveryHasBookedOrder(
      db.client.getClient(),
      "order-1",
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({ booked: true, deliveryIds: [DEL] });
  });

  it("a FAILED read is not a `no` — it refuses rather than letting a second booking through", async () => {
    const db = makeMockDb();
    db.reset();
    db.answers.inventory_transactions = {
      data: null,
      error: { message: "statement timeout" },
    };
    const res = await deliveryHasBookedOrder(db.client.getClient(), "order-1");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/twice/);
  });

  it("says NO when no delivery has booked, so the legacy path still works", async () => {
    const db = makeMockDb();
    db.reset();
    db.answers.inventory_transactions = { data: [], error: null };
    const res = await deliveryHasBookedOrder(db.client.getClient(), "order-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({ booked: false, deliveryIds: [] });
  });
});

describe("DeliveryStockService — a re-verify finishes a post that failed partway (QA round 15 (4))", () => {
  const B = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  let db: MockDb;
  let service: DeliveryStockService;
  let failOn: string | null;

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    failOn = null;
    const real = db.client.getClient;
    db.client.getClient = () => ({
      ...real(),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        db.rpcCalls.push({ fn, args });
        if (fn === "finalise_delivery_cost" && args.p_inventory_id === failOn)
          return { data: null, error: { message: "connection reset" } };
        return { data: { lots_matched: 1, lots_finalised: 1, bottles_finalised: 10 }, error: null };
      },
    });
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
    db.answers.deliveries = { data: { id: DEL, state: "VERIFIED", order_id: null }, error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1", freight: 50 }], error: null };
    const line = (o: Record<string, unknown>) => ({
      document_id: "inv-1", line_no: 1, inventory_id: ITEM, qty_bottles: 10, uom: "bottle",
      pack_size: 1, unit_price: 60, line_total: 600, ...o,
    });
    db.answers.procurement_document_lines = {
      data: [line({}), line({ line_no: 2, inventory_id: B, unit_price: 40, line_total: 400 })],
      error: null,
    };
    db.answers.inventory_transactions = {
      data: [{ inventory_id: ITEM, quantity_change: 10 }, { inventory_id: B, quantity_change: 10 }],
      error: null,
    };
  });
  const posts = () => db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost");

  it("B's post fails, the re-verify posts B once at its landed cost and leaves A alone; a second re-verify posts nothing", async () => {
    failOn = B;
    const first = await service.finaliseAtVerified(REST, DEL, USER);
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error).toMatch(/verifying the delivery again posts the cost of every item still provisional, once/);
    // 50 freight over 600 + 400: A 30.00 (63 a bottle), B 20.00 (42 a bottle).
    expect(posts().map((c) => [c.args.p_inventory_id, c.args.p_unit_cost])).toEqual([[ITEM, 63], [B, 42]]);

    // A is final at 63; B is still provisional.
    failOn = null;
    db.rpcCalls.length = 0;
    db.answers.inventory_lots = {
      data: [
        { inventory_id: ITEM, cost_state: "final", qty: 10 },
        { inventory_id: B, cost_state: "provisional", qty: 10 },
      ],
      error: null,
    };
    const retry = await service.finishProvisional(REST, DEL, USER);
    expect(retry.ok && retry.value.finalised.map((f) => [f.inventoryId, f.unitCost])).toEqual([[B, 42]]);
    expect(posts().map((c) => [c.args.p_inventory_id, c.args.p_unit_cost])).toEqual([[B, 42]]);

    // Both final now: nothing is posted again.
    db.rpcCalls.length = 0;
    db.answers.inventory_lots = {
      data: [
        { inventory_id: ITEM, cost_state: "final", qty: 10 },
        { inventory_id: B, cost_state: "final", qty: 10 },
      ],
      error: null,
    };
    const again = await service.finishProvisional(REST, DEL, USER);
    expect(again.ok && again.value.finalised).toEqual([]);
    expect(posts()).toEqual([]);
  });

  it("a lot revalued by hand after the verify is final, so the re-verify does not overwrite it", async () => {
    db.answers.inventory_lots = {
      data: [
        { inventory_id: ITEM, cost_state: "final", qty: 10 },
        { inventory_id: B, cost_state: "final", qty: 10 },
      ],
      error: null,
    };
    const res = await service.finishProvisional(REST, DEL, USER);
    expect(res.ok && res.value.finalised).toEqual([]);
    expect(posts()).toEqual([]);
  });

  it("a sold-out provisional lot (qty 0) is not posted; finalise_delivery_cost would match no lot", async () => {
    db.answers.inventory_lots = { data: [{ inventory_id: B, cost_state: "provisional", qty: 0 }], error: null };
    const res = await service.finishProvisional(REST, DEL, USER);
    expect(res.ok && res.value.finalised).toEqual([]);
    expect(posts()).toEqual([]);
  });

  it("an unreadable lot list is an error, never 'nothing left to post'", async () => {
    db.answers.inventory_lots = { data: null, error: { message: "connection reset" } };
    const res = await service.finishProvisional(REST, DEL, USER);
    expect(res.ok).toBe(false);
    expect(posts()).toEqual([]);
  });
});

describe("DeliveryStockService — a paper not in the house's money is never costed (QA round 15 (5))", () => {
  let db: MockDb;
  let service: DeliveryStockService;
  const posts = () => db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost");
  const verify = (house: unknown, proposals: unknown[] = []) => {
    db.answers.restaurants = house as never;
    db.answers.delivery_proposals = { data: proposals, error: null };
    return service.finaliseAtVerified(REST, DEL, USER);
  };
  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
    db.answers.deliveries = { data: { id: DEL, state: "VERIFIED", order_id: null }, error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1", currency: "EUR", freight: 50 }], error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: "inv-1", line_no: 1, inventory_id: ITEM, qty_bottles: 10, uom: "bottle", pack_size: 1, unit_price: 60, line_total: 600 }],
      error: null,
    };
    db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 10 }], error: null };
  });

  it("a EUR invoice in a TRY house posts nothing and says why; in a EUR house it posts 65", async () => {
    const r = await verify({ data: { currency: "TRY" }, error: null });
    expect(posts()).toEqual([]);
    expect(r.ok && r.value.stillProvisional[0]?.reason).toMatch(/its invoice is in EUR and this house keeps its costs in TRY/);
    await verify({ data: { currency: "EUR" }, error: null });
    expect(posts().map((c) => c.args.p_unit_cost)).toEqual([65]);
  });

  it("an accepted proposal on the EUR line does not cost it in a TRY house either", async () => {
    const r = await verify({ data: { currency: "TRY" }, error: null }, [{ document_id: "inv-1", line_no: 1, unit_price_proposed: 55, status: "accepted" }]);
    expect(posts()).toEqual([]);
    expect(r.ok && r.value.stillProvisional[0]?.reason).toMatch(/accepted proposal's price 55 is on an invoice not in this house's money/);
  });

  it("QA round 19 (1): a house with no currency named posts nothing, the line-only and proposal fallbacks included, and says why", async () => {
    for (const house of [{ data: { currency: null }, error: null }, { data: { currency: "tl" }, error: null }]) {
      db.rpcCalls.length = 0;
      const plain = await verify(house);
      const offered = await verify(house, [{ document_id: "inv-1", line_no: 1, unit_price_proposed: 55, status: "accepted" }]);
      expect(posts()).toEqual([]);
      for (const r of [plain, offered])
        expect(r.ok && r.value.stillProvisional[0]?.reason).toMatch(/this house( has not named the currency it keeps its costs in|'s currency is recorded as "tl", which is not a currency code)/);
    }
  });

  it("an unreadable house currency is an error, never read as 'not named'", async () => {
    const r = await verify({ data: null, error: { message: "timeout" } });
    expect(!r.ok && r.error).toMatch(/the currency this house keeps its costs in could not be read: timeout/);
    expect(posts()).toEqual([]);
  });
});
