/**
 * r110 onboarding (DD-r109-22 (2), DD-r110-19): a live or csv check that lands
 * on a house-day holding imported till history replaces it, and the ingest
 * answer says so. The deletion itself is the trigger's and is pinned in
 * supabase/tests/20270302100200_a_till_day_is_counted_once_test.sql; here the
 * words, the window and the 1000-row cap.
 */
import { PosHubService } from "./pos-hub.service";
import {
  HISTORY_WINDOW_DAYS,
  historyWindow,
  readHistoryDayCounts,
  sayHistoryReplaced,
} from "./history-replaced";

function makeClient() {
  const upserts: any[] = [];
  const q: any = {};
  for (const m of ["select", "eq", "in", "is", "gte", "lte", "or", "order", "limit", "range", "update"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: null, error: null });
  q.single = async () => ({ data: null, error: null });
  q.then = (res: any) => res({ data: [], count: 0, error: null });
  const client: any = {
    from: () => ({
      ...q,
      upsert: async (row: any) => {
        upserts.push(row);
        return { data: null, error: null };
      },
      insert: async () => ({ data: null, error: null }),
    }),
    rpc: async () => ({ data: null, error: null }),
  };
  return { client, upserts };
}

const CHECK = {
  externalCheckId: "live-1",
  tableRef: "T1",
  openedAt: "2026-11-20T17:00:00.000Z",
  closedAt: "2026-11-20T18:00:00.000Z",
  voided: false,
  total: 95,
  items: [],
  raw: null,
};

describe("an ingest says which days of imported history its checks replaced", () => {
  function hub(before: Map<string, number> | null, after: Map<string, number> | null) {
    const { client, upserts } = makeClient();
    const reads: { restaurantId: string; window: { from: string; to: string } }[] = [];
    const tillHistory = {
      read: jest.fn(async (restaurantId: string, window: { from: string; to: string }) => {
        reads.push({ restaurantId, window });
        return reads.length === 1 ? before : after;
      }),
    };
    const svc = new PosHubService(
      { getClient: () => client, supabase: client } as any,
      undefined,
      undefined,
      undefined,
      tillHistory as any,
    );
    jest.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);
    jest.spyOn((svc as any).logger, "log").mockImplementation(() => undefined);
    return { svc, reads, upserts, tillHistory };
  }

  it("import, then a live check on that day: the answer names the day, and the check is stored once", async () => {
    const { svc, reads, upserts } = hub(new Map([["2026-11-20", 2], ["2026-11-21", 1]]), new Map([["2026-11-21", 1]]));
    const out: any = await svc.ingest("h1", "generic_webhook", [CHECK]);
    expect(upserts).toHaveLength(1);
    expect(out.upserted).toBe(1);
    expect(reads.map((r) => r.restaurantId)).toEqual(["h1", "h1"]);
    expect(reads[0].window).toEqual({ from: "2026-11-19", to: "2026-11-21" });
    expect(out.historyReplaced).toEqual({
      days: ["2026-11-20"],
      daysCount: 1,
      itemDays: 2,
      said: "The till's own checks now hold 1 day that had imported history, so that history was removed and each day is counted once: 2026-11-20.",
    });
  });

  it("a house with no history reads once and answers null", async () => {
    const { svc, tillHistory } = hub(new Map(), new Map());
    const out: any = await svc.ingest("h1", "generic_webhook", [CHECK]);
    expect(tillHistory.read).toHaveBeenCalledTimes(1);
    expect(out.historyReplaced).toBeNull();
  });

  it("an unread count stores the check and names nothing", async () => {
    const { svc } = hub(null, null);
    const out: any = await svc.ingest("h1", "generic_webhook", [CHECK]);
    expect(out.upserted).toBe(1);
    expect(out.historyReplaced).toBeNull();
  });

  it("without the seam the hub reads nothing", async () => {
    const { client } = makeClient();
    const svc = new PosHubService({ getClient: () => client, supabase: client } as any);
    jest.spyOn((svc as any).logger, "log").mockImplementation(() => undefined);
    const out: any = await svc.ingest("h1", "generic_webhook", [CHECK]);
    expect(out.historyReplaced).toBeNull();
  });
});

describe("historyWindow", () => {
  it("is every date a check names, one day either side, and null with none readable", () => {
    expect(
      historyWindow([
        { openedAt: "2026-11-20T23:30:00Z", closedAt: null },
        { openedAt: "2026-11-02T10:00:00+03:00", closedAt: "2026-11-02T11:00:00+03:00" },
      ]),
    ).toEqual({ from: "2026-11-01", to: "2026-11-21" });
    expect(historyWindow([{ openedAt: "not a date", closedAt: "sometime on Tuesday" }])).toBeNull();
  });
});

describe("readHistoryDayCounts", () => {
  it("reads in spans under the 1000-row cap and joins them", async () => {
    const calls: any[] = [];
    const client = {
      rpc: async (fn: string, args: any) => {
        calls.push({ fn, ...args });
        return { data: [{ sale_date: args.p_from, item_days: 3 }], error: null };
      },
    };
    const counts = await readHistoryDayCounts(client, "h1", { from: "2024-01-01", to: "2026-12-31" });
    expect(calls.every((c) => c.fn === "pos_sales_history_day_counts" && c.p_restaurant_id === "h1")).toBe(true);
    for (const c of calls) {
      const days = (Date.parse(c.p_to) - Date.parse(c.p_from)) / 86_400_000 + 1;
      expect(days).toBeLessThanOrEqual(HISTORY_WINDOW_DAYS);
    }
    expect(calls[0].p_from).toBe("2024-01-01");
    expect(calls[calls.length - 1].p_to).toBe("2026-12-31");
    expect(counts?.size).toBe(calls.length);
  });

  it("is null when a span cannot be read", async () => {
    expect(await readHistoryDayCounts({ rpc: async () => ({ data: null, error: { message: "x" } }) }, "h1", { from: "2026-11-01", to: "2026-11-02" })).toBeNull();
    expect(
      await readHistoryDayCounts({ rpc: async () => { throw new Error("no rpc"); } }, "h1", { from: "2026-11-01", to: "2026-11-02" }),
    ).toBeNull();
  });
});

describe("sayHistoryReplaced", () => {
  it("names only the days whose count fell, and counts the item-days gone", () => {
    const out = sayHistoryReplaced(
      new Map([["2026-11-22", 4], ["2026-11-20", 2], ["2026-11-21", 1]]),
      new Map([["2026-11-21", 1], ["2026-11-23", 9]]),
    );
    expect(out.days).toEqual(["2026-11-20", "2026-11-22"]);
    expect(out.itemDays).toBe(6);
    expect(out.said).toContain("2 days");
    expect(sayHistoryReplaced(new Map([["2026-11-20", 2]]), new Map([["2026-11-20", 2]])).said).toBeNull();
  });
});
