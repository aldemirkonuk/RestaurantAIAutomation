import { HttpException } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { DatabaseService } from "../database/database.service";

/**
 * The day sheet under the month (sim wave 10, 2026-10-09):
 *
 *  - F-430 an order's expected delivery date is a day on the HOUSE's
 *          calendar. "Overdue" read it as UTC midnight, so in Los Angeles an
 *          order due tomorrow turned overdue at 17:00 today.
 *  - F-431 a past day said "No recorded activity" because the sheet only had
 *          the newest twelve lines. The activity read now takes the house's
 *          day and bounds every leg to it on the house's wall clock.
 */

function makeClient(rowsByTable: Record<string, any[]>) {
  const filters: Record<string, unknown[][]> = {};
  const passthrough = [
    "select",
    "eq",
    "is",
    "in",
    "gte",
    "lt",
    "order",
    "limit",
  ];
  const client = {
    filters,
    from: jest.fn((table: string) => {
      const builder: any = {};
      const asked: unknown[][] = [];
      (filters[table] ??= []).push(asked);
      for (const method of passthrough)
        builder[method] = jest.fn((...args: unknown[]) => {
          asked.push([method, ...args]);
          return builder;
        });
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(
          resolve,
          reject,
        );
      return builder;
    }),
  };
  return client;
}

const LA = [{ timezone: "America/Los_Angeles", country: "US" }];

const due = (id: string, date: string) => ({
  id,
  status: "IN_TRANSIT",
  expected_delivery_date: date,
  created_at: "2026-09-20T10:00:00Z",
});

describe("dashboard day sheet", () => {
  const db = { getClient: jest.fn() };
  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    // 18:00 on Oct 3 in Los Angeles; already Oct 4 in UTC.
    jest.useFakeTimers().setSystemTime(new Date("2026-10-04T01:00:00Z"));
    service = new DashboardService(db as unknown as DatabaseService);
  });

  afterEach(() => jest.useRealTimers());

  describe("F-430 — overdue is read on the house's calendar", () => {
    it("an order due tomorrow is not overdue this evening", async () => {
      db.getClient.mockReturnValue(
        makeClient({
          restaurants: LA,
          procurement_orders: [
            due("tomorrow", "2026-10-04"),
            due("today", "2026-10-03"),
            due("yesterday", "2026-10-02"),
          ],
        }),
      );

      const alerts = await service.getAlerts("r1");

      expect(alerts.map((a) => a.id)).toEqual(["overdue-yesterday"]);
    });

    it("with no zone, a date is overdue only once it has passed everywhere", async () => {
      db.getClient.mockReturnValue(
        makeClient({
          restaurants: [{ timezone: null, country: null }],
          procurement_orders: [
            due("oct3", "2026-10-03"),
            due("oct2", "2026-10-02"),
          ],
        }),
      );

      const alerts = await service.getAlerts("r1");

      // It is 13:00 on Oct 3 at UTC-12, so Oct 3 is not over everywhere yet.
      expect(alerts.map((a) => a.id)).toEqual(["overdue-oct2"]);
    });
  });

  describe("F-431 — a day's activity is that day's own lines", () => {
    it("bounds every leg to the house's day", async () => {
      const client = makeClient({ restaurants: LA });
      db.getClient.mockReturnValue(client);

      await service.getActivity("r1", 100, "2026-09-14");

      // Sept 14 in Los Angeles (PDT, UTC-7) runs 07:00Z to 07:00Z next day.
      const start = "2026-09-14T07:00:00.000Z";
      const end = "2026-09-15T07:00:00.000Z";
      for (const [table, column] of [
        ["procurement_orders", "updated_at"],
        ["events", "created_at"],
        ["restaurant_inventory", "updated_at"],
      ]) {
        const [asked] = client.filters[table];
        expect(asked).toEqual(
          expect.arrayContaining([
            ["gte", column, start],
            ["lt", column, end],
            ["limit", 100],
          ]),
        );
      }
    });

    it("refuses a dated read for a house with no zone, rather than answering empty", async () => {
      db.getClient.mockReturnValue(
        makeClient({ restaurants: [{ timezone: null, country: null }] }),
      );

      const err = await service
        .getActivity("r1", 100, "2026-09-14")
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(409);
    });

    it("an undated read is unbounded, as Lately reads it", async () => {
      const client = makeClient({ restaurants: LA });
      db.getClient.mockReturnValue(client);

      await service.getActivity("r1", 12);

      expect(client.from).not.toHaveBeenCalledWith("restaurants");
      for (const table of ["procurement_orders", "events"]) {
        const methods = client.filters[table][0].map((a) => (a as unknown[])[0]);
        expect(methods).not.toContain("gte");
      }
    });
  });
});
