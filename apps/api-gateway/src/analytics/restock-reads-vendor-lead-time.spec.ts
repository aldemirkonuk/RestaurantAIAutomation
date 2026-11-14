import { AnalyticsService } from "./analytics.service";
/**
 * r36 reports audit, gap 7: "What to buy back" assumed a 7-day lead for every
 * good. The reorder point is daily demand x lead + safety stock, so a vendor
 * that delivers in 2 days or in 21 moved every order by days. A good now takes
 * its vendor's lead as the vendor register states it.
 */
const day = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString().substring(0, 10);
const RID = "r-lead";

function item(id: string, providerId: string | null) {
  return {
    id,
    name: id,
    type: "red",
    qty: 30,
    unitCost: 10,
    costBasis: "invoiced_lot",
    unitPrice: 30,
    thresholdMin: 0,
    reorderPoint: 0,
    masterWineId: `mw-${id}`,
    providerId,
    inventoryValue: 300,
  };
}

/** 90 days of 2 a day for each good; the house is older than the window. */
function lines(ids: string[]) {
  return ids.flatMap((id) =>
    Array.from({ length: 90 }, (_, i) => ({
      masterWineId: `mw-${id}`,
      wineId: `mw-${id}`,
      inventoryId: id,
      qty: 2,
      how: "bottle",
      servings: 2,
      volumeMl: 1500,
      date: day(89 - i),
    })),
  );
}

const cell = (value: number | null, source: string) => ({ value, source });

function analytics(vendorTerms: any, items: any[]) {
  const svc = new AnalyticsService({} as any, vendorTerms);
  jest
    .spyOn(svc as any, "firstConsumption")
    .mockResolvedValue({ read: "read", day: day(400) });
  jest.spyOn(svc as any, "loadInventory").mockResolvedValue(items);
  jest
    .spyOn(svc as any, "loadConsumption")
    .mockResolvedValue(lines(items.map((i) => i.id)));
  return svc;
}

const register = {
  read: jest.fn(async () => ({
    vendors: [
      { providerId: "p-fast", leadTimeDays: cell(2, "stated") },
      { providerId: "p-slow", leadTimeDays: cell(21, "vendor_record") },
      { providerId: "p-blank", leadTimeDays: cell(null, "unknown") },
    ],
  })),
};

describe("restock takes each good's lead time from its vendor", () => {
  it("a 2-day vendor and a 21-day vendor get different reorder points", async () => {
    const out: any = await analytics(register, [
      item("fast", "p-fast"),
      item("slow", "p-slow"),
    ]).getInventoryScience(RID);
    const by = Object.fromEntries(out.skus.map((s: any) => [s.id, s]));
    expect(by.fast).toMatchObject({ leadTimeDays: 2, leadTimeSource: "stated" });
    expect(by.slow).toMatchObject({
      leadTimeDays: 21,
      leadTimeSource: "vendor_record",
    });
    // Flat demand: no safety stock, so the point is demand x lead.
    expect(by.fast.reorderPoint).toBeCloseTo(2 * 2, 6);
    expect(by.slow.reorderPoint).toBeCloseTo(2 * 21, 6);
    expect(by.fast.needsReorder).toBe(false);
    expect(by.slow.needsReorder).toBe(true);
    expect(out.basis.reorderScience).toContain(
      "lead time per good, from its vendor's lead in the vendor register",
    );
  });

  it("a good with no vendor, or a vendor with no lead, is assumed at 7 days and counted", async () => {
    const out: any = await analytics(register, [
      item("fast", "p-fast"),
      item("blank", "p-blank"),
      item("none", null),
    ]).getInventoryScience(RID);
    const by = Object.fromEntries(out.skus.map((s: any) => [s.id, s]));
    expect(by.blank).toMatchObject({ leadTimeDays: 7, leadTimeSource: "assumed" });
    expect(by.none).toMatchObject({ leadTimeDays: 7, leadTimeSource: "assumed" });
    expect(by.none.reorderPoint).toBeCloseTo(14, 6);
    expect(out.basis.reorderScience).toContain(
      "2 of 3 assumed at 7d (no lead time recorded for their vendor)",
    );
  });

  it("an unreadable vendor register leaves every good assumed and says why", async () => {
    const broken = { read: jest.fn(async () => Promise.reject(new Error("down"))) };
    const out: any = await analytics(broken, [item("fast", "p-fast")])
      .getInventoryScience(RID);
    expect(out.skus[0]).toMatchObject({ leadTimeDays: 7, leadTimeSource: "assumed" });
    expect(out.basis.reorderScience).toContain(
      "the vendor register could not be read",
    );
  });

  it("a caller's explicit lead wins and the register is not read", async () => {
    register.read.mockClear();
    const out: any = await analytics(register, [item("slow", "p-slow")])
      .getInventoryScience(RID, { leadTimeDays: 5 });
    expect(register.read).not.toHaveBeenCalled();
    expect(out.skus[0]).toMatchObject({ leadTimeDays: 5, leadTimeSource: "requested" });
    expect(out.basis.reorderScience).toContain("lead time 5d as requested");
  });
});

describe("the inventory read carries each good's vendor", () => {
  it("selects provider_id and maps it to providerId", async () => {
    const selects: string[] = [];
    const client = {
      from: (table: string) => {
        const b: any = {};
        b.select = (cols: string) => {
          selects.push(`${table}: ${cols}`);
          return b;
        };
        b.eq = () => b;
        b.then = (ok: any) =>
          ok({
            data:
              table === "restaurant_inventory"
                ? [{ id: "i1", wine_name: "x", stock_live: 3, provider_id: "p-fast" }]
                : [],
            error: null,
          });
        return b;
      },
    };
    const svc = new AnalyticsService({ getClient: () => client } as any);
    const rows: any[] = await (svc as any).loadInventory(RID);
    expect(selects.join("\n")).toMatch(/restaurant_inventory: .*\bprovider_id\b/);
    expect(rows[0].providerId).toBe("p-fast");
  });
});
