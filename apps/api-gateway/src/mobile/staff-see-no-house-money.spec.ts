/**
 * Staff hold no house money (ADR 0145 `money` row, DASH-W22; DASH-G6 will
 * redraw the line with floor coverage). Two reads still carried it:
 *
 * - F-957 (rehit of F-202): `GET /mobile/today-pulse` sent tonight's takings to
 *   every role, so a waiter's Today strip read the house's night.
 * - F-958: `GET /logs/timeline/:id` sent every invoice's and credit note's total,
 *   and the price an agent moved an order from and to, though the document
 *   list and the document read already withhold `total` from a non-holder.
 *
 * The third, `GET /providers/:id/orders` (F-959), is pinned beside its house
 * scoping in `providers/provider-subresources-are-house-scoped.spec.ts`.
 *
 * Wave 69 walked the rest of the phone's reads (F-957 wider, F-958 rest):
 * - `GET /mobile/feed` put each order card's amount in `amount` and in the
 *   line under its title, for every role.
 * - `GET /procurement/orders/:id/conversations` (the phone's order screen)
 *   carried the order's quoted price on every letter.
 * - `GET /logs/timeline` cut only the inbound responder's moved prices from a
 *   decision; any other agent's output reached staff whole.
 * The cellar (`/inventory/*`), the supply lists and order read, the team week,
 * the insights and goals, and the notifications were already cut by role.
 */
import { MobileController } from "./mobile.controller";
import type { TodayPulseResponse } from "./dto/mobile.dto";
import { MobileService } from "./mobile.service";
import { LogsTimelineService } from "../logs/logs-timeline.service";
import { ProcurementController } from "../procurement/procurement.controller";
import type { ProcurementService } from "../procurement/procurement.service";
import type { DatabaseService } from "../database/database.service";

const PULSE: TodayPulseResponse = {
  salesState: "known",
  revenueToday: 48250,
  checksToday: 61,
  revenueLastWeek: 41000,
  deltaPct: 18,
  pendingDecisions: 3,
  criticalCount: 1,
  windowStart: "2026-10-10T21:00:00.000Z",
  windowEnd: "2026-10-11T18:00:00.000Z",
  generatedAt: "2026-10-11T18:00:00.000Z",
  currency: "TRY",
  locale: "tr-TR",
};

function mobile() {
  const service = { getTodayPulse: jest.fn().mockResolvedValue({ ...PULSE }) };
  return new MobileController(service as never, {} as never);
}

const NOT_HOLDERS = ["staff", null, undefined, "waiter"];

describe("today pulse by role (F-957)", () => {
  it.each(NOT_HOLDERS)(
    "sends %p no takings, no check count and no change on last week",
    async (role) => {
      const pulse = await mobile().getTodayPulse({
        userId: "u-1",
        restaurantId: "r-1",
        role,
      });

      expect(pulse.salesState).toBe("withheld");
      expect(pulse.revenueToday).toBeNull();
      expect(pulse.checksToday).toBeNull();
      expect(pulse.revenueLastWeek).toBeNull();
      expect(pulse.deltaPct).toBeNull();
      expect(JSON.stringify(pulse)).not.toMatch(/48250|41000/);
      // What is not money still arrives.
      expect(pulse.pendingDecisions).toBe(3);
      expect(pulse.criticalCount).toBe(1);
      expect(pulse.locale).toBe("tr-TR");
    },
  );

  it.each(["owner", "manager"])("sends %s tonight's takings", async (role) => {
    const pulse = await mobile().getTodayPulse({
      userId: "u-1",
      restaurantId: "r-1",
      role,
    });

    expect(pulse).toEqual(PULSE);
  });
});

/** Every query method returns the chain; awaiting it yields the table's rows. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const chain = (rows: Record<string, unknown>[]): any =>
    new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) =>
                resolve({ data: rows, error: null })
            : () => chain(rows),
      },
    );
  const client = { from: (table: string) => chain(tables[table] ?? []) };
  return { getClient: () => client } as unknown as DatabaseService;
}

describe("logs timeline by role (F-958)", () => {
  const timeline = () =>
    new LogsTimelineService(
      fakeDb({
        decision_log: [
          {
            id: "dl-1",
            agent_name: "inbound_responder",
            decision_type: "inbound_email_response",
            confidence: 0.9,
            correlation_id: null,
            created_at: "2026-09-20T12:00:00Z",
            output: {
              reasons: ["price_above_target"],
              order_change: {
                order_id: "o-1",
                status_from: "PENDING",
                status_to: "NEGOTIATING",
                negotiated_price_from: 1250,
                negotiated_price_to: 1180,
                agreed_price: 1180,
                written: true,
              },
            },
          },
        ],
        procurement_documents: [
          {
            id: "cn-1",
            doc_type: "credit_note",
            doc_number: "CN-7",
            status: "received",
            total: 48250,
            correlation_id: null,
            created_at: "2026-09-20T11:00:00Z",
          },
        ],
      }),
    );

  it.each(NOT_HOLDERS)(
    "sends %p no document total and no moved price",
    async (role) => {
      const res = await timeline().getTimeline("r1", { role });

      const doc = res.events.find((e) => e.source === "procurement_documents")!;
      const dec = res.events.find((e) => e.source === "decision_log")!;
      expect(doc.detail).not.toHaveProperty("total");
      expect(doc.detail).toMatchObject({
        docType: "credit_note",
        status: "received",
      });
      const output = dec.detail.output as any;
      expect(output.order_change).toEqual({
        order_id: "o-1",
        status_from: "PENDING",
        status_to: "NEGOTIATING",
        written: true,
      });
      expect(output.reasons).toEqual(["price_above_target"]);
      expect(JSON.stringify(res.events)).not.toMatch(/48250|1250|1180/);
      expect(res.amountsWithheld).toBe(true);
    },
  );

  it.each(["owner", "manager"])(
    "sends %s the total and the moved price",
    async (role) => {
      const res = await timeline().getTimeline("r1", { role });

      const doc = res.events.find((e) => e.source === "procurement_documents")!;
      const dec = res.events.find((e) => e.source === "decision_log")!;
      expect(doc.detail.total).toBe(48250);
      expect((dec.detail.output as any).order_change.agreed_price).toBe(1180);
      expect(res.amountsWithheld).toBeUndefined();
    },
  );
});

describe("decision feed by role (F-957)", () => {
  const feedService = () =>
    new MobileService(
      {
        supabase: {
          from: (table: string) => {
            const rows: Record<string, unknown[]> = {
              providers: [{ id: "p-1", name: "Acme Wines" }],
              restaurants: [{ currency: "TRY", locale: "tr-TR" }],
            };
            const b: any = {};
            for (const m of ["select", "eq", "in", "limit", "maybeSingle"])
              b[m] = () => b;
            b.then = (resolve: any, reject: any) =>
              Promise.resolve({ data: rows[table] ?? [], error: null }).then(
                resolve,
                reject,
              );
            return b;
          },
        },
      } as never,
      {
        listPendingOrders: async () => [
          {
            id: "o-1",
            orderNumber: "PO-1",
            wineName: "Barolo",
            providerId: "p-1",
            quantity: 2,
            unitType: "case",
            totalCost: 48250,
            requestedAt: "2026-10-10T10:00:00.000Z",
          },
        ],
      } as never,
      { getPendingConversations: async () => [] } as never,
      { getUnreadNotifications: async () => [] } as never,
    );

  it.each(NOT_HOLDERS)(
    "gives %p the order card with no amount",
    async (role) => {
      const feed = await feedService().getFeed("u-1", "r-1", role);

      const card = feed.items[0];
      expect(card.kind).toBe("order_approval");
      expect(card.amount).toBeNull();
      expect(card.subtitle).toBe("2 cases · Acme Wines");
      expect(JSON.stringify(feed)).not.toMatch(/48[.,]?250/);
      expect(feed.amountsWithheld).toBe(true);
      expect(feed.counts.orderApprovals).toBe(1);
    },
  );

  it.each(["owner", "manager"])("gives %s the order's amount", async (role) => {
    const feed = await feedService().getFeed("u-1", "r-1", role);

    expect(feed.items[0].amount).toBe(48250);
    expect(feed.items[0].subtitle).toMatch(/48[.,]250/);
    expect(feed.amountsWithheld).toBeUndefined();
  });

  it("passes the token's role from the route to the feed", async () => {
    const service = { getFeed: jest.fn().mockResolvedValue({ items: [] }) };
    const controller = new MobileController(service as never, {} as never);

    await controller.getFeed({
      userId: "u-1",
      restaurantId: "r-1",
      role: "staff",
    });

    expect(service.getFeed).toHaveBeenCalledWith("u-1", "r-1", "staff");
  });
});

describe("an order's letters by role (F-957, the phone's order screen)", () => {
  const LETTER = {
    id: "c-1",
    orderId: "o-1",
    direction: "INBOUND",
    orderNumber: "PO-1",
    quantity: 2,
    quotedPrice: 1250,
    providerName: "Acme Wines",
  };
  const controller = () =>
    new ProcurementController({
      getOrderConversations: jest.fn().mockResolvedValue([{ ...LETTER }]),
    } as unknown as ProcurementService);

  it.each(NOT_HOLDERS)(
    "gives %p the letters without the order's quoted price",
    async (role) => {
      const out = (await controller().getOrderConversations("o-1", {
        userId: "u-1",
        restaurantId: "r-1",
        role,
      })) as Record<string, unknown>[];

      expect(out[0]).not.toHaveProperty("quotedPrice");
      expect(out[0]).toMatchObject({
        id: "c-1",
        orderNumber: "PO-1",
        providerName: "Acme Wines",
        amountsWithheld: true,
      });
    },
  );

  it.each(["owner", "manager"])("gives %s the quoted price", async (role) => {
    const out = (await controller().getOrderConversations("o-1", {
      userId: "u-1",
      restaurantId: "r-1",
      role,
    })) as Record<string, unknown>[];

    expect(out[0]).toEqual(LETTER);
  });
});

describe("logs timeline: every agent's decision and the event store (F-958)", () => {
  const timeline = () =>
    new LogsTimelineService(
      fakeDb({
        decision_log: [
          {
            id: "dl-2",
            agent_name: "ReportingAgent",
            decision_type: "nightly_report",
            confidence: 0.8,
            correlation_id: "corr-1",
            created_at: "2026-09-20T12:00:00Z",
            output: {
              reasons: ["night_closed"],
              net_sales: 98765,
              recommended_action: "Raise the Barolo to 2400 a bottle",
              lines: [{ wine: "Barolo", cost: 4321 }],
            },
          },
        ],
        event_store: [
          {
            event_id: "ev-1",
            aggregate_type: "inventory",
            aggregate_id: "inv-1",
            event_type: "lot_received",
            correlation_id: "corr-1",
            created_at: "2026-09-20T12:01:00Z",
            payload: { unit_cost: 5555, restaurant_id: "r1" },
          },
        ],
        restaurant_inventory: [{ id: "inv-1" }],
      }),
    );

  it.each(NOT_HOLDERS)(
    "gives %p another agent's decision without its figures or its advice",
    async (role) => {
      const res = await timeline().getTimeline("r1", {
        role,
        correlationId: "corr-1",
      });

      const dec = res.events.find((e) => e.source === "decision_log")!;
      expect(dec.detail.output).toEqual({ reasons: ["night_closed"] });
      expect(dec.detail.agentName).toBe("ReportingAgent");
      expect(JSON.stringify(res.events)).not.toMatch(/98765|4321|2400|5555/);
    },
  );

  it("gives an owner the agent's whole output", async () => {
    const res = await timeline().getTimeline("r1", {
      role: "owner",
      correlationId: "corr-1",
    });

    const dec = res.events.find((e) => e.source === "decision_log")!;
    expect((dec.detail.output as any).net_sales).toBe(98765);
  });

  // A pin, not a fix: the event store's payload never leaves the gateway for
  // any role; only its aggregate and event type are sent.
  it.each(["staff", "owner"])(
    "sends %s the event store row without its payload",
    async (role) => {
      const res = await timeline().getTimeline("r1", {
        role,
        correlationId: "corr-1",
      });

      const ev = res.events.find((e) => e.source === "event_store")!;
      expect(ev.detail).toEqual({
        aggregateType: "inventory",
        aggregateId: "inv-1",
        eventType: "lot_received",
      });
    },
  );
});
