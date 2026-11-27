import { InventoryService } from "./inventory.service";

// perf-p4-2: GET /inventory/:house sends only the columns a surface reads.
// The derived figures the pages draw from are computed from the full row
// first, so leaving a column out of the response must never change them.

const unread = (): Record<string, any> =>
  Object.fromEntries(
    InventoryService.LIST_UNREAD_COLUMNS.map((c) => [c, null]),
  );

const base = (over: Record<string, any>) => ({
  restaurant_id: "r1",
  stock_live: 4,
  threshold_min: 2,
  is_active: true,
  unit_type: "BOTTLE",
  version: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  ...unread(),
  restaurants: { default_pour_ml: 150 },
  ...over,
});

const rows = [
  base({
    id: "wine",
    master_wine_id: "m1",
    sale_type: "glass",
    pour_size_ml: 125,
    menu_price_glass: 12,
    menu_price_current: 48,
    wine_name: "House red",
    master_wine_library: {
      name: "Wine X 1988",
      bottle_size_ml: 750,
      retail_price_avg: 30,
    },
  }),
  base({ id: "food", master_wine_id: "m2", unit_type: "KG", sku: "F-1" }),
  base({
    id: "spirit",
    master_wine_id: "m3",
    bottle_size_ml: 700,
    pour_size_ml: 50,
    master_wine_library: { name: "Gin", bottle_size_ml: 700 },
  }),
];

function make() {
  const db: any = {
    getRestaurantInventory: jest.fn().mockResolvedValue(rows),
    getClient: jest.fn(),
  };
  const svc: any = new (InventoryService as any)(db);
  jest.spyOn(svc, "fetchLotRollup").mockResolvedValue({
    ok: true,
    data: new Map([["wine", { wac: 20, live_qty: 4, has_invoice_cost: true, open_ml: 100 }]]),
  });
  jest.spyOn(svc, "fetchLocationBreakdown").mockResolvedValue({
    ok: true,
    data: new Map([["wine", [{ locationId: "l1", qty: 4, wac: 20 }]]]),
  });
  jest
    .spyOn(svc, "fetchAnalytics")
    .mockResolvedValue({ map: new Map(), ok: true });
  jest
    .spyOn(svc, "fetchSettledMoves")
    .mockResolvedValue({ map: new Map(), ok: true, capped: false });
  return svc as InventoryService;
}

describe("InventoryService.getRestaurantInventory lean list", () => {
  it("omits every unread column and keeps the derived figures", async () => {
    const out: any[] = await make().getRestaurantInventory("r1", { lean: true });
    const byId = Object.fromEntries(out.map((r) => [r.id, r]));
    for (const r of out) {
      for (const c of InventoryService.LIST_UNREAD_COLUMNS) {
        expect(r).not.toHaveProperty(c);
      }
    }
    // a wine: library name, alias, pour maths, lot rollup, locations
    expect(byId.wine).toMatchObject({
      wineName: "House red",
      libraryName: "Wine X 1988",
      houseAlias: "House red",
      bottleSizeMl: 750,
      pourSizeMl: 125,
      glassesPerBottle: 6,
      menuPriceGlass: 12,
      menuPriceBottle: 48,
      wac: 20,
      lotLiveQty: 4,
      openMl: 100,
      locations: [{ locationId: "l1", qty: 4, wac: 20 }],
      analyticsReadable: true,
      stock_live: 4,
      threshold_min: 2,
    });
    // a food: default pour, no library
    expect(byId.food).toMatchObject({ sku: "F-1", unit_type: "KG", wineName: null });
    // a bottled spirit: its own bottle size, not the default
    expect(byId.spirit).toMatchObject({
      bottleSizeMl: 700,
      pourSizeMl: 50,
      glassesPerBottle: 14,
    });
  });

  it("also drops beverage_id and identity_provenance, which no reader touches", async () => {
    const out: any[] = await make().getRestaurantInventory("r1", { lean: true });
    for (const c of ["beverage_id", "identity_provenance"]) {
      expect(InventoryService.LIST_UNREAD_COLUMNS).toContain(c);
      expect(out[0]).not.toHaveProperty(c);
    }
    // the full reader keeps them
    const full: any[] = await make().getRestaurantInventory("r1");
    expect(full[0]).toHaveProperty("beverage_id");
    expect(full[0]).toHaveProperty("identity_provenance");
  });

  it("keeps the whole row when the caller is not the web list", async () => {
    const out: any[] = await make().getRestaurantInventory("r1");
    expect(out[0]).toHaveProperty("alert_count");
    expect(out[0]).toHaveProperty("markup_classification");
  });

  // perf-p6-2: keys no reader needs, or that are null, leave the reply too.
  describe("empty and dead keys", () => {
    const emptyCols = () =>
      Object.fromEntries(
        [
          ...InventoryService.LIST_DEAD_KEYS,
          ...InventoryService.LIST_NULL_OMITTED_KEYS,
        ].map((c) => [c, null]),
      );

    // A populated house: every row has a sku, a third have a provider and a
    // count date, one in ten has a glasses-per-bottle override.
    const populated = Array.from({ length: 330 }, (_, i) =>
      base({
        id: `i${i}`,
        master_wine_id: `m${i}`,
        wine_name: `Wine number ${i}`,
        bottle_size_ml: 750,
        pour_size_ml: 150,
        ...emptyCols(),
        sku: `SKU-${i}`,
        provider_id: i % 3 === 0 ? `p${i}` : null,
        last_counted_at: i % 3 === 0 ? "2026-11-01T00:00:00Z" : null,
        markup_ratio: i % 5 === 0 ? 2.5 : null,
        glasses_per_bottle_override: i % 10 === 0 ? 8 : null,
        storage_location_id: i % 4 === 0 ? "loc" : null,
        restaurants: { default_pour_ml: 150 },
      }),
    );

    function makeWith(data: any[]) {
      const svc: any = new (InventoryService as any)({
        getRestaurantInventory: jest.fn().mockResolvedValue(data),
        getClient: jest.fn(),
      });
      jest.spyOn(svc, "fetchLotRollup").mockResolvedValue({ ok: true, data: new Map() });
      jest.spyOn(svc, "fetchLocationBreakdown").mockResolvedValue({ ok: true, data: new Map() });
      jest.spyOn(svc, "fetchSettledMoves").mockResolvedValue({ map: new Map(), ok: true, capped: false });
      jest
        .spyOn(svc, "fetchAnalytics")
        .mockResolvedValue({ map: new Map(), ok: true });
      return svc as InventoryService;
    }

    it("drops the four dead keys and null-valued audited keys, keeps filled ones", async () => {
      const out: any[] = await makeWith(populated).getRestaurantInventory("r1", {
        lean: true,
      });
      for (const r of out) {
        for (const c of InventoryService.LIST_DEAD_KEYS) expect(r).not.toHaveProperty(c);
      }
      const r0 = out[0]; // i%3==0, %5==0, %10==0
      expect(r0).toMatchObject({
        sku: "SKU-0",
        provider_id: "p0",
        last_counted_at: "2026-11-01T00:00:00Z",
        markup_ratio: 2.5,
        markupRatio: 2.5,
        glassesPerBottle: 8,
        glassesPerBottleOverride: 8,
      });
      const r1 = out[1]; // everything null
      for (const c of [
        "provider_id",
        "last_counted_at",
        "markup_ratio",
        "negotiated_price",
        "menu_section",
      ]) {
        expect(r1).not.toHaveProperty(c);
      }
      // lastCountedAt keeps its null: four web readers compare it === null.
      expect(r1).toHaveProperty("lastCountedAt", null);
      expect(r1.sku).toBe("SKU-1");
    });

    it("changes no derived figure and shrinks the reply on a populated fixture", async () => {
      const lean: any[] = await makeWith(populated).getRestaurantInventory("r1", {
        lean: true,
      });
      const full: any[] = await makeWith(populated).getRestaurantInventory("r1");
      const gone = new Set<string>([
        ...InventoryService.LIST_UNREAD_COLUMNS,
        ...InventoryService.LIST_DEAD_KEYS,
        ...InventoryService.LIST_NULL_OMITTED_KEYS,
      ]);
      lean.forEach((l, i) => {
        for (const [k, v] of Object.entries(full[i])) {
          if (gone.has(k)) {
            if (k in l) expect(l[k]).toEqual(v); // kept only when it carries a value
          } else {
            expect(l[k]).toEqual(v);
          }
        }
      });
      const bytes = (x: unknown) => JSON.stringify(x).length;
      // What #2191's lean list alone sent: the full row minus its 36 columns.
      const was = full.map((r) => {
        const c = { ...r };
        for (const k of InventoryService.LIST_UNREAD_COLUMNS) delete c[k];
        return c;
      });
      // eslint-disable-next-line no-console
      console.log(
        `list bytes full=${bytes(full)} lean-2191=${bytes(was)} lean-now=${bytes(lean)}`,
      );
      expect(bytes(lean)).toBeLessThan(bytes(was) * 0.9);
    });
  });
});
