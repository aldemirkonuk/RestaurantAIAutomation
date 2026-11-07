/**
 * QA rounds 12 and 15: R1 the card and summary counted rows the view leaves
 * out (IN_TRANSIT, deleted, HD a house beer); R5 a failed view read reset the
 * alert states; R6 the 1000-row cap. HOUSE is QA's PGlite fixture; `inView`
 * is what v_low_stock_items returned there.
 */
import { Logger } from "@nestjs/common";
import { DashboardService } from "../dashboard/dashboard.service";
import { DatabaseService } from "../database/database.service";
import { InventoryService } from "../inventory/inventory.service";
import { LowStockAlertsService } from "./low-stock-alerts.service";

const R = "house-1";
const COUNTED = "2026-11-07T11:28:14.930Z";

// [key, stock, par, counted, active, deleted, state, inView]
const HOUSE: any[][] = [
  ["U1", 2, 3, false, true, false, "LIVE", true],
  ["U2", 0, 3, false, true, false, "LIVE", true],
  ["U3", 0, 3, false, true, false, "LIVE", false],
  ["C1", 2, 5, true, true, false, "LIVE", true],
  ["C2", 4, 5, true, true, false, "LIVE", true],
  ["P0", 0, 0, true, true, false, "LIVE", false],
  ["Z", 0, 3, true, true, false, "LIVE", true],
  ["NEG", -1, 3, true, true, false, "LIVE", true],
  ["RC", 6, 3, true, true, false, "LIVE", false],
  ["AR", 1, 3, true, false, false, "LIVE", false],
  ["CB", 1, 3, true, true, false, "LIVE", true],
  ["OB", 0, 3, true, true, false, "LIVE", true],
  ["AT", 3, 3, true, true, false, "LIVE", false],
  ["IT", 1, 3, true, true, false, "IN_TRANSIT", false],
  ["DL", 1, 3, true, true, true, "LIVE", false],
  ["HD", 1, 3, true, true, false, "LIVE", false],
];

function row(
  id: string,
  stock: number,
  par: number,
  counted: boolean,
  active = true,
  deleted = false,
  state = "LIVE",
) {
  return {
    id,
    restaurant_id: R,
    stock_live: stock,
    threshold_min: par,
    last_counted_at: counted ? COUNTED : null,
    is_active: active,
    deleted_at: deleted ? COUNTED : null,
    inventory_state: state,
    master_wine_id: id === "HD" ? null : `mw-${id}`,
    wine_name: `Wine ${id}`,
    vintage: 2019,
  };
}

const inventory = HOUSE.map(([k, s, p, c, a, d, st]) =>
  row(k, s, p, c, a, d, st),
);
const view = HOUSE.filter((h) => h[7]).map(([k, s, p, c]) => row(k, s, p, c));

type Tables = Record<string, any[]>;

/** A fake PostgREST: filters, keyset, count, the 1000-row cap, failures. */
function fakePg(tables: Tables, fail: Set<string> = new Set()) {
  const from = (table: string): any => {
    const where: ((r: any) => boolean)[] = [];
    let lim = Infinity;
    let counted = false;
    let patch: any = null;
    const c: any = {};
    const w = (f: (r: any) => boolean) => (where.push(f), c);
    c.select = (_: string, o?: any) => ((counted = o?.count === "exact"), c);
    c.eq = (k: string, v: any) => w((r) => r[k] === v);
    c.neq = (k: string, v: any) => w((r) => r[k] !== v);
    c.is = (k: string, v: any) =>
      w((r) => (v === null ? r[k] == null : r[k] === v));
    c.not = (k: string, op: string, v: any) =>
      w((r) => op !== "is" || v !== null || r[k] != null);
    c.in = (k: string, vs: any[]) => w((r) => vs.includes(r[k]));
    c.gt = (k: string, v: any) => w((r) => String(r[k]) > String(v));
    for (const m of ["or", "order", "contains", "gte", "lte", "lt"])
      c[m] = () => c;
    c.limit = (n: number) => ((lim = n), c);
    c.update = (p: any) => ((patch = p), c);
    const run = () => {
      if (fail.has(table))
        return { data: null, error: { message: `${table} is down` } };
      const hit = (tables[table] ?? []).filter((r) => where.every((w) => w(r)));
      if (patch) {
        hit.forEach((r) => Object.assign(r, patch));
        return { data: null, error: null };
      }
      hit.sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
      return {
        data: hit.slice(0, Math.min(lim, 1000)),
        error: null,
        count: counted ? hit.length : null,
      };
    };
    c.then = (res: any, rej: any) => Promise.resolve(run()).then(res, rej);
    return c;
  };
  return { from, rpc: async () => ({ data: null, error: null }) };
}

function dbOf(pg: any): DatabaseService {
  const db: any = Object.create(DatabaseService.prototype);
  db.supabase = pg;
  db.getClient = () => pg;
  return db;
}

function alertsOf(pg: any): any {
  return new LowStockAlertsService(
    { supabase: pg } as any,
    {} as any,
    { get: () => "" } as any,
    {} as any,
    {} as any,
  );
}

describe("low stock: every read agrees with v_low_stock_items (QA round 12)", () => {
  let warns: string[];
  beforeEach(() => {
    warns = [];
    jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation((m: any) => void warns.push(String(m)));
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("R1: the card and the summary count the same 8 low and 6 critical as the inbox and the alert list", async () => {
    const pg = fakePg({
      restaurant_inventory: inventory,
      v_low_stock_items: view,
    });
    const db = dbOf(pg);

    const inbox = (await alertsOf(pg).getLowStockByRestaurant()).get(R);
    expect([
      inbox.length,
      inbox.filter((r: any) => r.severity === "critical").length,
    ]).toEqual([8, 6]);

    const alerts = (await new DashboardService(db as any).getAlerts(R)).filter(
      (a) => a.type === "low_stock",
    );
    expect([
      alerts.length,
      alerts.filter((a) => a.severity === "critical").length,
    ]).toEqual([8, 6]);

    const card = await (
      new DashboardService(db as any) as any
    ).getInventorySummary(R);
    const summary = await new InventoryService(db as any).getInventorySummary(
      R,
    );
    for (const s of [card, summary]) {
      expect([s.lowStockCount, s.criticalCount]).toEqual([8, 6]);
    }
    expect(
      warns.filter((w) => w.includes("Low-stock count disagreement")),
    ).toEqual([]);

    const listed = (
      await new InventoryService(db as any).getRestaurantInventory(R)
    ).map((r: any) => r.id);
    expect(listed).toContain("IT");
    expect(listed).toContain("HD");
    expect(listed).not.toContain("DL");
    expect(listed).not.toContain("AR");
  });

  it("R5: a failed view read keeps every alert state, and the good read after it fires nothing twice", async () => {
    const tables: Tables = {
      v_low_stock_items: view.map((r) => ({ ...r })),
      inventory_alert_state: [],
    };
    const fail = new Set<string>();
    const pg = fakePg(tables, fail);
    const svc = alertsOf(pg);
    const fired: string[][] = [];
    svc.restateCountedAlerts = async () => 0;
    svc.getRestaurantNames = async () => new Map();
    svc.getEffectiveLowStockPrefs = async () => ({
      enabled: true,
      instantFirstAlert: true,
      criticalImmediate: true,
    });
    svc.recordAlertOutcome = async () => undefined;
    svc.upsertState = async (restaurantId: string, p: any) => {
      const s = tables.inventory_alert_state.find(
        (r) => r.inventory_id === p.inventoryId,
      );
      if (s) s.last_alert_level = p.level;
      else
        tables.inventory_alert_state.push({
          id: p.inventoryId,
          restaurant_id: restaurantId,
          inventory_id: p.inventoryId,
          last_alert_level: p.level,
        });
      return true;
    };
    svc.fireInstantAlert = async (_r: string, rows: any[]) => (
      fired.push(rows.map((w) => w.inventoryId)),
      true
    );
    const levels = () =>
      tables.inventory_alert_state
        .map((s) => `${s.inventory_id}:${s.last_alert_level}`)
        .sort();

    await svc.runEdgeSweep();
    expect(fired.map((f) => f.length)).toEqual([8]);
    const before = levels();
    expect(before.some((l: string) => l.endsWith(":ok"))).toBe(false);

    fail.add("v_low_stock_items");
    svc.lastInstantAt.clear();
    await svc.runEdgeSweep();
    await svc.evaluateInventoryItems(R, ["C1", "U2"]);
    expect(levels()).toEqual(before);
    expect(
      warns.some((w) => w.includes("v_low_stock_items could not be read")),
    ).toBe(true);

    fail.delete("v_low_stock_items");
    svc.lastInstantAt.clear();
    await svc.runEdgeSweep();
    expect(fired.map((f) => f.length)).toEqual([8]);
  });

  it("R6: past PostgREST's 1000 rows the list, the summaries and the sweep read the whole house", async () => {
    const rows = Array.from({ length: 1100 }, (_, i) =>
      row(`w-${String(i).padStart(4, "0")}`, i < 50 ? 6 : 1, 3, true),
    );
    const pg = fakePg({
      restaurant_inventory: rows,
      v_low_stock_items: rows.slice(50),
    });
    const db = dbOf(pg);

    expect(
      (await new InventoryService(db as any).getRestaurantInventory(R)).length,
    ).toBe(1100);
    const card = await (
      new DashboardService(db as any) as any
    ).getInventorySummary(R);
    const summary = await new InventoryService(db as any).getInventorySummary(
      R,
    );
    for (const s of [card, summary]) {
      expect([s.totalItems, s.lowStockCount, s.criticalCount]).toEqual([
        1100, 1050, 1050,
      ]);
    }
    expect((await alertsOf(pg).getLowStockByRestaurant()).get(R).length).toBe(
      1050,
    );
  });
});
