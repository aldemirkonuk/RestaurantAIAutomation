import { DatabaseService } from "../../database/database.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { DeliveryClockService } from "./delivery-clock.service";
import { DeliveryService } from "./delivery.service";
import { DeliveryStockService } from "./delivery-stock.service";
import { makeMockDb, MockDb } from "./delivery-mock";

/**
 * r34 walk w2 F3: "a closed delivery's stock is still on the shelf" is told to
 * the people who can give it back.
 *
 * The notice went to every member of the house, staff included, while only an
 * owner or a manager may press "give the stock back"
 * (`POST deliveries/:id/return-stock`, `assertSettlesDeliveryMoney`). It now
 * goes to the house's owners and managers. When they cannot be read, or the
 * house has none on record, it still goes to the whole house: a stuck shelf
 * nobody hears about is the worse failure. SYNTHETIC ids.
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
const failed = {
  ok: false,
  status: 500,
  error: "giving it back would take the shelf below zero (4 on hand, 6 to give back)",
};

type Sent = {
  restaurantId: string;
  payload: Record<string, unknown>;
  opts: Record<string, unknown> | undefined;
};

describe("who hears that a closed delivery's stock was not given back (r34 w2 F3)", () => {
  let db: MockDb;
  let sent: Sent[];
  let service: DeliveryService;

  const build = (
    authority:
      | { ownersAndManagers: (rid: string) => Promise<{ owners: string[]; managers: string[] }> }
      | undefined,
    result: unknown = failed,
  ) => {
    db = makeMockDb();
    db.reset();
    sent = [];
    const notifications = {
      persistForRestaurant: async (
        restaurantId: string,
        payload: Record<string, unknown>,
        opts?: Record<string, unknown>,
      ) => {
        sent.push({ restaurantId, payload, opts });
        return { inserted: 1, ids: ["n-1"] };
      },
    };
    const clocks = new DeliveryClockService(
      db.client as unknown as DatabaseService,
      notifications as unknown as NotificationsService,
    );
    jest.spyOn(clocks, "cancelFor").mockResolvedValue(undefined as never);
    service = new DeliveryService(
      db.client as unknown as DatabaseService,
      clocks,
      notifications as unknown as NotificationsService,
      { reverse: jest.fn(async () => result) } as unknown as DeliveryStockService,
      authority as never,
    );
  };

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

  it("[REVERT-FAILS] a rejection whose stock did not go back tells the owners and managers only", async () => {
    const ownersAndManagers = jest.fn(async () => ({
      owners: ["owner-1"],
      managers: ["mgr-1", "owner-1"],
    }));
    build({ ownersAndManagers });
    const res = await reject();
    expect(res.ok && res.value.stockReturn).toMatchObject({ returned: false });
    expect(ownersAndManagers).toHaveBeenCalledWith(REST);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({
      type: "delivery_stock_not_returned",
      priority: "high",
    });
    expect(sent[0].opts).toEqual({
      dedupeWithinMinutes: 60,
      onlyUserIds: ["owner-1", "mgr-1"],
    });
  });

  it("[REVERT-FAILS] a retry that fails again tells the same people", async () => {
    build({
      ownersAndManagers: async () => ({ owners: ["owner-1"], managers: [] }),
    });
    db.answers.deliveries = { data: row("REJECTED"), error: null };
    const res = await service.returnStock(REST, DEL, "mgr-1");
    expect(res.ok && res.value.stockReturn.returned).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].opts).toMatchObject({ onlyUserIds: ["owner-1"] });
  });

  it("when the owners and managers cannot be read, the whole house is still told", async () => {
    build({
      ownersAndManagers: async () => {
        throw new Error("user_restaurant_access: timeout");
      },
    });
    await reject();
    expect(sent).toHaveLength(1);
    expect(sent[0].opts).toEqual({ dedupeWithinMinutes: 60 });
  });

  it("a house with no owner or manager on record tells the whole house", async () => {
    build({ ownersAndManagers: async () => ({ owners: [], managers: [] }) });
    await reject();
    expect(sent).toHaveLength(1);
    expect(sent[0].opts).toEqual({ dedupeWithinMinutes: 60 });
  });

  it("a server without the authority service tells the whole house", async () => {
    build(undefined);
    await reject();
    expect(sent).toHaveLength(1);
    expect(sent[0].opts).toEqual({ dedupeWithinMinutes: 60 });
  });

  it("a return that went tells nobody and asks for nobody", async () => {
    const ownersAndManagers = jest.fn(async () => ({ owners: ["owner-1"], managers: [] }));
    build({ ownersAndManagers }, {
      ok: true,
      value: { deliveryId: DEL, bottlesReturned: 6 },
    });
    await reject();
    expect(sent).toEqual([]);
    expect(ownersAndManagers).not.toHaveBeenCalled();
  });
});
