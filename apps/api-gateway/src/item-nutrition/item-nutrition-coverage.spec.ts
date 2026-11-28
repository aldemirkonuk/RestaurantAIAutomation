import { ServiceUnavailableException } from "@nestjs/common";
import { ItemNutritionService } from "./item-nutrition.service";
import { DatabaseService } from "../database/database.service";

/**
 * DD-r108-36: GET /inventory/:restaurantId/nutrition/coverage. Pinned here:
 *  - the recorded ids are read WHOLE: 1,001 rows over two pages of 1,000
 *    all come back (a single unpaged select would stop at 1,000);
 *  - every page and the item count name the caller's house, so another
 *    house's rows never count;
 *  - a failed read is a 503, never "0 recorded";
 *  - the answer carries ids and a count only.
 */

type Row = { id: string; inventory_id: string; restaurant_id: string };
const pad = (n: number) => String(n).padStart(5, "0");
const house = (rid: string, n: number, from = 0): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${rid}-n${pad(from + i)}`, inventory_id: `${rid}-i${pad(from + i)}`, restaurant_id: rid }));

function makeService(opts: {
  rows: Row[];
  items?: { count: number | null; error: { message: string } | null };
  failPage?: number;
  pages?: Array<{ restaurantFilter: unknown; limit: number }>;
  countFilters?: unknown[];
}) {
  let served = 0;
  const from = (table: string) => {
    if (table === "restaurant_inventory") {
      let rid: unknown;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (_c: string, v: unknown) => {
          rid = v;
          opts.countFilters?.push(v);
          return b;
        },
        then: (res: (a: unknown) => unknown) =>
          Promise.resolve({ data: null, ...(opts.items ?? { count: rid === undefined ? 9999 : 1500, error: null }) }).then(res),
      };
      return b;
    }
    let rid: unknown;
    let cursor: string | null = null;
    let lim = 1000;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => {
        if (c === "restaurant_id") rid = v;
        return b;
      },
      order: () => b,
      gt: (_c: string, v: string) => {
        cursor = v;
        return b;
      },
      limit: (n: number) => {
        lim = n;
        return b;
      },
      then: (res: (a: unknown) => unknown) => {
        const page = served++;
        opts.pages?.push({ restaurantFilter: rid, limit: lim });
        if (opts.failPage === page) return Promise.resolve({ data: null, error: { message: "timeout" }, count: null }).then(res);
        const left = opts.rows
          .filter((r) => rid === undefined || r.restaurant_id === rid)
          .filter((r) => cursor === null || r.id > cursor)
          .sort((a, b2) => (a.id < b2.id ? -1 : 1));
        const data = left.slice(0, lim).map(({ id, inventory_id }) => ({ id, inventory_id }));
        return Promise.resolve({ data, error: null, count: left.length }).then(res);
      },
    };
    return b;
  };
  const db = { supabase: { from } } as unknown as DatabaseService;
  return new ItemNutritionService(db);
}

describe("ItemNutritionService.coverage", () => {
  it("reads all 1,001 recorded ids over two pages, never stopping at the 1,000-row cap", async () => {
    const pages: Array<{ restaurantFilter: unknown; limit: number }> = [];
    const out = await makeService({ rows: house("r-1", 1001), pages }).coverage("r-1");
    expect(out.recordedItemIds).toHaveLength(1001);
    expect(out.recordedItemIds[1000]).toBe("r-1-i01000");
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(out.houseItems).toBe(1500);
  });

  it("counts only the caller's house: every page and the item count filter by restaurant_id", async () => {
    const pages: Array<{ restaurantFilter: unknown; limit: number }> = [];
    const countFilters: unknown[] = [];
    const out = await makeService({ rows: [...house("r-1", 3), ...house("r-2", 5)], pages, countFilters }).coverage("r-1");
    expect(out.recordedItemIds).toEqual(["r-1-i00000", "r-1-i00001", "r-1-i00002"]);
    for (const p of pages) expect(p.restaurantFilter).toBe("r-1");
    expect(countFilters).toEqual(["r-1"]);
  });

  it("a failed page is a 503, never an answer of 0 recorded", async () => {
    await expect(makeService({ rows: house("r-1", 1001), failPage: 1 }).coverage("r-1")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("a failed item count is a 503 too", async () => {
    await expect(
      makeService({ rows: house("r-1", 2), items: { count: null, error: { message: "reset" } } }).coverage("r-1"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("answers ids and a count only, no figures", async () => {
    const out = await makeService({ rows: house("r-1", 1) }).coverage("r-1");
    expect(Object.keys(out).sort()).toEqual(["houseItems", "recordedItemIds"]);
  });
});
