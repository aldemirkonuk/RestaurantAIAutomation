import { ConflictException, NotFoundException } from "@nestjs/common";
import { copyIntoDraft, houseDayWords } from "./menu-copy";

/**
 * r109 menu-g5, "Edit as a new draft": the current menu copied as it is into a
 * new draft. These pin the identity copy (every column kept but the line's own
 * id, menu and birth), the house scope, a menu past 1000 lines and the
 * failed batch. The route and who may ask are pinned beside it
 * (menus.service.spec.ts, menu-copy-route.spec.ts).
 */

type Row = Record<string, unknown>;
const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CURRENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fakeDb(seed: Record<string, Row[]>, opts: { failInsertOn?: number } = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const writes: Array<{ table: string; op: string }> = [];
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
            writes.push({ table, op });
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
          return Promise.resolve({ data: single ? (out[0] ?? null) : out, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
  return { db, tables, writes };
}

const menuRow = (over: Row = {}): Row => ({ id: CURRENT, restaurant_id: HOUSE, name: "Wine List", status: "active", menu_type: "beverage", cadence: "seasonal", ...over });
let n = 0;
const line = (over: Row = {}): Row => ({
  id: `l-${String(++n).padStart(6, "0")}`,
  menu_id: CURRENT,
  restaurant_id: HOUSE,
  name: `Wine ${n}`,
  category: "Red",
  kind: "drink",
  line_no: n,
  description: "Dry, from the hill",
  printed_marks: ["vegan"],
  inventory_item_id: `inv-${n}`,
  wine_library_id: `mw-${n}`,
  by_glass_price: 12.5,
  bottle_price: 60,
  status: "approved",
  price_flag: null,
  created_at: "2027-01-01T00:00:00Z",
  ...over,
});
const input = (over: Partial<Parameters<typeof copyIntoDraft>[1]> = {}) => ({
  restaurantId: HOUSE,
  menuId: CURRENT,
  userId: "u-1",
  name: (c: string | null) => `${c}, draft of 27 Nov 2026`,
  notCurrent: "Only the current menu can be copied into a new draft. Nothing was made.",
  ...over,
});
const identity = (l: Row) => l;

describe("copyIntoDraft -- the identity copy", () => {
  it("keeps every column of a line but its id, its menu and its birth; the current menu is untouched", async () => {
    const lines = [line(), line({ category: "White", by_glass_price: null }), line({ status: "discarded" })];
    const f = fakeDb({ restaurant_menus: [menuRow()], menu_items: lines });
    const before = JSON.stringify(f.tables.menu_items);
    const r = await copyIntoDraft(f.db, input(), identity);
    expect(r).toMatchObject({ menuId: expect.any(String), name: "Wine List, draft of 27 Nov 2026", lines: 2 });
    const draft = f.tables.restaurant_menus.find((m) => m.id === r.menuId)!;
    expect(draft).toMatchObject({ status: "draft", read_state: "done", restaurant_id: HOUSE, cadence: "seasonal", lines_extracted: 2, extracted_by: "u-1", extracted_at: r.copiedAt });
    const copied = f.tables.menu_items.filter((l) => l.menu_id === r.menuId);
    const strip = ({ id: _i, menu_id: _m, created_at: _c, ...rest }: Row) => rest;
    expect(copied.map(strip)).toEqual(lines.slice(0, 2).map(strip));
    for (const c of copied) {
      expect(c.id).not.toMatch(/^l-/);
      expect(c).not.toHaveProperty("created_at");
    }
    expect(JSON.stringify(f.tables.menu_items.filter((l) => l.menu_id === CURRENT))).toBe(before);
    expect(f.writes.filter((w) => w.op !== "insert")).toEqual([]);
  });

  it("a menu of 1001 lines is copied whole, in batches", async () => {
    const f = fakeDb({ restaurant_menus: [menuRow()], menu_items: Array.from({ length: 1001 }, () => line()) });
    const r = await copyIntoDraft(f.db, input(), identity);
    expect(f.tables.menu_items.filter((l) => l.menu_id === r.menuId)).toHaveLength(1001);
    expect(r.lines).toBe(1001);
    expect(f.writes.filter((w) => w.table === "menu_items").length).toBeGreaterThan(1);
  });

  it("another house's lines are never copied, even under the same menu id", async () => {
    const f = fakeDb({ restaurant_menus: [menuRow()], menu_items: [line(), line({ restaurant_id: OTHER, name: "Not ours" })] });
    const r = await copyIntoDraft(f.db, input(), identity);
    const copied = f.tables.menu_items.filter((l) => l.menu_id === r.menuId);
    expect(copied.map((l) => l.name)).not.toContain("Not ours");
    expect(copied.every((l) => l.restaurant_id === HOUSE)).toBe(true);
  });

  it("a menu id from another house is a 404, and nothing is made", async () => {
    const f = fakeDb({ restaurant_menus: [menuRow({ restaurant_id: OTHER })], menu_items: [line({ restaurant_id: OTHER })] });
    await expect(copyIntoDraft(f.db, input(), identity)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.writes).toEqual([]);
  });

  it("a kept menu that is not current is a 409 in the caller's words, and nothing is made", async () => {
    const f = fakeDb({ restaurant_menus: [menuRow({ status: "draft" })], menu_items: [line()] });
    const err = await copyIntoDraft(f.db, input(), identity).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(String(err.message)).toMatch(/Only the current menu can be copied/);
    expect(f.writes).toEqual([]);
  });

  it("a failed batch takes the half-made draft away", async () => {
    const f = fakeDb({ restaurant_menus: [menuRow()], menu_items: Array.from({ length: 600 }, () => line()) }, { failInsertOn: 3 });
    await expect(copyIntoDraft(f.db, input(), identity)).rejects.toThrow(/taken away/);
    expect(f.tables.restaurant_menus.map((m) => m.id)).toEqual([CURRENT]);
    expect(f.tables.menu_items.filter((l) => l.menu_id !== CURRENT)).toEqual([]);
  });
});

describe("houseDayWords -- the draft's day on the house's clock", () => {
  const at = new Date("2026-11-27T22:30:00Z");
  it("Istanbul is already the 28th", () => expect(houseDayWords(at, "Europe/Istanbul")).toBe("28 Nov 2026"));
  it("a zone not recorded says UTC, never a guess", () => expect(houseDayWords(at, null)).toBe("27 Nov 2026 UTC"));
});
