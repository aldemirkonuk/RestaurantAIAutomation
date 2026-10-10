/**
 * F-434 — `GET /wines/submissions/list` returns only the caller's house's
 * submissions. `master_wine_library_submissions` is one table for every
 * house and the gateway reads it with the service role, so nothing but this
 * route's own filter keeps house B's rows (wine identity, price reference,
 * submitter id) away from a member of house A.
 *
 * Real: `WinesController.listSubmissions` and `WineSubmissionsService
 * .listSubmissions`. Double: the Supabase client, a tiny in-memory table that
 * honours `eq`, `order` and `limit` the way PostgREST would — so a missing
 * house filter returns both houses' rows here exactly as it did in production.
 */
import { WineSubmissionsService } from "./wine-submissions.service";
import { WinesController } from "./wines.controller";

const HOUSE_A = "house-a";
const HOUSE_B = "house-b";

const ROWS = [
  { id: "a1", restaurant_id: HOUSE_A, status: "pending", created_at: "2026-10-01" },
  { id: "a2", restaurant_id: HOUSE_A, status: "matched", created_at: "2026-10-02" },
  { id: "b1", restaurant_id: HOUSE_B, status: "pending", created_at: "2026-10-03", payload: { priceReference: 42 } },
  { id: "b2", restaurant_id: HOUSE_B, status: "matched", created_at: "2026-10-04" },
];

function fakeSupabase(rows: any[]) {
  return {
    from: () => {
      let out = [...rows];
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          out = out.filter((r) => r[col] === val);
          return q;
        },
        order: (col: string, opts: { ascending: boolean }) => {
          out.sort((x, y) => (x[col] < y[col] ? -1 : 1) * (opts.ascending ? 1 : -1));
          return q;
        },
        limit: (n: number) => {
          out = out.slice(0, n);
          return q;
        },
        then: (res: any, rej: any) => Promise.resolve({ data: out, error: null }).then(res, rej),
      };
      return q;
    },
  };
}

function build() {
  const service = new WineSubmissionsService({ supabase: fakeSupabase(ROWS) } as any);
  const controller = new WinesController({} as any, service, { get: jest.fn() } as any);
  return { controller, service };
}

describe("GET /wines/submissions/list is scoped to the caller's house (F-434)", () => {
  it("a member of house A sees house A's submissions and never house B's", async () => {
    const { controller } = build();
    const out = await controller.listSubmissions({ limit: 200 } as any, { userId: "u-a", restaurantId: HOUSE_A });
    expect(out.map((r: any) => r.id).sort()).toEqual(["a1", "a2"]);
    expect(out.some((r: any) => r.restaurant_id === HOUSE_B)).toBe(false);
  });

  it("the status filter narrows within the house, it does not widen past it", async () => {
    const { controller } = build();
    const out = await controller.listSubmissions({ status: "pending" } as any, { userId: "u-a", restaurantId: HOUSE_A });
    expect(out.map((r: any) => r.id)).toEqual(["a1"]);
  });

  it("no house on the caller means no rows, not every house's rows", async () => {
    const { service } = build();
    await expect(service.listSubmissions("" as any)).resolves.toEqual([]);
    await expect(service.listSubmissions(undefined as any, "pending")).resolves.toEqual([]);
  });
});
