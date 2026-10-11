/**
 * Reads past PostgREST's 1,000-row cap (wave 5 sweep, F-330..F-334).
 *
 * Every case below has more than 1,000 rows behind it, because that is the
 * only size at which these defects show: `supabase/config.toml:18` sets
 * `max_rows = 1000`, production answers the same (ADR 0292), and a response
 * past the cap is a 200 with the first thousand rows in it. The suites these
 * readers already had passed with a few rows each, which is how the cap went
 * unseen.
 *
 * The fake below behaves like PostgREST where these defects live: it honours
 * the filters, the orders and the limit, answers `count: "exact"` and
 * `head: true`, and caps every response at 1,000 rows. A read that does not
 * page, or that pages from the wrong end, therefore shows up as a wrong figure.
 */

import { ApprovalThresholdsService } from "../settings/approval-thresholds.service";
import { ProcurementService } from "../procurement/procurement.service";
import { SealChallengeService } from "./seal/seal-challenge.service";
import { PosHubService } from "../pos-hub/pos-hub.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { AdvancedAnalyticsService } from "../analytics/advanced-analytics.service";
import { GoalsService } from "../analytics/goals.service";
import { BeveragesService } from "../beverages/beverages.service";
import { InventoryService } from "../inventory/inventory.service";
import { WholeReadError, readForKeys } from "./read-whole-window";
import type { ThresholdRow } from "../settings/approval-thresholds";

const MAX_ROWS = 1000;
const R = "rest-1";
type Row = Record<string, any>;

function pathGet(row: Row, path: string): any {
  return path.split(".").reduce((v: any, k) => (v == null ? v : v[k]), row);
}

/** `%a%b%` / `*a*` as PostgREST reads an ILIKE pattern. */
function likeToRegex(pattern: string): RegExp {
  const body = pattern
    .split("")
    .map((ch) =>
      ch === "%" || ch === "*"
        ? ".*"
        : ch === "_"
          ? "."
          : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${body}$`, "is");
}

function cappedDb(
  tables: Record<string, Row[]>,
  errors: Record<string, { message: string; code?: string }> = {},
) {
  const reads: Array<{ table: string; returned: number }> = [];

  const builder = (table: string, source: () => Row[]) => {
    const filters: Array<(r: Row) => boolean> = [];
    const orders: Array<{ col: string; asc: boolean }> = [];
    let limitN: number | null = null;
    let offsetN = 0;
    let counted = false;
    let head = false;

    const settle = () => {
      if (errors[table]) {
        return { data: null, error: errors[table], count: null };
      }
      const rows = source().filter((r) => filters.every((f) => f(r)));
      const count = rows.length;
      const sorted = [...rows].sort((a, z) => {
        for (const o of orders) {
          const x = pathGet(a, o.col);
          const y = pathGet(z, o.col);
          if (x === y) continue;
          const lt = x < y ? -1 : 1;
          return o.asc ? lt : -lt;
        }
        return 0;
      });
      const data = sorted.slice(
        offsetN,
        offsetN + Math.min(limitN ?? Infinity, MAX_ROWS),
      );
      reads.push({ table, returned: data.length });
      return {
        data: head ? null : data,
        error: null,
        count: counted ? count : null,
      };
    };

    const q: any = {
      select: (_cols?: string, o?: { count?: string; head?: boolean }) => {
        if (o?.count === "exact") counted = true;
        if (o?.head) head = true;
        return q;
      },
      eq: (c: string, v: any) => (filters.push((r) => pathGet(r, c) === v), q),
      neq: (c: string, v: any) => (filters.push((r) => pathGet(r, c) !== v), q),
      is: (c: string, v: any) => (
        filters.push((r) => (pathGet(r, c) ?? null) === v),
        q
      ),
      in: (c: string, vs: any[]) => (
        filters.push((r) => vs.includes(pathGet(r, c))),
        q
      ),
      // Only `not(col, "is", null)` is modelled (F-1165's shelf-count read).
      not: (c: string, op: string, v: any) => {
        if (op === "is" && v === null)
          filters.push((r) => (pathGet(r, c) ?? null) !== null);
        return q;
      },
      gte: (c: string, v: any) => (filters.push((r) => pathGet(r, c) >= v), q),
      lte: (c: string, v: any) => (filters.push((r) => pathGet(r, c) <= v), q),
      gt: (c: string, v: any) => (filters.push((r) => pathGet(r, c) > v), q),
      ilike: (c: string, p: string) => {
        const re = likeToRegex(p);
        filters.push((r) => re.test(String(pathGet(r, c) ?? "")));
        return q;
      },
      // Only `col.ilike.pattern` clauses are modelled. Any other `or` (the
      // price register's tenancy clause) is not a filter these rows test.
      or: (expr: string) => {
        const clauses = expr
          .split(",")
          .map((c) => /^([\w.]+)\.ilike\.(.*)$/.exec(c));
        if (clauses.every(Boolean)) {
          filters.push((r) =>
            clauses.some((m) =>
              likeToRegex(m![2]).test(String(pathGet(r, m![1]) ?? "")),
            ),
          );
        }
        return q;
      },
      order: (col: string, o?: { ascending?: boolean }) => {
        orders.push({ col, asc: o?.ascending !== false });
        return q;
      },
      limit: (n: number) => ((limitN = n), q),
      range: (from: number, to: number) => (
        (offsetN = from),
        (limitN = to - from + 1),
        q
      ),
      maybeSingle: async () => {
        const out = settle();
        return { ...out, data: out.data?.[0] ?? null };
      },
      single: async () => {
        const out = settle();
        return { ...out, data: out.data?.[0] ?? null };
      },
      then: (res: any, rej: any) => Promise.resolve(settle()).then(res, rej),
    };
    return q;
  };

  const client: any = {
    from: (table: string) => builder(table, () => tables[table] ?? []),
    rpc: () => builder("rpc", () => []),
    storage: { from: () => ({}) },
  };
  return {
    db: { getClient: () => client, client, supabase: client } as any,
    reads,
  };
}

const pad = (i: number) => String(i).padStart(6, "0");
const daysAgo = (d: number, extraMs = 0) =>
  new Date(Date.now() - d * 86_400_000 + extraMs).toISOString();

// ── F-330 ───────────────────────────────────────────────────────────────────

describe("F-330 — Settings → POS status counts every check of the 30 days", () => {
  // 1,900 checks, oldest first in the table, so an unordered capped read
  // takes the first 1,000 and misses the newest.
  const checks = Array.from({ length: 1900 }, (_, i) => ({
    id: pad(i),
    restaurant_id: R,
    source: i % 2 === 0 ? "square" : "toast",
    opened_at: daysAgo(29, i * 1_000_000),
    closed_at: i === 1899 ? null : daysAgo(29, i * 1_000_000 + 60_000),
  }));
  const newest = checks[1899].opened_at;

  it("reports 1,900 checks, and the last check is the newest one", async () => {
    const { db } = cappedDb({ pos_checks: checks });
    const out: any = await new PosHubService(db).getStatus(R);
    expect(out.unavailable).toBe(false);
    expect(out.totalChecks).toBe(1900);
    const toast = out.sources.find((s: any) => s.source === "toast");
    expect(toast.checks).toBe(950);
    expect(toast.open).toBe(1);
    expect(toast.latest).toBe(newest);
  });

  it("a failed page is 'unavailable', never a count", async () => {
    const { db } = cappedDb(
      { pos_checks: checks },
      { pos_checks: { message: "boom" } },
    );
    const out: any = await new PosHubService(db).getStatus(R);
    expect(out.unavailable).toBe(true);
    expect(out.totalChecks).toBeNull();
  });
});

// ── F-331 ───────────────────────────────────────────────────────────────────

const CEILING_ROW = {
  restaurant_id: R,
  rule: "manager_ceiling",
  enabled: true,
  amount_limit: 1000,
  percent_limit: null,
  required_role: "owner",
  set_by: null,
  updated_at: null,
};

/** 1,500 orders over the year, oldest first; the newest 200 are big. */
function yearOfOrders(pendingTail = 0) {
  return Array.from({ length: 1500 }, (_, i) => ({
    id: pad(i),
    restaurant_id: R,
    provider_id: "prov-1",
    inventory_id: null,
    requested_at: daysAgo(360, i * 20_000_000),
    created_at: daysAgo(360, i * 20_000_000),
    total_cost: i >= 1300 ? 5000 : 100,
    final_price: null,
    status: i >= 1500 - pendingTail ? "PENDING" : "DELIVERED",
  }));
}

describe("F-331 — the approval-threshold retrospective reads the whole year", () => {
  it("counts 1,500 orders, and the newest months are in the walk", async () => {
    const { db } = cappedDb({
      restaurant_approval_thresholds: [CEILING_ROW],
      procurement_orders: yearOfOrders(),
    });
    const out = await new ApprovalThresholdsService(db, {} as any).read(R);
    expect(out.retrospective.readable).toBe(true);
    expect(out.retrospective.ordersRead).toBe(1500);
    const ceiling = out.retrospective.counts.find(
      (c: any) => c.rule === "manager_ceiling",
    ) as any;
    // The 200 big orders are the NEWEST 200: an oldest-1,000 walk saw none.
    expect(ceiling.wouldHaveFired).toBe(200);
  });
});

describe("F-331 — /orders' approval gate judges the newest pending orders", () => {
  const ceiling: ThresholdRow = {
    rule: "manager_ceiling",
    enabled: true,
    amountLimit: 1000,
    percentLimit: null,
    requiredRole: "owner",
    setBy: null,
    updatedAt: null,
  };

  it("lists the 3 pending orders at the end of a 1,500-order year", async () => {
    const { db } = cappedDb({ procurement_orders: yearOfOrders(3) });
    const thresholds = {
      read: jest.fn().mockResolvedValue({
        thresholds: [ceiling],
        policyEmpty: false,
        readable: true,
        reason: null,
      }),
    } as any;
    const orgs = {
      resolveRestaurantRole: jest.fn().mockResolvedValue("manager"),
    } as any;
    const svc = new ProcurementService(
      db,
      { createEvent: jest.fn() } as any,
      { recordTransaction: jest.fn() } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      thresholds,
      orgs,
      new SealChallengeService(db),
    );

    const gate = await svc.approvalGate(R, "user-1");
    expect(gate.readable).toBe(true);
    expect(gate.orders.map((o) => o.orderId).sort()).toEqual([
      pad(1497),
      pad(1498),
      pad(1499),
    ]);
    for (const o of gate.orders) {
      expect(o.mayApprove).toBe(false);
      expect(o.requiredRole).toBe("owner");
    }
  });
});

// ── F-332 ───────────────────────────────────────────────────────────────────

/** 1,500 delivered orders of $10 each across the last 300 days. */
const deliveredOrders = Array.from({ length: 1500 }, (_, i) => ({
  id: pad(i),
  restaurant_id: R,
  provider_id: "prov-1",
  status: "DELIVERED",
  total_cost: 10,
  final_price: null,
  bottles_total: 1,
  quantity: 1,
  delivered_at: daysAgo(300, i * 15_000_000),
  created_at: daysAgo(300, i * 15_000_000),
}));

describe("F-332 — COGS-365 and the purchase-spend goal sum the whole year", () => {
  it("the financial summary's COGS is $15,000 for 1,500 orders of $10", async () => {
    const { db } = cappedDb({ procurement_orders: deliveredOrders });
    const out: any = await new AnalyticsService(db).getFinancialSummary(R);
    expect(out.cogs).toBe(15000);
  });

  it("a failed page refuses the summary instead of reading as a light year", async () => {
    const { db } = cappedDb(
      { procurement_orders: deliveredOrders },
      { procurement_orders: { message: "boom" } },
    );
    await expect(
      new AnalyticsService(db).getFinancialSummary(R),
    ).rejects.toBeInstanceOf(WholeReadError);
  });

  const goals = (db: any) =>
    new GoalsService(db, {} as any, {} as any, {} as any, {} as any, {} as any);
  const since = daysAgo(330).slice(0, 10);

  it("purchase_spend is $15,000, not the first thousand orders' $10,000", async () => {
    const { db } = cappedDb({ procurement_orders: deliveredOrders });
    const out = await (goals(db) as any).computeMetricWithSeries(
      R,
      "purchase_spend",
      since,
      undefined,
      "UTC",
    );
    expect(out.current).toBe(15000);
    expect(out.rowCount).toBe(1500);
  });

  it("purchase_spend refuses a failed read rather than summing nothing to $0", async () => {
    const { db } = cappedDb(
      { procurement_orders: deliveredOrders },
      { procurement_orders: { message: "boom" } },
    );
    await expect(
      (goals(db) as any).computeMetricWithSeries(
        R,
        "purchase_spend",
        since,
        undefined,
        "UTC",
      ),
    ).rejects.toBeInstanceOf(WholeReadError);
  });
});

// ── F-333 ───────────────────────────────────────────────────────────────────

function orderItem(i: number, name: string, producer: string | null = null) {
  return {
    id: pad(i),
    wine_name: name,
    producer,
    quantity: 6,
    quoted_unit_price: null,
    negotiated_unit_price: null,
    final_unit_price: 4,
    created_at: daysAgo(200, i * 10_000_000),
    procurement_orders: {
      id: `o-${i}`,
      requested_at: daysAgo(200, i * 10_000_000),
      restaurant_id: R,
      providers: { name: "Vendor" },
    },
  };
}

describe("F-333 — a cellar row's order book finds a drink past the first 400 lines", () => {
  it("1,200 other lines first, then the house's beer: the beer is ordered", async () => {
    const items = [
      ...Array.from({ length: 1200 }, (_, i) => orderItem(i, `House Red ${i}`)),
      ...Array.from({ length: 5 }, (_, i) =>
        orderItem(1200 + i, "Pilsen", "Efes"),
      ),
    ];
    const { db } = cappedDb({ procurement_order_items: items });
    const out = await new BeveragesService(db).readRowRecord(R, "Efes Pilsen");
    const order = out.books.find((b) => b.book === "order")!;
    expect(order.readable).toBe(true);
    expect(order.rows).toBe(5);
    expect(order.truncated).toBe(false);
    expect(out.named).toContain("order");
  });

  it("past 400 matching lines it says it read the newest only", async () => {
    const items = Array.from({ length: 450 }, (_, i) =>
      orderItem(i, "Efes Pilsen"),
    );
    const { db } = cappedDb({ procurement_order_items: items });
    const out = await new BeveragesService(db).readRowRecord(R, "Efes Pilsen");
    const order = out.books.find((b) => b.book === "order")!;
    expect(order.rows).toBe(400);
    expect(order.truncated).toBe(true);
    expect(order.reason).toMatch(/newest 400/);
    // The newest line is in the ledger, the oldest is not.
    expect(order.ledger[0].at).toBe(items[449].procurement_orders.requested_at);
  });

  it("a capped read that matched nothing never says 'never ordered'", async () => {
    // Wider in SQL than `matchLine`: "Efes-Pilsen" asks for efes…pilsen, and
    // "Efes Pilsen" is not the same words, so 401 candidates match none.
    const items = Array.from({ length: 401 }, (_, i) =>
      orderItem(i, "Efes Pilsen"),
    );
    const { db } = cappedDb({ procurement_order_items: items });
    const out = await new BeveragesService(db).readRowRecord(R, "Efes-Pilsen");
    const order = out.books.find((b) => b.book === "order")!;
    expect(order.rows).toBe(0);
    expect(order.truncated).toBe(true);
    expect(order.reason).not.toMatch(/has never put this on a purchase order/);
    expect(order.reason).toMatch(/does not say it was never ordered/);
    expect(out.nothingNamesIt).toBe(false);
  });
});

// ── F-334 ───────────────────────────────────────────────────────────────────

describe("F-334 — an item's movement chart keeps its newest days", () => {
  it("1,500 pours in 28 days: the last hour's pours are drawn", async () => {
    const tx = Array.from({ length: 1500 }, (_, i) => ({
      id: pad(i),
      restaurant_id: R,
      inventory_id: "inv-1",
      quantity_change: -1,
      transaction_type: "pour",
      // The first 1,200 sit 27..15 days back; the last 300 in the last hour.
      created_at:
        i < 1200
          ? daysAgo(27, i * 800_000)
          : daysAgo(0, -3_600_000 + (i - 1200) * 1000),
    }));
    const { db } = cappedDb({ inventory_transactions: tx });
    const out: any = await new InventoryService(db).getItemActivity(R, "inv-1");
    expect(out.totalOut28d).toBe(1500);
    // The last hour can straddle midnight, so the last two days hold them.
    const [yesterday, today] = out.daily.slice(-2);
    expect(yesterday.out + today.out).toBe(300);
  });
});

// ── F-1214 ──────────────────────────────────────────────────────────────────

/** 1,400 wines, one bottle each at a recorded $10, with a lot total each. */
const cellar = Array.from({ length: 1400 }, (_, i) => ({
  id: pad(i),
  restaurant_id: R,
  wine_name: `Wine ${i}`,
  stock_live: 1,
  menu_price_current: 30,
  last_purchase_price: 10,
  threshold_min: 0,
  master_wine_id: null,
  is_active: true,
  created_at: daysAgo(400),
  master_wine_library: { primary_type: "red" },
}));
const lotTotals = cellar.map((w) => ({
  inventory_id: w.id,
  restaurant_id: R,
  live_qty: 1,
  wac: 10,
  has_invoice_cost: true,
  wac_qty: 1,
  cost_currency: null,
  cost_currency_count: 0,
}));

describe("F-1214 — the reports' cellar is the whole cellar, or a refusal", () => {
  const tables = () => ({
    restaurant_inventory: cellar,
    inventory_lot_rollup: lotTotals,
  });

  it("Cellar at cost values all 1,400 wines, not the first thousand", async () => {
    const { db } = cappedDb(tables());
    const out: any = await new AnalyticsService(db).getFinancialSummary(R);
    expect(out.costCoverage.total).toBe(1400);
    expect(out.costCoverage.priced).toBe(1400);
    expect(out.inventoryValue).toBe(14000);
  });

  it("a failed cellar read refuses the summary instead of an empty cellar", async () => {
    const { db } = cappedDb(tables(), {
      restaurant_inventory: { message: "boom" },
    });
    await expect(
      new AnalyticsService(db).getFinancialSummary(R),
    ).rejects.toBeInstanceOf(WholeReadError);
  });

  it("a failed lot-total read refuses too, never a cellar with no costs", async () => {
    const { db } = cappedDb(tables(), {
      inventory_lot_rollup: { message: "boom" },
    });
    await expect(
      new AnalyticsService(db).getFinancialSummary(R),
    ).rejects.toThrow(/lot totals could not be read/);
  });

  const advanced = (db: any) =>
    new AdvancedAnalyticsService(
      db,
      new AnalyticsService(db),
      {} as any,
      {} as any,
    );

  it("menu engineering's cost loader reads all 1,400 wines", async () => {
    const { db } = cappedDb(tables());
    const rows: any[] = await (advanced(db) as any).loadInventoryWithCost(R);
    expect(rows).toHaveLength(1400);
    expect(rows.every((r) => r.unitCost === 10)).toBe(true);
  });

  it("a slice of keys cut short of its own count refuses, never answers in part", async () => {
    await expect(
      readForKeys("The lot totals", ["a", "b"], async () => ({
        data: [{ inventory_id: "a" }],
        error: null,
        count: 2,
      })),
    ).rejects.toThrow(/came back with 1 of 2 rows/);
  });

  it("a failed read there refuses as well", async () => {
    const { db } = cappedDb(tables(), {
      restaurant_inventory: { message: "boom" },
    });
    await expect(
      (advanced(db) as any).loadInventoryWithCost(R),
    ).rejects.toBeInstanceOf(WholeReadError);
  });
});
