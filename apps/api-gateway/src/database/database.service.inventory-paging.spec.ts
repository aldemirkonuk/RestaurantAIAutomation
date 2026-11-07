import { DatabaseService } from "./database.service";

/**
 * QA round 15 on #874: offset paging repeated a row when a title landed
 * mid-read (flaw A) and trusted a short page as the end (flaw B). The list is
 * now #873's keyset read (readWholeWindow, ADR 0292). `table` is a fake
 * PostgREST over one table: eq/is filters, id order, gt cursor, limit, range
 * (so the old offset read runs too), exact count, a server cap, and a hook run
 * before each request.
 */
function fake(
  table: any[],
  opts: { cap?: number; before?: (n: number) => void; fail?: number } = {},
) {
  const scopes: unknown[][] = [];
  let n = 0;
  const from = () => {
    const where: ((r: any) => boolean)[] = [];
    const scope: unknown[] = [];
    let lo = 0;
    let lim = Infinity;
    const q: any = {
      select: () => q,
      eq: (k: string, v: unknown) => (scope.push(k), where.push((r) => r[k] === v), q),
      is: (k: string, v: unknown) => (where.push((r) => (r[k] ?? null) === v), q),
      order: () => q,
      gt: (k: string, v: string) => (where.push((r) => r[k] > v), q),
      limit: (l: number) => ((lim = l), q),
      range: (a: number, b: number) => ((lo = a), (lim = b - a + 1), q),
      then: (res: any, rej: any) => {
        n += 1;
        opts.before?.(n);
        scopes.push(scope);
        if (opts.fail === n)
          return Promise.resolve({ data: null, error: { message: `page ${n} down` } }).then(res, rej);
        const hit = table.filter((r) => where.every((w) => w(r))).sort((a, b) => (a.id < b.id ? -1 : 1));
        return Promise.resolve({
          data: hit.slice(lo, lo + Math.min(lim, opts.cap ?? 1000)),
          error: null,
          count: hit.length,
        }).then(res, rej);
      },
    };
    return q;
  };
  const svc = new DatabaseService({ get: () => undefined } as any);
  (svc as any).supabase = { from };
  return { svc, scopes };
}

const title = (id: string, restaurant_id = "rest-1") => ({
  id,
  restaurant_id,
  is_active: true,
  deleted_at: null,
});
const house = (n: number) =>
  Array.from({ length: n }, (_, i) => title(`t${String(i).padStart(5, "0")}`));
const ids = (rows: any[]) => rows.map((r) => r.id);

describe("DatabaseService.getRestaurantInventory paging", () => {
  it("returns every row past the 1000-row cap, scoped to the house on each page", async () => {
    const rows = [...house(2500), title("x-other", "rest-2")];
    const { svc, scopes } = fake(rows);
    const out = await svc.getRestaurantInventory("rest-1");
    expect(out).toHaveLength(2500);
    expect(new Set(ids(out)).size).toBe(2500);
    expect(scopes).toHaveLength(3);
    for (const s of scopes) expect(s).toContain("restaurant_id");
  });

  it("throws when a later page fails, never returning the first page as the whole list", async () => {
    const { svc } = fake(house(2500), { fail: 2 });
    await expect(svc.getRestaurantInventory("rest-1")).rejects.toThrow("could not be read whole");
  });

  it("flaw A: a title landing behind the cursor mid-read neither repeats nor drops a row", async () => {
    const rows = house(2500);
    const { svc } = fake(rows, { before: (n) => n === 2 && rows.push(title("t00000a")) });
    const out = await svc.getRestaurantInventory("rest-1");
    expect(ids(out)).toEqual(ids(house(2500)));
  });

  it("flaw A: a title landing ahead of the cursor mid-read is read once, with every other", async () => {
    const rows = house(2500);
    const { svc } = fake(rows, { before: (n) => n === 2 && rows.push(title("t99999")) });
    const out = await svc.getRestaurantInventory("rest-1");
    expect(out).toHaveLength(2501);
    expect(new Set(ids(out)).size).toBe(2501);
  });

  it("flaw B: a server cap below 1000 does not end the read at its first page", async () => {
    const { svc } = fake(house(1200), { cap: 500 });
    expect(await svc.getRestaurantInventory("rest-1")).toHaveLength(1200);
  });
});
