import { DatabaseService } from "../../database/database.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { DeliveryService } from "./delivery.service";
import { DeliveryClockService } from "./delivery-clock.service";
import { makeMockDb, makeMockNotifications, MockDb } from "./delivery-mock";

/**
 * The delivery's doors and its two gates (ADR 0103 D1/D3/D5/D6/D7, A2, A4, A6).
 * All ids are SYNTHETIC.
 *
 * The rules this file exists to hold, one test each:
 *
 *   D5  UNORDERED is a permanent mark decided once, not `order_id is null`.
 *   D7  WRONG_VENUE is a REJECTION and never enters RECONCILING.
 *   D3  AGREED needs both sides on the record — or a signed ticket the vendor's
 *       terms make final — and the record says WHICH rule fired.
 *   D6  VERIFIED needs a named human, comes only from AGREED, and is idempotent.
 *   A4  a document attached to a LAPSED delivery amends it and does not erase
 *       what the law deemed.
 *   A1  NOTHING here writes stock or cost. The assertion is on the write log:
 *       no `inventory_lots`, no `inventory_transactions`, ever.
 */

const REST = "rest-1";
const DEL = "del-1";

function deliveryRow(over: Record<string, unknown> = {}) {
  return {
    id: DEL,
    restaurant_id: REST,
    provider_id: "prov-1",
    order_id: null,
    state: "DELIVERED",
    provenance: "UNORDERED",
    jurisdiction: "TR",
    delivered_at: "2026-08-14T07:41:00Z",
    agreed_at: null,
    agreed_rule: null,
    verified_at: null,
    verified_by: null,
    lapsed_at: null,
    lapse_deemed: null,
    amended_at: null,
    owner_user_id: "u1",
    deputy_user_id: null,
    ...over,
  };
}

describe("DeliveryService", () => {
  let db: MockDb;
  let notifications: ReturnType<typeof makeMockNotifications>;
  let service: DeliveryService;

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    notifications = makeMockNotifications();
    const clocks = new DeliveryClockService(
      db.client as unknown as DatabaseService,
      notifications as unknown as NotificationsService,
    );
    service = new DeliveryService(
      db.client as unknown as DatabaseService,
      clocks,
      notifications as unknown as NotificationsService,
    );
  });

  /** No write ever landed on a stock table. ADR 0103 A1/A5. */
  const assertNoStockWrites = () => {
    const stock = db.writes.filter(
      (w) =>
        w.table === "inventory_lots" ||
        w.table === "inventory_transactions" ||
        w.table === "restaurant_inventory",
    );
    expect(stock).toEqual([]);
  };

  // -------------------------------------------------------------------------
  describe("create — provenance is decided once and is permanent (D5)", () => {
    it("marks a delivery with no order UNORDERED", async () => {
      db.insertAnswers.deliveries = {
        data: deliveryRow({ state: "ORDERED", provenance: "UNORDERED" }),
        error: null,
      };
      const res = await service.create(REST, "u1", {});
      expect(res.ok).toBe(true);
      const write = db.writes.find((w) => w.table === "deliveries");
      expect((write?.payload as { provenance: string }).provenance).toBe(
        "UNORDERED",
      );
      // Nothing arrived yet, so the event is ORDERED — not DELIVERED.
      expect((write?.payload as { state: string }).state).toBe("ORDERED");
      assertNoStockWrites();
    });

    it("marks a delivery that fulfils an order ORDERED, and DELIVERED once a door count is on it", async () => {
      db.answers.procurement_documents = {
        data: [
          {
            id: "doc-count",
            provider_id: "prov-1",
            doc_type: "receiving_advice",
            direction: "issued_by_us",
            extracted: {},
          },
        ],
        error: null,
      };
      db.insertAnswers.deliveries = {
        data: deliveryRow({
          state: "DELIVERED",
          provenance: "ORDERED",
          order_id: "ord-1",
        }),
        error: null,
      };
      const res = await service.create(REST, "u1", {
        orderId: "ord-1",
        documents: [{ documentId: "doc-count", role: "door_count" }],
      });
      expect(res.ok).toBe(true);
      const write = db.writes.find((w) => w.table === "deliveries");
      expect((write?.payload as { provenance: string }).provenance).toBe(
        "ORDERED",
      );
      expect((write?.payload as { state: string }).state).toBe("DELIVERED");
    });

    it("refuses a document belonging to another tenant, and writes nothing", async () => {
      // The document read is scoped by restaurant_id, so another tenant's id
      // simply does not come back — the same shape as a missing one.
      db.answers.procurement_documents = { data: [], error: null };
      const res = await service.create(REST, "u1", {
        documents: [{ documentId: "doc-elsewhere", role: "invoice" }],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(404);
      expect(db.writes.filter((w) => w.table === "deliveries")).toEqual([]);
    });

    it("refuses a role that is not one a document can play", async () => {
      const res = await service.create(REST, "u1", {
        documents: [
          { documentId: "doc-1", role: "receipt" as unknown as "invoice" },
        ],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(400);
      expect(db.writes).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("linkDocument — a late document amends a lapse (A4)", () => {
    it("moves LAPSED to LAPSED_AMENDED and leaves what the law deemed alone", async () => {
      db.answers.deliveries = {
        data: deliveryRow({
          state: "LAPSED",
          lapsed_at: "2026-08-21T00:00:00Z",
          lapse_deemed: "Turkish practice deems this accepted in full.",
        }),
        error: null,
      };
      db.answers.procurement_documents = {
        data: [
          {
            id: "doc-credit",
            provider_id: "prov-1",
            doc_type: "credit_memo",
            direction: "issued_by_vendor",
            extracted: {},
          },
        ],
        error: null,
      };
      db.insertAnswers.document_deliveries = { data: null, error: null };
      db.updateAnswers.deliveries = {
        data: deliveryRow({
          state: "LAPSED_AMENDED",
          lapsed_at: "2026-08-21T00:00:00Z",
          lapse_deemed: "Turkish practice deems this accepted in full.",
          amended_at: "2026-08-25T00:00:00Z",
        }),
        error: null,
      };

      const res = await service.linkDocument(
        REST,
        DEL,
        "doc-credit",
        "credit_memo",
      );
      expect(res.ok).toBe(true);
      const upd = db.writes.find(
        (w) => w.table === "deliveries" && w.verb === "update",
      );
      expect((upd?.payload as { state: string }).state).toBe("LAPSED_AMENDED");
      expect(upd?.payload).toHaveProperty("amended_at");
      // The record of what was deemed on the lapse date is NEVER overwritten.
      expect(upd?.payload).not.toHaveProperty("lapse_deemed");
      expect(upd?.payload).not.toHaveProperty("lapsed_at");
    });

    it("treats a duplicate link as already-linked, not as a failure", async () => {
      db.answers.deliveries = { data: deliveryRow(), error: null };
      db.answers.procurement_documents = {
        data: [
          {
            id: "doc-1",
            provider_id: "prov-1",
            doc_type: "invoice",
            direction: "issued_by_vendor",
            extracted: {},
          },
        ],
        error: null,
      };
      db.insertAnswers.document_deliveries = {
        data: null,
        error: {
          message:
            'duplicate key value violates unique constraint "document_deliveries_pkey"',
        },
      };
      const res = await service.linkDocument(REST, DEL, "doc-1", "invoice");
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.alreadyLinked).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("propose — every contradiction is a row (D7, A5)", () => {
    beforeEach(() => {
      db.answers.deliveries = { data: deliveryRow(), error: null };
      db.insertAnswers.delivery_proposals = {
        data: { id: "prop-1" },
        error: null,
      };
      db.updateAnswers.deliveries = {
        data: deliveryRow({ state: "RECONCILING" }),
        error: null,
      };
    });

    it("opens RECONCILING on a short ship and keeps the reason class", async () => {
      const res = await service.propose(REST, DEL, "u1", {
        side: "restaurant",
        reason: "SHORT_SHIP",
        lineNo: 1,
        qtyProposedBottles: 10,
        moneyAtRisk: 284,
        note: "we counted ten of twelve",
      });
      expect(res.ok).toBe(true);
      const write = db.writes.find((w) => w.table === "delivery_proposals");
      expect(write?.payload).toMatchObject({
        side: "restaurant",
        reason: "SHORT_SHIP",
        line_no: 1,
        qty_proposed: 10,
        money_at_risk: 284,
        status: "open",
        proposed_by: "u1",
      });
      const upd = db.writes.find(
        (w) => w.table === "deliveries" && w.verb === "update",
      );
      expect((upd?.payload as { state: string }).state).toBe("RECONCILING");
    });

    it("REJECTS on WRONG_VENUE and never enters RECONCILING (D7)", async () => {
      db.updateAnswers.deliveries = {
        data: deliveryRow({ state: "REJECTED" }),
        error: null,
      };
      const res = await service.propose(REST, DEL, "u1", {
        side: "restaurant",
        reason: "WRONG_VENUE",
        note: "this is the Kadıköy venue's order",
      });
      expect(res.ok).toBe(true);
      const upd = db.writes.find(
        (w) => w.table === "deliveries" && w.verb === "update",
      );
      expect((upd?.payload as { state: string }).state).toBe("REJECTED");
    });

    it("tells the restaurant when the VENDOR puts a position on the record (D8)", async () => {
      await service.propose(REST, DEL, "u1", {
        side: "vendor",
        reason: "SHORT_SHIP",
        moneyAtRisk: 142,
        note: "credit of 142,00 issued",
      });
      const note = notifications.sent.find(
        (n) => (n.payload as { type: string }).type === "delivery_proposal",
      );
      expect(note).toBeTruthy();
      expect((note?.payload as { title: string }).title).toMatch(
        /vendor proposed/i,
      );
    });

    it("does NOT notify the restaurant about its own position", async () => {
      await service.propose(REST, DEL, "u1", {
        side: "restaurant",
        reason: "SHORT_SHIP",
      });
      expect(
        notifications.sent.filter(
          (n) => (n.payload as { type: string }).type === "delivery_proposal",
        ),
      ).toEqual([]);
    });

    it("refuses a reason class that is not in D7, before writing anything", async () => {
      const res = await service.propose(REST, DEL, "u1", {
        side: "restaurant",
        reason: "LATE" as unknown as "SHORT_SHIP",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(400);
      expect(db.writes).toEqual([]);
    });

    it("refuses a position on a delivery that has already closed", async () => {
      db.answers.deliveries = {
        data: deliveryRow({ state: "VERIFIED" }),
        error: null,
      };
      const res = await service.propose(REST, DEL, "u1", {
        side: "vendor",
        reason: "PRICE_VARIANCE",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(409);
      expect(db.writes.filter((w) => w.table === "delivery_proposals")).toEqual(
        [],
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("accept — a human gate (D6)", () => {
    it("refuses a call with no user rather than attributing it to the system", async () => {
      const res = await service.accept(REST, "prop-1", null);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(403);
        expect(res.error).toMatch(/human gate/i);
      }
      expect(db.writes).toEqual([]);
    });

    it("is idempotent: accepting twice does not move the timestamp", async () => {
      db.answers.delivery_proposals = {
        data: {
          id: "prop-1",
          delivery_id: DEL,
          status: "accepted",
          side: "vendor",
        },
        error: null,
      };
      db.answers.deliveries = { data: deliveryRow(), error: null };
      const res = await service.accept(REST, "prop-1", "u1");
      expect(res.ok).toBe(true);
      expect(db.writes.filter((w) => w.table === "delivery_proposals")).toEqual(
        [],
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("agree — D3, and it says which rule fired", () => {
    const withEvidence = (o: {
      doorCount?: boolean;
      signedDoorCount?: boolean;
      vendorDoc?: boolean;
      proposals?: { side: string; status: string }[];
      signedFinal?: boolean;
    }) => {
      const links: { document_id: string; role: string }[] = [];
      const docs: Record<string, unknown>[] = [];
      if (o.doorCount || o.signedDoorCount) {
        links.push({ document_id: "doc-count", role: "door_count" });
        docs.push({
          id: "doc-count",
          provider_id: "prov-1",
          doc_type: "receiving_advice",
          direction: "issued_by_us",
          extracted: o.signedDoorCount
            ? {
                signature: {
                  signedBy: "Ayşe",
                  signedAt: "2026-08-14T07:41:00Z",
                },
              }
            : {},
        });
      }
      if (o.vendorDoc) {
        links.push({ document_id: "doc-inv", role: "invoice" });
        docs.push({
          id: "doc-inv",
          provider_id: "prov-1",
          doc_type: "invoice",
          direction: "issued_by_vendor",
          extracted: {},
        });
      }
      db.answers.document_deliveries = { data: links, error: null };
      db.answers.procurement_documents = { data: docs, error: null };
      db.answers.delivery_proposals = { data: o.proposals ?? [], error: null };
      db.answers.vendor_terms = {
        data: o.signedFinal
          ? [
              {
                id: "vt-1",
                restaurant_id: null,
                provider_id: "prov-1",
                days: 30,
                basis: "delivery_date",
                signed_ticket_is_final: true,
              },
            ]
          : [],
        error: null,
      };
      db.answers.deliveries = {
        data: deliveryRow({ state: "RECONCILING" }),
        error: null,
      };
    };

    it("refuses with ONLY the restaurant's side, and names what is missing", async () => {
      withEvidence({ doorCount: true });
      const res = await service.agree(REST, DEL, "u1");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(409);
        expect(res.error).toMatch(/vendor's position is not on the record/i);
        // The sentence says silence is not agreement, whatever the law deems.
        expect(res.error).toMatch(/silence is not agreement/i);
      }
      expect(
        db.writes.filter(
          (w) => w.table === "deliveries" && w.verb === "update",
        ),
      ).toEqual([]);
    });

    it("refuses while a proposal is still open", async () => {
      withEvidence({
        doorCount: true,
        vendorDoc: true,
        proposals: [{ side: "restaurant", status: "open" }],
      });
      const res = await service.agree(REST, DEL, "u1");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/still open/i);
    });

    it("fires `both_sides_recorded` when both are on the record and nothing is open", async () => {
      withEvidence({
        doorCount: true,
        vendorDoc: true,
        proposals: [
          { side: "restaurant", status: "accepted" },
          { side: "vendor", status: "accepted" },
        ],
      });
      db.updateAnswers.deliveries = {
        data: deliveryRow({
          state: "AGREED",
          agreed_at: "2026-08-15T10:00:00Z",
          agreed_rule: "both_sides_recorded",
        }),
        error: null,
      };
      const res = await service.agree(REST, DEL, "u1");
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.rule).toBe("both_sides_recorded");
      const upd = db.writes.find(
        (w) => w.table === "deliveries" && w.verb === "update",
      );
      expect(upd?.payload).toMatchObject({
        state: "AGREED",
        agreed_rule: "both_sides_recorded",
        agreed_by: "u1",
      });
      assertNoStockWrites();
    });

    it("fires `signed_ticket_is_final` on a signed door ticket with NO vendor response", async () => {
      withEvidence({ signedDoorCount: true, signedFinal: true });
      db.updateAnswers.deliveries = {
        data: deliveryRow({
          state: "AGREED",
          agreed_rule: "signed_ticket_is_final",
        }),
        error: null,
      };
      const res = await service.agree(REST, DEL, "u1");
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.rule).toBe("signed_ticket_is_final");
    });

    it("does NOT fire the signature rule when the vendor's terms do not make it final", async () => {
      withEvidence({ signedDoorCount: true, signedFinal: false });
      const res = await service.agree(REST, DEL, "u1");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/not set as final/i);
    });

    it("is idempotent — a second agree returns the first rule, unchanged", async () => {
      db.answers.deliveries = {
        data: deliveryRow({
          state: "AGREED",
          agreed_at: "2026-08-15T10:00:00Z",
          agreed_rule: "both_sides_recorded",
        }),
        error: null,
      };
      const res = await service.agree(REST, DEL, "u1");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.alreadyAgreed).toBe(true);
        expect(res.value.rule).toBe("both_sides_recorded");
      }
      expect(
        db.writes.filter(
          (w) => w.table === "deliveries" && w.verb === "update",
        ),
      ).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("verify — D6, and AGREED is never collapsed into it", () => {
    it("refuses a call with no human", async () => {
      db.answers.deliveries = {
        data: deliveryRow({ state: "AGREED" }),
        error: null,
      };
      const res = await service.verify(REST, DEL, null);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(403);
        expect(res.error).toMatch(/human gate/i);
      }
      expect(db.writes).toEqual([]);
    });

    it("refuses from RECONCILING, and says why the two gates are separate", async () => {
      db.answers.deliveries = {
        data: deliveryRow({ state: "RECONCILING" }),
        error: null,
      };
      const res = await service.verify(REST, DEL, "u1");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(409);
        expect(res.error).toMatch(/never collapsed/i);
      }
      expect(
        db.writes.filter(
          (w) => w.table === "deliveries" && w.verb === "update",
        ),
      ).toEqual([]);
    });

    it("verifies from AGREED, records the human, and touches NO stock or cost", async () => {
      db.answers.deliveries = {
        data: deliveryRow({ state: "AGREED" }),
        error: null,
      };
      db.updateAnswers.deliveries = {
        data: deliveryRow({
          state: "VERIFIED",
          verified_at: "2026-08-15T11:00:00Z",
          verified_by: "u1",
        }),
        error: null,
      };
      const res = await service.verify(REST, DEL, "u1");
      expect(res.ok).toBe(true);
      const upd = db.writes.find(
        (w) => w.table === "deliveries" && w.verb === "update",
      );
      expect(upd?.payload).toMatchObject({
        state: "VERIFIED",
        verified_by: "u1",
      });
      // ADR 0103 A1/A5: the door path is still the only writer of stock on this
      // build, and `cost_state` has no writer at all. Verify must not become the
      // first one, marking lots final that nothing marked provisional.
      assertNoStockWrites();
      expect(
        db.writes.some((w) => String(w.payload).includes("cost_state")),
      ).toBe(false);
      if (res.ok)
        expect(res.value.stockUntouched).toMatch(/Nothing was posted/);
    });

    it("is idempotent — a second verify returns the first stamp and writes nothing", async () => {
      db.answers.deliveries = {
        data: deliveryRow({
          state: "VERIFIED",
          verified_at: "2026-08-15T11:00:00Z",
          verified_by: "u1",
        }),
        error: null,
      };
      const res = await service.verify(REST, DEL, "u2");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.alreadyVerified).toBe(true);
        expect(res.value.delivery.verified_by).toBe("u1");
      }
      expect(
        db.writes.filter(
          (w) => w.table === "deliveries" && w.verb === "update",
        ),
      ).toEqual([]);
    });

    it("is a 404 for another tenant's delivery", async () => {
      db.answers.deliveries = { data: null, error: null };
      const res = await service.verify("rest-2", DEL, "u1");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe("a failed read is never an empty answer (ADR 0067)", () => {
    it("fails the proposal thread rather than reporting no disputes", async () => {
      db.answers.deliveries = { data: deliveryRow(), error: null };
      db.answers.delivery_proposals = {
        data: null,
        error: { message: "connection reset" },
      };
      const res = await service.proposalsFor(REST, DEL);
      expect(res.ok).toBe(false);
    });

    it("fails agree rather than agreeing on evidence it could not read", async () => {
      db.answers.deliveries = {
        data: deliveryRow({ state: "RECONCILING" }),
        error: null,
      };
      db.answers.document_deliveries = {
        data: null,
        error: { message: "statement timeout" },
      };
      const res = await service.agree(REST, DEL, "u1");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(500);
      expect(
        db.writes.filter(
          (w) => w.table === "deliveries" && w.verb === "update",
        ),
      ).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("D8 — 'this delivery differs' has a basis, and says which", () => {
    /** A door count of 10 against a vendor document of 12, on one delivery. */
    const withCountAndPaper = () => {
      db.answers.document_deliveries = {
        data: [
          { document_id: "doc-count", role: "door_count" },
          { document_id: "doc-inv", role: "invoice" },
        ],
        error: null,
      };
      db.answers.procurement_document_lines = {
        data: [
          {
            id: "cl-1",
            vendor_sku: null,
            description: "SYNTHETIC Öküzgözü 2021",
            vintage: 2021,
            format_ml: 750,
            qty_bottles: "10",
            unit_price: null,
          },
        ],
        error: null,
      };
    };

    it("compares the DOOR COUNT with the vendor's paperwork when no order preceded it", async () => {
      db.insertAnswers.deliveries = {
        data: deliveryRow({
          state: "DELIVERED",
          provenance: "UNORDERED",
          order_id: null,
        }),
        error: null,
      };
      db.answers.procurement_documents = {
        data: [
          {
            id: "doc-count",
            provider_id: "prov-1",
            doc_type: "receiving_advice",
            direction: "issued_by_us",
            extracted: {},
          },
        ],
        error: null,
      };
      withCountAndPaper();

      const res = await service.create(REST, "u1", {
        documents: [{ documentId: "doc-count", role: "door_count" }],
      });
      expect(res.ok).toBe(true);
      // Both documents' lines come back from the same canned answer, so every
      // counted line pairs with a paper line of the same quantity: compared,
      // and nothing differed. THE POINT IS THE 0, not the number.
      if (res.ok) expect(res.value.differsOnLines).toBe(0);
      // The basis is on the record, so a reader can tell which comparison ran.
      const note = notifications.sent.find(
        (n) => (n.payload as { type: string }).type === "delivery_differs",
      );
      // Nothing differed, so no notification — and `0` said so instead.
      expect(note).toBeUndefined();
    });

    it("reports NULL, never 0, when there is nothing to compare against", async () => {
      db.insertAnswers.deliveries = {
        data: deliveryRow({
          state: "ORDERED",
          provenance: "UNORDERED",
          order_id: null,
        }),
        error: null,
      };
      db.answers.document_deliveries = { data: [], error: null };
      const res = await service.create(REST, "u1", {});
      expect(res.ok).toBe(true);
      // NULL = we did not compare. 0 would say we compared and found nothing,
      // which is the sentence this repository's standing fault is made of.
      if (res.ok) expect(res.value.differsOnLines).toBeNull();
    });

    it("reports NULL rather than 0 when the comparison read FAILS", async () => {
      db.insertAnswers.deliveries = {
        data: deliveryRow({
          state: "DELIVERED",
          provenance: "UNORDERED",
          order_id: null,
        }),
        error: null,
      };
      db.answers.procurement_documents = {
        data: [
          {
            id: "doc-count",
            provider_id: "prov-1",
            doc_type: "receiving_advice",
            direction: "issued_by_us",
            extracted: {},
          },
        ],
        error: null,
      };
      db.answers.document_deliveries = {
        data: null,
        error: { message: "connection reset" },
      };
      const res = await service.create(REST, "u1", {
        documents: [{ documentId: "doc-count", role: "door_count" }],
      });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.differsOnLines).toBeNull();
      expect(
        notifications.sent.filter(
          (n) => (n.payload as { type: string }).type === "delivery_differs",
        ),
      ).toEqual([]);
    });
  });
  // -------------------------------------------------------------------------
  describe("A11 — a difference must be answered before AGREED", () => {
    /**
     * The vendor lens, 2026-09-06 finding 1, as a test.
     *
     * A door count of 10 against an invoice of 12 on an ORDERED delivery: both
     * sides are on the record, nothing is open, and rule A used to agree it in
     * one call while the gateway's own notification said the two disagreed.
     * The founder's answer (2026-09-06): "Difference must be answered."
     */
    const shortShip = (orderedBottles = 10, billedBottles = "12") => {
      db.answers.deliveries = {
        data: deliveryRow({ state: "RECONCILING", order_id: "ord-1" }),
        error: null,
      };
      db.answers.document_deliveries = {
        data: [
          { document_id: "doc-count", role: "door_count" },
          { document_id: "doc-inv", role: "invoice" },
        ],
        error: null,
      };
      db.answers.procurement_documents = {
        data: [
          {
            id: "doc-count",
            provider_id: "prov-1",
            doc_type: "receiving_advice",
            direction: "issued_by_us",
            extracted: {},
          },
          {
            id: "doc-inv",
            provider_id: "prov-1",
            doc_type: "invoice",
            direction: "issued_by_vendor",
            extracted: {},
          },
        ],
        error: null,
      };
      db.answers.procurement_document_lines = {
        data: [
          {
            id: "dl-1",
            document_id: "doc-inv",
            line_no: 1,
            vendor_sku: null,
            description: "SYNTHETIC Okuzgozu 2021",
            vintage: 2021,
            format_ml: 750,
            qty_bottles: billedBottles,
            unit_price: "71",
          },
        ],
        error: null,
      };
      db.answers.procurement_order_items = {
        data: [
          {
            id: "ol-1",
            wine_name: "SYNTHETIC Okuzgozu 2021",
            vendor_sku: null,
            vintage: 2021,
            quantity: orderedBottles,
            bottles_per_unit: 1,
            total_bottles: orderedBottles,
            quoted_unit_price: 71,
            final_unit_price: null,
          },
        ],
        error: null,
      };
      db.answers.delivery_proposals = { data: [], error: null };
      db.answers.delivery_line_acceptances = { data: [], error: null };
      db.updateAnswers.deliveries = {
        data: deliveryRow({
          state: "AGREED",
          order_id: "ord-1",
          agreed_at: "2026-09-06T10:00:00Z",
          agreed_rule: "both_sides_recorded",
        }),
        error: null,
      };
    };

    it("REFUSES a delivery that differs on a line nothing has answered, and names the line", async () => {
      shortShip();
      const res = await service.agree(REST, DEL, "u1");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(409);
        expect(res.error).toMatch(/recorded difference/i);
        expect(res.error).toMatch(/line 1 of document doc-inv/);
        expect(res.error).toMatch(/accept/i);
      }
      // And nothing moved. A refusal that still wrote AGREED would be worse
      // than no gate at all.
      expect(
        db.writes.filter((w) => w.table === "deliveries" && w.verb === "update"),
      ).toEqual([]);
    });

    it("agrees once the line is ACCEPTED AS BILLED, and still says which rule fired", async () => {
      shortShip();
      db.answers.delivery_line_acceptances = {
        data: [{ document_id: "doc-inv", line_no: 1 }],
        error: null,
      };
      const res = await service.agree(REST, DEL, "u1");
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.rule).toBe("both_sides_recorded");
    });

    it("agrees once an ACCEPTED PROPOSAL covers the line", async () => {
      shortShip();
      db.answers.delivery_proposals = {
        data: [
          {
            document_id: "doc-inv",
            line_no: 1,
            side: "restaurant",
            status: "accepted",
          },
        ],
        error: null,
      };
      const res = await service.agree(REST, DEL, "u1");
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.rule).toBe("both_sides_recorded");
    });

    it("RULE A IS UNCHANGED where the comparison ran and nothing differed", async () => {
      shortShip(12, "12");
      const res = await service.agree(REST, DEL, "u1");
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.rule).toBe("both_sides_recorded");
    });

    it("refuses rather than agreeing when the difference check could not RUN (ADR 0067)", async () => {
      shortShip();
      db.answers.procurement_order_items = {
        data: null,
        error: { message: "statement timeout" },
      };
      const res = await service.agree(REST, DEL, "u1");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(500);
        expect(res.error).toMatch(/could not run/i);
      }
      expect(
        db.writes.filter((w) => w.table === "deliveries" && w.verb === "update"),
      ).toEqual([]);
    });

    it("gates rule B too — a signed ticket does not agree an unanswered difference", async () => {
      shortShip();
      db.answers.vendor_terms = {
        data: [{ signed_ticket_is_final: true }],
        error: null,
      };
      const res = await service.agree(REST, DEL, "u1");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  describe("A11 — accept as billed is a human decision with a reason", () => {
    const onDelivery = () => {
      db.answers.deliveries = {
        data: deliveryRow({ state: "RECONCILING" }),
        error: null,
      };
      db.answers.procurement_documents = {
        data: [
          {
            id: "doc-inv",
            provider_id: "prov-1",
            doc_type: "invoice",
            direction: "issued_by_vendor",
            extracted: {},
          },
        ],
        error: null,
      };
      db.answers.document_deliveries = {
        data: [{ document_id: "doc-inv", role: "invoice" }],
        error: null,
      };
    };

    it("refuses a call with no user rather than attributing it to the platform", async () => {
      onDelivery();
      const res = await service.acceptAsBilled(REST, DEL, null, {
        documentId: "doc-inv",
        lineNo: 1,
        reason: "two bottles short, not worth the claim",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(403);
      expect(db.writes).toEqual([]);
    });

    it("refuses an acceptance with no reason", async () => {
      onDelivery();
      const res = await service.acceptAsBilled(REST, DEL, "u1", {
        documentId: "doc-inv",
        lineNo: 1,
        reason: "   ",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(400);
      expect(db.writes).toEqual([]);
    });

    it("refuses a line of a document that is not on this delivery", async () => {
      onDelivery();
      db.answers.document_deliveries = { data: [], error: null };
      const res = await service.acceptAsBilled(REST, DEL, "u1", {
        documentId: "doc-inv",
        lineNo: 1,
        reason: "accepted as billed",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(409);
      expect(
        db.writes.filter((w) => w.table === "delivery_line_acceptances"),
      ).toEqual([]);
    });

    it("records who, when and why", async () => {
      onDelivery();
      db.answers.delivery_line_acceptances = { data: [], error: null };
      db.insertAnswers.delivery_line_acceptances = {
        data: {
          id: "acc-1",
          accepted_at: "2026-09-06T10:00:00Z",
          accepted_by: "u1",
        },
        error: null,
      };
      const res = await service.acceptAsBilled(REST, DEL, "u1", {
        documentId: "doc-inv",
        lineNo: 1,
        reason: "two bottles short, not worth the claim",
      });
      expect(res.ok).toBe(true);
      const write = db.writes.find(
        (w) => w.table === "delivery_line_acceptances" && w.verb === "insert",
      );
      expect(write?.payload).toMatchObject({
        delivery_id: DEL,
        document_id: "doc-inv",
        line_no: 1,
        accepted_by: "u1",
        reason: "two bottles short, not worth the claim",
      });
    });

    it("is idempotent — a second acceptance returns the first and writes nothing", async () => {
      onDelivery();
      db.answers.delivery_line_acceptances = {
        data: [
          {
            id: "acc-1",
            accepted_at: "2026-09-06T10:00:00Z",
            accepted_by: "u1",
          },
        ],
        error: null,
      };
      const res = await service.acceptAsBilled(REST, DEL, "u2", {
        documentId: "doc-inv",
        lineNo: 1,
        reason: "again",
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.alreadyAccepted).toBe(true);
        expect(res.value.acceptedBy).toBe("u1");
      }
      expect(
        db.writes.filter((w) => w.table === "delivery_line_acceptances"),
      ).toEqual([]);
    });
  });
});
