import {
  CURRENT_MENU_LINE_COLUMNS,
  readCurrentMenuLines,
} from "./current-menu-lines";

/**
 * The one current-menu read the cellar's menu readers share (A-028, F-148).
 * What these pin is the SCOPE of each read — only `status = 'active'` menus,
 * only this house, no discarded line — and that a failed or partial read is
 * never returned as a shorter menu.
 */

type Row = Record<string, unknown>;

const RID = "550e8400-e29b-41d4-a716-446655440000";

/**
 * A fake that filters: every `.from()` is a fresh query that records its
 * calls and, when awaited, applies its eq / neq / in / gt / order / limit to
 * the table's rows, so a missing scope is served the rows it would let in.
 */
function fakeDb(tables: Record<string, { rows?: Row[]; error?: unknown }>) {
  const reads: Array<{ table: string; calls: Array<[string, unknown[]]> }> = [];
  const db = {
    from: (table: string) => {
      const calls: Array<[string, unknown[]]> = [];
      reads.push({ table, calls });
      const keep: Array<(r: Row) => boolean> = [];
      let orderBy: string | null = null;
      let limit: number | null = null;
      const self: Record<string, unknown> = {};
      const on = (
        m: string,
        effect: (...a: any[]) => void = () => undefined,
      ) => {
        self[m] = jest.fn((...a: unknown[]) => {
          calls.push([m, a]);
          effect(...a);
          return self;
        });
      };
      on("select");
      on("eq", (c: string, v: unknown) => keep.push((r) => r[c] === v));
      on("neq", (c: string, v: unknown) => keep.push((r) => r[c] !== v));
      on("in", (c: string, vs: unknown[]) =>
        keep.push((r) => vs.includes(r[c])),
      );
      on("gt", (c: string, v: unknown) =>
        keep.push((r) => String(r[c]) > String(v)),
      );
      on("order", (c: string) => (orderBy = c));
      on("limit", (n: number) => (limit = n));
      self.then = (resolve: (v: unknown) => unknown) => {
        const t = tables[table] ?? {};
        let out = (t.rows ?? []).filter((r) => keep.every((k) => k(r)));
        if (orderBy) {
          const col = orderBy;
          out = [...out].sort((a, z) =>
            String(a[col]) < String(z[col]) ? -1 : 1,
          );
        }
        if (limit !== null) out = out.slice(0, limit);
        return Promise.resolve({
          data: t.error ? null : out,
          error: t.error ?? null,
        }).then(resolve);
      };
      return self;
    },
  };
  return {
    db,
    readsOf: (table: string) => reads.filter((r) => r.table === table),
  };
}

const menu = (id: string, status: string, restaurantId = RID): Row => ({
  id,
  restaurant_id: restaurantId,
  status,
});
const line = (id: string, menuId: string, extra: Row = {}): Row => ({
  id,
  menu_id: menuId,
  restaurant_id: RID,
  status: "approved",
  name: `Line ${id}`,
  ...extra,
});

describe("readCurrentMenuLines", () => {
  it("reads only this house's ACTIVE menus, and only their live lines", async () => {
    const { db, readsOf } = fakeDb({
      restaurant_menus: {
        rows: [
          menu("live", "active"),
          menu("old", "archived"),
          menu("scan", "draft"),
          menu("theirs", "active", "another-house"),
        ],
      },
      menu_items: {
        rows: [
          line("a1", "live"),
          line("a2", "live", { status: "discarded" }),
          line("b1", "old"),
          line("c1", "scan"),
          line("d1", "theirs", { restaurant_id: "another-house" }),
        ],
      },
    });

    const out = await readCurrentMenuLines(db, RID);
    expect(out.currentMenus).toBe(1);
    expect(out.rows.map((r) => r.id)).toEqual(["a1"]);

    const [menus] = readsOf("restaurant_menus");
    expect(menus.calls).toContainEqual(["eq", ["restaurant_id", RID]]);
    expect(menus.calls).toContainEqual(["eq", ["status", "active"]]);
    const [lines] = readsOf("menu_items");
    expect(lines.calls).toContainEqual(["select", [CURRENT_MENU_LINE_COLUMNS]]);
    expect(lines.calls).toContainEqual(["in", ["menu_id", ["live"]]]);
    expect(lines.calls).toContainEqual(["eq", ["restaurant_id", RID]]);
    expect(lines.calls).toContainEqual(["neq", ["status", "discarded"]]);
  });

  it("reads several active menus as ONE union", async () => {
    const { db, readsOf } = fakeDb({
      restaurant_menus: { rows: [menu("m1", "active"), menu("m2", "active")] },
      menu_items: {
        rows: [line("x1", "m1"), line("x2", "m2"), line("x3", "m2")],
      },
    });
    const out = await readCurrentMenuLines(db, RID);
    expect(out.currentMenus).toBe(2);
    expect(out.rows.map((r) => r.id)).toEqual(["x1", "x2", "x3"]);
    expect(readsOf("menu_items")).toHaveLength(1);
    expect(readsOf("menu_items")[0].calls).toContainEqual([
      "in",
      ["menu_id", ["m1", "m2"]],
    ]);
  });

  it("reads a menu past PostgREST's 1000-row stop whole, keyset-paged on id", async () => {
    const rows = Array.from({ length: 1003 }, (_, i) =>
      line(`l${String(i).padStart(5, "0")}`, "live"),
    );
    const { db, readsOf } = fakeDb({
      restaurant_menus: { rows: [menu("live", "active")] },
      menu_items: { rows },
    });
    const out = await readCurrentMenuLines(db, RID);
    expect(out.rows).toHaveLength(1003);
    expect(new Set(out.rows.map((r) => r.id)).size).toBe(1003);

    const pages = readsOf("menu_items");
    expect(pages).toHaveLength(2);
    expect(pages[0].calls.some(([m]) => m === "gt")).toBe(false);
    expect(pages[1].calls).toContainEqual(["gt", ["id", "l00999"]]);
    for (const p of pages) {
      expect(p.calls).toContainEqual(["order", ["id", { ascending: true }]]);
      expect(p.calls).toContainEqual(["limit", [1000]]);
    }
  });

  it("says a house with no current menu has none, and never reads menu_items", async () => {
    const { db, readsOf } = fakeDb({
      restaurant_menus: {
        rows: [menu("old", "archived"), menu("scan", "draft")],
      },
      menu_items: { rows: [line("b1", "old"), line("c1", "scan")] },
    });
    await expect(readCurrentMenuLines(db, RID)).resolves.toEqual({
      currentMenus: 0,
      rows: [],
    });
    expect(readsOf("menu_items")).toHaveLength(0);
  });

  it("THROWS when the menus cannot be read — never an empty menu", async () => {
    const { db, readsOf } = fakeDb({
      restaurant_menus: {
        error: { message: "permission denied for restaurant_menus" },
      },
    });
    await expect(readCurrentMenuLines(db, RID)).rejects.toThrow(
      /current menu \(restaurant_menus\) could not be read \(permission denied/,
    );
    expect(readsOf("menu_items")).toHaveLength(0);
  });

  // r36 menu audit N4: probed on the real isKitchenLine, /menu said one thing
  // and the recipe lane, reading this, the other for all three of these.
  it("says dish or drink as /menu does, and never hands on the raw line", async () => {
    const { db } = fakeDb({
      restaurant_menus: { rows: [menu("live", "active")] },
      menu_items: {
        rows: [
          line("k1", "live", { name: "Sauternes", category: "dessert", producer: "Ch. Suduiraut", vintage: "2015" }),
          line("k2", "live", { name: "Moscato d'Asti", category: "Desserts" }),
          line("k3", "live", { name: "Köfte", category: null, raw_extracted_text: "Köfte,Mains,18,cost 6.10,Kasap Ali" }),
          line("k4", "live", { name: "Tiramisu", category: "dessert" }),
          line("k5", "live", { name: "Chianti", category: "red", raw_extracted_text: "Chianti, great with pasta" }),
        ],
      },
    });
    const out = await readCurrentMenuLines(db, RID);
    expect(out.rows.map((r) => [r.name, r.kitchen_line])).toEqual([
      ["Sauternes", false],
      ["Moscato d'Asti", false],
      ["Köfte", true],
      ["Tiramisu", true],
      ["Chianti", false],
    ]);
    expect(out.rows.some((r) => "raw_extracted_text" in r)).toBe(false);
    expect(out.rows[0]).toMatchObject({ producer: "Ch. Suduiraut", vintage: "2015", category: "dessert" });
    // The fake hands back every field; the columns the test needs must be read.
    const read = CURRENT_MENU_LINE_COLUMNS.split(",").map((c) => c.trim());
    expect(read).toEqual(expect.arrayContaining(["category", "producer", "vintage", "region", "grape_variety", "raw_extracted_text"]));
  });

  it("THROWS when the lines cannot be read — never a shorter menu", async () => {
    const { db } = fakeDb({
      restaurant_menus: { rows: [menu("live", "active")] },
      menu_items: { error: { message: "statement timeout" } },
    });
    await expect(readCurrentMenuLines(db, RID)).rejects.toThrow(
      /current menu's lines \(menu_items\) could not be read \(statement timeout\)/,
    );
  });
});
