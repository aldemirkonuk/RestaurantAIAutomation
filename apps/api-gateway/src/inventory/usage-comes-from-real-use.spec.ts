import { InventoryService } from "./inventory.service";

/**
 * days_of_stock_from_real_use: inventory_analytics says where a good's usage
 * a day comes from (sales, counts, or neither) and over which window. The
 * list read selects those columns and carries them on every row, so the
 * drawer can say "used 5.8 kg between the counts of 22 Oct and 11 Nov"
 * instead of "not drawn by sales".
 */

function service(analyticsRows: unknown[], error: unknown = null) {
  const selects: string[] = [];
  const chain: any = {
    from: jest.fn(() => chain),
    select: jest.fn((cols: string) => {
      selects.push(cols);
      return chain;
    }),
    eq: jest.fn(() => Promise.resolve({ data: analyticsRows, error })),
  };
  const db = { getClient: () => chain } as any;
  const svc = new InventoryService(db);
  return { svc, selects };
}

const FLOUR = {
  inventory_id: "inv-flour",
  velocity_per_day: 290,
  days_of_cover: 28,
  reorder_point: 2900,
  reorder_suggested: false,
  abc_class: null,
  dead_stock: false,
  days_since_sale: null,
  usage_source: "counts",
  usage_since: "2026-10-22T03:00:00+00:00",
  usage_until: "2026-11-11T03:00:00+00:00",
  usage_qty: "5800",
};

describe("usage a day says where it comes from", () => {
  it("the analytics read selects the usage source and its window", async () => {
    const { svc, selects } = service([FLOUR]);
    await (svc as any).fetchAnalytics("r1");
    expect(selects[0].split(", ")).toEqual(
      expect.arrayContaining([
        "velocity_per_day",
        "days_of_cover",
        "usage_source",
        "usage_since",
        "usage_until",
        "usage_qty",
      ]),
    );
  });

  it("a counted good carries its source, window and amount used (a number, not text)", async () => {
    const { svc } = service([FLOUR]);
    const { map } = await (svc as any).fetchAnalytics("r1");
    const row = (svc as any).mapInventoryItem(
      { id: "inv-flour", kind: "food", uom: "g" },
      undefined,
      undefined,
      map.get("inv-flour"),
    );
    expect(row).toMatchObject({
      velocityPerDay: 290,
      daysOfCover: 28,
      deadStock: false,
      usageSource: "counts",
      usageSince: "2026-10-22T03:00:00+00:00",
      usageUntil: "2026-11-11T03:00:00+00:00",
      usageQty: 5800,
    });
  });

  it("neither sales nor counts: no source, no amount", () => {
    const { svc } = service([]);
    const row = (svc as any).mapInventoryItem(
      { id: "inv-salt", kind: "food", uom: "g" },
      undefined,
      undefined,
      { ...FLOUR, velocity_per_day: 0, days_of_cover: null, usage_source: null, usage_since: null, usage_until: null, usage_qty: null },
    );
    expect(row.usageSource).toBeUndefined();
    expect(row.usageQty).toBeUndefined();
    expect(row.daysOfCover).toBeUndefined();
  });
});
