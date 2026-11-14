/**
 * r31 walk w2, F4: the notice for a closed delivery whose stock was not
 * given back read "... retrying books exactly what is missing.. Those
 * bottles ...": a doubled stop, and the BOOKING's sentence quoted about a
 * give-back. A refused give-back is now said as one, and the notice keeps one
 * stop. SYNTHETIC ids.
 */
import { DatabaseService } from "../../database/database.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { DeliveryClockService } from "./delivery-clock.service";
import { DeliveryService } from "./delivery.service";
import { DeliveryStockService, givingBackFailure } from "./delivery-stock.service";
import { makeMockDb, makeMockNotifications } from "./delivery-mock";

function client(dbMessage: string) {
  const tables: Record<string, unknown> = {
    deliveries: { id: "del-1", state: "REJECTED", order_id: null },
    inventory_transactions: [{ inventory_id: "item-1", quantity_change: 6 }],
  };
  const from = (t: string) => {
    const chain: Record<string, unknown> = {};
    for (const v of ["select", "eq", "in", "order"]) chain[v] = () => chain;
    chain.maybeSingle = async () => ({ data: tables[t] ?? null, error: null });
    chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: tables[t] ?? [], error: null }).then(r);
    return chain;
  };
  return { getClient: () => ({ from, rpc: async () => ({ data: null, error: { message: dbMessage } }) }) };
}

describe("a refused give-back says why, as a give-back (r31 w2 F4)", () => {
  it("below zero: the shelf and the return it could not hold", () => {
    expect(givingBackFailure("stock would go negative: 4 + -6")).toBe(
      "giving it back would take the shelf below zero (4 on hand, 6 to give back)",
    );
    expect(givingBackFailure("stock would go negative: 2.5 + -6")).toContain("(2.5 on hand, 6 to give back)");
  });

  it("anything else is said as it came, with no stop of its own", () => {
    expect(givingBackFailure("connection reset.")).toBe("the shelf could not be moved (connection reset)");
  });

  it("reverse answers in give-back words, never the booking's", async () => {
    const stock = new DeliveryStockService(client("stock would go negative: 4 + -6") as unknown as DatabaseService);
    const back = await stock.reverse("rest-1", "del-1", "u1", "rejected: WRONG_VENUE");
    expect(back.ok).toBe(false);
    if (back.ok) return;
    expect(back.error).toBe("giving it back would take the shelf below zero (4 on hand, 6 to give back)");
    expect(back.error).not.toMatch(/books exactly what is missing/);
  });

  it("the house's notice has one stop between the reason and what follows", async () => {
    const db = makeMockDb();
    const notifications = makeMockNotifications();
    const clocks = new DeliveryClockService(db.client as unknown as DatabaseService, notifications as unknown as NotificationsService);
    jest.spyOn(clocks, "cancelFor").mockResolvedValue(undefined as never);
    const reverse = jest.fn().mockResolvedValue({ ok: false, status: 503, error: "the shelf could not be moved (boom)." });
    const svc = new DeliveryService(
      db.client as unknown as DatabaseService,
      clocks,
      notifications as unknown as NotificationsService,
      { reverse } as unknown as DeliveryStockService,
    );
    const r = await (svc as unknown as {
      returnTheDoorStock: (a: string, b: string, c: string | null, d: string) => Promise<{ returned: boolean; error?: string }>;
    }).returnTheDoorStock("rest-1", "del-1", "u1", "rejected");
    expect(r.returned).toBe(false);
    expect(r.error).toContain("was not given back: the shelf could not be moved (boom). Those bottles still count as stock.");
    expect(r.error).not.toContain("..");
  });
});
