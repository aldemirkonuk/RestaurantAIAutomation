import { ScenarioVerifyService } from "./scenario-verify.service";
import type { ScenarioExpectation } from "./scenario-types";

/**
 * The verifier's own honesty (ADR 0093 D2).
 *
 * An instrument that renders a failed read as an empty result, or an empty
 * expectation as a clean bill of health, commits the defect it exists to
 * expose. So these tests are about the THREE STATUSES and where each is
 * reachable, not about the SQL:
 *
 *   pass          the product did the thing, and we read it back
 *   fail          the product did NOT do the thing, and we read that back
 *   unverifiable  we could not tell — a read failed, an expectation is empty,
 *                 an outcome was never recorded, or no detector exists
 *
 * A live end-to-end run against a gateway and a sim tenant is the
 * integrator's; nothing here touches a database or a network.
 */

type Row = Record<string, any>;

/** Every read resolves to `results[table]`. Absent tables resolve empty. */
function makeDb(results: Record<string, any>) {
  const chain = (table: string): any => {
    const q: any = {};
    const self = () => q;
    for (const m of [
      "select",
      "eq",
      "in",
      "gte",
      "lte",
      "lt",
      "gt",
      "neq",
      "order",
      "limit",
      "update",
    ]) {
      q[m] = self;
    }
    q.maybeSingle = () =>
      Promise.resolve(results[table] ?? { data: null, error: null });
    q.then = (resolve: any, reject: any) =>
      Promise.resolve(results[table] ?? { data: [], error: null }).then(
        resolve,
        reject,
      );
    return q;
  };
  const client = { from: chain };
  return { getClient: () => client, supabase: client } as any;
}

const TODAY = new Date().toISOString().slice(0, 10);
const OPENED = `${TODAY}T18:00:00.000Z`;
const CLOSED = `${TODAY}T19:00:00.000Z`;
const POSTED = `${TODAY}T19:05:00.000Z`;

// Real hours for the happy path: every day 00:00–23:59 in the venue's zone, so a
// check at any time is "within hours" and `hours.outside` can actually pass.
const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const ALL_DAY_HOURS = Object.fromEntries(
  WEEK.map((d) => [d, [{ open: "00:00", close: "23:59" }]]),
) as Record<(typeof WEEK)[number], Array<{ open: string; close: string }>>;
// Hours under which TODAY (in America/Chicago) is a closed day.
const TODAY_CHICAGO_WEEKDAY = (() => {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" })
    .format(new Date(`${TODAY}T12:00:00Z`))
    .toLowerCase()
    .slice(0, 3);
  return wd as (typeof WEEK)[number];
})();
const CLOSED_TODAY_HOURS = Object.fromEntries(
  WEEK.map((d) => [d, d === TODAY_CHICAGO_WEEKDAY ? [] : [{ open: "12:00", close: "23:00" }]]),
) as Record<(typeof WEEK)[number], Array<{ open: string; close: string }>>;
const BOTTLE_KEY = "pos:generic_webhook:chk-1:item-1:1";

function baseExpectation(over: Partial<ScenarioExpectation> = {}) {
  const exp: ScenarioExpectation = {
    contract_version: 1,
    source: "generic_webhook",
    scenario: "random",
    seed: 7,
    service_date: TODAY,
    timezone: "America/Chicago",
    scenarios: [
      {
        id: "s1",
        title: "A table of two",
        story: "One bread, one bottle.",
        check_ids: ["chk-1"],
      },
    ],
    checks: [
      {
        external_check_id: "chk-1",
        opened_at: OPENED,
        closed_at: CLOSED,
        voided: false,
        table_label: "12",
        covers: 2,
        server_name: "Ana",
        subtotal: 96,
        total: 100,
        tip: 0,
        posted: true,
        post_count: 1,
        outside_hours: false,
        lines: [
          {
            line_no: 0,
            external_item_id: "food-1",
            name: "Sourdough",
            qty: 1,
            price: 4,
            is_wine: false,
            expect: "food",
            idempotency_key: null,
          },
          {
            line_no: 1,
            external_item_id: "item-1",
            name: "Caymus Cabernet",
            qty: 1,
            price: 96,
            is_wine: true,
            inventory_id: "inv-1",
            expect: "bottle",
            idempotency_key: BOTTLE_KEY,
          },
        ],
      },
    ],
    depletion: [
      {
        inventory_id: "inv-1",
        wine_name: "Caymus Cabernet",
        opening_stock_live: 12,
        bottles: 1,
        expected_stock_live: 11,
        stock_live_is_upper_bound: false,
      },
    ],
    unresolved: { count: 0, by_reason: {} },
    low_stock: [],
    outside_hours_count: 0,
    dropped_check_ids: [],
    duplicate_check_ids: [],
    voided_check_ids: [],
    tables: [{ label: "12", seats: 2 }],
    totals: {
      checks: 1,
      posted_checks: 1,
      wine_lines: 1,
      food_lines: 1,
      revenue: 100,
    },
  };
  return { ...exp, ...over };
}

function happyResults(over: Record<string, any> = {}) {
  return {
    sim_scenario_runs: {
      data: {
        id: "run-1",
        restaurant_id: "r-sim",
        archetype_id: "bistro",
        scenario: "random",
        seed: 7,
        service_date: TODAY,
        timezone: "America/Chicago",
        operating_hours: ALL_DAY_HOURS,
        params: {},
        expected: baseExpectation(),
        posted_at: POSTED,
        created_at: POSTED,
      },
      error: null,
    },
    pos_checks: {
      data: [
        {
          external_check_id: "chk-1",
          table_id: "t-12",
          server_name: "Ana",
          opened_at: OPENED,
          closed_at: CLOSED,
          covers: 2,
          subtotal: 96,
          total: 100,
          tip: 0,
          voided: false,
          items: [
            { name: "Sourdough", is_wine: false, inventory_id: null },
            { name: "Caymus Cabernet", is_wine: true, inventory_id: "inv-1" },
          ],
        },
      ],
      error: null,
    },
    restaurant_tables: {
      data: [{ id: "t-12", label: "12", seats: 2, is_active: true }],
      error: null,
    },
    inventory_transactions: {
      data: [
        {
          id: "tx-1",
          inventory_id: "inv-1",
          transaction_type: "sale",
          source: "pos",
          quantity_change: -1,
          quantity_before: 12,
          quantity_after: 11,
          idempotency_key: BOTTLE_KEY,
        },
      ],
      error: null,
    },
    wine_consumption_log: {
      data: [
        {
          id: "wcl-1",
          inventory_id: "inv-1",
          wine_name: "Caymus Cabernet",
          consumption_type: "bottle",
          quantity: 1,
          volume_ml: 750,
          unit_price: 96,
          notes: BOTTLE_KEY,
          source: "pos",
        },
      ],
      error: null,
    },
    restaurant_inventory: {
      data: [
        {
          id: "inv-1",
          wine_name: "Caymus Cabernet",
          stock_live: 11,
          threshold_min: 3,
        },
      ],
      error: null,
    },
    inventory_lots: {
      data: [{ inventory_id: "inv-1", qty: 11, stock_state: "live" }],
      error: null,
    },
    analytics_insights: {
      data: [
        {
          candidate_key: "wine_velocity",
          entity_key: "inv-1",
          entity_label: "Caymus Cabernet",
          sentence: "Caymus Cabernet is your fastest mover this week.",
          evidence: {},
          computed_at: POSTED,
        },
      ],
      error: null,
    },
    ...over,
  };
}

function build(
  results: Record<string, any>,
  over: {
    revenueWindow?: any;
    tablePerf?: any;
  } = {},
) {
  const simpos = {
    assertSimRestaurant: jest.fn().mockResolvedValue(undefined),
  };
  const goals = {
    getPosRevenueWindow: jest.fn().mockResolvedValue(
      over.revenueWindow ?? {
        restaurantId: "r-sim",
        from: TODAY,
        to: TODAY,
        days: 1,
        posConnected: true,
        revenue: 100,
        checkCount: 1,
        dailySeries: [{ date: TODAY, revenue: 100 }],
      },
    ),
  };
  const tableAnalytics = {
    getTablePerformance: jest.fn().mockResolvedValue(
      over.tablePerf ?? {
        sinceDays: 1,
        tables: [{ label: "12", checks: 1, revenue: 100 }],
        correlations: [],
        drivers: {},
        dataStatus: "live",
      },
    ),
  };
  const insights = { generate: jest.fn() };
  const lowStock = { triggerEdgeSweep: jest.fn() };
  const service = new ScenarioVerifyService(
    makeDb(results),
    simpos as any,
    goals as any,
    tableAnalytics as any,
    insights as any,
    lowStock as any,
  );
  return { service, simpos, goals, tableAnalytics, insights, lowStock };
}

const byId = (result: any, id: string) =>
  result.checks.find((c: Row) => c.id === id);

describe("ScenarioVerifyService.verify — a clean replay", () => {
  it("passes the checks it can prove and never invents a pass for the rest", async () => {
    const { service, simpos } = build(happyResults());
    const r = await service.verify("r-sim", "run-1");

    // The sim-tenant guard is not optional on a surface that reads live tables.
    expect(simpos.assertSimRestaurant).toHaveBeenCalledWith("r-sim");

    expect(byId(r, "checks.landed").status).toBe("pass");
    expect(byId(r, "checks.fields").status).toBe("pass");
    expect(byId(r, "checks.tables_resolved").status).toBe("pass");
    expect(byId(r, "lines.wine_resolved").status).toBe("pass");
    expect(byId(r, "stock.bottle_transactions").status).toBe("pass");
    expect(byId(r, "stock.projection").status).toBe("pass");
    expect(byId(r, "consumption.mirror").status).toBe("pass");
    expect(byId(r, "unresolved.queued").status).toBe("pass");
    expect(byId(r, "insights.generated").status).toBe("pass");
    expect(byId(r, "analytics.pos_revenue").status).toBe("pass");
    expect(byId(r, "analytics.tables").status).toBe("pass");

    // Nothing this run does not exercise is allowed to read as a pass.
    expect(byId(r, "stock.pours").status).toBe("unverifiable");
    expect(byId(r, "stock.dedupe").status).toBe("unverifiable");
    expect(byId(r, "voids.returned").status).toBe("unverifiable");
    expect(byId(r, "webhook.dropped").status).toBe("unverifiable");
    expect(byId(r, "webhook.duplicate").status).toBe("unverifiable");

    expect(r.summary.fail).toBe(0);
    expect(r.summary.pass + r.summary.fail + r.summary.unverifiable).toBe(
      r.summary.total,
    );
    expect(r.summary.total).toBe(r.checks.length);
    expect(
      r.checks.every((c: Row) => typeof c.title === "string" && c.title),
    ).toBe(true);
    // EVERY check id, on every run. A branch that silently skipped a row would
    // shorten the table, and a shorter table reads as "there was less to
    // check" rather than "one verdict went missing".
    expect(r.checks).toHaveLength(20);
    expect(new Set(r.checks.map((c: Row) => c.id)).size).toBe(20);
  });

  it("states the table-performance comparison as a floor, not a per-day total", async () => {
    const { service } = build(happyResults(), {
      // A wider window legitimately holds MORE checks for this table.
      tablePerf: {
        sinceDays: 90,
        tables: [{ label: "12", checks: 40 }],
        correlations: [],
        drivers: {},
        dataStatus: "live",
      },
    });
    const r = await service.verify("r-sim", "run-1");
    const row = byId(r, "analytics.tables");
    expect(row.status).toBe("pass");
    expect(row.detail).toMatch(/FLOOR|floor/);
  });
});

describe("ScenarioVerifyService.verify — a failed read is never an empty one", () => {
  it("turns every dependent check unverifiable and records the read (ADR 0067)", async () => {
    const { service } = build(
      happyResults({
        pos_checks: { data: null, error: { message: "statement timeout" } },
      }),
    );
    const r = await service.verify("r-sim", "run-1");

    const failedRead = r.reads.find(
      (x: Row) => x.table === "pos_checks" && x.ok === false,
    );
    expect(failedRead).toBeTruthy();
    expect(failedRead.error).toBe("statement timeout");

    for (const id of [
      "checks.landed",
      "checks.fields",
      "checks.tables_resolved",
      "lines.wine_resolved",
      "hours.outside",
    ]) {
      const row = byId(r, id);
      expect(row.status).toBe("unverifiable");
      expect(row.detail).toContain("statement timeout");
      // The specific mistake: a dead read rendering as "0 of 1 landed".
      expect(row.status).not.toBe("pass");
      expect(row.status).not.toBe("fail");
    }
  });

  it("does not turn a failed inventory read into a stock discrepancy", async () => {
    const { service } = build(
      happyResults({
        restaurant_inventory: {
          data: null,
          error: { message: "connection reset" },
        },
      }),
    );
    const r = await service.verify("r-sim", "run-1");
    const row = byId(r, "stock.projection");
    expect(row.status).toBe("unverifiable");
    expect(row.detail).toContain("connection reset");
  });
});

describe("ScenarioVerifyService.verify — an empty expectation is not a pass", () => {
  it("reports every check id as unverifiable when the run has no expectation", async () => {
    const { service } = build(
      happyResults({
        sim_scenario_runs: {
          data: {
            id: "run-1",
            restaurant_id: "r-sim",
            scenario: "random",
            seed: 7,
            service_date: TODAY,
            timezone: "America/Chicago",
            operating_hours: null,
            params: {},
            expected: null,
            posted_at: POSTED,
            created_at: POSTED,
          },
          error: null,
        },
      }),
    );
    const r = await service.verify("r-sim", "run-1");
    expect(r.summary.pass).toBe(0);
    expect(r.summary.fail).toBe(0);
    expect(r.summary.unverifiable).toBe(r.checks.length);
    // A SHORT table would be its own lie — the reader must see every check id
    // that exists, each saying why it could not be answered.
    expect(r.checks.length).toBeGreaterThanOrEqual(20);
    expect(r.checks[0].detail).toContain("no expectation");
  });

  it("compares nothing when the contract version is not the one this build reads", async () => {
    const { service } = build(
      happyResults({
        sim_scenario_runs: {
          data: {
            id: "run-1",
            restaurant_id: "r-sim",
            scenario: "random",
            seed: 7,
            service_date: TODAY,
            timezone: "America/Chicago",
            operating_hours: null,
            params: {},
            expected: baseExpectation({ contract_version: 99 }),
            posted_at: POSTED,
            created_at: POSTED,
          },
          error: null,
        },
      }),
    );
    const r = await service.verify("r-sim", "run-1");
    expect(r.summary.pass).toBe(0);
    expect(r.checks.every((c: Row) => c.status === "unverifiable")).toBe(true);
    expect(r.checks[0].detail).toContain("contract_version 99");
  });

  it("a closed day with no checks says 'nothing to compare' for the row checks", async () => {
    const { service } = build(
      happyResults({
        sim_scenario_runs: {
          data: {
            id: "run-1",
            restaurant_id: "r-sim",
            scenario: "closed_day",
            seed: 3,
            service_date: TODAY,
            timezone: "America/Chicago",
            operating_hours: CLOSED_TODAY_HOURS,
            params: {},
            expected: baseExpectation({
              checks: [],
              depletion: [],
              tables: [],
              low_stock: [],
              totals: { checks: 0, posted_checks: 0, revenue: 0 },
            }),
            posted_at: POSTED,
            created_at: POSTED,
          },
          error: null,
        },
        pos_checks: { count: 0, data: null, error: null },
      }),
    );
    const r = await service.verify("r-sim", "run-1");
    expect(byId(r, "checks.landed").status).toBe("unverifiable");
    expect(byId(r, "checks.landed").detail).toContain("nothing to compare");
    expect(r.summary.fail).toBe(0);
  });
});

describe("ScenarioVerifyService.verify — the things that must never pass", () => {
  it("a dropped webhook is unverifiable, because no detector exists (S09 §9)", async () => {
    const { service } = build(
      happyResults({
        sim_scenario_runs: {
          data: {
            id: "run-1",
            restaurant_id: "r-sim",
            scenario: "dropped_webhook",
            seed: 9,
            service_date: TODAY,
            timezone: "America/Chicago",
            operating_hours: null,
            params: {},
            expected: baseExpectation({ dropped_check_ids: ["chk-lost"] }),
            posted_at: POSTED,
            created_at: POSTED,
          },
          error: null,
        },
      }),
    );
    const r = await service.verify("r-sim", "run-1");
    const row = byId(r, "webhook.dropped");
    expect(row.status).toBe("unverifiable");
    expect(row.status).not.toBe("pass");
    expect(row.detail).toContain("no detector exists");
  });

  it("a notification with no recorded email outcome is unverifiable, not 'not sent'", async () => {
    const exp = baseExpectation({
      low_stock: [
        {
          inventory_id: "inv-1",
          wine_name: "Caymus Cabernet",
          threshold_min: 5,
          expected_stock_live: 4,
        },
      ],
    });
    const { service } = build(
      happyResults({
        sim_scenario_runs: {
          data: {
            id: "run-1",
            restaurant_id: "r-sim",
            scenario: "sell_to_par",
            seed: 4,
            service_date: TODAY,
            timezone: "America/Chicago",
            operating_hours: null,
            params: {},
            expected: exp,
            posted_at: POSTED,
            created_at: POSTED,
          },
          error: null,
        },
        notifications: {
          data: [
            {
              id: "n-1",
              created_at: POSTED,
              title: "Low stock",
              delivery_status: null,
              metadata: { wines: [{ wineId: "inv-1" }] },
            },
          ],
          error: null,
        },
      }),
    );
    const r = await service.verify("r-sim", "run-1");
    expect(byId(r, "low_stock.notified").status).toBe("pass");
    const emailed = byId(r, "low_stock.emailed");
    expect(emailed.status).toBe("unverifiable");
    expect(emailed.detail).toContain("unknown, not false");
  });

  it("no notification at all is a fail that names the lever", async () => {
    const exp = baseExpectation({
      low_stock: [
        {
          inventory_id: "inv-1",
          wine_name: "Caymus Cabernet",
          expected_stock_live: 4,
        },
      ],
    });
    const { service } = build(
      happyResults({
        sim_scenario_runs: {
          data: {
            id: "run-1",
            restaurant_id: "r-sim",
            scenario: "sell_to_par",
            seed: 4,
            service_date: TODAY,
            timezone: "America/Chicago",
            operating_hours: null,
            params: {},
            expected: exp,
            posted_at: POSTED,
            created_at: POSTED,
          },
          error: null,
        },
        notifications: { data: [], error: null },
      }),
    );
    const r = await service.verify("r-sim", "run-1");
    expect(byId(r, "low_stock.notified").status).toBe("fail");
    expect(byId(r, "low_stock.notified").detail).toContain("sweep lever");
    expect(byId(r, "low_stock.emailed").status).toBe("unverifiable");
  });

  it("two transactions under one key fail — a replay must not deplete twice", async () => {
    const { service } = build(
      happyResults({
        inventory_transactions: {
          data: [
            {
              id: "tx-1",
              inventory_id: "inv-1",
              transaction_type: "sale",
              source: "pos",
              quantity_change: -1,
              idempotency_key: BOTTLE_KEY,
            },
            {
              id: "tx-2",
              inventory_id: "inv-1",
              transaction_type: "sale",
              source: "pos",
              quantity_change: -1,
              idempotency_key: BOTTLE_KEY,
            },
          ],
          error: null,
        },
      }),
    );
    const r = await service.verify("r-sim", "run-1");
    const row = byId(r, "stock.bottle_transactions");
    expect(row.status).toBe("fail");
    expect(JSON.stringify(row.samples)).toContain("depleted twice");
  });

  it("a projection that disagrees with its own lots is a fail, not a rounding note", async () => {
    const { service } = build(
      happyResults({
        inventory_lots: {
          data: [{ inventory_id: "inv-1", qty: 9, stock_state: "live" }],
          error: null,
        },
      }),
    );
    const r = await service.verify("r-sim", "run-1");
    const row = byId(r, "stock.projection");
    expect(row.status).toBe("fail");
    expect(JSON.stringify(row.samples)).toContain(
      "disagrees with its own ledger",
    );
  });

  it("a void whose only transaction sits under the SALE key is reported as the D5 defect", async () => {
    const exp = baseExpectation();
    exp.checks![0].lines[1].expect = "void_return";
    exp.checks![0].voided = true;
    const { service } = build(
      happyResults({
        sim_scenario_runs: {
          data: {
            id: "run-1",
            restaurant_id: "r-sim",
            scenario: "void",
            seed: 5,
            service_date: TODAY,
            timezone: "America/Chicago",
            operating_hours: null,
            params: {},
            expected: exp,
            posted_at: POSTED,
            created_at: POSTED,
          },
          error: null,
        },
      }),
    );
    const r = await service.verify("r-sim", "run-1");
    const row = byId(r, "voids.returned");
    expect(row.status).toBe("fail");
    expect(JSON.stringify(row.samples)).toContain("ADR 0093 D5");
  });

  it("hours it cannot parse are unverifiable, never 'within hours'", async () => {
    // A shape the product's own parser rejects (ranges as tuples). An unknown
    // must not count as "inside hours".
    const { service } = build(
      happyResults({
        sim_scenario_runs: {
          data: {
            id: "run-1",
            restaurant_id: "r-sim",
            scenario: "random",
            seed: 7,
            service_date: TODAY,
            timezone: "America/Chicago",
            operating_hours: { mon: [["17:00", "23:30"]] },
            params: {},
            expected: baseExpectation(),
            posted_at: POSTED,
            created_at: POSTED,
          },
          error: null,
        },
      }),
    );
    const r = await service.verify("r-sim", "run-1");
    const row = byId(r, "hours.outside");
    expect(row.status).toBe("unverifiable");
    expect(row.actual).toBeNull();
    expect(row.detail).toContain("hours_invalid");
  });

  it("hours the venue never set are unverifiable, never 'within hours'", async () => {
    const { service } = build(
      happyResults({
        sim_scenario_runs: {
          data: {
            id: "run-1",
            restaurant_id: "r-sim",
            scenario: "random",
            seed: 7,
            service_date: TODAY,
            timezone: "America/Chicago",
            operating_hours: null,
            params: {},
            expected: baseExpectation(),
            posted_at: POSTED,
            created_at: POSTED,
          },
          error: null,
        },
      }),
    );
    const r = await service.verify("r-sim", "run-1");
    const row = byId(r, "hours.outside");
    expect(row.status).toBe("unverifiable");
    expect(row.detail).toContain("hours_unknown");
  });

  it("with real hours every check is placed, and the count is a pass", async () => {
    const { service } = build(happyResults());
    const r = await service.verify("r-sim", "run-1");
    const row = byId(r, "hours.outside");
    expect(row.status).toBe("pass");
    expect(row.actual).toBe(0);
  });
});

describe("ScenarioVerifyService — runs list and the levers", () => {
  it("returns the cap so the page can render a floor rather than a total", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: `run-${i}`,
      scenario: "random",
      seed: i,
      service_date: TODAY,
      timezone: "America/Chicago",
      posted_at: POSTED,
      created_at: POSTED,
      expected: { totals: { checks: 3 }, scenarios: [] },
    }));
    const { service } = build({
      sim_scenario_runs: { data: rows, error: null },
    });
    const out = await service.listRuns("r-sim");
    expect(out.runs).toHaveLength(50);
    expect(out.cap).toBe(50);
    expect(out.capped).toBe(true);
    expect(out.runs[0].totals).toEqual({ checks: 3 });
  });

  it("a failed runs read throws rather than rendering as 'no runs'", async () => {
    const { service } = build({
      sim_scenario_runs: {
        data: null,
        error: { message: "permission denied" },
      },
    });
    await expect(service.listRuns("r-sim")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("the sweep lever runs the edge sweep and returns the rows with their delivery status", async () => {
    const { service, lowStock } = build(
      happyResults({
        notifications: {
          data: [
            {
              id: "n-1",
              type: "inventory_low_stock",
              created_at: POSTED,
              delivery_status: { email: { ok: true, recipients: 2 } },
              metadata: { wines: [{ wineId: "inv-1" }] },
            },
          ],
          error: null,
        },
      }),
    );
    const out = await service.runSweep("r-sim", "run-1");
    expect(lowStock.triggerEdgeSweep).toHaveBeenCalledTimes(1);
    expect(out.notifications).toHaveLength(1);
    expect(out.notifications[0].delivery_status.email.ok).toBe(true);
  });

  it("the insights lever reports the upper bound as an upper bound", async () => {
    const { service, insights } = build(happyResults());
    insights.generate.mockResolvedValue({
      restaurantId: "r-sim",
      insights: [{ sentence: "One" }, { sentence: "Two" }],
      availability: ["checks"],
      candidateTypesAvailable: 573,
      candidateTypesTotal: 573,
      generatedAt: POSTED,
    });
    const out = await service.generateInsights("r-sim");
    expect(out.count).toBe(2);
    expect(out.candidateTypesAvailable).toBe(573);
    expect(out.sample).toEqual(["One", "Two"]);
  });
});
