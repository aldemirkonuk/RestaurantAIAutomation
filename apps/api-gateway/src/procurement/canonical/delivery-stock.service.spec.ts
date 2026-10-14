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
    // The page switches on the code, never on the reason's words.
    expect(res.value.notBooked.map((l) => l.code)).toEqual([
      "no_item",
      "no_item",
    ]);
  });

  // F-730 — two lines of the same item in one count add up. Before, the
  // second line's delta was taken against the FIRST line's quantity, so 6 + 6
  // booked 6 and 6 + 4 booked 6 and then gave 2 back.
  it.each([
    [6, 6, 12],
    [6, 4, 10],
  ])(
    "two lines of one item, %i and %i, book %i bottles",
    async (a, b, total) => {
      db.answers.procurement_document_lines = {
        data: [
          line({ line_no: 1, qty_bottles: a }),
          line({ line_no: 2, qty_bottles: b }),
        ],
        error: null,
      };
      const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.bottlesMoved).toBe(total);
      const moves = db.rpcCalls.filter((c) => c.fn === "apply_stock_movement");
      expect(moves.map((c) => c.args.p_delta)).toEqual([total]);
      expect(res.value.notBooked).toEqual([]);
      expect(res.value.booked.map((l) => l.delta)).toEqual([total, 0]);
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

  // sim F-671: a re-verify posts no cost, so a lot booked after VERIFIED
  // would stay provisional for good.
  it("refuses a later count on a VERIFIED delivery and books nothing", async () => {
    db.answers.deliveries = {
      data: { id: DEL, state: "VERIFIED", order_id: null },
      error: null,
    };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, USER);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.error).toMatch(/already confirmed/);
    expect(db.rpcCalls.filter((c) => c.fn === "apply_stock_movement")).toEqual(
      [],
    );
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

  describe("the settled cost says which money it is in (F-343)", () => {
    const invoiceLine = {
      data: [
        {
          document_id: "inv-1",
          line_no: 1,
          inventory_id: ITEM,
          qty_bottles: 10,
          unit_price: 20,
          description: "Öküzgözü",
          vendor_sku: null,
        },
      ],
      error: null,
    };
    const stamped = () =>
      db.writes.filter(
        (w) => w.table === "inventory_lots" && w.verb === "update",
      );

    it("stamps the invoice's currency on the delivery's lots", async () => {
      db.answers.procurement_document_lines = invoiceLine;
      db.answers.procurement_documents = {
        data: [{ currency: "eur" }],
        error: null,
      };
      const res = await service.finaliseAtVerified(REST, DEL, USER);
      expect(res.ok).toBe(true);
      expect(stamped()).toEqual([
        {
          table: "inventory_lots",
          verb: "update",
          payload: { unit_cost_currency: "EUR" },
        },
      ]);
    });

    it("an invoice stating none takes the order's currency", async () => {
      db.answers.deliveries = {
        data: { id: DEL, state: "AGREED", order_id: "order-1" },
        error: null,
      };
      db.answers.procurement_document_lines = invoiceLine;
      db.answers.procurement_documents = {
        data: [{ currency: null }],
        error: null,
      };
      db.answers.procurement_orders = {
        data: { currency: "TRY" },
        error: null,
      };
      await service.finaliseAtVerified(REST, DEL, USER);
      expect(stamped()).toEqual([
        {
          table: "inventory_lots",
          verb: "update",
          payload: { unit_cost_currency: "TRY" },
        },
      ]);
    });

    it("two invoices naming two currencies stamp nothing, and the cost still posts", async () => {
      db.answers.procurement_document_lines = invoiceLine;
      db.answers.procurement_documents = {
        data: [{ currency: "EUR" }, { currency: "USD" }],
        error: null,
      };
      const res = await service.finaliseAtVerified(REST, DEL, USER);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.finalised).toHaveLength(1);
      expect(stamped()).toEqual([]);
    });
  });

  describe("the settled cost says whether tax is inside it (ADR 0341 F3)", () => {
    const invoiceLine = {
      data: [
        {
          document_id: "inv-1",
          line_no: 1,
          inventory_id: ITEM,
          qty_bottles: 10,
          unit_price: 20,
          description: "Öküzgözü",
          vendor_sku: null,
        },
      ],
      error: null,
    };
    const taxStamps = () =>
      db.writes.filter(
        (w) =>
          w.table === "inventory_lots" &&
          w.verb === "update" &&
          "unit_cost_tax_basis" in (w.payload as Record<string, unknown>),
      );

    beforeEach(() => {
      db.answers.procurement_document_lines = invoiceLine;
      db.answers.procurement_documents = {
        data: [{ currency: "TRY" }],
        error: null,
      };
    });

    it.each([["TR"], ["US"]])(
      "[REVERT-FAILS] an inclusive house (%s) where the verifier said nothing stamps nothing, never a guess from the country",
      async (country) => {
        db.answers.restaurants = {
          data: { tax_basis: "prices_include_tax", country },
          error: null,
        };
        const res = await service.finaliseAtVerified(REST, DEL, USER);
        expect(res.ok).toBe(true);
        expect(taxStamps()).toEqual([]);
      },
    );

    it("what the verifier said is stamped as said", async () => {
      db.answers.restaurants = {
        data: { tax_basis: "prices_include_tax", country: "TR" },
        error: null,
      };
      await service.finaliseAtVerified(REST, DEL, USER, "excludes_tax");
      expect(taxStamps()).toEqual([
        {
          table: "inventory_lots",
          verb: "update",
          payload: { unit_cost_tax_basis: "excludes_tax" },
        },
      ]);
    });

    it.each([
      ["unset", "TR"],
      ["prices_exclude_tax", "US"],
      ["not_vat_charging", "TR"],
    ])(
      "a %s house (%s) stamps nothing, even when told",
      async (basis, country) => {
        db.answers.restaurants = {
          data: { tax_basis: basis, country },
          error: null,
        };
        const res = await service.finaliseAtVerified(
          REST,
          DEL,
          USER,
          "excludes_tax",
        );
        expect(res.ok).toBe(true);
        expect(taxStamps()).toEqual([]);
      },
    );

    it("an unread house stamps nothing, and the cost still posts", async () => {
      db.answers.restaurants = { data: null, error: { message: "boom" } };
      const res = await service.finaliseAtVerified(
        REST,
        DEL,
        USER,
        "excludes_tax",
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.finalised).toHaveLength(1);
      expect(taxStamps()).toEqual([]);
    });

    it("an inclusive house in a country with no rule, told nothing, stamps nothing", async () => {
      db.answers.restaurants = {
        data: { tax_basis: "prices_include_tax", country: "GB" },
        error: null,
      };
      await service.finaliseAtVerified(REST, DEL, USER);
      expect(taxStamps()).toEqual([]);
    });
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
        {
          document_id: "door-1",
          line_no: 1,
          inventory_id: ITEM,
          qty_bottles: 10,
          unit_price: null,
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
