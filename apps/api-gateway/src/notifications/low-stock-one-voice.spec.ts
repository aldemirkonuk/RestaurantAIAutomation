/**
 * QA round 9c leftovers: low stock says one thing wherever it is said.
 *
 * 1. The dashboard's alert list and the alert service file the same
 *    `v_low_stock_items` row through one rule (`alertBandOfViewRow`), so a
 *    counted 2 of 5 is critical in both. The dashboard used to call only
 *    `stock_live === 0` critical.
 * 2. A stored alert that said "not counted yet" is restated once the wine is
 *    counted after it was sent (the session's call: restate, not retire).
 */
import { Logger } from "@nestjs/common";
import { DashboardService } from "../dashboard/dashboard.service";
import { alertBandOfViewRow } from "../common/stock-status";
import {
  LowStockAlertsService,
  instantAlertMessage,
  restateOnCount,
} from "./low-stock-alerts.service";

const COUNTED_AT = "2026-11-01T10:00:00Z";

// The view rows, one per case the rule distinguishes.
const VIEW = [
  { id: "counted-2of5", restaurant_id: "r1", wine_name: "Two Of Five", stock_live: 2, threshold_min: 5, last_counted_at: COUNTED_AT },
  { id: "counted-4of5", restaurant_id: "r1", wine_name: "Four Of Five", stock_live: 4, threshold_min: 5, last_counted_at: COUNTED_AT },
  { id: "counted-out", restaurant_id: "r1", wine_name: "Counted Out", stock_live: 0, threshold_min: 3, last_counted_at: COUNTED_AT },
  { id: "recv-low", restaurant_id: "r1", wine_name: "Received Low", stock_live: 2, threshold_min: 3, last_counted_at: null },
  { id: "recv-zero", restaurant_id: "r1", wine_name: "Received Zero", stock_live: 0, threshold_min: 3, last_counted_at: null },
];

function chain(rows: (table: string) => any[], writes: any[] = []) {
  const from = (table: string): any => {
    const c: any = {};
    for (const m of ["select", "eq", "neq", "not", "is", "in", "or", "order", "limit", "contains"])
      c[m] = () => c;
    c.update = (patch: any) => {
      const w = { table, patch, id: null as any };
      writes.push(w);
      c.eq = (_col: string, id: any) => {
        w.id = id;
        return Promise.resolve({ error: null });
      };
      return c;
    };
    c.then = (resolve: any) => resolve({ data: rows(table), error: null });
    return c;
  };
  return { from };
}

describe("QA 9c — a low wine reads the same in the inbox and on the dashboard", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("alertBandOfViewRow: a counted 2 of 5 is critical, 4 of 5 low, a full row is not alerted", () => {
    expect(alertBandOfViewRow(VIEW[0])).toBe("critical");
    expect(alertBandOfViewRow(VIEW[1])).toBe("low");
    expect(alertBandOfViewRow(VIEW[4])).toBe("critical");
    expect(alertBandOfViewRow({ id: "x", stock_live: 5, threshold_min: 5, last_counted_at: COUNTED_AT })).toBeNull();
  });

  it("the dashboard's alert list and the alert service give every view row the same severity", async () => {
    const db = { getClient: () => chain((t) => (t === "v_low_stock_items" ? VIEW : [])) };
    const alerts = await new DashboardService(db as any).getAlerts("r1");
    const dash = Object.fromEntries(
      alerts.filter((a) => a.type === "low_stock").map((a) => [a.id.replace("low-stock-", ""), a.severity]),
    );

    const service = new LowStockAlertsService(
      { supabase: chain((t) => (t === "v_low_stock_items" ? VIEW : [])) } as any,
      {} as any,
      { get: () => "" } as any,
      {} as any,
      {} as any,
    ) as any;
    const rows: any[] = (await service.getLowStockByRestaurant()).get("r1");
    const inbox = Object.fromEntries(
      rows.map((r) => [r.inventoryId, r.severity === "critical" ? "critical" : "warning"]),
    );

    expect(dash["counted-2of5"]).toBe("critical");
    expect(dash).toEqual(inbox);
    expect(Object.keys(dash).sort()).toEqual(VIEW.map((r) => r.id).sort());
  });
});

describe("QA 9c item 3 — a stored 'not counted yet' is restated once the wine is counted", () => {
  const SENT = "2026-11-02T09:00:00Z";
  const NOT_COUNTED = {
    inventoryId: "inv-a",
    wineId: "wine-a",
    wineName: "Received Red",
    currentStock: 2,
    threshold: 3,
    severity: "low" as const,
    notCounted: true,
  };

  it("keeps the instant alert's words as they were for counted and uncounted wines", () => {
    expect(instantAlertMessage([NOT_COUNTED])).toBe(
      "2 bottles by receipts and sales, not counted yet (par: 3)",
    );
    expect(instantAlertMessage([{ ...NOT_COUNTED, notCounted: false }])).toBe(
      "Only 2 bottles remaining (par: 3)",
    );
  });

  it("restates an entry counted after the alert was sent, and only that one", () => {
    const counted = [
      { id: "inv-a", master_wine_id: "wine-a", stock_live: 1, last_counted_at: "2026-11-03T08:00:00Z" },
    ];
    const wines = restateOnCount([NOT_COUNTED], SENT, counted);
    expect(wines).toEqual([
      expect.objectContaining({ notCounted: false, currentStock: 1, uncountedFigure: 2, countedAt: "2026-11-03T08:00:00Z" }),
    ]);
    expect(instantAlertMessage(wines!)).toBe(
      "Counted since: 1 bottle (par: 3). The alert's 2 was by receipts and sales.",
    );
    expect(instantAlertMessage(wines!)).not.toMatch(/not counted yet/);

    // A count from before the alert does not restate it.
    expect(restateOnCount([NOT_COUNTED], SENT, [{ ...counted[0], last_counted_at: "2026-11-01T08:00:00Z" }])).toBeNull();
    // An older row (no inventoryId) matched by its library id, but never on an ambiguous one.
    const old = { ...NOT_COUNTED, inventoryId: undefined };
    expect(restateOnCount([old], SENT, counted)).not.toBeNull();
    expect(restateOnCount([old], SENT, [...counted, { ...counted[0], id: "inv-b" }])).toBeNull();
  });

  it("the edge sweep rewrites the stored row's message and metadata before it evaluates", async () => {
    const writes: any[] = [];
    const notes = [
      {
        id: "n1",
        restaurant_id: "r1",
        created_at: SENT,
        metadata: {
          mode: "instant",
          wines: [NOT_COUNTED, { ...NOT_COUNTED, inventoryId: "inv-c", wineName: "Still Uncounted" }],
        },
      },
    ];
    const inventory = [
      { id: "inv-a", master_wine_id: "wine-a", stock_live: 1, last_counted_at: "2026-11-03T08:00:00Z" },
    ];
    const supabase = chain(
      (t) => (t === "notifications" ? notes : t === "restaurant_inventory" ? inventory : []),
      writes,
    );
    const service = new LowStockAlertsService(
      { supabase } as any,
      {} as any,
      { get: () => "" } as any,
      {} as any,
      {} as any,
    );

    await service.runEdgeSweep();

    const write = writes.find((w) => w.table === "notifications");
    expect(write?.id).toBe("n1");
    expect(write.patch.message).toBe(
      "Just crossed below par: Received Red (1/3, counted since), Still Uncounted (2/3, not counted yet)",
    );
    expect(write.patch.metadata.wines[0]).toMatchObject({ notCounted: false, uncountedFigure: 2 });
    expect(write.patch.metadata.wines[1]).toMatchObject({ notCounted: true });
    expect(write.patch.metadata.mode).toBe("instant");
  });
});
