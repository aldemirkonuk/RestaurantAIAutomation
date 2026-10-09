import { HttpException, ServiceUnavailableException } from "@nestjs/common";
import {
  WHOLE_READ_PAGE,
  WholeReadError,
  readWholeWindow,
} from "./read-whole-window";
import { GoalsService } from "../analytics/goals.service";
import { TableAnalyticsService } from "../analytics/table-analytics.service";
import { AdvancedAnalyticsService } from "../analytics/advanced-analytics.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { AnalyticsController } from "../analytics/analytics.controller";
import { RecommendationsService } from "../analytics/recommendations.service";
import { InsightGeneratorService } from "../analytics/insights/insight-generator.service";
import { DashboardService } from "../dashboard/dashboard.service";
import { RecordedDaysService } from "../calendar/recorded-days.service";

/**
 * ADR 0292 — analytics reads the whole window, page by page, or refuses.
 *
 * PostgREST stops every response at `max_rows` (1000, supabase/config.toml:18)
 * and says nothing. The double below does the same: every response is cut at
 * the server cap whatever was asked, which is the one property the old reads
 * never met. Every service case here was measured RED against origin/main
 * 8c673db4b (the read returned 1,000 rows) before the fix.
 *
 * The double honours eq / neq / gte / lte / lt / gt / in, `order`, `limit`,
 * `maybeSingle` / `single` and `select(…, { count: "exact" })`, whose count
 * is the size of the FILTERED set before the limit — a later page's count is
 * what lies past its cursor, exactly as PostgREST reports it.
 */

type Row = Record<string, any>;
type Filter = { op: string; col: string; val: any };

interface Behaviour {
  /** The server's max_rows. Defaults to 1000. */
  cap?: number;
  /** 1-based request numbers (per table) that answer with an error. */
  failOn?: number[];
  /** Added to the reported count on the given 1-based request numbers. */
  driftOn?: Record<number, number>;
  /** Never report a count, whatever the select asked for. */
  noCount?: boolean;
  /** A server that ignores the `.gt("id", …)` cursor. */
  ignoreCursor?: boolean;
  /** Rows come back with no `id`. */
  stripIds?: boolean;
}

interface Request {
  table: string;
  n: number;
  select?: string;
  count?: string;
  order?: string;
  gt?: string;
  limit?: number;
}

function asTime(v: unknown): number | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function compare(a: unknown, b: unknown): number {
  const ta = asTime(a);
  const tb = asTime(b);
  if (ta !== null && tb !== null) return ta - tb;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.col];
  switch (f.op) {
    case "eq":
      return String(v) === String(f.val);
    case "neq":
      return String(v) !== String(f.val);
    case "in":
      return (f.val as unknown[]).map(String).includes(String(v));
    case "gte":
      return v != null && compare(v, f.val) >= 0;
    case "gt":
      return v != null && compare(v, f.val) > 0;
    case "lte":
      return v != null && compare(v, f.val) <= 0;
    case "lt":
      return v != null && compare(v, f.val) < 0;
    default:
      throw new Error(`the double does not know .${f.op}()`);
  }
}

function cappedDb(
  tables: Record<string, Row[]>,
  behaviour: Record<string, Behaviour> = {},
) {
  const requests: Request[] = [];
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const perTable = new Map<string, number>();

  const client = {
    from(table: string) {
      const filters: Filter[] = [];
      const req: Partial<Request> & { write?: boolean } = { table };
      let single: "maybe" | "one" | null = null;
      const b: any = {};
      b.select = (cols: string, opts?: { count?: string }) => {
        req.select = cols;
        req.count = opts?.count;
        return b;
      };
      for (const op of ["eq", "neq", "gte", "lte", "lt", "in"]) {
        b[op] = (col: string, val: unknown) => {
          filters.push({ op, col, val });
          return b;
        };
      }
      b.gt = (col: string, val: string) => {
        if (col === "id") req.gt = val;
        else filters.push({ op: "gt", col, val });
        return b;
      };
      b.order = (col: string) => {
        req.order = col;
        return b;
      };
      b.limit = (n: number) => {
        req.limit = n;
        return b;
      };
      b.maybeSingle = () => {
        single = "maybe";
        return b;
      };
      b.single = () => {
        single = "one";
        return b;
      };
      for (const op of ["update", "insert", "upsert", "delete"]) {
        b[op] = (payload: unknown) => {
          req.write = true;
          writes.push({ table, op, payload });
          return b;
        };
      }
      const answer = () => {
        if (req.write) return { data: null, error: null };
        const n = (perTable.get(table) ?? 0) + 1;
        perTable.set(table, n);
        requests.push({ ...(req as Request), n });
        const be = behaviour[table] ?? {};
        if (be.failOn?.includes(n)) {
          return {
            data: null,
            error: {
              message: "canceling statement due to statement timeout",
              code: "57014",
            },
            count: null,
          };
        }
        let rows = (tables[table] ?? []).filter((r) =>
          filters.every((f) => matches(r, f)),
        );
        if (req.gt !== undefined && !be.ignoreCursor)
          rows = rows.filter((r) => String(r.id) > String(req.gt));
        if (req.order) {
          const col = req.order;
          rows = [...rows].sort((x, y) => compare(x[col], y[col]));
        }
        const count = rows.length + (be.driftOn?.[n] ?? 0);
        let out = rows.slice(
          0,
          Math.min(be.cap ?? 1000, req.limit ?? Infinity),
        );
        if (be.stripIds) out = out.map(({ id: _id, ...rest }) => rest);
        if (single) return { data: out[0] ?? null, error: null };
        return {
          data: out,
          error: null,
          count: req.count === "exact" && !be.noCount ? count : null,
        };
      };
      b.then = (resolve: any, reject: any) =>
        Promise.resolve().then(answer).then(resolve, reject);
      return b;
    },
  };
  const db = { getClient: () => client, supabase: client } as any;
  return { client, db, requests, writes };
}

/** An id whose order is NOT the rows' time order, as a uuid's is not. */
function scrambledId(i: number): string {
  const h = (i * 2654435761) % 4294967296;
  return `${h.toString(16).padStart(8, "0")}-${String(i).padStart(6, "0")}`;
}

/** `daysAgo` days before today (UTC), at 10:00Z plus `minute` minutes. */
function at(daysAgo: number, minute = 0): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return new Date(d.getTime() + (600 + minute) * 60000).toISOString();
}

/** `n` rows spread over days `first..last` ago, OLDEST FIRST in storage. */
function spread(
  n: number,
  first: number,
  last: number,
  make: (i: number, daysAgo: number, minute: number) => Row,
): Row[] {
  const days = first - last + 1;
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const daysAgo = first - Math.floor((i * days) / n);
    rows.push({ id: scrambledId(i), ...make(i, daysAgo, i % 240) });
  }
  return rows;
}

function checks(n: number, first = 56, last = 0): Row[] {
  return spread(n, first, last, (i, daysAgo, minute) => ({
    restaurant_id: "r1",
    voided: false,
    opened_at: at(daysAgo, minute),
    closed_at: at(daysAgo, minute + 30),
    total: 100 + (i % 7),
    covers: 2,
    tip: 10,
    items: [],
  }));
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const build =
  (client: any, table = "pos_checks") =>
  () =>
    client
      .from(table)
      .select("id, total", { count: "exact" })
      .eq("restaurant_id", "r1");

// ===========================================================================
// The helper
// ===========================================================================

describe("readWholeWindow — the window whole, or a refusal (ADR 0292)", () => {
  const rows = checks(3313);

  it("reads 3,313 rows whole, in id order, in 4 requests", async () => {
    const { client, requests } = cappedDb({ pos_checks: rows });
    const got = await readWholeWindow<Row>("the checks", build(client));
    expect(got).toHaveLength(3313);
    expect(new Set(got.map((r) => r.id)).size).toBe(3313);
    const ids = got.map((r) => String(r.id));
    expect(ids).toEqual([...ids].sort());
    expect(requests).toHaveLength(4);
    expect(requests.every((r) => r.order === "id" && r.limit === 1000)).toBe(
      true,
    );
    expect(WHOLE_READ_PAGE).toBe(1000);
  });

  it("issues no .gt on page 0 and the last id as the cursor after", async () => {
    const { client, requests } = cappedDb({ pos_checks: rows });
    const got = await readWholeWindow<Row>("the checks", build(client));
    expect(requests[0].gt).toBeUndefined();
    expect(requests[1].gt).toBe(String(got[999].id));
    expect(requests[3].gt).toBe(String(got[2999].id));
  });

  it("adopts a server cap lower than its page (500)", async () => {
    const { client, requests } = cappedDb(
      { pos_checks: rows },
      { pos_checks: { cap: 500 } },
    );
    const got = await readWholeWindow<Row>("the checks", build(client));
    expect(got).toHaveLength(3313);
    expect(requests[0].limit).toBe(1000);
    expect(requests.slice(1).every((r) => r.limit === 500)).toBe(true);
    expect(requests).toHaveLength(7);
  });

  it("refuses with read_failed on an error on page 3, never 2,000 rows", async () => {
    const { client } = cappedDb(
      { pos_checks: rows },
      { pos_checks: { failOn: [3] } },
    );
    const err = await readWholeWindow("the checks", build(client)).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(WholeReadError);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.getStatus()).toBe(503);
    expect(err.reason).toBe("read_failed");
    expect(err.rowsRead).toBe(2000);
    expect(err.count).toBe(3313);
    expect(err.message).toMatch(/could not be read whole/);
  });

  it("re-reads once when the count drifts, and returns the whole window", async () => {
    // A check lands between page 1 and page 2 of the first attempt only.
    const { client, requests } = cappedDb(
      { pos_checks: rows },
      { pos_checks: { driftOn: { 2: 1 } } },
    );
    const got = await readWholeWindow<Row>("the checks", build(client));
    expect(got).toHaveLength(3313);
    // 2 requests of the refused attempt, then 4 of the whole one.
    expect(requests).toHaveLength(6);
  });

  it("refuses as unstable when the count drifts on both attempts", async () => {
    const { client, requests } = cappedDb(
      { pos_checks: rows },
      { pos_checks: { driftOn: { 2: 1, 4: -1 } } },
    );
    const err = await readWholeWindow("the checks", build(client)).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(WholeReadError);
    expect(err.reason).toBe("unstable");
    expect(requests).toHaveLength(4);
  });

  it("refuses a count over the ceiling before asking for page 1", async () => {
    const { client, requests } = cappedDb({ pos_checks: rows });
    const err = await readWholeWindow("the checks", build(client), {
      ceiling: 3000,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(WholeReadError);
    expect(err.reason).toBe("row_ceiling");
    expect(requests).toHaveLength(1);
  });

  it("refuses a full page whose rows carry no id", async () => {
    const { client } = cappedDb(
      { pos_checks: rows },
      { pos_checks: { stripIds: true, noCount: true } },
    );
    const err = await readWholeWindow("the checks", build(client)).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(WholeReadError);
    expect(err.reason).toBe("malformed_page");
  });

  it("refuses rows with no id while a count is to be met", async () => {
    const { client } = cappedDb(
      { pos_checks: rows.slice(0, 10) },
      { pos_checks: { stripIds: true } },
    );
    const err = await readWholeWindow("the checks", build(client)).catch(
      (e) => e,
    );
    expect(err.reason).toBe("malformed_page");
  });

  it("refuses a cursor the server does not honour: the count says so first", async () => {
    // Page 2 counts the whole window again instead of what lies past page 1.
    const { client } = cappedDb(
      { pos_checks: rows },
      { pos_checks: { ignoreCursor: true } },
    );
    const err = await readWholeWindow("the checks", build(client)).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(WholeReadError);
    expect(err.reason).toBe("unstable");
  });

  it("refuses a cursor the server does not honour, with no count, on the repeated id", async () => {
    const { client } = cappedDb(
      { pos_checks: rows },
      { pos_checks: { ignoreCursor: true, noCount: true } },
    );
    const err = await readWholeWindow("the checks", build(client)).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(WholeReadError);
    expect(err.reason).toBe("cursor_stalled");
    expect(err.rowsRead).toBe(1000);
  });

  it("with no count reported, stops at a short page (the test-double path)", async () => {
    const { client, requests } = cappedDb(
      { pos_checks: rows },
      { pos_checks: { noCount: true } },
    );
    const got = await readWholeWindow<Row>("the checks", build(client));
    expect(got).toHaveLength(3313);
    expect(requests).toHaveLength(4);
  });

  it("answers an empty window with no rows and one request", async () => {
    const { client, requests } = cappedDb({ pos_checks: [] });
    await expect(readWholeWindow("the checks", build(client))).resolves.toEqual(
      [],
    );
    expect(requests).toHaveLength(1);
  });

  it("reads a window of exactly 2,000 rows in 2 requests", async () => {
    const { client, requests } = cappedDb({ pos_checks: rows.slice(0, 2000) });
    const got = await readWholeWindow<Row>("the checks", build(client));
    expect(got).toHaveLength(2000);
    expect(requests).toHaveLength(2);
  });
});

// ===========================================================================
// The readers. Each case FAILED at origin/main (1,000 rows) and passes now.
// ===========================================================================

function goalsOver(db: any): GoalsService {
  return new GoalsService(
    db,
    { getStored: async () => [] } as any,
    {} as any,
    {} as any,
    {} as any,
    { getFinancialSummary: async () => ({}) } as any,
  );
}

describe("GoalsService — the till and goal progress read the whole window", () => {
  const rows = checks(3313, 56, 0);
  // Every goal series is filed on the house's day (ADR 0296), so the house
  // needs a zone; "UTC" keeps these cases on the UTC days `at` writes.
  const restaurants = [{ id: "r1", timezone: "UTC", country: null }];

  it("getPosRevenueWindow(90) counts 3,313 checks, the full sum and the newest day", async () => {
    const { db } = cappedDb({ pos_checks: rows, restaurants });
    const w = await goalsOver(db).getPosRevenueWindow("r1", 90);
    expect(w.checkCount).toBe(3313);
    expect(w.revenue).toBe(sum(rows.map((r) => r.total)));
    const newest = [...rows.map((r) => r.closed_at.slice(0, 10))].sort().pop();
    expect(w.dailySeries[w.dailySeries.length - 1].date).toBe(newest);
  });

  it("asks for `items` only for the metrics that read them", async () => {
    const { db, requests } = cappedDb({ pos_checks: rows, restaurants });
    await goalsOver(db).getPosRevenueWindow("r1", 90);
    const window = requests.filter((r) => r.order === "id");
    expect(window.length).toBeGreaterThan(0);
    for (const r of window) {
      expect(r.select).toBe("id, total, opened_at, closed_at");
      expect(r.count).toBe("exact");
    }
    const { db: db2, requests: req2 } = cappedDb({
      pos_checks: rows,
      restaurants,
    });
    await (goalsOver(db2) as any).computeMetricWithSeries(
      "r1",
      "wine_revenue",
      at(80).slice(0, 10),
      undefined,
      "UTC",
    );
    expect(req2.filter((r) => r.order === "id")[0].select).toBe(
      "id, total, opened_at, closed_at, items",
    );
  });

  it("bottles_sold sums 1,500 consumption lines, not 1,000", async () => {
    const lines = spread(1500, 40, 1, (_i, daysAgo) => ({
      restaurant_id: "r1",
      consumption_type: "bottle",
      quantity: 2,
      volume_ml: null,
      created_at: at(daysAgo),
    }));
    const { db } = cappedDb({ wine_consumption_log: lines, restaurants });
    const out = await (goalsOver(db) as any).computeMetricWithSeries(
      "r1",
      "bottles_sold",
      at(60).slice(0, 10),
      undefined,
      "UTC",
    );
    expect(out.rowCount).toBe(1500);
    expect(out.current).toBe(3000);
  });

  it("a page-2 error throws WholeReadError instead of a partial revenue", async () => {
    // Request 1 is the "ever had a check" probe; 2 is page 0; 3 is page 1.
    const { db } = cappedDb(
      { pos_checks: rows, restaurants },
      { pos_checks: { failOn: [3] } },
    );
    const err = await goalsOver(db)
      .getPosRevenueWindow("r1", 90)
      .catch((e) => e);
    expect(err).toBeInstanceOf(WholeReadError);
    expect(err.reason).toBe("read_failed");
  });

  const goal = {
    id: "g1",
    restaurant_id: "r1",
    metric_key: "checks",
    target_value: 5000,
    created_at: at(60),
    period: "custom",
    direction: "at_least",
    deadline: null,
  };

  it("getGoalProgress stores the whole window's count as current_value", async () => {
    const { db, writes } = cappedDb({
      pos_checks: rows,
      analytics_goals: [goal],
      restaurants,
    });
    const out: any = await goalsOver(db).getGoalProgress("r1", "g1");
    expect(out.current).toBe(3313);
    const stored = writes.filter((w) => w.table === "analytics_goals");
    expect(stored).toHaveLength(1);
    expect((stored[0].payload as any).current_value).toBe(3313);
  });

  it("getGoalProgress writes no current_value from a refused read", async () => {
    // Request 1 is the "ever had a check" probe; request 2 is page 0.
    const { db, writes } = cappedDb(
      { pos_checks: rows, analytics_goals: [goal], restaurants },
      { pos_checks: { failOn: [2] } },
    );
    const err = await goalsOver(db)
      .getGoalProgress("r1", "g1")
      .catch((e) => e);
    expect(err).toBeInstanceOf(WholeReadError);
    expect(writes.filter((w) => w.table === "analytics_goals")).toEqual([]);
  });
});

describe("TableAnalyticsService — 'Who served it' ranks on every check", () => {
  // Maya's checks are stored first and are the smallest: the first 1,000 rows
  // a capped, unordered read returned put her FIRST by takings (A-006).
  const names = ["Maya", "Kerem", "Priya", "Deniz", "Lucas"];
  const perWaiter = [655, 671, 682, 673, 660];
  const rows: Row[] = [];
  names.forEach((name, w) => {
    for (let k = 0; k < perWaiter[w]; k++) {
      const i = rows.length;
      rows.push({
        id: scrambledId(i),
        restaurant_id: "r1",
        voided: false,
        server_name: name,
        server_external_id: null,
        table_id: null,
        opened_at: at(1 + (k % 50), k % 200),
        closed_at: at(1 + (k % 50), (k % 200) + 30),
        covers: 2,
        total: name === "Maya" ? 180 : 200,
        tip: null,
        items: [],
      });
    }
  });

  it("reads all 3,341 checks and puts Maya last", async () => {
    const { db } = cappedDb({ pos_checks: rows });
    const out: any = await new TableAnalyticsService(db).getWaiterPerformance(
      "r1",
      90,
    );
    expect(sum(out.waiters.map((w: any) => w.checks))).toBe(3341);
    expect(out.waiters[out.waiters.length - 1].name).toBe("Maya");
    expect(out.waiters[0].revenue).toBe(682 * 200);
  });

  it("a refused read is a 503, not an empty floor", async () => {
    const { db } = cappedDb(
      { pos_checks: rows },
      { pos_checks: { failOn: [2] } },
    );
    const err = await new TableAnalyticsService(db)
      .getWaiterPerformance("r1", 90)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.getStatus()).toBe(503);
    expect(err.message).toBe(
      "The POS checks could not be read, so nothing about them is claimed.",
    );
  });
});

describe("AdvancedAnalyticsService — menu engineering and seasonality count every unit", () => {
  const wines = ["M1", "M2", "M3", "M4", "M5"];
  const inventory = wines.map((m, i) => ({
    id: `inv-${i}`,
    restaurant_id: "r1",
    is_active: true,
    wine_name: `Wine ${m}`,
    stock_live: 10,
    menu_price_current: 50 + i,
    last_purchase_price: 20,
    master_wine_id: m,
    master_wine_library: { primary_type: "red" },
  }));
  const lines = spread(8445, 60, 1, (i, daysAgo) => ({
    restaurant_id: "r1",
    inventory_id: `inv-${i % 5}`,
    consumption_type: "bottle",
    quantity: 1,
    volume_ml: null,
    created_at: at(daysAgo, i % 300),
    restaurant_inventory: { master_wine_id: wines[i % 5] },
  }));

  const svc = (db: any) =>
    new AdvancedAnalyticsService(db, {} as any, {} as any, {} as any);

  it("getMenuEngineering classifies on 8,445 units", async () => {
    const { db } = cappedDb({
      restaurant_inventory: inventory,
      wine_consumption_log: lines,
    });
    const out: any = await svc(db).getMenuEngineering("r1", 90);
    const units = sum(out.items.map((i: any) => i.velocityPerDay * 90));
    expect(Math.round(units)).toBe(8445);
  });

  it("getSeasonality's weekday profile sums to 8,445 units", async () => {
    const { db } = cappedDb({
      restaurant_inventory: inventory,
      wine_consumption_log: lines,
    });
    const out: any = await svc(db).getSeasonality("r1", 90);
    const units = sum(out.weekdayProfile.map((d: any) => d.mean * d.n));
    expect(Math.round(units)).toBe(8445);
  });

  it("a refused consumption read reaches the caller instead of an empty menu", async () => {
    const { db } = cappedDb(
      { restaurant_inventory: inventory, wine_consumption_log: lines },
      { wine_consumption_log: { failOn: [2] } },
    );
    const err = await svc(db)
      .getMenuEngineering("r1", 90)
      .catch((e) => e);
    expect(err).toBeInstanceOf(WholeReadError);
  });
});

describe("AnalyticsService — the till list sums every consumption line", () => {
  it("getPosConsumptionBreakdown over 1,500 lines", async () => {
    const lines = spread(1500, 20, 1, (i, daysAgo) => ({
      restaurant_id: "r1",
      inventory_id: `inv-${i % 3}`,
      wine_name: `Wine ${i % 3}`,
      consumption_type: "bottle",
      quantity: 1,
      volume_ml: 750,
      total_revenue: 40,
      created_at: at(daysAgo),
      restaurant_inventory: {
        wine_name: `Wine ${i % 3}`,
        last_purchase_price: 15,
      },
    }));
    const { db } = cappedDb({ wine_consumption_log: lines });
    const from = at(30).slice(0, 10);
    const to = at(0).slice(0, 10);
    // The dates are house dates and the caller hands the house's zone (ADR
    // 0296). "UTC" keeps this case's window on the UTC days `at` writes.
    const out = await new AnalyticsService(db).getPosConsumptionBreakdown(
      "r1",
      from,
      to,
      "UTC",
    );
    expect(sum(out.map((r) => r.bottlesSold))).toBe(1500);
    expect(sum(out.map((r) => r.bottleRevenue ?? 0))).toBe(1500 * 40);
  });
});

describe("AnalyticsService — loadConsumption reads every line, or refuses (fork 3)", () => {
  // Feeds Wine 360's forecast14d (getDemandForecast), the financial summary,
  // risk and inventory science. Measured RED against origin/main e2cbe426a's
  // analytics.service.ts: it read 1,000 of these 1,500 lines.
  const lines = spread(1500, 20, 1, (_i, daysAgo) => ({
    restaurant_id: "r1",
    inventory_id: "inv-1",
    consumption_type: "bottle",
    quantity: 1,
    volume_ml: null,
    created_at: at(daysAgo),
    restaurant_inventory: { master_wine_id: "M1" },
  }));
  const consumptionRequests = (requests: Request[]) =>
    requests.filter((r) => r.table === "wine_consumption_log");

  it("reads all 1,500 lines in 2 requests", async () => {
    const { db, requests } = cappedDb({ wine_consumption_log: lines });
    const out = await (new AnalyticsService(db) as any).loadConsumption(
      "r1",
      90,
    );
    expect(out).toHaveLength(1500);
    expect(sum(out.map((c: any) => c.qty))).toBe(1500);
    expect(out.every((c: any) => c.masterWineId === "M1")).toBe(true);
    expect(consumptionRequests(requests)).toHaveLength(2);
  });

  it("getDemandForecast's history holds all 1,500 units", async () => {
    const { db } = cappedDb({ wine_consumption_log: lines });
    const out: any = await new AnalyticsService(db).getDemandForecast("r1");
    expect(sum(out.history.values)).toBe(1500);
  });

  // ---- A refused read (the founder, 2026-10-06, ADR 0292 fork 3: "Say
  // 'could not be read' (Recommended)"). Each case below was RED at
  // c05c41f4c, where loadConsumption returned [] and every lens computed as
  // if nothing had been poured.

  it("a refused page 2 throws WholeReadError, never [] and never 1,000 lines", async () => {
    const { db, requests } = cappedDb(
      { wine_consumption_log: lines },
      { wine_consumption_log: { failOn: [2] } },
    );
    const err = await (new AnalyticsService(db) as any)
      .loadConsumption("r1", 90)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WholeReadError);
    expect(err.reason).toBe("read_failed");
    expect(consumptionRequests(requests)).toHaveLength(2);
  });

  // A cellar and a year of buying the old code would have priced, so a
  // resolved lens below would carry real figures, not only nulls.
  const cellar = [
    {
      id: "inv-1",
      restaurant_id: "r1",
      is_active: true,
      wine_name: "Wine M1",
      stock_live: 12,
      menu_price_current: 60,
      last_purchase_price: 20,
      threshold_min: 2,
      master_wine_id: "M1",
      master_wine_library: { primary_type: "red" },
    },
  ];
  const bought = [
    {
      id: "o1",
      restaurant_id: "r1",
      provider_id: "p1",
      total_cost: 500,
      bottles_total: 24,
      status: "DELIVERED",
      delivered_at: at(10),
      created_at: at(12),
    },
  ];
  /** Every page of the pour log times out: each lens's read is refused. */
  const refusedEverywhere = () =>
    cappedDb(
      {
        wine_consumption_log: lines,
        restaurant_inventory: cellar,
        procurement_orders: bought,
      },
      {
        wine_consumption_log: {
          failOn: Array.from({ length: 60 }, (_x, i) => i + 1),
        },
      },
    );

  it.each([
    [
      "getFinancialSummary",
      (s: AnalyticsService) => s.getFinancialSummary("r1"),
    ],
    ["getRiskProfile", (s: AnalyticsService) => s.getRiskProfile("r1")],
    [
      "getInventoryScience",
      (s: AnalyticsService) => s.getInventoryScience("r1"),
    ],
    ["getDemandForecast", (s: AnalyticsService) => s.getDemandForecast("r1")],
  ])(
    "%s refuses with the sentence instead of figures computed without pours",
    async (_name, call) => {
      const { db } = refusedEverywhere();
      const err: any = await call(new AnalyticsService(db)).catch((e) => e);
      expect(err).toBeInstanceOf(WholeReadError);
      expect(err.message).toMatch(
        /^The consumption lines in this window could not be read whole: .*Nothing is reported from part of it\.$/,
      );
    },
  );

  it("the four routes answer the refusal sentence, never a 200 with figures", async () => {
    const { db } = refusedEverywhere();
    const none = {} as any;
    const controller = new AnalyticsController(
      new AnalyticsService(db),
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
    );
    for (const route of [
      () => controller.getFinancial("r1"),
      () => controller.getInventoryScience("r1"),
      () => controller.getRisk("r1"),
      () => controller.getForecast("r1"),
    ]) {
      const err: any = await route().catch((e) => e);
      // The routes' own catch maps any throw to a 500 that carries the
      // message; /reports prints "The … register could not be read (…)" for
      // any failed status (rp-format.ts failureLine), as it does for the 503
      // menu engineering answers.
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(500);
      expect(err.message).toMatch(/could not be read whole/);
    }
  });

  it("the overview names the three lenses as unread (null), not as figures", async () => {
    const { db } = refusedEverywhere();
    const advanced = new AdvancedAnalyticsService(
      db,
      new AnalyticsService(db),
      { getStored: async () => [] } as any,
      { listGoals: async () => [] } as any,
    );
    const out: any = await advanced.getOverview("r1");
    expect(out.financial).toBeNull();
    expect(out.risk).toBeNull();
    expect(out.inventory).toBeNull();
    expect(out.menuEngineering).toBeNull();
  });

  it("/recommendations names the three lenses in sourcesUnread", async () => {
    const { db, client } = refusedEverywhere();
    const svc = new RecommendationsService(
      new AnalyticsService(db),
      {
        getMenuEngineering: async () => null,
        getSeasonality: async () => null,
        getCashflow: async () => null,
      } as any,
      { generate: async () => ({ insights: [] }) } as any,
      { listGoals: async () => [] } as any,
      {
        readDispositions: async () => ({
          map: new Map(),
          readable: true,
          problem: null,
        }),
      } as any,
      { supabase: client, getClient: () => client } as any,
    );
    const out = await svc.getRecommendations("r1");
    expect(out.sourcesUnread).toEqual(
      expect.arrayContaining([
        "financial summary",
        "risk profile",
        "inventory science",
      ]),
    );
  });

  it("a days-of-stock goal is refused with the read, not scored from the lens", async () => {
    const { db } = refusedEverywhere();
    const goals = new GoalsService(
      db,
      { getStored: async () => [] } as any,
      {} as any,
      {} as any,
      {} as any,
      new AnalyticsService(db),
    );
    const err = await (goals as any)
      .computeMetricWithSeries(
        "r1",
        "days_of_inventory",
        at(30).slice(0, 10),
        undefined,
        undefined,
        // An owner's read: days of stock reads the till (ADR 0298, decision 9).
        { withSales: true },
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WholeReadError);
  });
});

describe("RecordedDaysService — a /calendar month reads every check", () => {
  it("windowFor over 2,121 checks draws every trading day", async () => {
    const from = at(40).slice(0, 10);
    const to = at(10).slice(0, 10);
    const rows = spread(2121, 40, 10, (i, daysAgo, minute) => ({
      restaurant_id: "r1",
      voided: false,
      opened_at: at(daysAgo, minute),
      closed_at: at(daysAgo, minute + 30),
      total: 90,
      covers: 3,
    }));
    const { db } = cappedDb({ pos_checks: rows, analytics_day_exclusions: [] });
    const out = await new RecordedDaysService(db).windowFor("r1", from, to);
    expect(out.refusal).toBeNull();
    expect(out.days).toHaveLength(31);
    expect(sum(out.days.map((d) => d.checkCount))).toBe(2121);
    expect(sum(out.days.map((d) => d.covers ?? 0))).toBe(2121 * 3);
  });

  it("a register read only in part returns the refusal, never days", async () => {
    const rows = checks(2121, 40, 10);
    const { db } = cappedDb(
      { pos_checks: rows },
      { pos_checks: { ignoreCursor: true } },
    );
    const out = await new RecordedDaysService(db).windowFor(
      "r1",
      at(40).slice(0, 10),
      at(10).slice(0, 10),
    );
    expect(out.days).toEqual([]);
    expect(out.refusal).toMatch(/could not be read whole/);
  });

  it("a failed page keeps the existing refusal sentence", async () => {
    const { db } = cappedDb(
      { pos_checks: checks(2121, 40, 10) },
      { pos_checks: { failOn: [2] } },
    );
    const out = await new RecordedDaysService(db).windowFor(
      "r1",
      at(40).slice(0, 10),
      at(10).slice(0, 10),
    );
    expect(out.days).toEqual([]);
    expect(out.refusal).toBe("The sales register could not be read.");
  });
});

describe("InsightGeneratorService — the bundle holds every check", () => {
  it("loadBundle reads 3,313 checks and 1,500 consumption lines", async () => {
    const lines = spread(1500, 40, 1, (_i, daysAgo) => ({
      restaurant_id: "r1",
      inventory_id: "inv-1",
      quantity: 1,
      volume_ml: null,
      created_at: at(daysAgo),
      restaurant_inventory: { master_wine_id: "M1" },
    }));
    const { db } = cappedDb({
      pos_checks: checks(3313, 56, 1),
      wine_consumption_log: lines,
    });
    const svc = new InsightGeneratorService(
      db,
      {
        load: async () => ({ dates: new Set<string>(), readable: true }),
      } as any,
      {} as any,
    );
    const bundle = await (svc as any).loadBundle("r1");
    expect(bundle.checks).toHaveLength(3313);
    expect(bundle.consumption).toHaveLength(1500);
    expect(bundle.availability.has("checks")).toBe(true);
  });

  it("a refused bundle read leaves that family silent, not partial", async () => {
    const { db } = cappedDb(
      { pos_checks: checks(3313, 56, 1) },
      { pos_checks: { failOn: [2] } },
    );
    const svc = new InsightGeneratorService(
      db,
      {
        load: async () => ({ dates: new Set<string>(), readable: true }),
      } as any,
      {} as any,
    );
    const bundle = await (svc as any).loadBundle("r1");
    expect(bundle.checks).toEqual([]);
    expect(bundle.availability.has("checks")).toBe(false);
  });
});

describe("DashboardService — the sales chart counts every glass", () => {
  it("getSalesChart('month') sums 1,500 consumption lines", async () => {
    const lines = spread(1500, 20, 1, (_i, daysAgo) => ({
      restaurant_id: "r1",
      volume_ml: 150,
      quantity: 1,
      created_at: at(daysAgo),
    }));
    const { db } = cappedDb({ wine_consumption_log: lines });
    const points = await new DashboardService(db).getSalesChart("r1", "month");
    expect(sum(points.map((p) => p.glasses))).toBe(1500);
  });

  it("a refused consumption read is thrown, not drawn as glasses = 0", async () => {
    const { db } = cappedDb(
      { wine_consumption_log: [] },
      { wine_consumption_log: { failOn: [1] } },
    );
    const err = await new DashboardService(db)
      .getSalesChart("r1", "month")
      .catch((e) => e);
    expect(err).toBeInstanceOf(WholeReadError);
  });
});
