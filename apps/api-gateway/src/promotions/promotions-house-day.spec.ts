import { MenusService } from "../menus/menus.service";
import { DatabaseService } from "../database/database.service";
import { PromotionsService, houseDay } from "./promotions.service";

/**
 * F-260: an offer's last day ended at 5 PM in Los Angeles, because "today"
 * was UTC's date. F-175: the empty table said "540 days of your own price
 * history" for a house whose prices went back about 100 days — 540 is the
 * window read, not how far back the house's prices go.
 */

type Row = Record<string, any>;

/** Filters on `eq`/`is`/`gt`, honours `limit`; everything else passes through. */
function fakeSupabase(tables: Record<string, Row[]>) {
  function from(table: string) {
    const preds: Array<(r: Row) => boolean> = [];
    let limit = Infinity;
    const api: any = new Proxy(
      {},
      {
        get(_t, prop: string) {
          switch (prop) {
            case "eq":
              return (c: string, v: unknown) => (
                preds.push((r) => r[c] === v),
                api
              );
            case "is":
              return (c: string, v: unknown) => (
                preds.push((r) => (r[c] ?? null) === v),
                api
              );
            case "gt":
              return (c: string, v: unknown) => (
                preds.push((r) => String(r[c]) > String(v)),
                api
              );
            case "limit":
              return (n: number) => ((limit = n), api);
            case "then":
              return (resolve: any) =>
                resolve({
                  data: (tables[table] ?? [])
                    .filter((r) => preds.every((p) => p(r)))
                    .slice(0, limit),
                  error: null,
                });
            default:
              return () => api;
          }
        },
      },
    );
    return api;
  }
  return { from } as any;
}

const HOUSE = "house-1";

function service(tables: Record<string, Row[]>) {
  const db = { supabase: fakeSupabase(tables) } as unknown as DatabaseService;
  const menus = new MenusService(
    db,
    undefined as any,
    undefined as any,
    undefined as any,
  );
  return new PromotionsService(db, menus);
}

function offer(end_date: string): Row {
  return {
    id: "o1",
    provider_id: "v1",
    restaurant_id: HOUSE,
    name: "Last-day offer",
    promo_type: "percentage",
    description: null,
    conditions: {},
    discount_value: { percent: 10 },
    applicable_wines: [],
    start_date: "2026-10-01",
    end_date,
    is_active: true,
    confidence: 0.8,
    created_at: "2026-10-01",
    dismissed_at: null,
    dismissed_by: null,
    providers: { id: "v1", name: "Sevilen" },
  };
}

// 2026-10-09 01:00 UTC is still 2026-10-08, 6 PM, in Los Angeles.
const EVENING_IN_LA = new Date("2026-10-09T01:00:00Z");

describe("promotions — today is the house's date (F-260)", () => {
  it("houseDay reads the date on the house's clock, and UTC's with no zone", () => {
    expect(houseDay(EVENING_IN_LA, "America/Los_Angeles")).toBe("2026-10-08");
    expect(houseDay(EVENING_IN_LA, "Europe/Istanbul")).toBe("2026-10-09");
    expect(houseDay(EVENING_IN_LA, null)).toBe("2026-10-09");
  });

  it("an offer ending today in Los Angeles is still open at 6 PM there", async () => {
    const read = await service({
      restaurants: [{ id: HOUSE, timezone: "America/Los_Angeles" }],
      provider_promotions: [offer("2026-10-08")],
    }).readForHouse(HOUSE, { now: EVENING_IN_LA });
    expect(read.time_zone).toBe("America/Los_Angeles");
    expect(read.today).toBe("2026-10-08");
    expect(read.offers[0].state).toBe("open");
  });

  it("a house with no zone recorded keeps UTC's date, and says it has no zone", async () => {
    const read = await service({
      restaurants: [{ id: HOUSE, timezone: null }],
      provider_promotions: [offer("2026-10-08")],
    }).readForHouse(HOUSE, { now: EVENING_IN_LA });
    expect(read.time_zone).toBeNull();
    expect(read.offers[0].state).toBe("passed");
  });
});

describe("promotions — how far back the house's own prices go (F-175)", () => {
  it("reports the oldest paid line read, not the window", async () => {
    const paid = (id: string, effective_date: string) => ({
      id,
      restaurant_id: HOUSE,
      provider_id: "v1",
      master_wine_id: "mw-1",
      identity_id: null,
      price: 20,
      unit: "bottle",
      currency: "USD",
      quantity: 6,
      effective_date,
      source: "invoice",
      master_wine_library: { name: "Narince", vintage: 2022 },
    });
    const read = await service({
      restaurants: [{ id: HOUSE, timezone: "America/Los_Angeles" }],
      price_history: [paid("p2", "2026-09-30"), paid("p1", "2026-07-01")],
    }).readForHouse(HOUSE, { now: EVENING_IN_LA });
    expect(read.ledger.window_days).toBe(540);
    expect(read.ledger.oldest_paid).toBe("2026-07-01");
  });

  it("says no paid line was read rather than inventing a date", async () => {
    const read = await service({
      restaurants: [{ id: HOUSE, timezone: null }],
    }).readForHouse(HOUSE, {
      now: EVENING_IN_LA,
    });
    expect(read.ledger.oldest_paid).toBeNull();
  });
});
