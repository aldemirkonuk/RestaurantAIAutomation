/**
 * OD-161, second half. A wine nobody has counted is unknown, not zero, unless
 * receipts and sales gave it a figure. Migration
 * a_received_wine_not_counted_yet_can_run_low lets such a wine into
 * `v_low_stock_items` when received minus sold is below par, with
 * `last_counted_at` null as the view's last column. The alert engine raises
 * it as low stock and says "not counted yet" wherever it gives the figure:
 * the stored inbox row, its metadata, and the email.
 */
import { LowStockAlertsService } from "./low-stock-alerts.service";
import { lowStockDigestTemplate } from "../communications/email-templates/low-stock-digest.template";

function makeDb(viewRows: any[]) {
  const chain = (table: string): any => {
    const c: any = {
      select: () => c,
      eq: () => c,
      neq: () => c,
      or: () => c,
      is: () => c,
      in: () => c,
      order: () => c,
      gt: () => c,
      limit: () => c,
      update: () => c,
      maybeSingle: () => Promise.resolve({ data: { alert_count: 0 } }),
      upsert: () => Promise.resolve({ error: null }),
      then: (resolve: any) =>
        resolve({
          data: table === "v_low_stock_items" ? viewRows : [],
          error: null,
        }),
    };
    return c;
  };
  return {
    supabase: { from: (t: string) => chain(t) },
    getClient: () => ({ from: (t: string) => chain(t) }),
    getRestaurantMemberIds: jest.fn().mockResolvedValue(["user-1"]),
    getRestaurantMemberIdsOrThrow: jest.fn().mockResolvedValue(["user-1"]),
  } as any;
}

// What the view returns for QA round 4's case: received 10, sold 8, par 3.
const RECEIVED_NOT_COUNTED = {
  id: "inv-received",
  restaurant_id: "r1",
  master_wine_id: "wine-received",
  wine_name: "Received Red",
  stock_live: 2,
  threshold_min: 3,
  last_counted_at: null,
};
const COUNTED = {
  id: "inv-counted",
  restaurant_id: "r1",
  master_wine_id: "wine-counted",
  wine_name: "Counted White",
  stock_live: 2,
  threshold_min: 3,
  last_counted_at: "2026-11-01T10:00:00Z",
};

describe("OD-161 — a received wine not counted yet can run low", () => {
  let notifications: { persistForRestaurant: jest.Mock };
  let gmail: { sendLowStockDigest: jest.Mock };

  beforeEach(() => {
    notifications = {
      persistForRestaurant: jest.fn().mockResolvedValue({ inserted: 1, ids: ["n1"] }),
    };
    gmail = { sendLowStockDigest: jest.fn().mockResolvedValue({ success: true }) };
  });

  function build(viewRows: any[]) {
    return new LowStockAlertsService(
      makeDb(viewRows),
      notifications as any,
      { get: jest.fn().mockReturnValue("") } as any,
      gmail as any,
      { resolveRecipients: jest.fn().mockResolvedValue({ emails: ["mgr@x.com"] }) } as any,
    );
  }

  async function rowsFromView(viewRows: any[]) {
    const service = build(viewRows) as any;
    const byHouse: Map<string, any[]> = await service.getLowStockByRestaurant();
    return { service, rows: byHouse.get("r1") ?? [] };
  }

  it("reads 'not counted' from the view's last_counted_at, and only a null says so", async () => {
    const { rows } = await rowsFromView([
      RECEIVED_NOT_COUNTED,
      COUNTED,
      // A view without the column (before this migration) held counted rows only.
      { ...COUNTED, id: "inv-old-view", last_counted_at: undefined },
    ]);
    const byId = Object.fromEntries(rows.map((r: any) => [r.inventoryId, r]));
    expect(byId["inv-received"]).toMatchObject({
      currentStock: 2,
      threshold: 3,
      severity: "low",
      notCounted: true,
    });
    expect(byId["inv-counted"].notCounted).toBe(false);
    expect(byId["inv-old-view"].notCounted).toBe(false);
  });

  it("alerts a received, never-counted wine as low stock and says it is not counted yet", async () => {
    const { service, rows } = await rowsFromView([RECEIVED_NOT_COUNTED]);
    await service.evaluateRestaurant("r1", rows, "R1");

    const payload = notifications.persistForRestaurant.mock.calls[0][1];
    expect(payload.type).toBe("inventory_low_stock");
    expect(payload.title).toBe("Low stock: Received Red");
    expect(payload.message).toBe(
      "2 bottles by receipts and sales, not counted yet (par: 3)",
    );
    expect(payload.message).not.toMatch(/^Only/);
    expect(payload.metadata.wines[0]).toMatchObject({ notCounted: true });
    expect(gmail.sendLowStockDigest.mock.calls[0][0].wines[0]).toMatchObject({
      wineName: "Received Red",
      notCounted: true,
    });
  });

  it("names the uncounted wine in a burst, and leaves the counted one's words alone", async () => {
    const { service, rows } = await rowsFromView([RECEIVED_NOT_COUNTED, COUNTED]);
    await service.evaluateRestaurant("r1", rows, "R1");

    const { message } = notifications.persistForRestaurant.mock.calls[0][1];
    expect(message).toContain("Received Red (2/3, not counted yet)");
    expect(message).toContain("Counted White (2/3)");
    expect(message).not.toContain("Counted White (2/3, not counted yet)");
  });

  it("carries 'not counted yet' into the daily digest", async () => {
    const { service, rows } = await rowsFromView([RECEIVED_NOT_COUNTED, COUNTED]);
    await service.sendDigest("r1", rows, "R1");

    const { metadata } = notifications.persistForRestaurant.mock.calls[0][1];
    const flags = Object.fromEntries(
      metadata.wines.map((w: any) => [w.wineName, w.notCounted]),
    );
    expect(flags).toEqual({ "Received Red": true, "Counted White": false });
  });

  it("writes 'not counted yet' beside the figure in the email, and only there", () => {
    const html = lowStockDigestTemplate({
      mode: "digest",
      wines: [
        { wineName: "Received Red", currentStock: 2, threshold: 3, severity: "low", notCounted: true },
        { wineName: "Counted White", currentStock: 2, threshold: 3, severity: "low" },
      ],
    });
    expect(html).toContain("2 / 3 bottles &middot; not counted yet");
    expect(html.match(/not counted yet/g)).toHaveLength(1);
  });
});
