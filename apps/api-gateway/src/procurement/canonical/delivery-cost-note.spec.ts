/**
 * QA round 15 finding 6, the cost note (#872): `DeliveryService.verify` builds
 * the sentence the person reads after pressing Verify. The older specs stub
 * `DeliveryStockService` with hand-written papers, so they cannot tell whether
 * the sentence is built from what the REAL stock service reports. These run
 * the real `DeliveryStockService` on the mock database and pin the sentence.
 *
 * Mutations each was proven against (delivery.service.ts, one at a time):
 *   M9   the invoice's "left out" sentence is dropped from the note
 *   M10  the invoice's tax sentence is dropped from the note
 *   M11  the re-verify no longer says repaired items carry their landed cost
 *
 * All fixtures are SYNTHETIC: ids, vendors, prices and quantities are invented.
 */

import { DatabaseService } from "../../database/database.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { DeliveryService } from "./delivery.service";
import { DeliveryClockService } from "./delivery-clock.service";
import { DeliveryStockService } from "./delivery-stock.service";
import { makeMockDb, makeMockNotifications, MockDb } from "./delivery-mock";

const REST = "rest-1";
const DEL = "del-1";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const ITEM2 = "ffffffff-ffff-ffff-ffff-ffffffffffff";

const deliveryRow = (over: Record<string, unknown> = {}) => ({
  id: DEL,
  restaurant_id: REST,
  provider_id: "prov-1",
  order_id: null,
  state: "AGREED",
  provenance: "UNORDERED",
  jurisdiction: "TR",
  delivered_at: "2026-08-14T07:41:00Z",
  agreed_at: "2026-08-14T09:00:00Z",
  agreed_rule: "both_sides",
  verified_at: null,
  verified_by: null,
  lapsed_at: null,
  lapse_deemed: null,
  amended_at: null,
  owner_user_id: "u1",
  deputy_user_id: null,
  ...over,
});

describe("DeliveryService.verify — the cost note is built from the real stock service", () => {
  let db: MockDb;
  let service: DeliveryService;

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    const notifications = makeMockNotifications();
    service = new DeliveryService(
      db.client as unknown as DatabaseService,
      new DeliveryClockService(
        db.client as unknown as DatabaseService,
        notifications as unknown as NotificationsService,
      ),
      notifications as unknown as NotificationsService,
      new DeliveryStockService(db.client as unknown as DatabaseService),
    );
    db.answers.deliveries = { data: deliveryRow(), error: null };
    db.updateAnswers.deliveries = {
      data: deliveryRow({ state: "VERIFIED", verified_at: "2026-08-15T11:00:00Z", verified_by: "u1" }),
      error: null,
    };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
    db.rpcAnswers.finalise_delivery_cost = {
      data: { lots_matched: 1, lots_finalised: 1, bottles_finalised: 10 },
      error: null,
    };
  });

  const line = (over: Record<string, unknown> = {}) => ({
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
  const invoice = (head: Record<string, unknown>, lines: Record<string, unknown>[], booked: Record<string, number>) => {
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1", ...head }], error: null };
    db.answers.procurement_document_lines = { data: lines, error: null };
    db.answers.inventory_transactions = {
      data: Object.entries(booked).map(([inventory_id, quantity_change]) => ({ inventory_id, quantity_change })),
      error: null,
    };
  };

  it("M9: a deposit on the invoice is named in the note as left out of cost", async () => {
    invoice({ deposit_total: 30 }, [line()], { [ITEM]: 10 });
    const res = await service.verify(REST, DEL, "u1");
    expect(res.ok && res.value.cost?.finalised.map((f) => f.unitCost)).toEqual([60]);
    expect(res.ok && res.value.costNote).toMatch(
      /^Cost posted for 1 item\(s\); 0 left provisional\. On the invoice: .*Not cost: a deposit of 30\.00/,
    );
  });

  it("M9b: a deposit line and a fee line are named by line number and amount", async () => {
    invoice(
      { extracted_lines: [{ lineNo: 2, lineKind: "deposit" }] },
      [line(), line({ line_no: 2, inventory_id: null, qty_bottles: 1, unit_price: 180, line_total: 180 })],
      { [ITEM]: 10 },
    );
    const res = await service.verify(REST, DEL, "u1");
    expect(res.ok && res.value.costNote).toMatch(/On the invoice: .*line 2, a deposit of 180\.00/);
  });

  it("M10: the note carries the sentence that says how the invoice's tax was read", async () => {
    invoice({ tax: 120, subtotal: 600 }, [line()], { [ITEM]: 10 });
    const res = await service.verify(REST, DEL, "u1");
    expect(res.ok && res.value.costNote).toMatch(
      /On the invoice: .* 1 line is costed as printed, and what its cost holds is not stated, since the house has not set its tax basis\.$/,
    );
  });

  it("M11: a re-verify that repairs a lot booked at the printed case price says it now carries its landed cost", async () => {
    db.answers.deliveries = {
      data: deliveryRow({ state: "VERIFIED", verified_at: "2026-08-15T11:00:00Z", verified_by: "u1" }),
      error: null,
    };
    invoice(
      {},
      [line({ qty_bottles: 24, uom: "case", pack_size: 12, unit_price: 264, line_total: 528 })],
      { [ITEM]: 24 },
    );
    db.answers.inventory_lots = {
      data: [{ inventory_id: ITEM, unit_cost: 264, cost_state: "final", cost_provenance: "invoice", qty: 24 }],
      error: null,
    };
    const res = await service.verify(REST, DEL, "u1");
    expect(res.ok && res.value.alreadyVerified).toBe(true);
    expect(db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost").map((c) => c.args.p_unit_cost)).toEqual([22]);
    expect(res.ok && res.value.costNote).toBe(
      "This delivery was already verified; a cost already posted is not posted twice. 1 item(s) had been booked at the invoice's printed price and now carry their landed cost per bottle: the price of one bottle with its share of the invoice's charges and discount.",
    );
  });
});
