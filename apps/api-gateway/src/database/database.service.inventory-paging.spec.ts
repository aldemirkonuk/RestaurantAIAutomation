import { DatabaseService } from "./database.service";

/** A stub of the one chain getRestaurantInventory uses; records every page's scoping. */
function stub(pages: Array<{ data?: any[]; error?: any }>) {
  const calls: Array<{ eq: Array<[string, unknown]>; range: [number, number] }> = [];
  let i = 0;
  const chain = () => {
    const rec = { eq: [] as Array<[string, unknown]>, range: [0, 0] as [number, number] };
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (rec.eq.push([c, v]), q),
      order: () => q,
      range: (a: number, b: number) => {
        rec.range = [a, b];
        calls.push(rec);
        return Promise.resolve(pages[i++] ?? { data: [] });
      },
    };
    return q;
  };
  const svc = new DatabaseService({ get: () => undefined } as any);
  (svc as any).supabase = { from: () => chain() };
  return { svc, calls };
}
const rows = (n: number, from = 0) => Array.from({ length: n }, (_, k) => ({ id: `r${from + k}` }));

describe("DatabaseService.getRestaurantInventory paging", () => {
  it("returns every row past the 1000-row cap, scoped to the house on each page", async () => {
    const { svc, calls } = stub([{ data: rows(1000) }, { data: rows(5, 1000) }]);
    const out = await svc.getRestaurantInventory("rest-1");
    expect(out).toHaveLength(1005);
    expect(calls.map((c) => c.range)).toEqual([[0, 999], [1000, 1999]]);
    for (const c of calls) expect(c.eq).toContainEqual(["restaurant_id", "rest-1"]);
  });

  it("throws when a later page fails, never returning the first page as the whole list", async () => {
    const { svc } = stub([{ data: rows(1000) }, { error: new Error("page 2 down") }]);
    await expect(svc.getRestaurantInventory("rest-1")).rejects.toThrow("page 2 down");
  });
});
