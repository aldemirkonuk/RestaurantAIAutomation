import { ConflictException, ForbiddenException, NotFoundException, BadRequestException } from "@nestjs/common";
import { repriceIntoDraft, repriceLine, repricePrice, repriceRefusal } from "./menu-reprice";
import { MenuVersionsController } from "./menus.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * r108 menu-g9: "Raise prices by a percent" makes a new DRAFT menu, never an
 * in-place edit. These pin the arithmetic (integer hundredths, half up to the
 * step), the copy (whole, scoped to the house, the current menu untouched)
 * and who may ask (owner or manager).
 */

type Row = Record<string, unknown>;
const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CURRENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** An in-memory table store whose queries filter, order, page, insert and delete. */
function fakeDb(seed: Record<string, Row[]>, opts: { failInsertOn?: number } = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const writes: Array<{ table: string; op: string; rows?: Row[] }> = [];
  let inserts = 0;
  let nextId = 0;
  const db = {
    from(table: string) {
      const keep: Array<(r: Row) => boolean> = [];
      let op: "select" | "insert" | "delete" = "select";
      let payload: Row[] = [];
      let orderBy: string | null = null;
      let limit: number | null = null;
      let single = false;
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (keep.push((r) => r[c] === v), q),
        neq: (c: string, v: unknown) => (keep.push((r) => r[c] !== v), q),
        gt: (c: string, v: unknown) => (keep.push((r) => String(r[c]) > String(v)), q),
        order: (c: string) => ((orderBy = c), q),
        limit: (n: number) => ((limit = n), q),
        maybeSingle: () => ((single = true), q),
        single: () => ((single = true), q),
        insert: (rows: Row | Row[]) => ((op = "insert"), (payload = Array.isArray(rows) ? rows : [rows]), q),
        delete: () => ((op = "delete"), q),
        then(resolve: (v: unknown) => unknown) {
          const rows = (tables[table] ??= []);
          if (op === "insert") {
            inserts += 1;
            if (opts.failInsertOn === inserts) return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve);
            const made = payload.map((r) => ({ id: `new-${String(++nextId).padStart(6, "0")}`, ...r }));
            rows.push(...made);
            writes.push({ table, op, rows: made });
            return Promise.resolve({ data: single ? made[0] : made, error: null }).then(resolve);
          }
          if (op === "delete") {
            tables[table] = rows.filter((r) => !keep.every((k) => k(r)));
            writes.push({ table, op });
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          let out = rows.filter((r) => keep.every((k) => k(r)));
          if (orderBy) {
            const c = orderBy;
            out = [...out].sort((a, z) => (String(a[c]) < String(z[c]) ? -1 : 1));
          }
          if (limit !== null) out = out.slice(0, limit);
          return Promise.resolve({ data: single ? out[0] ?? null : out, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
  return { db, tables, writes };
}

const menuRow = (over: Row = {}): Row => ({
  id: CURRENT,
  restaurant_id: HOUSE,
  name: "Wine List",
  status: "active",
  menu_type: "beverage",
  cadence: null,
  ...over,
});
let n = 0;
const line = (over: Row = {}): Row => ({
  id: `l-${String(++n).padStart(6, "0")}`,
  menu_id: CURRENT,
  restaurant_id: HOUSE,
  name: `Wine ${n}`,
  category: "Red",
  by_glass_price: null,
  bottle_price: 100,
  status: "approved",
  price_flag: null,
  created_at: "2027-01-01T00:00:00Z",
  ...over,
});
const input = (over: Partial<Parameters<typeof repriceIntoDraft>[1]> = {}) => ({
  restaurantId: HOUSE,
  menuId: CURRENT,
  userId: "u-1",
  percent: 10,
  roundTo: 0.5,
  ...over,
});

describe("repricePrice -- integer hundredths, half up to the step", () => {
  it("9.50 +10% to the nearest 0.50 is 10.50", () => expect(repricePrice(9.5, 10, 0.5)).toBe(10.5));
  it("45 +7.5% to the nearest 1 is 48", () => expect(repricePrice(45, 7.5, 1)).toBe(48));
  it("33.33 +3% to the nearest 0.01 is 34.33", () => expect(repricePrice(33.33, 3, 0.01)).toBe(34.33));
  it("1.00 +0.5% to the nearest 0.01 is 1.01 (half up, not a float's 100.4999)", () =>
    expect(repricePrice(1, 0.5, 0.01)).toBe(1.01));
  it("40 +10% to the nearest 5 is 45 (44 is 8.8 steps, so 9)", () =>
    expect(repricePrice(40, 10, 5)).toBe(45));
  it("a price that would round to nothing is kept as it was", () => expect(repricePrice(4, -50, 10)).toBe(4));
  it("a blank price stays blank", () => expect(repricePrice(null, 10, 1)).toBeNull());
  it("a price read as text from the database is read as its number", () =>
    expect(repricePrice("9.50" as unknown as number, 10, 0.5)).toBe(10.5));
});

describe("repriceLine", () => {
  it("a line held in another money is copied as it is and counted apart", () =>
    expect(repriceLine({ bottle_price: 50, price_flag: "other_currency" }, 10, 1)).toEqual({
      by_glass_price: null,
      bottle_price: 50,
      outcome: "held_other_money",
    }));
  it("a line outside the chosen sections is copied as it is", () =>
    expect(repriceLine({ category: "White", bottle_price: 50 }, 10, 1, ["Red"]).outcome).toBe("unchanged"));
  it('"" names the lines with no section', () =>
    expect(repriceLine({ category: null, bottle_price: 50 }, 10, 1, [""]).bottle_price).toBe(55));
});

describe("repriceRefusal -- bounds, in words", () => {
  it.each([
    [0, 1],
    [-51, 1],
    [101, 1],
    [10.001, 1],
    [10, 0.25],
  ])("percent %p round %p is refused", (p, r) => expect(repriceRefusal(p, r)).toEqual(expect.any(String)));
  it.each([
    [-50, 0.01],
    [100, 10],
    [7.5, 0.05],
  ])("percent %p round %p is fine", (p, r) => expect(repriceRefusal(p, r)).toBeNull());
});

describe("repriceIntoDraft -- a new draft, the current menu untouched", () => {
  it("copies the current menu into a draft named for the raise, and answers the counts", async () => {
    const lines = [
      line({ bottle_price: 9.5 }),
      line({ bottle_price: null, by_glass_price: null }),
      line({ bottle_price: 50, price_flag: "other_currency" }),
      line({ bottle_price: 20, status: "discarded" }),
    ];
    const f = fakeDb({ restaurant_menus: [menuRow()], menu_items: lines });
    const before = JSON.stringify(lines);
    const r = await repriceIntoDraft(f.db, input());
    expect(r).toEqual({ menuId: expect.any(String), name: "Wine List, prices +10%", changed: 1, unchanged: 1, heldOtherMoney: 1 });
    const draft = f.tables.restaurant_menus.find((m) => m.id === r.menuId)!;
    expect(draft).toMatchObject({ status: "draft", restaurant_id: HOUSE, read_state: "done", lines_extracted: 3 });
    const copied = f.tables.menu_items.filter((l) => l.menu_id === r.menuId);
    expect(copied.map((l) => l.bottle_price)).toEqual([10.5, null, 50]);
    // The current menu's rows are as they were, and nothing was written to them.
    expect(JSON.stringify(f.tables.menu_items.filter((l) => l.menu_id === CURRENT))).toBe(before);
    expect(f.tables.restaurant_menus.find((m) => m.id === CURRENT)).toEqual(menuRow());
    expect(f.writes.filter((w) => w.op !== "insert")).toEqual([]);
  });

  it("only the chosen sections change", async () => {
    const f = fakeDb({
      restaurant_menus: [menuRow()],
      menu_items: [line({ category: "Red", bottle_price: 40 }), line({ category: "White", bottle_price: 40 })],
    });
    const r = await repriceIntoDraft(f.db, input({ roundTo: 1, sections: ["White"] }));
    const copied = f.tables.menu_items.filter((l) => l.menu_id === r.menuId);
    expect(copied.map((l) => [l.category, l.bottle_price])).toEqual([
      ["Red", 40],
      ["White", 44],
    ]);
    expect(r).toMatchObject({ changed: 1, unchanged: 1 });
  });

  it("a menu of 1001 lines is copied whole, in batches", async () => {
    const many = Array.from({ length: 1001 }, () => line());
    const f = fakeDb({ restaurant_menus: [menuRow()], menu_items: many });
    const r = await repriceIntoDraft(f.db, input());
    expect(f.tables.menu_items.filter((l) => l.menu_id === r.menuId)).toHaveLength(1001);
    expect(r.changed).toBe(1001);
    expect(f.writes.filter((w) => w.table === "menu_items").length).toBeGreaterThan(1);
  });

  it("another house's lines are never copied, even under the same menu id", async () => {
    const f = fakeDb({
      restaurant_menus: [menuRow()],
      menu_items: [line(), line({ restaurant_id: OTHER, name: "Not ours" })],
    });
    const r = await repriceIntoDraft(f.db, input());
    const copied = f.tables.menu_items.filter((l) => l.menu_id === r.menuId);
    expect(copied.map((l) => l.name)).not.toContain("Not ours");
    expect(copied.every((l) => l.restaurant_id === HOUSE)).toBe(true);
  });

  it("a menu id from another house is a 404, and nothing is made", async () => {
    const f = fakeDb({ restaurant_menus: [menuRow({ restaurant_id: OTHER })], menu_items: [line({ restaurant_id: OTHER })] });
    await expect(repriceIntoDraft(f.db, input())).rejects.toBeInstanceOf(NotFoundException);
    expect(f.writes).toEqual([]);
  });

  it("a kept menu that is not current is a 409, and nothing is made", async () => {
    const f = fakeDb({ restaurant_menus: [menuRow({ status: "draft" })], menu_items: [line()] });
    await expect(repriceIntoDraft(f.db, input())).rejects.toBeInstanceOf(ConflictException);
    expect(f.writes).toEqual([]);
  });

  it("0% is refused in words before anything is read", async () => {
    const f = fakeDb({ restaurant_menus: [menuRow()], menu_items: [line()] });
    await expect(repriceIntoDraft(f.db, input({ percent: 0 }))).rejects.toBeInstanceOf(BadRequestException);
    expect(f.writes).toEqual([]);
  });

  it("a failed batch takes the half-made draft away", async () => {
    const many = Array.from({ length: 600 }, () => line());
    const f = fakeDb({ restaurant_menus: [menuRow()], menu_items: many }, { failInsertOn: 3 });
    await expect(repriceIntoDraft(f.db, input())).rejects.toThrow(/taken away/);
    expect(f.tables.restaurant_menus.map((m) => m.id)).toEqual([CURRENT]);
    expect(f.tables.menu_items.filter((l) => l.menu_id !== CURRENT)).toEqual([]);
  });
});

describe("POST /menu-versions/:menuId/reprice -- owner or manager only", () => {
  function controller(role: string | null) {
    const organizations = new OrganizationsService({} as never);
    jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
    const repriceMenu = jest.fn(async () => ({ menuId: "d-1", name: "x", changed: 1, unchanged: 0, heldOtherMoney: 0 }));
    return { c: new MenuVersionsController({ repriceMenu } as any, organizations), repriceMenu };
  }
  it.each(["owner", "manager"])("a %s may raise the prices into a draft", async (role) => {
    const { c, repriceMenu } = controller(role);
    await c.reprice(HOUSE, "u-1", CURRENT, { percent: 10, roundTo: 1 });
    expect(repriceMenu).toHaveBeenCalledWith(HOUSE, CURRENT, "u-1", { percent: 10, roundTo: 1 });
  });
  it.each(["staff", null])("%s is refused with 403 in words, and nothing is asked", async (role) => {
    const { c, repriceMenu } = controller(role);
    const err = await c.reprice(HOUSE, "u-1", CURRENT, { percent: 10, roundTo: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(String(err.message)).toMatch(/raise the menu's prices/);
    expect(repriceMenu).not.toHaveBeenCalled();
  });
});
