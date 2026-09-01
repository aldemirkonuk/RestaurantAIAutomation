import { Test } from "@nestjs/testing";
import { HttpException } from "@nestjs/common";
import { PurchaseReasonService } from "./purchase-reason.service";
import { DatabaseService } from "../database/database.service";
import { makeSupabaseStub, SupabaseStub } from "./testing/supabase-stub";
import {
  NO_REASON_RECORDED,
  PURCHASE_REASON_CODES,
} from "./dto/dashboard-signals.dto";

/**
 * The "why" on a purchase (dashboard rebuild spec §3.2).
 *
 * Two constraints from the chef decide every test here:
 *
 *   "Paragraphs are dead on arrival."  → five preset chips, tap-once and
 *   complete. A code from a closed set, never prose.
 *
 *   "It appears at ORDERING, not receiving... Ask me then or you've lost the
 *   window."  → the write refuses once the goods have landed, and the row
 *   records the order's REAL status at capture rather than a claim, so a
 *   reader can say "recorded at ordering" and be right.
 *
 * And the ADR 0051 line the spec states outright: an item with no reason
 * recorded must read as "no reason recorded", never as a guess.
 */

const R1 = "11111111-1111-1111-1111-111111111111";
const R2 = "22222222-2222-2222-2222-222222222222";

const ORDER_OPEN = "99999999-0000-0000-0000-000000000001";
const ORDER_DELIVERED = "99999999-0000-0000-0000-000000000002";
const ORDER_OTHER_UNIT = "99999999-0000-0000-0000-0000000000ff";

const INV_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const INV_B = "aaaaaaaa-0000-0000-0000-00000000000b";
const INV_MOVING = "aaaaaaaa-0000-0000-0000-00000000000c";
const INV_OTHER_UNIT = "aaaaaaaa-0000-0000-0000-0000000000ff";

const USER = "eeeeeeee-0000-0000-0000-000000000001";
const NOW = "2026-09-02T12:00:00.000Z";

const ORDERS = [
  {
    id: ORDER_OPEN,
    restaurant_id: R1,
    inventory_id: INV_A,
    status: "PENDING",
    delivered_at: null,
  },
  {
    id: ORDER_DELIVERED,
    restaurant_id: R1,
    inventory_id: INV_B,
    status: "delivered",
    delivered_at: "2026-08-20T00:00:00Z",
  },
  {
    id: ORDER_OTHER_UNIT,
    restaurant_id: R2,
    inventory_id: INV_OTHER_UNIT,
    status: "PENDING",
    delivered_at: null,
  },
];

const EXISTING_REASONS = [
  {
    id: "77777777-0000-0000-0000-000000000001",
    restaurant_id: R1,
    order_id: ORDER_OPEN,
    inventory_id: INV_A,
    reason_code: "aging_on_purpose",
    note: null,
    order_status_at_capture: "PENDING",
    captured_at: "2026-08-01T09:00:00Z",
    captured_by: USER,
  },
  // The other unit's reason. Must never surface in an R1 read.
  {
    id: "77777777-0000-0000-0000-0000000000ff",
    restaurant_id: R2,
    order_id: ORDER_OTHER_UNIT,
    inventory_id: INV_OTHER_UNIT,
    reason_code: "bought_wrong",
    note: "other unit",
    order_status_at_capture: "PENDING",
    captured_at: "2026-08-01T09:00:00Z",
    captured_by: null,
  },
];

/**
 * Idle-stock fixtures. `inventory_analytics.dead_stock` is the measured
 * definition already in the schema: nothing sold in 90 days (or never sold)
 * while stock is on hand.
 */
const INVENTORY = [
  { id: INV_A, restaurant_id: R1, wine_name: "Barolo Riserva" },
  { id: INV_B, restaurant_id: R1, wine_name: "Vin Santo" },
  { id: INV_MOVING, restaurant_id: R1, wine_name: "Chablis 1er Cru" },
  { id: INV_OTHER_UNIT, restaurant_id: R2, wine_name: "Other unit's Krug" },
];

const ANALYTICS = [
  // Idle 140 days, cost known, reason recorded ("aging on purpose").
  {
    inventory_id: INV_A,
    restaurant_id: R1,
    on_hand: 6,
    dead_stock: true,
    days_since_sale: 140,
    last_sold_at: "2026-04-15T00:00:00Z",
  },
  // Never sold at all — a different claim from "idle for N days".
  {
    inventory_id: INV_B,
    restaurant_id: R1,
    on_hand: 4,
    dead_stock: true,
    days_since_sale: null,
    last_sold_at: null,
  },
  // Moving. Must not appear.
  {
    inventory_id: INV_MOVING,
    restaurant_id: R1,
    on_hand: 12,
    dead_stock: false,
    days_since_sale: 2,
    last_sold_at: "2026-08-31T00:00:00Z",
  },
  {
    inventory_id: INV_OTHER_UNIT,
    restaurant_id: R2,
    on_hand: 99,
    dead_stock: true,
    days_since_sale: 400,
    last_sold_at: "2025-07-29T00:00:00Z",
  },
];

const ROLLUP = [
  {
    inventory_id: INV_A,
    restaurant_id: R1,
    live_qty: 6,
    wac: 30,
    has_invoice_cost: true,
  },
  // On hand, but nothing knows what it cost.
  {
    inventory_id: INV_B,
    restaurant_id: R1,
    live_qty: 4,
    wac: null,
    has_invoice_cost: false,
  },
  {
    inventory_id: INV_OTHER_UNIT,
    restaurant_id: R2,
    live_qty: 99,
    wac: 180,
    has_invoice_cost: true,
  },
];

function build(stub: SupabaseStub) {
  return Test.createTestingModule({
    providers: [
      PurchaseReasonService,
      { provide: DatabaseService, useValue: { getClient: () => stub.client } },
    ],
  }).compile();
}

function fullStub(writes: Record<string, any> = {}) {
  return makeSupabaseStub(
    {
      procurement_orders: ORDERS,
      purchase_reasons: EXISTING_REASONS,
      inventory_analytics: ANALYTICS,
      inventory_lot_rollup: ROLLUP,
      restaurant_inventory: INVENTORY,
    },
    writes,
  );
}

describe("PurchaseReasonService", () => {
  let service: PurchaseReasonService;
  let stub: SupabaseStub;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    stub = fullStub();
    service = (await build(stub)).get(PurchaseReasonService);
  });

  afterEach(() => jest.useRealTimers());

  // =========================================================================
  // The chips
  // =========================================================================

  it("offers exactly the five decided chips, in the decided order", async () => {
    expect(service.listOptions()).toEqual([
      { code: "event_hold", label: "Event hold" },
      { code: "seasonal_trial", label: "Seasonal trial" },
      { code: "slow_mover", label: "Slow mover" },
      { code: "bought_wrong", label: "Bought wrong" },
      { code: "aging_on_purpose", label: "Aging on purpose" },
    ]);
    expect(service.listOptions().map((o) => o.code)).toEqual([
      ...PURCHASE_REASON_CODES,
    ]);
  });

  it("refuses a reason code outside the closed set", async () => {
    await expect(
      service.recordReason({
        restaurantId: R1,
        orderId: ORDER_OPEN,
        reasonCode: "because_i_felt_like_it" as any,
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  // =========================================================================
  // Captured at ORDERING, and provably so
  // =========================================================================

  it("records the order's real status at capture, not a claim by the caller", async () => {
    const rec = await service.recordReason({
      restaurantId: R1,
      orderId: ORDER_OPEN,
      reasonCode: "event_hold",
      capturedBy: USER,
    });

    expect(rec).toEqual({
      orderId: ORDER_OPEN,
      inventoryId: INV_A,
      reasonCode: "event_hold",
      reasonLabel: "Event hold",
      capturedAt: NOW,
      orderStatusAtCapture: "PENDING",
      capturedBy: USER,
      note: null,
    });
  });

  it("refuses to record a reason once the goods have landed — the window has closed", async () => {
    await expect(
      service.recordReason({
        restaurantId: R1,
        orderId: ORDER_DELIVERED,
        reasonCode: "seasonal_trial",
      }),
    ).rejects.toBeInstanceOf(HttpException);

    expect(
      stub
        .callsFor("purchase_reasons")
        .some((c) => c.filters.some((f) => f.method === "upsert")),
    ).toBe(false);
  });

  it("takes restaurant_id and inventory_id from the order row, never from the request body", async () => {
    await service.recordReason({
      restaurantId: R1,
      orderId: ORDER_OPEN,
      reasonCode: "slow_mover",
    });

    const write = stub
      .callsFor("purchase_reasons")
      .flatMap((c) => c.filters)
      .find((f) => f.method === "upsert");

    expect(write).toBeDefined();
    expect(write!.args[0]).toMatchObject({
      restaurant_id: R1,
      order_id: ORDER_OPEN,
      inventory_id: INV_A,
      reason_code: "slow_mover",
      order_status_at_capture: "PENDING",
    });
  });

  it("upserts on order_id, so a second tap corrects rather than duplicates", async () => {
    await service.recordReason({
      restaurantId: R1,
      orderId: ORDER_OPEN,
      reasonCode: "bought_wrong",
    });

    const write = stub
      .callsFor("purchase_reasons")
      .flatMap((c) => c.filters)
      .find((f) => f.method === "upsert");

    expect(write!.args[1]).toMatchObject({ onConflict: "order_id" });
  });

  it("keeps the optional note optional and never lets it stand in as the reason", async () => {
    const rec = await service.recordReason({
      restaurantId: R1,
      orderId: ORDER_OPEN,
      reasonCode: "event_hold",
      note: "Chef's table, 14 Sep",
    });

    expect(rec.note).toBe("Chef's table, 14 Sep");
    expect(rec.reasonCode).toBe("event_hold");
    expect(rec.reasonLabel).toBe("Event hold");
  });

  // =========================================================================
  // Multi-unit (spec §6)
  // =========================================================================

  it("will not attach a reason to another unit's order", async () => {
    await expect(
      service.recordReason({
        restaurantId: R1,
        orderId: ORDER_OTHER_UNIT,
        reasonCode: "event_hold",
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("scopes the order lookup to the requesting restaurant at the database", async () => {
    await service.recordReason({
      restaurantId: R1,
      orderId: ORDER_OPEN,
      reasonCode: "event_hold",
    });
    expect(stub.filtered("procurement_orders", "restaurant_id", R1)).toBe(true);
  });

  it("surfaces a write failure instead of reporting a reason that was not stored", async () => {
    const failing = fullStub({
      purchase_reasons: { error: { message: "duplicate key" } },
    });
    const svc = (await build(failing)).get(PurchaseReasonService);

    await expect(
      svc.recordReason({
        restaurantId: R1,
        orderId: ORDER_OPEN,
        reasonCode: "event_hold",
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  // =========================================================================
  // Reading — "no reason recorded" is a real answer
  // =========================================================================

  it("returns the recorded reason with its decided label", async () => {
    const rows = await service.getReasonsForItems(R1, [INV_A]);

    expect(rows).toEqual([
      {
        inventoryId: INV_A,
        reason: {
          orderId: ORDER_OPEN,
          inventoryId: INV_A,
          reasonCode: "aging_on_purpose",
          reasonLabel: "Aging on purpose",
          capturedAt: "2026-08-01T09:00:00Z",
          orderStatusAtCapture: "PENDING",
          capturedBy: USER,
          note: null,
        },
        reasonUnknownReason: null,
      },
    ]);
  });

  it("says 'no reason recorded' for an item with none, and never guesses one", async () => {
    const rows = await service.getReasonsForItems(R1, [INV_A, INV_B]);
    const b = rows.find((r) => r.inventoryId === INV_B)!;

    expect(b.reason).toBeNull();
    expect(b.reasonUnknownReason).toBe(NO_REASON_RECORDED);
  });

  it("does not read another unit's reasons", async () => {
    const rows = await service.getReasonsForItems(R1, [INV_OTHER_UNIT]);

    expect(rows).toEqual([
      {
        inventoryId: INV_OTHER_UNIT,
        reason: null,
        reasonUnknownReason: NO_REASON_RECORDED,
      },
    ]);
    expect(stub.filtered("purchase_reasons", "restaurant_id", R1)).toBe(true);
  });

  it("returns every reason for the unit when no id list is given", async () => {
    const rows = await service.getReasonsForItems(R1);

    expect(rows.map((r) => r.inventoryId)).toEqual([INV_A]);
    expect(rows.map((r) => r.inventoryId)).not.toContain(INV_OTHER_UNIT);
  });

  // =========================================================================
  // The read the vendor strip needs (spec §2.5)
  //
  // The chef's objection to the current framing is the design brief: "framed
  // as a finance number it reads like an accusation with no context, and I'll
  // get defensive, because the same dollar figure covers 'I made a buying
  // mistake' and 'this is aging exactly as planned.'"
  // =========================================================================

  describe("idle stock with reasons", () => {
    it("attaches the recorded reason to idle stock, so the strip is not a bare accusation", async () => {
      const res = await service.getIdleStockWithReasons(R1);
      const a = res.items.find((i) => i.inventoryId === INV_A)!;

      expect(a.reason).toMatchObject({
        reasonCode: "aging_on_purpose",
        reasonLabel: "Aging on purpose",
      });
      expect(a.reasonUnknownReason).toBeNull();
      expect(a.daysSinceSale).toBe(140);
      expect(a.capitalLocked).toEqual({
        amount: 180,
        basis: "invoice",
        currency: "USD",
      });
    });

    it("says 'no reason recorded' for idle stock nobody explained", async () => {
      const res = await service.getIdleStockWithReasons(R1);
      const b = res.items.find((i) => i.inventoryId === INV_B)!;

      expect(b.reason).toBeNull();
      expect(b.reasonUnknownReason).toBe(NO_REASON_RECORDED);
    });

    it("separates 'never moved' from 'idle for N days'", async () => {
      const res = await service.getIdleStockWithReasons(R1);
      const b = res.items.find((i) => i.inventoryId === INV_B)!;

      expect(b.movementStatus).toBe("no_movement_recorded");
      expect(b.daysSinceSale).toBeNull();
      expect(
        res.items.find((i) => i.inventoryId === INV_A)!.movementStatus,
      ).toBe("idle_since");
    });

    it("returns null capital with a reason where no cost is known, never 0", async () => {
      const res = await service.getIdleStockWithReasons(R1);
      const b = res.items.find((i) => i.inventoryId === INV_B)!;

      expect(b.capitalLocked).toBeNull();
      expect(b.capitalLockedUnknownReason).toBeTruthy();
      expect(b.bottles).toBe(4);
    });

    it("reports the capital total as a FLOOR when some idle items have no cost", async () => {
      const res = await service.getIdleStockWithReasons(R1);

      expect(res.totals).toEqual({
        idleItems: 2,
        capitalLocked: 180,
        capitalLockedIsFloor: true,
        itemsWithUnknownCapital: 1,
        capitalLockedUnknownReason: null,
      });
    });

    it("distinguishes 'nothing idle' from 'no idea', which are different claims", async () => {
      // Nothing idle: a real 0, and not a floor.
      const nothingIdle = makeSupabaseStub({
        inventory_analytics: ANALYTICS.map((a) => ({
          ...a,
          dead_stock: false,
        })),
        restaurant_inventory: INVENTORY,
        inventory_lot_rollup: ROLLUP,
        purchase_reasons: EXISTING_REASONS,
      });
      const svcA = (await build(nothingIdle)).get(PurchaseReasonService);
      const a = await svcA.getIdleStockWithReasons(R1);
      expect(a.items).toEqual([]);
      expect(a.totals.capitalLocked).toBe(0);
      expect(a.totals.capitalLockedIsFloor).toBe(false);

      // Idle stock exists, but no cost is known for ANY of it: null, not 0.
      const noCosts = makeSupabaseStub({
        inventory_analytics: ANALYTICS,
        restaurant_inventory: INVENTORY,
        inventory_lot_rollup: ROLLUP.map((r) => ({
          ...r,
          wac: null,
          has_invoice_cost: false,
        })),
        purchase_reasons: EXISTING_REASONS,
      });
      const svcB = (await build(noCosts)).get(PurchaseReasonService);
      const b = await svcB.getIdleStockWithReasons(R1);
      expect(b.totals.capitalLocked).toBeNull();
      expect(b.totals.capitalLockedUnknownReason).toBeTruthy();
    });

    it("orders by how long it has sat, never by dollars", async () => {
      const res = await service.getIdleStockWithReasons(R1);

      // Never-moved first, then longest idle. INV_B is worth nothing known;
      // INV_A is worth $180. Money plays no part.
      expect(res.items.map((i) => i.inventoryId)).toEqual([INV_B, INV_A]);
    });

    it("excludes moving stock and the other unit entirely", async () => {
      const res = await service.getIdleStockWithReasons(R1);
      const ids = res.items.map((i) => i.inventoryId);

      expect(ids).not.toContain(INV_MOVING);
      expect(ids).not.toContain(INV_OTHER_UNIT);
      for (const table of [
        "inventory_analytics",
        "inventory_lot_rollup",
        "restaurant_inventory",
        "purchase_reasons",
      ]) {
        expect(stub.filtered(table, "restaurant_id", R1)).toBe(true);
      }
    });
  });
});
