import { Test, TestingModule } from "@nestjs/testing";
import { CellarAgingService } from "./cellar-aging.service";
import { DatabaseService } from "../database/database.service";
import { makeSupabaseStub, SupabaseStub } from "./testing/supabase-stub";

/**
 * Drink window — the cellar-aging half (dashboard rebuild spec §5).
 *
 * The chef's insight is the whole test suite: this half works off delivery date
 * and known drinking windows with nobody logging anything, and it must be
 * ranked by URGENCY, never by money — "a $40 bottle nobody's pouring that's
 * about to tip over matters more today than a $400 bottle with five good years
 * left."
 *
 * The other binding rule is ADR 0051: where a window is not knowable for an
 * item, the item SAYS SO. An invented default window is exactly the failure
 * mode the ADR exists to prevent, and it would be invisible — a plausible
 * "drink by 2029" on a wine nobody has aging data for reads identically to a
 * real one.
 */

const R1 = "11111111-1111-1111-1111-111111111111";
/** A second unit, whose rows sit in every fixture below as a leak tripwire. */
const R2 = "22222222-2222-2222-2222-222222222222";
/** A third unit that owns nothing anywhere. */
const R3 = "33333333-3333-3333-3333-333333333333";

const INV_CHEAP = "aaaaaaaa-0000-0000-0000-000000000001";
const INV_NOLOTS = "aaaaaaaa-0000-0000-0000-000000000002";
const INV_NOLANDING = "aaaaaaaa-0000-0000-0000-000000000003";
const INV_CLOSING = "aaaaaaaa-0000-0000-0000-000000000004";
const INV_PRICEY = "aaaaaaaa-0000-0000-0000-000000000005";
const INV_NOWINDOW = "aaaaaaaa-0000-0000-0000-000000000006";
/** Belongs to R2. Must never appear in an R1 answer. */
const INV_OTHER_UNIT = "aaaaaaaa-0000-0000-0000-0000000000ff";
const MW_OTHER_UNIT = "bbbbbbbb-0000-0000-0000-0000000000ff";

const MW = {
  cheap: "bbbbbbbb-0000-0000-0000-000000000001",
  nolots: "bbbbbbbb-0000-0000-0000-000000000002",
  nolanding: "bbbbbbbb-0000-0000-0000-000000000003",
  closing: "bbbbbbbb-0000-0000-0000-000000000004",
  pricey: "bbbbbbbb-0000-0000-0000-000000000005",
  nowindow: "bbbbbbbb-0000-0000-0000-000000000006",
};

/** "now" for every case below. Windows are computed in whole years. */
const NOW = "2026-09-01T12:00:00Z";

const INVENTORY = [
  {
    id: INV_CHEAP,
    restaurant_id: R1,
    master_wine_id: MW.cheap,
    wine_name: "Muscadet Sèvre et Maine",
    stock_live: 6,
  },
  {
    id: INV_NOLOTS,
    restaurant_id: R1,
    master_wine_id: MW.nolots,
    wine_name: "Sancerre",
    stock_live: 3,
  },
  {
    id: INV_NOLANDING,
    restaurant_id: R1,
    master_wine_id: MW.nolanding,
    wine_name: "Vermentino",
    stock_live: 2,
  },
  {
    id: INV_CLOSING,
    restaurant_id: R1,
    master_wine_id: MW.closing,
    wine_name: "Chablis 1er Cru",
    stock_live: 6,
  },
  {
    id: INV_PRICEY,
    restaurant_id: R1,
    master_wine_id: MW.pricey,
    wine_name: "Barolo Riserva",
    stock_live: 4,
  },
  {
    id: INV_NOWINDOW,
    restaurant_id: R1,
    master_wine_id: MW.nowindow,
    wine_name: "House Red",
    stock_live: 10,
  },
  // ---- Second unit. Every fixture below carries one of these. ----
  {
    id: INV_OTHER_UNIT,
    restaurant_id: R2,
    master_wine_id: MW_OTHER_UNIT,
    wine_name: "Other unit's Krug",
    stock_live: 99,
  },
];

const CATALOG = [
  // 2019 + 5 → drink by 2024 → 2 years past. The cheap bottle.
  {
    id: MW.cheap,
    name: "Muscadet Sèvre et Maine",
    producer: "Domaine de la Pépière",
    vintage: 2019,
    aging_potential_years: 5,
  },
  // 2021 + 4 → 2025 → 1 year past.
  {
    id: MW.nolots,
    name: "Sancerre",
    producer: "Vacheron",
    vintage: 2021,
    aging_potential_years: 4,
  },
  // 2023 + 2 → 2025 → 1 year past, but nothing recorded it landing.
  {
    id: MW.nolanding,
    name: "Vermentino",
    producer: "Argiolas",
    vintage: 2023,
    aging_potential_years: 2,
  },
  // 2022 + 4 → 2026 → this year. Closing.
  {
    id: MW.closing,
    name: "Chablis 1er Cru",
    producer: "Louis Michel",
    vintage: 2022,
    aging_potential_years: 4,
  },
  // 2018 + 13 → 2031 → five good years left. The $400 bottle.
  {
    id: MW.pricey,
    name: "Barolo Riserva",
    producer: "Giacosa",
    vintage: 2018,
    aging_potential_years: 13,
  },
  // Vintage known, aging potential NOT known. The honest-gap case.
  {
    id: MW.nowindow,
    name: "House Red",
    producer: "Unknown",
    vintage: 2022,
    aging_potential_years: null,
  },
  // The other unit's wine. A perfectly good window — which is exactly why it
  // would slip into an R1 answer unnoticed if the tenant filter were dropped.
  {
    id: MW_OTHER_UNIT,
    name: "Krug Grande Cuvée",
    producer: "Krug",
    vintage: 2015,
    aging_potential_years: 20,
  },
];

const ROLLUP = [
  {
    inventory_id: INV_CHEAP,
    restaurant_id: R1,
    live_qty: 6,
    wac: 6.5,
    has_invoice_cost: true,
  },
  {
    inventory_id: INV_CLOSING,
    restaurant_id: R1,
    live_qty: 6,
    wac: 28,
    has_invoice_cost: false,
  },
  {
    inventory_id: INV_PRICEY,
    restaurant_id: R1,
    live_qty: 4,
    wac: 100,
    has_invoice_cost: true,
  },
  // Stock on hand, but no cost anywhere. Value must be null, never 0.
  {
    inventory_id: INV_NOWINDOW,
    restaurant_id: R1,
    live_qty: 10,
    wac: null,
    has_invoice_cost: false,
  },
  {
    inventory_id: INV_OTHER_UNIT,
    restaurant_id: R2,
    live_qty: 99,
    wac: 180,
    has_invoice_cost: true,
  },
];

const LOTS = [
  // 2026-05-04 → 120 days held at NOW.
  {
    inventory_id: INV_CHEAP,
    restaurant_id: R1,
    received_at: "2026-05-04T00:00:00Z",
    vintage: 2019,
  },
  {
    inventory_id: INV_CHEAP,
    restaurant_id: R1,
    received_at: "2026-07-20T00:00:00Z",
    vintage: 2019,
  },
  {
    inventory_id: INV_CLOSING,
    restaurant_id: R1,
    received_at: "2026-08-25T00:00:00Z",
    vintage: 2022,
  },
  {
    inventory_id: INV_PRICEY,
    restaurant_id: R1,
    received_at: "2026-01-10T00:00:00Z",
    vintage: 2018,
  },
  {
    inventory_id: INV_NOWINDOW,
    restaurant_id: R1,
    received_at: "2026-08-01T00:00:00Z",
    vintage: null,
  },
  {
    inventory_id: INV_OTHER_UNIT,
    restaurant_id: R2,
    received_at: "2020-01-01T00:00:00Z",
    vintage: 2015,
  },
];

// No lots for INV_NOLOTS — the delivery date is the only landing record.
// 2026-06-01 → 92 days held at NOW.
const ORDERS = [
  {
    inventory_id: INV_NOLOTS,
    restaurant_id: R1,
    delivered_at: "2026-06-01T00:00:00Z",
  },
  {
    inventory_id: INV_OTHER_UNIT,
    restaurant_id: R2,
    delivered_at: "2020-01-01T00:00:00Z",
  },
];

function build(stub: SupabaseStub) {
  return Test.createTestingModule({
    providers: [
      CellarAgingService,
      { provide: DatabaseService, useValue: { getClient: () => stub.client } },
    ],
  }).compile();
}

function fullStub() {
  return makeSupabaseStub({
    restaurant_inventory: INVENTORY,
    master_wine_library: CATALOG,
    inventory_lot_rollup: ROLLUP,
    inventory_lots: LOTS,
    procurement_orders: ORDERS,
  });
}

describe("CellarAgingService — drink window", () => {
  let service: CellarAgingService;
  let stub: SupabaseStub;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    stub = fullStub();
    const module: TestingModule = await build(stub);
    service = module.get(CellarAgingService);
  });

  afterEach(() => jest.useRealTimers());

  // =========================================================================
  // The ranking rule — the chef was explicit and it is the whole point
  // =========================================================================

  it("ranks by urgency, so the $39 bottle past its window beats the $400 bottle with five years left", async () => {
    const res = await service.getDrinkWindow(R1);
    const order = res.items.map((i) => i.inventoryId);

    expect(order.indexOf(INV_CHEAP)).toBeLessThan(order.indexOf(INV_PRICEY));

    const cheap = res.items.find((i) => i.inventoryId === INV_CHEAP)!;
    const pricey = res.items.find((i) => i.inventoryId === INV_PRICEY)!;

    // The cheap bottle really is the cheap one — otherwise the test proves
    // nothing about the ranking key.
    expect(cheap.value!.amount).toBe(39);
    expect(pricey.value!.amount).toBe(400);
    expect(cheap.value!.amount).toBeLessThan(pricey.value!.amount);

    expect(cheap.urgency).toBe("past_window");
    expect(pricey.urgency).toBe("holding");
  });

  it("orders the whole list by urgency tier, then by how overdue — never by money", async () => {
    const res = await service.getDrinkWindow(R1);

    expect(res.items.map((i) => i.inventoryId)).toEqual([
      INV_CHEAP, // 2 years past
      INV_NOLOTS, // 1 year past, held 92 days
      INV_NOLANDING, // 1 year past, landing unknown → last within the tier
      INV_CLOSING, // window closes this year
      INV_PRICEY, // five years left
      INV_NOWINDOW, // window not knowable → always last
    ]);

    // urgencyRank is the key the server actually sorted on, and it is
    // published so a surface cannot silently re-rank and still claim urgency.
    const ranks = res.items.map((i) => i.urgencyRank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("sorts an item with no knowable window last, never in the middle on a guessed date", async () => {
    const res = await service.getDrinkWindow(R1);
    expect(res.items[res.items.length - 1].inventoryId).toBe(INV_NOWINDOW);
    expect(res.items[res.items.length - 1].urgency).toBe("unknown");
  });

  // =========================================================================
  // ADR 0051 — unknown says unknown, per item
  // =========================================================================

  it("returns a null window with a per-item reason when aging potential is not known", async () => {
    const res = await service.getDrinkWindow(R1);
    const item = res.items.find((i) => i.inventoryId === INV_NOWINDOW)!;

    expect(item.window).toBeNull();
    expect(item.windowUnknownReason).toBeTruthy();
    expect(item.windowUnknownReason).toMatch(/aging potential/i);
    // The invented-default failure mode, stated as an assertion.
    expect(item).not.toHaveProperty("drinkByYear");
  });

  it("never invents a landing date: no lot and no delivered order reads as unknown, not as today", async () => {
    const res = await service.getDrinkWindow(R1);
    const item = res.items.find((i) => i.inventoryId === INV_NOLANDING)!;

    expect(item.landedAt).toBeNull();
    expect(item.heldDays).toBeNull();
    expect(item.landedBasis).toBe("unknown");
  });

  it("returns a null value with a reason when no cost backs the stock, never 0", async () => {
    const res = await service.getDrinkWindow(R1);
    const item = res.items.find((i) => i.inventoryId === INV_NOWINDOW)!;

    expect(item.value).toBeNull();
    expect(item.valueUnknownReason).toBeTruthy();
    expect(item.bottles).toBe(10); // stock is known; only its cost is not
  });

  it("labels every derived window estimated, because aging potential is a catalog property, not a measurement", async () => {
    const res = await service.getDrinkWindow(R1);
    const withWindow = res.items.filter((i) => i.window !== null);

    expect(withWindow.length).toBeGreaterThan(0);
    for (const item of withWindow) {
      expect(item.window!.confidence).toBe("estimated");
      expect(item.window!.basis).toMatch(/aging_potential_years/);
    }
  });

  // =========================================================================
  // Landing date and holding time
  // =========================================================================

  it("takes the landing date from the earliest live lot and reports days held", async () => {
    const res = await service.getDrinkWindow(R1);
    const item = res.items.find((i) => i.inventoryId === INV_CHEAP)!;

    expect(item.landedAt).toBe("2026-05-04T00:00:00Z");
    expect(item.landedBasis).toBe("lot_received");
    expect(item.heldDays).toBe(120);
  });

  it("falls back to the delivered order date when the item has no lots, and says so", async () => {
    const res = await service.getDrinkWindow(R1);
    const item = res.items.find((i) => i.inventoryId === INV_NOLOTS)!;

    expect(item.landedAt).toBe("2026-06-01T00:00:00Z");
    expect(item.landedBasis).toBe("order_delivered");
    expect(item.heldDays).toBe(92);
  });

  it("computes the window from the real catalog columns", async () => {
    const res = await service.getDrinkWindow(R1);
    const item = res.items.find((i) => i.inventoryId === INV_CHEAP)!;

    expect(item.window).toEqual({
      drinkByYear: 2024,
      yearsRemaining: -2,
      agingPotentialYears: 5,
      vintage: 2019,
      confidence: "estimated",
      basis: expect.stringContaining("aging_potential_years"),
    });
  });

  // =========================================================================
  // Coverage — counts are floors when the query was capped
  // =========================================================================

  it("reports coverage counts and does not call them floors when nothing was truncated", async () => {
    const res = await service.getDrinkWindow(R1);

    expect(res.coverage).toEqual({
      itemsConsidered: 6,
      itemsWithKnownWindow: 5,
      itemsWithoutKnownWindow: 1,
      itemsWithoutLandedDate: 1,
      truncated: false,
    });
  });

  it("marks coverage truncated when the row cap is hit, so counts render as floors", async () => {
    const res = await service.getDrinkWindow(R1, { limit: 2 });

    expect(res.coverage.truncated).toBe(true);
    expect(res.items.length).toBe(2);
  });

  // =========================================================================
  // Multi-unit (spec §6)
  // =========================================================================

  it("scopes every tenant table to the requested restaurant", async () => {
    await service.getDrinkWindow(R1);

    for (const table of [
      "restaurant_inventory",
      "inventory_lot_rollup",
      "inventory_lots",
      "procurement_orders",
    ]) {
      expect(stub.filtered(table, "restaurant_id", R1)).toBe(true);
    }
  });

  it("never returns the other unit's bottles, and never counts them in coverage", async () => {
    const res = await service.getDrinkWindow(R1);

    expect(res.items.map((i) => i.inventoryId)).not.toContain(INV_OTHER_UNIT);
    expect(res.items.map((i) => i.name)).not.toContain("Krug Grande Cuvée");
    expect(res.coverage.itemsConsidered).toBe(6);
  });

  it("does not tenant-filter the global wine catalog, and keys it only by this tenant's wine ids", async () => {
    await service.getDrinkWindow(R1);

    // master_wine_library has no restaurant_id — it is a shared catalog. The
    // isolation comes from the id list, which is built from this restaurant's
    // inventory rows only, so the other unit's wine is never even looked up.
    const call = stub.callsFor("master_wine_library")[0];
    const inFilter = call.filters.find((f) => f.method === "in");
    expect(inFilter).toBeDefined();
    expect(inFilter!.args[0]).toBe("id");
    expect((inFilter!.args[1] as string[]).sort()).toEqual(
      Object.values(MW).sort(),
    );
    expect(inFilter!.args[1]).not.toContain(MW_OTHER_UNIT);
  });

  it("returns nothing for a unit that owns nothing, rather than somebody else's cellar", async () => {
    const res = await service.getDrinkWindow(R3);

    expect(res.items).toEqual([]);
    expect(res.coverage.itemsConsidered).toBe(0);
    // No catalog fetch at all when there are no wines to look up.
    expect(stub.callsFor("master_wine_library")).toHaveLength(0);
  });

  it("states its basis in the payload, including that it does not read sales", async () => {
    const res = await service.getDrinkWindow(R1);

    expect(res.restaurantId).toBe(R1);
    expect(res.basis.ranking).toMatch(/urgency/i);
    expect(res.basis.ranking).toMatch(/value never/i);
    expect(Object.values(res.basis).join(" ")).toMatch(/pos|sales/i);
  });
});
