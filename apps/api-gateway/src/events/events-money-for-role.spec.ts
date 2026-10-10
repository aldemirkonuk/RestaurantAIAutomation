import { EventsService } from "./events.service";
import { EventType, SourcePage } from "./dto/event.dto";
import { isMoneyKey } from "./event-money-for-role";

/**
 * F-1065: `GET /events` and the `event:new` socket carried every order's
 * `totalCost` to staff (the order-change event the order reads' cuts missed,
 * F-433/F-958). Staff see no house money (ADR 0145, the F-957..F-959 call):
 * a non-holder's read leaves money keys out at every depth, and the shared
 * socket room (`restaurant:<id>`, which staff join) gets the row without them.
 */

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ORDER_ROW = {
  id: "e-1",
  restaurant_id: HOUSE,
  user_id: "u-1",
  event_type: "order_change",
  source_page: "orders",
  payload: {
    type: "approved",
    orderId: "o-1",
    quantity: 12,
    bottlesTotal: 12,
    status: "approved",
    totalCost: 552,
    data: { price: 46, notes: "by the case" },
    lines: [{ unitCost: 46, wineName: "Barolo" }],
  },
  schema_version: 1,
  idempotency_key: null,
  trace_id: null,
  correlation_id: null,
  created_at: "2026-10-10T10:00:00Z",
};

const PLAIN_ROW = {
  ...ORDER_ROW,
  id: "e-2",
  event_type: "inventory_change",
  payload: { wineId: "w-1", quantity: -1, previousQuantity: 7 },
};

function service(rows: Record<string, unknown>[]) {
  const emitted: { room: string; event: string; data: any }[] = [];
  const q: Record<string, any> = {};
  const self = () => q;
  q.select = self;
  q.eq = self;
  q.gt = self;
  q.lt = self;
  q.order = self;
  q.range = async () => ({ data: rows, error: null, count: rows.length });
  q.insert = self;
  q.single = async () => ({ data: rows[0], error: null });
  const db = { supabase: { from: () => q } };
  const gateway = {
    server: {
      to: (room: string) => ({
        emit: (event: string, data: unknown) =>
          emitted.push({ room, event, data }),
      }),
    },
  };
  const svc = new EventsService(db as never, gateway as never);
  return { svc, emitted };
}

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

describe("money keys", () => {
  it.each(["totalCost", "price", "unitCost", "amount", "total", "subtotal"])(
    "%s is money",
    (k) => expect(isMoneyKey(k)).toBe(true),
  );
  it.each(["quantity", "bottlesTotal", "previousQuantity", "status", "notes"])(
    "%s is not",
    (k) => expect(isMoneyKey(k)).toBe(false),
  );
});

describe("GET /events carries no house money to staff (F-1065)", () => {
  it.each(["staff", null])(
    "role %p reads the order change without its total",
    async (role) => {
      const { svc } = service([ORDER_ROW, PLAIN_ROW]);
      const out = await svc.listEvents(HOUSE, {}, role);
      const [order, plain] = out.events as any[];
      expect(order.payload).toEqual({
        type: "approved",
        orderId: "o-1",
        quantity: 12,
        bottlesTotal: 12,
        status: "approved",
        data: { notes: "by the case" },
        lines: [{ wineName: "Barolo" }],
      });
      expect(order.amountsWithheld).toBe(true);
      // Nothing was cut from a payload with no money in it.
      expect(plain.payload).toEqual(PLAIN_ROW.payload);
      expect(plain).not.toHaveProperty("amountsWithheld");
    },
  );

  it.each(["owner", "manager"])("%s reads the total", async (role) => {
    const { svc } = service([ORDER_ROW]);
    const out = await svc.listEvents(HOUSE, {}, role);
    const [order] = out.events as any[];
    expect(order.payload.totalCost).toBe(552);
    expect(order).not.toHaveProperty("amountsWithheld");
  });
});

describe("the event:new socket carries no house money to the shared room (F-1065)", () => {
  it("emits the order change to restaurant:<id> without its money", async () => {
    const { svc, emitted } = service([ORDER_ROW]);
    await svc.createEvent(HOUSE, "u-1", {
      eventType: EventType.ORDER_CHANGE,
      sourcePage: SourcePage.ORDERS,
      payload: ORDER_ROW.payload,
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].room).toBe(`restaurant:${HOUSE}`);
    expect(emitted[0].event).toBe("event:new");
    expect(JSON.stringify(emitted[0].data)).not.toMatch(/552|"price"|unitCost/);
    expect(emitted[0].data.payload.orderId).toBe("o-1");
    expect(emitted[0].data.amountsWithheld).toBe(true);
  });
});
