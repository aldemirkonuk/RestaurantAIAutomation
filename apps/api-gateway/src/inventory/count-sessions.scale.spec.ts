import { CountSessionsService } from "./count-sessions.service";
import type { InventoryService } from "./inventory.service";

/**
 * F-1702: a whole-house count of a big house. `supabase/config.toml` sets
 * `max_rows = 1000`, so an unranged read is cut at the first thousand rows
 * with a 200, and a list of ids in one `.in()` grows the URL past what the
 * server takes. The fake below behaves like PostgREST on both: it honours
 * the filters, the orders and the range, caps every answer at 1,000 rows,
 * and refuses an `.in()` past 200 ids (about 7.4 KB of uuids, the size at
 * which a URL is refused). A pull or a review that does not page, or that
 * sends every item in one request, shows up here as items missing or as a
 * refused read.
 */

type Row = Record<string, any>;
const HOUSE = "house-a";
const SESSION = "count-1";
const MAX_ROWS = 1000;
const MAX_IN = 200;

function cappedDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    const filters: Array<(r: Row) => boolean> = [];
    const orders: Array<{ col: string; asc: boolean }> = [];
    let range: [number, number] | null = null;
    let single = false;
    let tooLong = false;
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), q),
      is: (c: string, v: any) => (filters.push((r) => (r[c] ?? null) === v), q),
      gte: (c: string, v: any) => (filters.push((r) => r[c] >= v), q),
      in: (c: string, vs: any[]) => {
        if (vs.length > MAX_IN) tooLong = true;
        filters.push((r) => vs.includes(r[c]));
        return q;
      },
      order: (col: string, o?: { ascending?: boolean }) => (
        orders.push({ col, asc: o?.ascending !== false }),
        q
      ),
      range: (a: number, b: number) => ((range = [a, b]), q),
      maybeSingle: () => ((single = true), q),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    const run = () => {
      if (tooLong) {
        return { data: null, error: { message: "URI too long", code: "414" } };
      }
      let out = rows.filter((r) => filters.every((f) => f(r)));
      out = [...out].sort((a, b) => {
        for (const { col, asc } of orders) {
          const x = a[col] ?? "";
          const y = b[col] ?? "";
          if (x < y) return asc ? -1 : 1;
          if (x > y) return asc ? 1 : -1;
        }
        return 0;
      });
      if (range) out = out.slice(range[0], range[1] + 1);
      out = out.slice(0, MAX_ROWS);
      if (single) return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    };
    return q;
  };
  return { from };
}

/** 1,200 items, one lot each, over three shelves: past both limits. */
function bigHouse() {
  const shelves = ["shelf-a", "shelf-b", "shelf-c"];
  const pad = (i: number) => String(i).padStart(4, "0");
  const items = Array.from({ length: 1200 }, (_, i) => `item-${pad(i)}`);
  const db = cappedDb({
    stock_count_sessions: [
      {
        id: SESSION,
        restaurant_id: HOUSE,
        kind: "full",
        status: "open",
        opened_by: "user-boss",
        opened_at: "2026-10-14T08:00:00.000Z",
        attributed_period: null,
      },
    ],
    stock_count_session_shelves: shelves.map((s, i) => ({
      session_id: SESSION,
      restaurant_id: HOUSE,
      location_id: s,
      sort_order: i,
      claimed_by: null,
      done_at: null,
    })),
    storage_locations: shelves.map((s) => ({
      id: s,
      restaurant_id: HOUSE,
      parent_id: null,
      is_active: true,
      zone: s,
      section: null,
      name: s,
      deleted_at: null,
    })),
    restaurant_inventory: items.map((id) => ({
      id,
      restaurant_id: HOUSE,
      display_name: `Wine ${id}`,
      wine_name: null,
      master_wine_id: null,
      bottle_size_ml: 750,
    })),
    inventory_lots: items.map((id, i) => ({
      id: `lot-${pad(i)}`,
      restaurant_id: HOUSE,
      inventory_id: id,
      location_id: shelves[i % 3],
      stock_state: "live",
      qty: 2,
      open_bottle_ml: 0,
    })),
    inventory_lot_rollup: items.map((id) => ({
      inventory_id: id,
      restaurant_id: HOUSE,
      master_wine_id: null,
      wac: 10,
    })),
  });
  const svc = new CountSessionsService(
    { getClient: () => db } as any,
    {} as unknown as InventoryService,
  );
  return { svc, items };
}

describe("F-1702 -- a whole-house count of a big house reads every lot", () => {
  it("[REVERT-FAILS] the pull lists all 1,200 items, named, across the shelves", async () => {
    const { svc, items } = bigHouse();
    const out: any = await svc.pull(HOUSE, SESSION, "user-bartender");
    const listed = out.shelves.flatMap((s: any) => s.items);
    expect(listed).toHaveLength(items.length);
    expect(new Set(listed.map((i: any) => i.inventoryId))).toEqual(
      new Set(items),
    );
    expect(listed.every((i: any) => i.name === `Wine ${i.inventoryId}`)).toBe(
      true,
    );
    expect(listed.some((i: any) => i.countWhole)).toBe(false);
  });

  it("[REVERT-FAILS] the review names every item no line has counted yet", async () => {
    const { svc, items } = bigHouse();
    const out: any = await svc.review(HOUSE, SESSION, true);
    expect(out.itemsNotCounted).toBe(items.length);
    const missed = out.shelves.flatMap((s: any) => s.missed);
    expect(missed).toHaveLength(items.length);
    expect(missed.every((m: any) => m.name === `Wine ${m.inventoryId}`)).toBe(
      true,
    );
  });
});
