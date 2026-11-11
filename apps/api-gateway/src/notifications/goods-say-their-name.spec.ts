import { LowStockAlertsService } from "./low-stock-alerts.service";
import { lowStockDigestTemplate } from "../communications/email-templates/low-stock-digest.template";
import { lowStockAlertTemplate } from "../communications/email-templates/low-stock-alert.template";
import { goodsNoun, quantityIn } from "../common/goods-words";

/** #929 widened the view to every good; OD-161: a never-counted row is not low. */
function chain(): any {
  const c: any = {
    select: () => c,
    eq: () => c,
    neq: () => c,
    in: () => c,
    update: () => c,
    maybeSingle: () => Promise.resolve({ data: { alert_count: 0 } }),
    upsert: () => Promise.resolve({ error: null }),
    then: (resolve: any) => resolve({ data: [] }),
  };
  return c;
}

function build() {
  const db: any = {
    supabase: { from: () => chain() },
    getClient: () => ({ from: () => chain() }),
    getRestaurantMemberIds: jest.fn().mockResolvedValue(["u1"]),
    getRestaurantMemberIdsOrThrow: jest.fn().mockResolvedValue(["u1"]),
  };
  const notifications = {
    persistForRestaurant: jest.fn().mockResolvedValue({ inserted: 1 }),
  };
  const gmail = {
    sendLowStockDigest: jest.fn().mockResolvedValue({ success: true }),
  };
  const svc = new LowStockAlertsService(
    db,
    notifications as any,
    { get: jest.fn().mockReturnValue("") } as any,
    gmail as any,
    { resolveRecipients: jest.fn().mockResolvedValue({ emails: ["m@x.com"] }) } as any,
  );
  return { svc, notifications, gmail };
}

const flourRow = {
  id: "inv-flour",
  master_wine_id: null,
  wine_name: "Flour",
  stock_live: 200,
  threshold_min: 500,
  kind: "food",
  uom: "g",
  last_counted_at: "2026-11-01T00:00:00Z",
};

describe("low-stock alert says each good's own unit and name", () => {
  it("one flour: the inbox row says grams, not bottles", async () => {
    const { svc, notifications } = build();
    const row = (svc as any).mapRow(flourRow);
    await svc.evaluateRestaurant("r1", [row], "R1");
    const payload = notifications.persistForRestaurant.mock.calls[0][1];
    expect(payload.message).toBe("Only 200 g remaining (par: 500)");
    expect(payload.message).not.toMatch(/bottle/);
  });

  it("a beer and a flour together are goods, not wines", async () => {
    const { svc, notifications, gmail } = build();
    const rows = [
      flourRow,
      { ...flourRow, id: "inv-lager", wine_name: "House Lager", kind: "beer", uom: "bottle", stock_live: 2, threshold_min: 24 },
    ].map((r) => (svc as any).mapRow(r));
    await svc.evaluateRestaurant("r1", rows, "R1");
    const payload = notifications.persistForRestaurant.mock.calls[0][1];
    expect(payload.title).toBe("2 goods dropped below par — 2 critical");
    expect(payload.message).toContain("Flour (200/500 g)");
    expect(payload.message).toContain("House Lager (2/24 bottles)");
    const sent = gmail.sendLowStockDigest.mock.calls[0][0];
    expect(sent.wines.map((w: any) => w.uom)).toEqual(["g", "bottle"]);
  });

  it("two wines still read as wines", async () => {
    const { svc, notifications } = build();
    const w = (id: string) =>
      (svc as any).mapRow({ ...flourRow, id, wine_name: id, kind: "wine", uom: "bottle", stock_live: 1, threshold_min: 6 });
    await svc.evaluateRestaurant("r1", [w("a"), w("b")], "R1");
    expect(notifications.persistForRestaurant.mock.calls[0][1].title).toBe(
      "2 wines dropped below par — 2 critical",
    );
  });

  it("an unnamed non-wine good is not called an unknown wine", () => {
    const { svc } = build();
    const row = (svc as any).mapRow({ ...flourRow, wine_name: null });
    expect(row.wineName).toBe("Unnamed good");
  });
});

describe("OD-161 — a good nobody has counted is not low", () => {
  it("mapRow drops a row whose last_counted_at is null, keeps one with no such column", () => {
    const { svc } = build();
    expect((svc as any).mapRow({ ...flourRow, last_counted_at: null })).toBeNull();
    const { last_counted_at: _omit, ...older } = flourRow;
    expect((svc as any).mapRow(older)).not.toBeNull();
  });
});

describe("the emails say each good's own unit and name", () => {
  const flour = { wineName: "Flour", currentStock: 200, threshold: 500, severity: "critical" as const, kind: "food", uom: "g" };
  it("digest table, heading and summary", () => {
    const html = lowStockDigestTemplate({
      mode: "digest",
      wines: [flour, { ...flour, wineName: "Rye", severity: "low" }],
    });
    expect(html).toContain("200 / 500 g");
    expect(html).toContain("2 goods below par");
    expect(html).not.toMatch(/bottles|wines/i);
  });
  it("a wine digest still says bottles and wines", () => {
    const html = lowStockDigestTemplate({
      mode: "digest",
      wines: [{ wineName: "Barolo", currentStock: 1, threshold: 6, severity: "critical", kind: "wine", uom: "bottle" }],
    });
    expect(html).toContain("1 / 6 bottles");
    expect(html).toContain("1 wine below par");
  });
  it("single alert preheader", () => {
    const html = lowStockAlertTemplate({ wineName: "Flour", currentStock: 200, threshold: 500, uom: "g" });
    expect(html).toContain("Only 200 g remaining");
    expect(html).not.toMatch(/bottles/);
  });
  it("helpers", () => {
    expect(quantityIn(3, "each")).toBe("3 units");
    expect(goodsNoun(["wine", "beer"], 1)).toBe("good");
  });
});
