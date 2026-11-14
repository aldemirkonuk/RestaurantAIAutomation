import { DatabaseService } from "../../database/database.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { DeliveryClockService } from "./delivery-clock.service";
import { DeliveryService } from "./delivery.service";
import { DeliveryStockService } from "./delivery-stock.service";
import { makeMockDb, makeMockNotifications, MockDb } from "./delivery-mock";

/**
 * r28 invoices audit, G2: a closed delivery whose stock did not go back says so.
 *
 * A rejection reverses what the door booked. When that failed, the failure was
 * only logged: the delivery read REJECTED, the answer was a success, and no
 * route could try again. Now the answer carries `stockReturn`, the house is
 * notified once, and `returnStock` retries. SYNTHETIC ids.
 */

const REST = "rest-1";
const DEL = "del-1";
const row = (state: string) => ({
  id: DEL,
  restaurant_id: REST,
  provider_id: "prov-1",
  order_id: null,
  state,
  provenance: "UNORDERED",
});

describe("a closed delivery's stock return (r28 G2)", () => {
  let db: MockDb;
  let notifications: ReturnType<typeof makeMockNotifications>;
  let reverse: jest.Mock;
  let service: DeliveryService;

  const build = (result: unknown) => {
    db = makeMockDb();
    db.reset();
    notifications = makeMockNotifications();
    reverse = jest.fn(async () => result);
    const clocks = new DeliveryClockService(
      db.client as unknown as DatabaseService,
      notifications as unknown as NotificationsService,
    );
    jest.spyOn(clocks, "cancelFor").mockResolvedValue(undefined as never);
    service = new DeliveryService(
      db.client as unknown as DatabaseService,
      clocks,
      notifications as unknown as NotificationsService,
      { reverse } as unknown as DeliveryStockService,
    );
  };
  const failed = {
    ok: false,
    status: 500,
    error: "stock would go negative: 2 + -6",
  };

  describe("rejecting on WRONG_VENUE", () => {
    const reject = () => {
      db.answers.deliveries = { data: row("DELIVERED"), error: null };
      db.insertAnswers.delivery_proposals = { data: { id: "p-1" }, error: null };
      db.updateAnswers.deliveries = { data: row("REJECTED"), error: null };
      return service.propose(REST, DEL, "u1", {
        side: "restaurant",
        reason: "WRONG_VENUE",
        note: "not this house's goods",
      });
    };

    it("a failed return is in the answer in words, and the house is told once, by delivery", async () => {
      build(failed);
      const res = await reject();
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.delivery.state).toBe("REJECTED");
      expect(res.value.stockReturn).toEqual({
        returned: false,
        error: expect.stringContaining("stock would go negative: 2 + -6"),
      });
      expect(res.value.stockReturn).toMatchObject({
        error: expect.stringMatching(/was not given back.*still count as stock.*give the stock back from the delivery/),
      });
      expect(notifications.sent).toHaveLength(1);
      expect(notifications.sent[0]).toMatchObject({
        restaurantId: REST,
        payload: {
          type: "delivery_stock_not_returned",
          priority: "high",
          groupKey: `delivery-stock-not-returned:${DEL}`,
          actionUrl: `/deliveries/${DEL}`,
          metadata: { deliveryId: DEL },
        },
      });
      expect(reverse).toHaveBeenCalledWith(REST, DEL, "u1", "rejected: WRONG_VENUE");
    });

    it("a return that went says how many bottles, and tells nobody", async () => {
      build({ ok: true, value: { deliveryId: DEL, bottlesReturned: 6 } });
      const res = await reject();
      expect(res.ok && res.value.stockReturn).toEqual({ returned: true, bottlesReturned: 6 });
      expect(notifications.sent).toEqual([]);
    });

    it("a proposal that rejects nothing returns nothing and carries no stockReturn", async () => {
      build(failed);
      db.answers.deliveries = { data: row("DELIVERED"), error: null };
      db.insertAnswers.delivery_proposals = { data: { id: "p-2" }, error: null };
      db.updateAnswers.deliveries = { data: row("RECONCILING"), error: null };
      const res = await service.propose(REST, DEL, "u1", { side: "restaurant", reason: "SHORT_SHIP" });
      expect(res.ok).toBe(true);
      expect(res.ok && "stockReturn" in res.value).toBe(false);
      expect(reverse).not.toHaveBeenCalled();
    });
  });

  describe("returnStock, the retry", () => {
    it.each(["REJECTED", "CANCELLED"])("a %s delivery tries again and reports what moved", async (state) => {
      build({ ok: true, value: { deliveryId: DEL, bottlesReturned: 6 } });
      db.answers.deliveries = { data: row(state), error: null };
      const res = await service.returnStock(REST, DEL, "u2");
      expect(res).toEqual({
        ok: true,
        value: { deliveryId: DEL, stockReturn: { returned: true, bottlesReturned: 6 } },
      });
      expect(reverse).toHaveBeenCalledWith(REST, DEL, "u2", `${state.toLowerCase()}: stock given back again`);
    });

    it("a retry that fails again says so and notifies", async () => {
      build(failed);
      db.answers.deliveries = { data: row("REJECTED"), error: null };
      const res = await service.returnStock(REST, DEL, "u2");
      expect(res.ok && res.value.stockReturn.returned).toBe(false);
      expect(notifications.sent).toHaveLength(1);
    });

    it.each(["DELIVERED", "RECONCILING", "AGREED", "VERIFIED", "LAPSED"])(
      "an open or settled %s delivery keeps its stock: 409, nothing moved",
      async (state) => {
        build(failed);
        db.answers.deliveries = { data: row(state), error: null };
        const res = await service.returnStock(REST, DEL, "u2");
        expect(res).toEqual({
          ok: false,
          status: 409,
          error: expect.stringContaining(`This delivery is ${state}, so its stock stays`),
        });
        expect(reverse).not.toHaveBeenCalled();
      },
    );

    it("a delivery not at this house is 404, and a failed read is 500", async () => {
      build(failed);
      db.answers.deliveries = { data: null, error: null };
      expect(await service.returnStock(REST, DEL, "u2")).toEqual({ ok: false, status: 404, error: "Delivery not found" });
      db.answers.deliveries = { data: null, error: { message: "boom" } };
      const broke = await service.returnStock(REST, DEL, "u2");
      expect(broke.ok === false && broke.status).toBe(500);
      expect(reverse).not.toHaveBeenCalled();
    });
  });
});
