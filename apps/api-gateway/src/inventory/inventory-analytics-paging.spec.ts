import { Logger } from "@nestjs/common";
import { InventoryService } from "./inventory.service";

/**
 * QA round 15 H3 on #874: fetchAnalytics was unpaged, so with 1200 titles the
 * last 200 had no pace or runway while `analyticsReadable` said the join was
 * read. A fake PostgREST: eq filters, order, gt keyset, limit, range, exact
 * count, the 1000-row cap, and one failing request per table.
 */
function fakePg(tables: Record<string, any[]>, fail = "") {
  const asked: Record<string, number> = {};
  const from = (table: string) => {
    const where: ((r: any) => boolean)[] = [];
    let key = "id";
    let lo = 0;
    let lim = Infinity;
    const q: any = {
      select: () => q,
      eq: (k: string, v: unknown) => (where.push((r) => r[k] === v), q),
      is: (k: string, v: unknown) => (where.push((r) => (r[k] ?? null) === v), q),
      order: (k: string) => ((key = k), q),
      gt: (k: string, v: string) => (where.push((r) => String(r[k]) > v), q),
      limit: (n: number) => ((lim = n), q),
      range: (a: number, b: number) => ((lo = a), (lim = b - a + 1), q),
      then: (res: any, rej: any) => {
        asked[table] = (asked[table] ?? 0) + 1;
        if (fail === `${table}#${asked[table]}`)
          return Promise.resolve({ data: null, error: { message: "down" } }).then(res, rej);
        const hit = (tables[table] ?? [])
          .filter((r) => where.every((w) => w(r)))
          .sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1));
        const data = hit.slice(lo, lo + Math.min(lim, 1000));
        return Promise.resolve({ data, error: null, count: hit.length }).then(res, rej);
      },
    };
    return q;
  };
  return { from };
}

const R = "rest-1";
const ids = Array.from({ length: 1200 }, (_, i) => `t${String(i).padStart(4, "0")}`);
const tables = () => ({
  restaurant_inventory: ids.map((id) => ({ id, restaurant_id: R, is_active: true, deleted_at: null, stock_live: 4 })),
  inventory_analytics: ids.map((inventory_id) => ({ inventory_id, restaurant_id: R, velocity_per_day: 0.5, days_of_cover: 8 })),
});

function serviceOver(pg: any): InventoryService {
  const db: any = { getClient: () => pg };
  db.getRestaurantInventory = async () => tables().restaurant_inventory;
  return new InventoryService(db);
}

describe("InventoryService.getRestaurantInventory: the sales pace past 1000 titles", () => {
  beforeEach(() => jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it("gives every one of 1200 titles its pace and runway", async () => {
    const list = await serviceOver(fakePg(tables())).getRestaurantInventory(R);
    expect(list).toHaveLength(1200);
    expect(list.filter((r: any) => r.velocityPerDay === 0.5 && r.daysOfCover === 8)).toHaveLength(1200);
    expect(list.every((r: any) => r.analyticsReadable === true)).toBe(true);
  });

  it("a failed second page says the pace could not be read, never blank for 200 titles", async () => {
    const list = await serviceOver(fakePg(tables(), "inventory_analytics#2")).getRestaurantInventory(R);
    expect(list.every((r: any) => r.analyticsReadable === false)).toBe(true);
  });
});
