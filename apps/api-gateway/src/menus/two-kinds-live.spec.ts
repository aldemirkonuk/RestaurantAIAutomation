import { MenusService } from "./menus.service";
import { readCurrentMenuLines } from "./current-menu-lines";

/**
 * ADR 0340 rule 25: a house keeps one live menu PER KIND (Drinks, Food,
 * Desserts), so two `restaurant_menus` rows can be `active` at once. Every
 * reader that asked for "the" active menu with `.maybeSingle()` failed there:
 * PostgREST answers PGRST116 when more than one row matches, so `/menu`, the
 * discarded lines and Arrival's opening menu answered 500, and onboarding
 * swallowed the error and read "no menu". These cases drive the readers
 * through a fake that answers `.maybeSingle()` the way PostgREST does, so a
 * reader that goes back to a single-row read fails here.
 */

type Row = Record<string, any>;

const RID = "rest-1";

/** A filtering fake. `.maybeSingle()` refuses more than one row, as PostgREST does. */
function fakeDb(
  tables: Record<string, Row[]>,
  fails: Record<string, string> = {},
) {
  const from = (table: string) => {
    const keep: Array<(r: Row) => boolean> = [];
    const rows = () =>
      (tables[table] ?? []).filter((r) => keep.every((k) => k(r)));
    const failed = () =>
      fails[table] ? { data: null, error: { message: fails[table] } } : null;
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (keep.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (keep.push((r) => r[c] !== v), q),
      in: (c: string, vs: unknown[]) => (
        keep.push((r) => vs.includes(r[c])),
        q
      ),
      gt: (c: string, v: unknown) => (
        keep.push((r) => String(r[c]) > String(v)),
        q
      ),
      is: (c: string, v: unknown) => (
        keep.push((r) => (r[c] ?? null) === v),
        q
      ),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => {
        const f = failed();
        if (f) return f;
        const hit = rows();
        if (hit.length > 1)
          return {
            data: null,
            error: {
              code: "PGRST116",
              message: "JSON object requested, multiple (or no) rows returned",
            },
          };
        return { data: hit[0] ?? null, error: null };
      },
      then: (resolve: any, reject: any) =>
        Promise.resolve(failed() ?? { data: rows(), error: null }).then(
          resolve,
          reject,
        ),
    };
    return q;
  };
  return { from, rpc: async () => ({ data: null, error: null }) } as any;
}

function service(
  tables: Record<string, Row[]>,
  fails: Record<string, string> = {},
) {
  return new MenusService(
    { supabase: fakeDb(tables, fails) } as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

const menu = (
  id: string,
  menu_type: string,
  status = "active",
  over: Row = {},
): Row => ({
  id,
  restaurant_id: RID,
  name: `${menu_type} list`,
  menu_type,
  status,
  ...over,
});
const line = (id: string, menu_id: string, over: Row = {}): Row => ({
  id,
  menu_id,
  restaurant_id: RID,
  name: `Line ${id}`,
  category: null,
  status: "approved",
  ...over,
});

/** Drinks and Food both live, a draft Desserts read, and an archived Drinks menu. */
function twoKindsLive(): Record<string, Row[]> {
  return {
    restaurant_menus: [
      // Stored Food first: the reply still names Drinks first (kind order).
      menu("m-food", "food"),
      menu("m-drinks", "beverage"),
      menu("m-desserts-draft", "desserts", "draft"),
      menu("m-drinks-old", "beverage", "archived", {
        retired_at: "2026-10-01T00:00:00Z",
      }),
      menu("m-theirs", "beverage", "active", { restaurant_id: "rest-2" }),
    ],
    menu_items: [
      line("d1", "m-drinks", { name: "Barolo", category: "red" }),
      line("d2", "m-drinks", { name: "Gone wine", status: "discarded" }),
      line("f1", "m-food", { name: "Köfte", line_kind: "dish", price: 18 }),
      line("f2", "m-food", { name: "Gone dish", status: "discarded" }),
      line("x1", "m-desserts-draft", { name: "Draft tiramisu" }),
      line("o1", "m-drinks-old", { name: "Old wine" }),
      line("t1", "m-theirs", { name: "Their wine", restaurant_id: "rest-2" }),
    ],
  };
}

describe("ADR 0340: two live kinds are read, never a 500", () => {
  it("getMenu names every live kind and serves their lines as one union", async () => {
    const r: any = await service(twoKindsLive()).getMenu(RID);
    expect(r.kinds).toEqual([
      {
        menuId: "m-drinks",
        kind: "beverage",
        name: "beverage list",
        status: "active",
      },
      { menuId: "m-food", kind: "food", name: "food list", status: "active" },
    ]);
    // The one-menu shape the pages read today: the Drinks menu.
    expect(r.menuId).toBe("m-drinks");
    expect(r.name).toBe("beverage list");
    expect(r.status).toBe("active");
    expect(r.items.map((l: Row) => [l.id, l.menu_id, l.menu_type])).toEqual([
      ["d1", "m-drinks", "beverage"],
      ["f1", "m-food", "food"],
    ]);
    const dish = r.items.find((l: Row) => l.id === "f1");
    expect(dish.line_kind).toBe("dish");
    expect(dish.price).toBe(18);
  });

  it("getMenu with only a Food menu live names that menu, as a one-menu house was shown", async () => {
    const tables = twoKindsLive();
    tables.restaurant_menus = tables.restaurant_menus.filter(
      (m) => m.id !== "m-drinks",
    );
    const r: any = await service(tables).getMenu(RID);
    expect(r.menuId).toBe("m-food");
    expect(r.kinds.map((k: Row) => k.kind)).toEqual(["food"]);
    expect(r.items.map((l: Row) => l.id)).toEqual(["f1"]);
  });

  it("getMenu says a failed menus read, never an empty menu", async () => {
    await expect(
      service(twoKindsLive(), {
        restaurant_menus: "statement timeout",
      }).getMenu(RID),
    ).rejects.toThrow(
      /current menu \(restaurant_menus\) could not be read \(statement timeout\)/,
    );
  });

  it("getDiscardedLines reads every live kind's discarded lines, and no other menu's", async () => {
    const r = await service(twoKindsLive()).getDiscardedLines(RID);
    expect(r.items.map((l) => l.id).sort()).toEqual(["d2", "f2"]);
  });

  it("readCurrentMenus says each menu's kind and narrows to the kinds asked for", async () => {
    const svc = service(twoKindsLive());
    const all = await svc.readCurrentMenus(RID);
    expect(all.menus.map((m) => [m.menuId, m.kind])).toEqual([
      ["m-drinks", "beverage"],
      ["m-food", "food"],
    ]);
    expect(all.lines.map((l) => [l.id, l.menu_type])).toEqual([
      ["d1", "beverage"],
      ["f1", "food"],
    ]);
    const food = await svc.readCurrentMenus(RID, { kinds: ["food"] });
    expect(food.menus.map((m) => m.menuId)).toEqual(["m-food"]);
    expect(food.lines.map((l) => l.id)).toEqual(["f1"]);
    const none = await svc.readCurrentMenus(RID, { kinds: [] });
    expect(none).toEqual({ menus: [], lines: [] });
  });

  it("listVersions names the live menu of each kind and keeps `current` as the Drinks one", async () => {
    const r = await service(twoKindsLive()).listVersions(RID);
    expect(r.currentByKind.beverage?.menuId).toBe("m-drinks");
    expect(r.currentByKind.food?.menuId).toBe("m-food");
    expect(r.currentByKind.desserts).toBeNull();
    expect(r.current?.menuId).toBe("m-drinks");
    expect(r.versions.find((v) => v.menuId === "m-desserts-draft")?.kind).toBe(
      "desserts",
    );
  });

  it("the cellar's line read says each line's kind and can read one kind", async () => {
    const db = fakeDb(twoKindsLive());
    const all = await readCurrentMenuLines(db, RID);
    expect(all.currentMenus).toBe(2);
    expect(all.rows.map((r) => [r.id, r.menu_type])).toEqual([
      ["d1", "beverage"],
      ["f1", "food"],
    ]);
    const drinks = await readCurrentMenuLines(db, RID, { kinds: ["beverage"] });
    expect(drinks.currentMenus).toBe(1);
    expect(drinks.rows.map((r) => r.id)).toEqual(["d1"]);
  });
});

describe("ADR 0340: onboarding reads the live kinds and fails loud", () => {
  const progress = {
    id: "row-1",
    user_id: "owner",
    restaurant_id: RID,
    menu_uploaded: true,
  };
  const withProgress = (tables: Record<string, Row[]>) => ({
    ...tables,
    user_onboarding_progress: [progress],
    restaurants: [{ id: RID, threshold_configured: true }],
  });

  it("two live kinds are a current menu, so the house is activated", async () => {
    const p = await service(withProgress(twoKindsLive())).getOnboardingProgress(
      "owner",
      RID,
    );
    expect(p.menu_current).toBe(true);
    expect(p.activated).toBe(true);
  });

  // Rule 26 (§F13): a live menu counts only with a drink line on it.
  it("a house whose only live menu is Food is not activated", async () => {
    const p = await service(
      withProgress({
        restaurant_menus: [menu("m-food", "food")],
        menu_items: [
          line("f1", "m-food", { name: "Köfte", line_kind: "dish", price: 18 }),
          // No stored kind: on a Food menu it is still not a drink (rule 7).
          line("f2", "m-food", { name: "Ayran", category: "non-alcoholic" }),
        ],
      }),
    ).getOnboardingProgress("owner", RID);
    expect(p.menu_current).toBe(false);
    expect(p.activated).toBe(false);
    // F-1713: and it says the live menu has no drinks, so the checklist asks
    // for the drinks menu instead of making current a menu that already is.
    expect(p.menu_live_no_drinks).toBe(true);
  });

  it("a house with no live menu, or a live drink line, is not told its menu lacks drinks (F-1713)", async () => {
    const none = await service(
      withProgress({ restaurant_menus: [], menu_items: [] }),
    ).getOnboardingProgress("owner", RID);
    expect(none.menu_live_no_drinks).toBe(false);
    const both = await service(
      withProgress(twoKindsLive()),
    ).getOnboardingProgress("owner", RID);
    expect(both.menu_live_no_drinks).toBe(false);
  });

  it("a dessert wine stored as a drink on a live Desserts menu activates it", async () => {
    const p = await service(
      withProgress({
        restaurant_menus: [menu("m-desserts", "desserts")],
        menu_items: [
          line("w1", "m-desserts", {
            name: "Muscat de Beaumes-de-Venise",
            line_kind: "drink",
          }),
        ],
      }),
    ).getOnboardingProgress("owner", RID);
    expect(p.menu_current).toBe(true);
  });

  it("a failed menu lines read THROWS; it never reads as 'no menu'", async () => {
    await expect(
      service(withProgress(twoKindsLive()), {
        menu_items: "permission denied",
      }).getOnboardingProgress("owner", RID),
    ).rejects.toThrow(/could not be read \(permission denied\)/);
  });

  it("a failed menus read THROWS; it never reads as 'no menu'", async () => {
    await expect(
      service(withProgress(twoKindsLive()), {
        restaurant_menus: "permission denied",
      }).getOnboardingProgress("owner", RID),
    ).rejects.toThrow(
      /current menu \(restaurant_menus\) could not be read \(permission denied\)/,
    );
  });
});
