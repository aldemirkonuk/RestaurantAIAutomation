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
 */
import { MobileController } from "./mobile.controller";
import type { TodayPulseResponse } from "./dto/mobile.dto";
import { LogsTimelineService } from "../logs/logs-timeline.service";
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
