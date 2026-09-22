/**
 * A delivery that booked nothing asks an owner or a manager to name its item,
 * and naming it books the stock then — once, on the record. The founder,
 * 2026-09-22 (round 6u), verbatim pick: "Deliver, flag to name it
 * (Recommended)" (ADR 0192, third amendment).
 *
 * Real: `raiseDeliveryItemToName`, `readOpenDeliveryItemsToName` and
 * `nameDeliveredItem`, over one in-memory store (`FakeDb`, which holds the
 * one-ask-per-order unique key and applies a conditional write in one
 * synchronous pass, so two namings racing lose at the write). The ledger RPC
 * is modelled as `apply_stock_movement` is: one row per idempotency key. The
 * migration's CHECKs, unique index and tenancy trigger are proven in PGlite
 * (p4-scratch/pglite-probe/E4-migrations.mjs). Stand-in: the role read.
 */
import { ForbiddenException } from "@nestjs/common";
import { FakeDb } from "../notifications/producers/testing/fake-db";
import {
  nameAskWords,
  nameDeliveredItem,
  raiseDeliveryItemToName,
  readOpenDeliveryItemsToName,
} from "./delivery-item-to-name";

const HOUSE = "house-1";
const ORDER = "44444444-4444-4444-8444-444444444444";
const ITEM = "11111111-1111-4111-8111-111111111111";
const OTHER_ITEM = "11111111-1111-4111-8111-999999999999";
const OWNER = "u-owner";
const STAFF = "u-staff";

type Row = Record<string, any>;

function build(opts: { order?: Row; item?: Row; ask?: Row | null; liveError?: string | null } = {}) {
  const db = new FakeDb();
  db.tables.procurement_orders = [
    { id: ORDER, restaurant_id: HOUSE, status: "DELIVERED", inventory_id: ITEM, order_number: "PO-7", ...(opts.order ?? {}) },
  ];
  db.tables.restaurant_inventory = [
    { id: ITEM, restaurant_id: HOUSE, master_wine_id: null, wine_name: "Kavaklıdere Yakut 2019", shadow_stock: 0, in_transit_quantity: 0, ...(opts.item ?? {}) },
    { id: OTHER_ITEM, restaurant_id: "another-house", master_wine_id: null, wine_name: "Theirs" },
  ];
  db.tables.delivery_item_to_name =
    opts.ask === null
      ? []
      : [
          {
            id: "ask-1",
            restaurant_id: HOUSE,
            order_id: ORDER,
            why: "zero_bottles",
            bottles_resolved: 0,
            status: "open",
            raised_by: STAFF,
            raised_at: "2026-09-22T08:00:00Z",
            named_by: null,
            named_at: null,
            named_inventory_id: null,
            bottles_booked: null,
            ...(opts.ask ?? {}),
          },
        ];
  db.tables.inventory_transactions = [];
  db.tables.inventory_events = [];
  db.tables.system_audit_log = [];
  db.tables.house_item_research = [];
  const movements: Row[] = [];
  db.rpcHandlers.apply_stock_movement = (args) => {
    movements.push(args);
    if (args.p_stock_state === "live" && opts.liveError) return { data: null, error: { message: opts.liveError } };
    if (!db.tables.inventory_transactions.some((r) => r.idempotency_key === args.p_idempotency_key)) {
      db.tables.inventory_transactions.push({
        restaurant_id: args.p_restaurant_id,
        order_id: args.p_order_id,
        inventory_id: args.p_inventory_id,
        stock_type: args.p_stock_state,
        quantity_change: args.p_delta,
        idempotency_key: args.p_idempotency_key,
        delivery_id: null,
      });
    }
    return { data: null, error: null };
  };
  const roles: Record<string, string> = { [OWNER]: "owner", [STAFF]: "staff" };
  let roleReadFails = false;
  const deps = {
    client: db as any,
    logger: { error: () => undefined, warn: () => undefined },
    isOwnerOrManager: async (userId: string) => {
      if (roleReadFails) throw new Error("user_restaurant_access: connection reset");
      return ["owner", "manager"].includes(roles[userId] ?? "");
    },
  };
  const live = () => movements.filter((m) => m.p_stock_state === "live");
  return {
    db,
    deps,
    live,
    failRoleRead: () => {
      roleReadFails = true;
    },
  };
}

const name = (t: ReturnType<typeof build>, over: Partial<{ userId: string; inventoryId: string; bottles: number | null }> = {}) =>
  nameDeliveredItem(t.deps, {
    restaurantId: HOUSE,
    orderId: ORDER,
    userId: OWNER,
    inventoryId: ITEM,
    bottles: 6,
    ...over,
  });

describe("the ask: one per delivered order, raised after the delivery", () => {
  it("raises one ask per order; a second raise finds the first", async () => {
    const t = build({ ask: null });
    expect(
      await raiseDeliveryItemToName(t.db, { restaurantId: HOUSE, orderId: ORDER, why: "zero_bottles", bottlesResolved: 0, raisedBy: STAFF }),
    ).toEqual({ ok: true, created: true });
    expect(
      await raiseDeliveryItemToName(t.db, { restaurantId: HOUSE, orderId: ORDER, why: "zero_bottles", bottlesResolved: 0, raisedBy: STAFF }),
    ).toEqual({ ok: true, created: false });
    expect(t.db.tables.delivery_item_to_name).toHaveLength(1);
    expect(t.db.tables.delivery_item_to_name[0]).toMatchObject({ order_id: ORDER, why: "zero_bottles", bottles_resolved: 0, raised_by: STAFF });
  });

  it("an ask that cannot be written is said, never dropped", async () => {
    const t = build({ ask: null });
    t.db.failures.delivery_item_to_name = "permission denied";
    const out = await raiseDeliveryItemToName(t.db, { restaurantId: HOUSE, orderId: ORDER, why: "no_item", bottlesResolved: 6, raisedBy: STAFF });
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/could not be recorded \(permission denied\)/) });
    expect(nameAskWords(out)).toMatch(/could not be asked to name it.*Nothing books this delivery's stock until it is named/);
  });

  it("the list is this house's open asks; a failed read throws, never an empty list", async () => {
    const t = build();
    t.db.tables.delivery_item_to_name.push({ id: "ask-x", restaurant_id: "another-house", order_id: "o-x", why: "zero_bottles", bottles_resolved: 0, status: "open", raised_at: "2026-09-22T09:00:00Z" });
    const list = await readOpenDeliveryItemsToName(t.db, HOUSE);
    expect(list).toEqual([
      { orderId: ORDER, orderNumber: "PO-7", why: "zero_bottles", bottlesResolved: 0, orderInventoryId: ITEM, raisedAt: "2026-09-22T08:00:00Z" },
    ]);
    t.db.failures.delivery_item_to_name = "connection reset";
    await expect(readOpenDeliveryItemsToName(t.db, HOUSE)).rejects.toThrow(/could not be read \(connection reset\)/);
  });
});

describe("naming it books the stock then — once, on the record", () => {
  it("an owner names it: the stock is booked under markDelivered's key, the ask is named, the audit row written, research queued", async () => {
    const t = build();
    const out = await name(t);
    expect(t.live()).toHaveLength(1);
    expect(t.live()[0]).toMatchObject({
      p_inventory_id: ITEM,
      p_delta: 6,
      p_transaction_type: "purchase",
      p_order_id: ORDER,
      p_idempotency_key: `order-delivered-live:${ORDER}`,
      p_restaurant_id: HOUSE,
      p_performed_by: OWNER,
    });
    expect(t.db.tables.delivery_item_to_name[0]).toMatchObject({
      status: "named",
      named_by: OWNER,
      named_inventory_id: ITEM,
      bottles_booked: 6,
    });
    expect(t.db.tables.system_audit_log).toEqual([
      expect.objectContaining({ action: "delivery_item_named", actor_id: OWNER, entity_id: ORDER, restaurant_id: HOUSE }),
    ]);
    expect(t.db.tables.inventory_events).toEqual([
      expect.objectContaining({ event_type: "order_delivered", idempotency_key: `order-delivered:${ORDER}`, quantity_change: 6 }),
    ]);
    // The wine library lacks this item: research, by its id (answer 4).
    expect(t.db.tables.house_item_research).toEqual([
      expect.objectContaining({ inventory_id: ITEM, status: "queued", queued_from: "delivery", source_order_id: ORDER, classified_name: "Kavaklıdere Yakut 2019" }),
    ]);
    expect(out).toMatchObject({ bottlesBooked: 6, audited: true, research: { ok: true, status: "queued" } });
    expect(out.says).toBe(
      "The delivery's item was named and 6 bottles were booked. This wine is not in the wine library yet, so it is queued for research.",
    );
  });

  it("a second naming is refused and books nothing twice", async () => {
    const t = build();
    await name(t);
    await expect(name(t)).rejects.toMatchObject({ status: 409 });
    expect(t.live()).toHaveLength(1);
  });

  it("two namings at once: exactly one books", async () => {
    const t = build();
    const results = await Promise.allSettled([name(t), name(t)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(t.live()).toHaveLength(1);
    expect(t.db.tables.system_audit_log).toHaveLength(1);
  });

  it("a staff member may not name it; nothing is written", async () => {
    const t = build();
    await expect(name(t, { userId: STAFF })).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.live()).toHaveLength(0);
    expect(t.db.tables.delivery_item_to_name[0].status).toBe("open");
  });

  it("a role that cannot be read refuses; nothing is written", async () => {
    const t = build();
    t.failRoleRead();
    await expect(name(t)).rejects.toThrow(/could not be read \(user_restaurant_access: connection reset\)/);
    expect(t.live()).toHaveLength(0);
  });

  it("a zero-bottle delivery must say how many came in", async () => {
    const t = build();
    await expect(name(t, { bottles: null })).rejects.toThrow(/say how many bottles came in/);
    await expect(name(t, { bottles: 0 })).rejects.toThrow(/whole number from 1/);
    expect(t.live()).toHaveLength(0);
  });

  it("a delivery that resolved to bottles books that count; another number is refused", async () => {
    const t = build({ ask: { why: "no_item", bottles_resolved: 12 }, order: { inventory_id: null } });
    await expect(name(t, { bottles: 11 })).rejects.toThrow(/resolved to 12 bottles; 11 is not that number/);
    expect(t.live()).toHaveLength(0);
    const out = await name(t, { bottles: null });
    expect(out.bottlesBooked).toBe(12);
    // The no-item order now names the item it was delivered for, by id.
    expect(t.db.tables.procurement_orders[0].inventory_id).toBe(ITEM);
  });

  it("an item other than the order's own is refused", async () => {
    const t = build({ item: {} });
    t.db.tables.restaurant_inventory.push({ id: "item-b", restaurant_id: HOUSE, master_wine_id: null, wine_name: "B" });
    await expect(name(t, { inventoryId: "item-b" })).rejects.toThrow(/order is for another item/);
    expect(t.live()).toHaveLength(0);
  });

  it("another house's item is refused", async () => {
    const t = build({ ask: { why: "no_item", bottles_resolved: 6 }, order: { inventory_id: null } });
    await expect(name(t, { inventoryId: OTHER_ITEM })).rejects.toThrow(/not an item of this house/);
    expect(t.live()).toHaveLength(0);
    expect(t.db.tables.procurement_orders[0].inventory_id).toBeNull();
  });

  it("stock the door booked since is not booked again", async () => {
    const t = build();
    t.db.tables.inventory_transactions.push({ order_id: ORDER, delivery_id: "d-1", idempotency_key: "delivery-line:d-1:doc:1" });
    await expect(name(t)).rejects.toThrow(/receiving door has booked this order's stock/);
    expect(t.live()).toHaveLength(0);
    expect(t.db.tables.delivery_item_to_name[0].status).toBe("open");
  });

  it("stock the door's case count booked since (no delivery id) is not booked again", async () => {
    const t = build();
    t.db.tables.inventory_transactions.push({
      restaurant_id: HOUSE,
      order_id: ORDER,
      inventory_id: ITEM,
      stock_type: "live",
      quantity_change: 6,
      delivery_id: null,
      idempotency_key: "door-receipt:evt-1",
    });
    await expect(name(t)).rejects.toThrow(/booked since it was delivered \(at the door, at its verification, or by an earlier delivery\)/);
    expect(t.live()).toHaveLength(0);
    expect(t.db.tables.delivery_item_to_name[0].status).toBe("open");
  });

  it("a ledger that cannot be read refuses; nothing is written", async () => {
    const t = build();
    t.db.failures.inventory_transactions = "timeout";
    await expect(name(t)).rejects.toThrow(/timeout/);
    expect(t.live()).toHaveLength(0);
    expect(t.db.tables.delivery_item_to_name[0].status).toBe("open");
  });

  it("a refused booking puts the ask back to open, and a no-item order is unlinked again", async () => {
    const t = build({ ask: { why: "no_item", bottles_resolved: 6 }, order: { inventory_id: null }, liveError: "item is not an item of restaurant" });
    await expect(name(t, { bottles: null })).rejects.toMatchObject({ status: 422 });
    expect(t.db.tables.delivery_item_to_name[0]).toMatchObject({ status: "open", named_by: null, named_inventory_id: null, bottles_booked: null });
    expect(t.db.tables.procurement_orders[0].inventory_id).toBeNull();
    expect(t.db.tables.system_audit_log).toHaveLength(0);
  });

  it("an order that is not delivered is refused", async () => {
    const t = build({ order: { status: "APPROVED" } });
    await expect(name(t)).rejects.toThrow(/not delivered/);
    expect(t.live()).toHaveLength(0);
  });

  it("no ask for the order in this house is a 404", async () => {
    const t = build({ ask: null });
    await expect(name(t)).rejects.toMatchObject({ status: 404 });
  });

  it("an audit row that cannot be written is said; the booking and the ask's own record stand", async () => {
    const t = build();
    t.db.failures.system_audit_log = "permission denied";
    const out = await name(t);
    expect(out.audited).toBe(false);
    expect(out.says).toMatch(/audit log row could not be written/);
    expect(t.live()).toHaveLength(1);
    expect(t.db.tables.delivery_item_to_name[0].status).toBe("named");
  });

  it("a library wine is booked and not queued for research", async () => {
    const t = build({ item: { master_wine_id: "55555555-5555-4555-8555-555555555555" } });
    const out = await name(t);
    expect(out.research).toBeNull();
    expect(t.db.tables.house_item_research).toHaveLength(0);
  });
});
