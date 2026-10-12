/**
 * "No order on file → Add to the books" (F-669, founder S198).
 *
 * The door could not log a phoned-in truck as an order: `placed_on_stated`
 * had a column and no writer, and the only route that booked a
 * `source='retroactive'` order is fenced (410). These pin the door's writer:
 * one tap writes the order already delivered as "Logged at door" and counts
 * it into stock, retries book nothing twice, and the order reads back as
 * logged at the door on every order read.
 */
import { HttpException } from "@nestjs/common";
import {
  logDeliveryAtDoor,
  statedOrderDay,
  type LogAtDoorDeps,
  type LogAtDoorInput,
} from "./logged-at-door";
import { ProcurementService } from "./procurement.service";
import { ProcurementController } from "./procurement.controller";

const NOW = new Date("2026-10-11T12:00:00Z");

describe("statedOrderDay — the answer to 'When was this ordered?'", () => {
  it("is the phone's own day for Today and the day before for Yesterday", () => {
    expect(statedOrderDay("today", "2026-10-11", NOW)).toBe("2026-10-11");
    expect(statedOrderDay("yesterday", "2026-10-11", NOW)).toBe("2026-10-10");
    // A house ahead of UTC is already on tomorrow's date: still its today.
    expect(statedOrderDay("today", "2026-10-12", NOW)).toBe("2026-10-12");
    expect(
      statedOrderDay(
        "yesterday",
        "2026-03-01",
        new Date("2026-03-01T09:00:00Z"),
      ),
    ).toBe("2026-02-28");
  });

  it("is nothing on Don't know, whatever the phone says", () => {
    expect(statedOrderDay("unknown", null, NOW)).toBeNull();
    expect(statedOrderDay("unknown", "1999-01-01", NOW)).toBeNull();
  });

  it("refuses a phone whose date is off, rather than writing a wrong day", () => {
    expect(() => statedOrderDay("today", "2026-10-14", NOW)).toThrow(
      HttpException,
    );
    expect(() => statedOrderDay("yesterday", null, NOW)).toThrow(/Don't know/);
    expect(() => statedOrderDay("today", "2026-02-30", NOW)).toThrow(
      HttpException,
    );
  });
});

function input(over: Partial<LogAtDoorInput> = {}): LogAtDoorInput {
  return {
    restaurantId: "house-1",
    userId: "user-1",
    role: "staff",
    key: "7f6c1c2e-1111-4a2b-9c3d-000000000001",
    providerId: "prov-1",
    inventoryId: "inv-1",
    quantity: 2,
    unit: "case",
    bottlesPerCase: 6,
    orderedOn: "yesterday",
    phoneToday: new Date().toISOString().slice(0, 10),
    clientCapturedAt: null,
    signedByInitials: "AK",
    ...over,
  };
}

type DepMocks = Record<keyof LogAtDoorDeps, jest.Mock>;

function deps(over: Partial<DepMocks> = {}): DepMocks & LogAtDoorDeps {
  const d: DepMocks = {
    findLogged: jest.fn().mockResolvedValue(null),
    createOrder: jest
      .fn()
      .mockResolvedValue({ id: "order-1", orderNumber: "ORD-2026-00001" }),
    recordDoorReceipt: jest
      .fn()
      .mockResolvedValue({ alreadyRecorded: false, stockBooked: true } as any),
    ...over,
  };
  return d as DepMocks & LogAtDoorDeps;
}

describe("logDeliveryAtDoor — one tap writes the order and counts it in", () => {
  it("writes a retroactive order, already delivered, with the stated day and the tap as its placement", async () => {
    const d = deps();
    const today = new Date().toISOString().slice(0, 10);
    const out = await logDeliveryAtDoor(d, input());
    expect(d.createOrder).toHaveBeenCalledTimes(1);
    const [rid, uid, dto, provenance] = d.createOrder.mock.calls[0];
    expect(rid).toBe("house-1");
    expect(uid).toBe("user-1");
    expect(dto).toMatchObject({
      inventoryId: "inv-1",
      providerId: "prov-1",
      quantity: 2,
      unitType: "case",
      bottlesPerUnit: 6,
      placementId: input().key,
    });
    // No price: the door shows none, the paper sets it at the desk.
    expect(dto).not.toHaveProperty("finalPrice");
    expect(provenance).toEqual({
      source: "retroactive",
      alreadyFulfilled: {
        deliveredAt: null,
        invoiceTotal: null,
        placedOnStated: statedOrderDay("yesterday", today),
      },
    });
    expect(out).toMatchObject({
      orderId: "order-1",
      orderNumber: "ORD-2026-00001",
      loggedAtDoor: true,
      orderAlreadyWritten: false,
    });
  });

  it("counts the delivery into stock through the ordinary door receipt", async () => {
    const d = deps();
    await logDeliveryAtDoor(d, input());
    expect(d.recordDoorReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "house-1",
        orderId: "order-1",
        userId: "user-1",
        countedQty: 2,
        countedUom: "case",
        packSize: 6,
        outcome: "accepted",
        expectedQtyInCountedUom: 2,
        idempotencyKey: `logged-at-door:${input().key}`,
        signedByInitials: "AK",
        role: "staff",
      }),
    );
  });

  it("on a retry reuses the order the first attempt wrote, and never writes a second", async () => {
    const d = deps({
      findLogged: jest
        .fn()
        .mockResolvedValue({ id: "order-0", orderNumber: "ORD-2026-00000" }),
    });
    const out = await logDeliveryAtDoor(d, input({ orderedOn: "unknown" }));
    expect(d.findLogged).toHaveBeenCalledWith("house-1", input().key);
    expect(d.createOrder).not.toHaveBeenCalled();
    expect(d.recordDoorReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-0",
        idempotencyKey: `logged-at-door:${input().key}`,
      }),
    );
    expect(out.orderAlreadyWritten).toBe(true);
  });

  it("writes nothing when it cannot tell whether the tap already wrote an order", async () => {
    const d = deps({
      findLogged: jest.fn().mockRejectedValue(new Error("db down")),
    });
    await expect(logDeliveryAtDoor(d, input())).rejects.toMatchObject({
      response: { reason: "logged_order_unreadable" },
    });
    expect(d.createOrder).not.toHaveBeenCalled();
    expect(d.recordDoorReceipt).not.toHaveBeenCalled();
  });

  it("says the order exists and the count did not land, with the order's id", async () => {
    const d = deps({
      recordDoorReceipt: jest
        .fn()
        .mockRejectedValue(new Error("stock write failed")),
    });
    await expect(logDeliveryAtDoor(d, input())).rejects.toMatchObject({
      response: {
        reason: "logged_but_not_counted",
        orderId: "order-1",
        message: expect.stringMatching(
          /as order ORD-2026-00001.*did not reach stock.*again/,
        ),
      },
    });
  });

  it("refuses a case with no bottle count before anything is written", async () => {
    const d = deps();
    await expect(
      logDeliveryAtDoor(d, input({ bottlesPerCase: null })),
    ).rejects.toMatchObject({ response: { reason: "case_needs_bottles" } });
    expect(d.findLogged).not.toHaveBeenCalled();
    expect(d.createOrder).not.toHaveBeenCalled();
  });

  it("counts bottles with no pack size", async () => {
    const d = deps();
    await logDeliveryAtDoor(
      d,
      input({ unit: "bottle", bottlesPerCase: null, quantity: 9 }),
    );
    expect(d.createOrder.mock.calls[0][2]).not.toHaveProperty("bottlesPerUnit");
    expect(d.recordDoorReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        countedQty: 9,
        countedUom: "bottle",
        packSize: null,
      }),
    );
  });
});

describe("an order read says Logged at door (F-669)", () => {
  const svc = new ProcurementService({} as any, {} as any, {} as any) as any;
  const row = {
    id: "o1",
    order_number: "ORD-1",
    restaurant_id: "house-1",
    inventory_id: "inv-1",
    provider_id: "prov-1",
    quantity: 2,
    status: "PARTIALLY_RECEIVED",
  };

  it("is true for source 'retroactive' and carries the stated day", () => {
    const wire = svc.mapOrderRow({
      ...row,
      source: "retroactive",
      placed_on_stated: "2026-10-10",
    });
    expect(wire.loggedAtDoor).toBe(true);
    expect(wire.placedOnStated).toBe("2026-10-10");
  });

  it("is false for an order the house placed, and absent where source was not read", () => {
    expect(
      svc.mapOrderRow({ ...row, source: "manual", placed_on_stated: null }),
    ).toMatchObject({ loggedAtDoor: false, placedOnStated: null });
    const unread = svc.mapOrderRow(row);
    expect("loggedAtDoor" in unread && unread.loggedAtDoor !== undefined).toBe(
      false,
    );
    expect(unread.placedOnStated).toBeUndefined();
  });
});

describe("POST /procurement/orders/logged-at-door", () => {
  it("is wired to the door's count and the order writer", async () => {
    const procurement = {
      createOrder: jest
        .fn()
        .mockResolvedValue({ id: "order-9", orderNumber: "ORD-9" }),
    };
    const receiving = {
      findLoggedAtDoorOrder: jest.fn().mockResolvedValue(null),
      recordDoorReceipt: jest.fn().mockResolvedValue({ stockBooked: true }),
    };
    const ctrl = new ProcurementController(
      procurement as any,
      receiving as any,
    );
    const out = await ctrl.logAtDoor(
      {
        key: input().key,
        providerId: "prov-1",
        inventoryId: "inv-1",
        quantity: 4,
        unit: "bottle",
        orderedOn: "unknown",
      } as any,
      { userId: "user-1", restaurantId: "house-1", role: "staff" },
    );
    expect(out).toMatchObject({
      orderId: "order-9",
      loggedAtDoor: true,
      placedOnStated: null,
    });
    expect(procurement.createOrder.mock.calls[0][3]).toMatchObject({
      source: "retroactive",
    });
    expect(receiving.recordDoorReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-9", countedQty: 4 }),
    );
  });

  it("answers 503 and writes nothing when the door count is not wired", async () => {
    const procurement = { createOrder: jest.fn() };
    const ctrl = new ProcurementController(procurement as any);
    await expect(
      ctrl.logAtDoor({ key: input().key } as any, {
        userId: "u",
        restaurantId: "h",
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(procurement.createOrder).not.toHaveBeenCalled();
  });
});
