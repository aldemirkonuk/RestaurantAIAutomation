import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import {
  pacingOver,
  pacingWords,
  purchasingSpan,
  PurchasingSpan,
} from "./purchasing-span";
import { houseToday, shiftHouseDay } from "../common/house-day";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";
import { EXPORT_CUTTINGS } from "../reports/exports/report-export-cuttings";

/**
 * Spend pacing starts at the house's first purchase order (r36 reports audit
 * gap 1, cashflow half). Before it the days are unknown, not days without
 * buying.
 */

const DAYS = 180;
/** 180 UTC house days ending yesterday, oldest first. */
const dates = (() => {
  const today = houseToday("UTC");
  return Array.from({ length: DAYS }, (_, i) => shiftHouseDay(today, i - DAYS));
})();
/** The same spend every day of the last `n` days, zero before. */
const steady = (n: number, perDay = 100) =>
  dates.map((_, i) => (i >= DAYS - n ? perDay : 0));
/** The span of a house whose first order was `n` days before today. */
const youngSpan = (n: number) =>
  purchasingSpan(dates, { read: "read", day: dates[DAYS - n] });

describe("purchasingSpan", () => {
  it("a first order older than the window counts the whole window", () => {
    expect(purchasingSpan(dates, { read: "read", day: "2020-01-01" })).toEqual({
      windowDays: 180,
      observedDays: 180,
      since: null,
      firstRecord: "read",
    });
  });

  it("a first order on the window's first day counts the whole window", () => {
    expect(
      purchasingSpan(dates, { read: "read", day: dates[0] }).since,
    ).toBeNull();
  });

  it("a first order inside the window counts the days from it to yesterday", () => {
    expect(youngSpan(40)).toEqual({
      windowDays: 180,
      observedDays: 40,
      since: dates[140],
      firstRecord: "read",
    });
  });

  it("a house with no order has no day of records", () => {
    expect(purchasingSpan(dates, { read: "read", day: null })).toMatchObject({
      observedDays: 0,
      firstRecord: "none",
    });
  });

  it("an unreadable first order falls back to the whole window", () => {
    expect(
      purchasingSpan(dates, { read: "could_not_read", day: null }),
    ).toMatchObject({ observedDays: 180, firstRecord: "could_not_read" });
  });
});

describe("pacingOver: the pace and the projection read records only", () => {
  it("a 40-day house buying the same each day has no pace and no earlier window", () => {
    const p = pacingOver(steady(40), youngSpan(40));
    // Zero-filled, this read +200%: 3,000 against the 1,000 of ten days.
    expect(p.spendLast30d).toBe(3000);
    expect(p.spendPrev30d).toBeNull();
    expect(p.paceDeltaPct).toBeNull();
  });

  it("59 days of records still state no pace; 60 do", () => {
    expect(pacingOver(steady(59), youngSpan(59)).paceDeltaPct).toBeNull();
    const p = pacingOver(steady(60), youngSpan(60));
    expect(p.spendPrev30d).toBe(3000);
    expect(p.paceDeltaPct).toBe(0);
  });

  it("a steady house's projection is flat, not a climb from its opening", () => {
    const p = pacingOver(steady(40), youngSpan(40));
    expect(p.weeks).toBe(5);
    expect(p.projectedNext4Weeks).toHaveLength(4);
    for (const v of p.projectedNext4Weeks as number[])
      expect(Math.abs(v - 700)).toBeLessThan(0.01);
  });

  it("the zero-filled weeks would have drawn a climb (the defect, measured)", () => {
    const whole: PurchasingSpan = {
      windowDays: 180,
      observedDays: 180,
      since: null,
      firstRecord: "read",
    };
    const wrong = pacingOver(steady(40), whole).projectedNext4Weeks as number[];
    expect(wrong[3]).toBeGreaterThan(900);
  });

  it("a projection needs four complete weeks: 28 days draw one, 27 do not", () => {
    expect(pacingOver(steady(28), youngSpan(28)).projectedNext4Weeks).toHaveLength(4);
    const p = pacingOver(steady(27), youngSpan(27));
    expect(p.weeks).toBe(3);
    expect(p.projectedNext4Weeks).toBeNull();
  });

  it("an older house keeps 25 complete weeks ending yesterday", () => {
    const p = pacingOver(steady(180), purchasingSpan(dates, { read: "read", day: "2020-01-01" }));
    expect(p.weeks).toBe(25);
    expect(p.spendPrev30d).toBe(3000);
  });

  it("a house with no order projects nothing", () => {
    const p = pacingOver(steady(0), purchasingSpan(dates, { read: "read", day: null }));
    expect(p.projectedNext4Weeks).toBeNull();
    expect(p.spendPrev30d).toBeNull();
  });
});

describe("pacingWords", () => {
  it("a young house names its first order, the withheld pace and the weeks it lacks", () => {
    const span = youngSpan(20);
    expect(pacingWords(span, pacingOver(steady(20), span))).toBe(
      `read over the 20 days since ${dates[160]}, the house's first purchase order: the days before it are not counted as days without buying, so the 30 days before last are not a full window of records and no pace is stated; no projection: it needs 4 complete weeks of purchase orders and there are 2`,
    );
  });

  it("an older house's sentence is unchanged", () => {
    const span = purchasingSpan(dates, { read: "read", day: "2020-01-01" });
    expect(pacingWords(span, pacingOver(steady(180), span))).toBe(
      "the projection runs on 25 complete weeks ending yesterday",
    );
  });

  it("one week says 'is 1'", () => {
    const span = youngSpan(9);
    expect(pacingWords(span, pacingOver(steady(9), span))).toMatch(/and there is 1$/);
  });

  it("an unreadable first order says the whole window is counted", () => {
    const span = purchasingSpan(dates, { read: "could_not_read", day: null });
    expect(pacingWords(span, pacingOver(steady(180), span))).toBe(
      "the house's first purchase order could not be read, so all 180 days are counted and the figures run low if the house is younger than that; the projection runs on 25 complete weeks ending yesterday",
    );
  });

  it("no order says so", () => {
    const span = purchasingSpan(dates, { read: "read", day: null });
    expect(pacingWords(span, pacingOver(steady(0), span))).toBe(
      "the house has no purchase order yet, so nothing is paced or projected",
    );
  });
});

/* ── getCashflow end to end, over a small PostgREST-like stub ── */

const RID = "55555555-5555-5555-5555-555555555555";
const ago = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const order = (i: number, at: string, cost = 100) => ({
  id: `po-${String(i).padStart(5, "0")}`,
  provider_id: "p1",
  providers: { name: "Vendor" },
  total_cost: cost,
  final_price: cost,
  bottles_total: 1,
  quantity: 1,
  created_at: at,
  delivered_at: at,
  expected_delivery_date: null,
  status: ProcurementOrderStatus.DELIVERED,
});

function stub(orders: any[], opts: { firstFails?: boolean } = {}) {
  const calls: Array<{ method: string; args: any[] }> = [];
  return {
    calls,
    from(table: string) {
      const rows =
        table === "restaurants"
          ? [{ id: RID, timezone: "UTC", country: null }]
          : table === "procurement_orders"
            ? orders
            : [];
      let orderBy = "id";
      let lim: number | null = null;
      let cursor: string | null = null;
      const b: any = {};
      for (const m of ["eq", "in", "gte", "or"]) b[m] = () => b;
      b.select = () => b;
      b.order = (col: string) => {
        calls.push({ method: "order", args: [table, col] });
        orderBy = col;
        return b;
      };
      b.gt = (col: string, v: unknown) => {
        if (col === "id") cursor = String(v);
        return b;
      };
      b.limit = (n: number) => {
        lim = n;
        return b;
      };
      b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
      b.then = (resolve: any, reject: any) => {
        if (opts.firstFails && orderBy === "created_at")
          return Promise.resolve({
            data: null,
            error: { message: "canceling statement due to statement timeout" },
          }).then(resolve, reject);
        const sorted = [...rows].sort((x, y) =>
          String(x[orderBy]).localeCompare(String(y[orderBy])),
        );
        const past = cursor == null ? sorted : sorted.filter((r) => String(r.id) > cursor!);
        const page = past.slice(0, lim ?? 1000);
        return Promise.resolve({ data: page, error: null, count: past.length }).then(
          resolve,
          reject,
        );
      };
      return b;
    },
  };
}

const cashflowOver = (client: any) =>
  new AdvancedAnalyticsService(
    { getClient: () => client } as any,
    {} as any,
    {} as any,
    {} as any,
  ).getCashflow(RID) as Promise<any>;

/** One order a day, every day from `n` days ago to yesterday. */
const daily = (n: number) =>
  Array.from({ length: n }, (_, i) => order(i, ago(n - i)));

describe("getCashflow starts at the house's first purchase order", () => {
  it("reads the first order by created_at, one row, for this house", async () => {
    const client = stub(daily(40));
    await cashflowOver(client);
    expect(client.calls).toContainEqual({
      method: "order",
      args: ["procurement_orders", "created_at"],
    });
  });

  it("a 40-day house states no pace and no earlier window, and says why", async () => {
    const out = await cashflowOver(stub(daily(40)));
    expect(out.spendLast30d).toBe(3000);
    expect(out.spendPrev30d).toBeNull();
    expect(out.paceDeltaPct).toBeNull();
    expect(out.basis.outflow).toContain("the house's first purchase order");
    expect(out.basis.outflow).toContain("no pace is stated");
    expect(out.projectedNext4Weeks).toHaveLength(4);
  });

  it("a 100-day house keeps its pace", async () => {
    const out = await cashflowOver(stub(daily(100)));
    expect(out.spendPrev30d).toBe(3000);
    expect(out.paceDeltaPct).toBe(0);
    expect(out.basis.outflow).not.toContain("no pace is stated");
  });

  it("a delivery recorded lately but dated 100 days ago starts the records there", async () => {
    const backdated = { ...order(999, ago(1)), delivered_at: ago(100) };
    const out = await cashflowOver(stub([...daily(40), backdated]));
    expect(out.spendPrev30d).toBe(1000);
    expect(out.paceDeltaPct).not.toBeNull();
    expect(out.basis.outflow).toContain("read over the 100 days since");
  });

  it("a house with no order paces and projects nothing", async () => {
    const out = await cashflowOver(stub([]));
    expect(out.projectedNext4Weeks).toBeNull();
    expect(out.basis.outflow).toContain("no purchase order yet");
  });

  it("an unreadable first order counts the whole window and says so", async () => {
    const out = await cashflowOver(stub(daily(40), { firstFails: true }));
    expect(out.spendPrev30d).toBe(1000);
    expect(out.basis.outflow).toContain("could not be read");
  });
});

describe("the pacing export says why the earlier window is withheld", () => {
  const prevCell = (payload: object) =>
    EXPORT_CUTTINGS.pacing
      .write(payload, { days: null })
      .figures.find((x: any) => x.label === "Paid out, the 30 days before") as any;

  it("a young house: the records do not cover it", () => {
    const cell = prevCell({
      spendLast30d: 3000,
      spendPrev30d: null,
      paceDeltaPct: null,
      projectedNext4Weeks: null,
      committedOpenOrders: 0,
      openOrderCount: 0,
    });
    expect(JSON.stringify(cell)).toContain(
      "the house's purchase orders do not yet cover the 30 days before last",
    );
  });

  it("a register with no figure at all keeps its own reason", () => {
    const cell = prevCell({ spendLast30d: null, spendPrev30d: null });
    expect(JSON.stringify(cell)).toContain("the cashflow register returned no figure");
  });
});
