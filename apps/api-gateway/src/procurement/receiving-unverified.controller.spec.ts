import { ReceivingController } from "./receiving.controller";
import { ReceivingService } from "./receiving.service";

/**
 * GET /procurement/receiving/unverified reads two lists (R10). The
 * door-counted one is a side read: when it fails, the order door's list still
 * answers, and the response says the door-counted list is unknown rather than
 * empty (mail-receipts fix round 2026-11-12, finding on #1096).
 */
const user = { restaurantId: "11111111-1111-1111-1111-111111111111" } as never;
const orderItem = {
  orderId: "o-1",
  orderNumber: "PO-1",
  countedQtyBottles: 12,
  ageHours: 5,
  severity: "fresh",
};

function controllerWith(svc: Partial<Record<keyof ReceivingService, unknown>>) {
  return new ReceivingController(svc as unknown as ReceivingService);
}

describe("ReceivingController.unverified (R10)", () => {
  it("keeps the order door's list when the door-counted read fails, and says so", async () => {
    const c = controllerWith({
      listUnverified: async () => [orderItem],
      listDoorCountedWithoutPaper: async () => {
        throw new Error("deliveries: connection reset");
      },
    });
    const res = await c.unverified(user);
    expect(res.items).toEqual([orderItem]);
    expect(res.doorCounted).toEqual([]);
    expect(res.doorCountedFailed).toBe(true);
    expect(res.doorCountedComplete).toBe(false);
    expect(res.summary).toContain("1 delivery counted by case");
  });

  it("lists door-counted deliveries beside the order door's, once each", async () => {
    const c = controllerWith({
      listUnverified: async () => [orderItem],
      listDoorCountedWithoutPaper: async () => ({
        rows: [
          { deliveryId: "d-1", orderId: "o-1" },
          { deliveryId: "d-2", orderId: null },
        ],
        capped: false,
      }),
    });
    const res = await c.unverified(user);
    expect(res.doorCounted.map((d) => d.deliveryId)).toEqual(["d-2"]);
    expect(res.doorCountedFailed).toBe(false);
    expect(res.doorCountedComplete).toBe(true);
  });

  it("still fails as a whole when the order door's own list fails", async () => {
    const c = controllerWith({
      listUnverified: async () => {
        throw new Error("receipt events unreadable");
      },
      listDoorCountedWithoutPaper: async () => ({ rows: [], capped: false }),
    });
    await expect(c.unverified(user)).rejects.toThrow("receipt events unreadable");
  });
});
