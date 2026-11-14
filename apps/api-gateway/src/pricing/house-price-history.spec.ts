import { ForbiddenException, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { HISTORY_COLUMNS, readHousePriceHistory } from "./house-price-history";
import { PriceHistoryController } from "./price-history.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * r36 menu audit N6: one good's house-price history, newest first, read back
 * from menu_price_versions. The fake FILTERS on every eq/in it is given and
 * orders and limits, so a dropped house scope is served the other house's rows.
 */
type Row = Record<string, unknown>;
const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const GOOD = "c0000000-0000-4000-8000-000000000001";

function fakeDb(tables: Record<string, { rows?: Row[]; error?: { message: string } }>) {
  const selects: Record<string, unknown[]> = {};
  const db = {
    from(table: string) {
      const keep: Array<(r: Row) => boolean> = [];
      let order: { col: string; asc: boolean } | null = null;
      let limit: number | null = null;
      const run = () => {
        const t = tables[table] ?? {};
        if (t.error) return { data: null, error: t.error };
        let out = (t.rows ?? []).filter((r) => keep.every((k) => k(r)));
        if (order) {
          const { col, asc } = order;
          out = [...out].sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : 1) * (asc ? 1 : -1));
        }
        if (limit !== null) out = out.slice(0, limit);
        return { data: out, error: null };
      };
      const q: any = {
        select: (cols: unknown) => ((selects[table] ??= []).push(cols), q),
        eq: (c: string, v: unknown) => (keep.push((r) => r[c] === v), q),
        in: (c: string, vs: unknown[]) => (keep.push((r) => vs.includes(r[c])), q),
        order: (col: string, o: { ascending: boolean }) => ((order = { col, asc: o.ascending }), q),
        limit: (n: number) => ((limit = n), q),
        maybeSingle: async () => {
          const r = run();
          return { data: r.data ? (r.data[0] ?? null) : null, error: r.error };
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
      };
      return q;
    },
  };
  return { db: db as any, selects };
}

const v = (over: Row): Row => ({
  restaurant_id: A,
  inventory_id: GOOD,
  bottle_price: null,
  glass_price: null,
  effective_to: null,
  change_source: "manual",
  changed_by: null,
  reason: null,
  ...over,
});

function house(versions: Row[], extra: Record<string, { rows?: Row[]; error?: { message: string } }> = {}) {
  return fakeDb({
    restaurant_inventory: { rows: [{ id: GOOD, restaurant_id: A, wine_name: "Chianti", display_name: null }] },
    menu_price_versions: { rows: versions },
    users: { rows: [{ user_id: "u-deniz", name: "Deniz" }, { user_id: "u-aylin", name: "Aylin" }] },
    ...extra,
  });
}

const CHIANTI = [
  v({ bottle_price: "48", effective_from: "2026-10-01T09:00:00Z", effective_to: "2026-11-02T10:00:00Z", change_source: "import", changed_by: "u-deniz", reason: "menu made current" }),
  v({ bottle_price: 52, glass_price: "12.5", effective_from: "2026-11-02T10:00:00Z", changed_by: "u-aylin", reason: "  " }),
  v({ bottle_price: 40, effective_from: "2026-09-01T09:00:00Z", effective_to: "2026-10-01T09:00:00Z", change_source: "backfill" }),
  // Another house's row for the same good id: never read.
  v({ restaurant_id: B, bottle_price: 99, effective_from: "2026-11-10T10:00:00Z" }),
];

describe("readHousePriceHistory (r36 menu audit N6)", () => {
  it("reads one good's changes, newest first, with who, from where and why", async () => {
    const { db, selects } = house(CHIANTI);
    const out = await readHousePriceHistory(db, A, GOOD);
    expect(out).toEqual({
      inventoryId: GOOD,
      goodName: "Chianti",
      versions: [
        { bottle: 52, glass: 12.5, from: "2026-11-02T10:00:00Z", to: null, source: "manual", by: { userId: "u-aylin", name: "Aylin" }, reason: null },
        { bottle: 48, glass: null, from: "2026-10-01T09:00:00Z", to: "2026-11-02T10:00:00Z", source: "import", by: { userId: "u-deniz", name: "Deniz" }, reason: "menu made current" },
        { bottle: 40, glass: null, from: "2026-09-01T09:00:00Z", to: "2026-10-01T09:00:00Z", source: "backfill", by: { userId: null, name: null }, reason: null },
      ],
      more: false,
      namesReadable: true,
      namesReason: null,
    });
    expect(selects.menu_price_versions).toEqual([HISTORY_COLUMNS]);
  });

  it("returns the newest page and says older changes exist", async () => {
    const many = Array.from({ length: 5 }, (_, i) => v({ bottle_price: 40 + i, effective_from: `2026-10-0${i + 1}T00:00:00Z` }));
    const out = await readHousePriceHistory(house(many).db, A, GOOD, 3);
    expect(out.versions.map((x) => x.bottle)).toEqual([44, 43, 42]);
    expect(out.more).toBe(true);
    const all = await readHousePriceHistory(house(many).db, A, GOOD, 5);
    expect(all.more).toBe(false);
  });

  it("another house's good, or no such good, is a 404, and its prices are never read", async () => {
    await expect(readHousePriceHistory(house(CHIANTI).db, B, GOOD)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("a failed read is said, never an empty history", async () => {
    await expect(
      readHousePriceHistory(house(CHIANTI, { menu_price_versions: { error: { message: "timeout" } } }).db, A, GOOD),
    ).rejects.toThrow(new InternalServerErrorException("The price history could not be read: timeout."));
    await expect(
      readHousePriceHistory(house(CHIANTI, { restaurant_inventory: { error: { message: "denied" } } }).db, A, GOOD),
    ).rejects.toThrow(/The good could not be read, so its price history is not shown: denied/);
  });

  it("says who could not be named, and keeps the prices", async () => {
    const out = await readHousePriceHistory(house(CHIANTI, { users: { error: { message: "denied" } } }).db, A, GOOD);
    expect(out.versions).toHaveLength(3);
    expect(out.versions[0].by).toEqual({ userId: "u-aylin", name: null });
    expect(out.namesReadable).toBe(false);
    expect(out.namesReason).toBe("who changed these prices could not be named: denied");
  });
});

describe("PriceHistoryController: owner or manager only", () => {
  function controller(role: string | null) {
    const organizations = new OrganizationsService({} as never);
    jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
    return new PriceHistoryController({ supabase: house(CHIANTI).db } as never, organizations);
  }

  it.each(["owner", "manager"])("a %s reads the history", async (role) => {
    const out = await controller(role).history(A, "u-1", GOOD);
    expect(out.versions).toHaveLength(3);
  });

  it.each(["staff", "viewer", null])("%s is refused (403)", async (role) => {
    await expect(controller(role as string | null).history(A, "u-1", GOOD)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
