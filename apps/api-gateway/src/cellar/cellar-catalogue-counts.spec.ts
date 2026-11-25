import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { CellarRegistersService } from "./cellar-registers.service";

/**
 * The shared catalogues are tallied by the database, not by a browser-sized
 * read in the gateway. PostgREST caps a plain select at max_rows (1000), so a
 * library of 2,500 rows was counted as 1,000 and the readout said so quietly.
 */

const MAX_ROWS = 1000;

type Row = Record<string, string | null>;

/** A PostgREST stand-in: honours eq/not-in filters, head counts, ranges and the max_rows cap. */
function table(rows: Row[]) {
  return {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      let out = rows;
      let from = 0;
      let to = Infinity;
      const q: Record<string, unknown> = {};
      q.eq = (col: string, v: string) => { out = out.filter((r) => r[col] === v); return q; };
      q.is = () => q;
      q.range = (a: number, b: number) => { from = a; to = b; return q; };
      q.then = (resolve: (v: unknown) => unknown) => {
        if (opts?.head) return Promise.resolve({ data: null, error: null, count: out.length }).then(resolve);
        const page = out.slice(from, Math.min(to + 1, from + MAX_ROWS));
        return Promise.resolve({ data: page, error: null, count: null }).then(resolve);
      };
      return q;
    },
  };
}

async function readCounts(library: Row[], beverages: Row[]) {
  const db = {
    getClient: () => ({
      from: (t: string) => (t === "master_wine_library" ? table(library) : table(beverages)),
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [CellarRegistersService, { provide: DatabaseService, useValue: db }],
  }).compile();
  const service = moduleRef.get(CellarRegistersService) as unknown as {
    readCatalogueCounts(): Promise<{
      status: { readable: boolean; rows: number | null };
      counts: Map<string, number> | null;
      unmapped: Record<string, number>;
    }>;
  };
  return service.readCatalogueCounts();
}

const many = (n: number, col: string, v: string | null): Row[] =>
  Array.from({ length: n }, () => ({ [col]: v }));

describe("readCatalogueCounts past the 1000-row cap", () => {
  it("counts a library of 2,500 rows by kind, equal to the grouped counts", async () => {
    const library = [
      ...many(1700, "beverage_kind", "wine"),
      ...many(600, "beverage_kind", "beer"),
      ...many(150, "beverage_kind", "sake"),
      ...many(50, "beverage_kind", null),
    ];
    const r = await readCounts(library, []);
    expect(r.status).toEqual({ readable: true, reason: null, rows: 2500 });
    expect(r.counts?.get("wines")).toBe(1700);
    expect(r.counts?.get("beer")).toBe(600);
    expect(r.counts?.get("spirits")).toBeUndefined();
  });

  it("counts 1,300 beverages past the cap and still names the types it cannot map", async () => {
    const beverages = [
      ...many(1100, "beverage_type", "whiskey"),
      ...many(190, "beverage_type", "beer"),
      ...many(10, "beverage_type", "tepache"),
    ];
    const r = await readCounts([], beverages);
    expect(r.status.rows).toBe(1300);
    expect(r.counts?.get("whiskey")).toBe(1100);
    expect(r.counts?.get("spirits")).toBe(1100);
    expect(r.counts?.get("beer")).toBe(190);
    expect(r.unmapped).toEqual({ tepache: 10 });
  });
});
