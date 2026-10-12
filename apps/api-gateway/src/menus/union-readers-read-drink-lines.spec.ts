import { readCurrentMenuLines } from "./current-menu-lines";
import { readVendorMenuSupply } from "../providers/vendor-menu-supply";
import { PriceLocksService } from "../pricing/price-locks.service";
import { MarginAdviceService } from "../pricing/margin-advice.service";
import { offerMenuLines } from "../promotions/promotions.service";
import { BeveragesService } from "../beverages/beverages.service";

/**
 * ADR 0340 rule 25 (the menus build, lane 4): every DRINK reader of the
 * current menus selects lines on `menu_type` first (any live menu), then
 * `lineIsDrink`, then the effective category. A house keeps one live menu per
 * kind (Drinks, Food, Desserts; founder answer S208), so a reader that took
 * every live line would read the Food menu's dishes as wines, and one that read
 * only the Drinks menu would miss a dessert wine on Desserts.
 *
 * One house, three live menus, and a draft that is never read:
 *   Drinks   d1 Efes (no stored kind)         -> a drink (today's rule)
 *            d2 Mixed olives, "Kitchen"        -> not (isKitchenLine)
 *            d3 Pour of the day, no stored kind -> a drink (today's rule)
 *   Food     f1 Lamb shank, line_kind dish     -> not
 *            f2 Chablis, no stored kind        -> not (a kindless line on Food)
 *   Desserts e1 Tokaji, line_kind drink        -> a drink, on Desserts
 *            e2 Baklava, no stored kind        -> not
 * The ledger's SQL half is proven in
 * supabase/tests/20270107600000_the_ledger_reads_drink_lines_and_names_two_prices_test.sql.
 */

type Row = Record<string, any>;
const RID = "house-1";

function fakeDb(
  tables: Record<string, Row[]>,
  fail: Record<string, string> = {},
) {
  const from = (table: string) => {
    const keep: Array<(r: Row) => boolean> = [];
    let limit = Infinity;
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
      gte: () => q,
      is: (c: string, v: unknown) => (
        keep.push((r) => (r[c] ?? null) === v),
        q
      ),
      not: () => q,
      or: () => q,
      ilike: () => q,
      lte: () => q,
      range: () => q,
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => {
        if (fail[table]) return { data: null, error: { message: fail[table] } };
        return {
          data:
            (tables[table] ?? []).filter((r) => keep.every((k) => k(r)))[0] ??
            null,
          error: null,
        };
      },
      then(resolve: any) {
        if (fail[table])
          return resolve({ data: null, error: { message: fail[table] } });
        const rows = (tables[table] ?? [])
          .filter((r) => keep.every((k) => k(r)))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
          .slice(0, limit)
          .map((r) => ({ ...r }));
        return resolve({ data: rows, error: null });
      },
    };
    return q;
  };
  // An RPC answers as an empty, chainable read (the till books are not under test here).
  return { from, rpc: (fn: string) => from(`rpc:${fn}`) };
}

const line = (id: string, menuId: string, over: Row): Row => ({
  id,
  menu_id: menuId,
  restaurant_id: RID,
  status: "approved",
  line_kind: null,
  drink_category: null,
  section_id: null,
  wine_library_id: null,
  bottle_price: null,
  by_glass_price: null,
  raw_extracted_text: null,
  ...over,
});

function house(): Record<string, Row[]> {
  return {
    restaurant_menus: [
      {
        id: "m-drinks",
        restaurant_id: RID,
        status: "active",
        menu_type: "beverage",
        name: "Drinks",
      },
      {
        id: "m-food",
        restaurant_id: RID,
        status: "active",
        menu_type: "food",
        name: "Food",
      },
      {
        id: "m-desserts",
        restaurant_id: RID,
        status: "active",
        menu_type: "desserts",
        name: "Desserts",
      },
      {
        id: "m-draft",
        restaurant_id: RID,
        status: "draft",
        menu_type: "beverage",
        name: "Draft",
      },
    ],
    menu_items: [
      line("d1", "m-drinks", {
        category: "Draft Beer",
        name: "Efes",
        wine_library_id: "w-efes",
        bottle_price: 6,
      }),
      line("d2", "m-drinks", {
        category: "Kitchen",
        name: "Mixed olives",
        wine_library_id: "w-olives",
        raw_extracted_text: "Mixed olives 5",
      }),
      line("d3", "m-drinks", {
        category: "House Selection",
        name: "Pour of the day",
        raw_extracted_text: "Pour of the day 9",
      }),
      line("f1", "m-food", {
        category: "Mains",
        name: "Lamb shank",
        line_kind: "dish",
        wine_library_id: "w-lamb",
      }),
      line("f2", "m-food", {
        category: "Wines",
        name: "Chablis",
        wine_library_id: "w-chablis",
        bottle_price: 40,
      }),
      line("e1", "m-desserts", {
        category: "Sweet wines",
        name: "Tokaji",
        line_kind: "drink",
        drink_category: "dessert",
        wine_library_id: "w-tokaji",
        bottle_price: 60,
      }),
      line("e2", "m-desserts", {
        category: "Puddings",
        name: "Baklava",
        wine_library_id: "w-baklava",
      }),
      line("x1", "m-draft", {
        category: "Red",
        name: "Draft Barolo",
        wine_library_id: "w-draft",
      }),
    ],
  };
}

describe("readCurrentMenuLines({ drinks: true }) -- the cellar's and beverages' reader (ADR 0340 rule 25)", () => {
  it("reads every live menu, keeps only its drink lines, and never a draft's", async () => {
    const r = await readCurrentMenuLines(fakeDb(house()), RID, {
      drinks: true,
    });
    expect(r.currentMenus).toBe(3);
    expect(r.rows.map((x) => x.id)).toEqual(["d1", "d3", "e1"]);
    expect(r.rows.map((x) => x.menu_type)).toEqual([
      "beverage",
      "beverage",
      "desserts",
    ]);
  });

  it("reads the raw line for the drink test and never returns it", async () => {
    const r = await readCurrentMenuLines(fakeDb(house()), RID, {
      drinks: true,
    });
    for (const x of r.rows)
      expect(
        Object.prototype.hasOwnProperty.call(x, "raw_extracted_text"),
      ).toBe(false);
  });

  it("without `drinks` it still reads every live line, as before (a counting reader)", async () => {
    const r = await readCurrentMenuLines(fakeDb(house()), RID);
    expect(r.rows.map((x) => x.id)).toEqual([
      "d1",
      "d2",
      "d3",
      "e1",
      "e2",
      "f1",
      "f2",
    ]);
  });
});

describe("readVendorMenuSupply -- 'Supplies my menu' reads drink lines only (ADR 0340 rule 25)", () => {
  it("counts the drink lines of every live menu: a dessert wine on Desserts is on it, a dish or a kindless Food line is not", async () => {
    const out = await readVendorMenuSupply(
      fakeDb(house()),
      RID,
      new Date("2026-10-12T12:00:00Z"),
    );
    expect(out.menu.current).toBe(true);
    expect(out.menu.menus).toBe(3);
    // d1, d3, e1 -- d3 carries no wine.
    expect(out.menu.lines).toBe(3);
    expect(out.menu.linkedLines).toBe(2);
    expect(out.menu.wines).toBe(2);
  });
});

describe("PriceLocksService -- a lock's menu lines name their menu and kind (ADR 0340 rule 25)", () => {
  function locks(): Record<string, Row[]> {
    return {
      ...house(),
      house_price_locks: [
        {
          id: "lock-t",
          restaurant_id: RID,
          inventory_id: "inv-t",
          kind: "bottle",
          locked_price: "60.00",
          locked_by: "user-5",
          locked_at: new Date().toISOString(),
          note: null,
          moved_from_lock_id: null,
          released_at: null,
        },
        {
          id: "lock-c",
          restaurant_id: RID,
          inventory_id: "inv-c",
          kind: "bottle",
          locked_price: "40.00",
          locked_by: "user-5",
          locked_at: new Date().toISOString(),
          note: null,
          moved_from_lock_id: null,
          released_at: null,
        },
      ],
      restaurant_inventory: [
        {
          id: "inv-t",
          restaurant_id: RID,
          master_wine_id: "w-tokaji",
          wine_name: "Tokaji",
          is_active: true,
          deleted_at: null,
          sale_type: "bottle",
          menu_price_current: "60.00",
          menu_price_glass: null,
          last_purchase_price: "20.00",
          bottle_size_ml: 500,
        },
        {
          id: "inv-c",
          restaurant_id: RID,
          master_wine_id: "w-chablis",
          wine_name: "Chablis",
          is_active: true,
          deleted_at: null,
          sale_type: "bottle",
          menu_price_current: "40.00",
          menu_price_glass: null,
          last_purchase_price: "15.00",
          bottle_size_ml: 750,
        },
      ],
      restaurants: [
        {
          id: RID,
          target_margin_bottle_pct: "65.00",
          target_margin_glass_pct: "75.00",
          target_margin_band_pct: "2.00",
        },
      ],
      inventory_lot_rollup: [],
      users: [
        {
          user_id: "user-5",
          name: "Aylin",
          role: "manager",
          restaurant_id: RID,
        },
      ],
      user_restaurant_access: [
        {
          user_id: "user-5",
          restaurant_id: RID,
          role: "manager",
          is_active: true,
        },
      ],
    };
  }
  const svc = (tables: Record<string, Row[]>) => {
    const db = { client: fakeDb(tables) } as any;
    return new PriceLocksService(db, new MarginAdviceService(db));
  };

  it("reads only drink lines, each naming its menu and that menu's kind", async () => {
    const m = await svc(locks()).currentMenuLines(RID);
    expect(m.error).toBeNull();
    // The fake answers in id order: m-desserts, m-drinks, m-food.
    expect(m.menus.map((x) => x.menuId)).toEqual([
      "m-desserts",
      "m-drinks",
      "m-food",
    ]);
    expect(m.lines.map((x) => [x.menuId, x.kind, x.wineLibraryId])).toEqual([
      ["m-desserts", "desserts", "w-tokaji"],
      ["m-drinks", "beverage", "w-efes"],
      ["m-drinks", "beverage", null],
    ]);
  });

  it("a lock on a dessert wine is on the menu, named by its menu and kind; a wine only on Food as a kindless line is not", async () => {
    const r = await svc(locks()).list(RID);
    expect(r.readable).toBe(true);
    const by = Object.fromEntries(r.locks.map((l) => [l.lockId, l]));
    expect(by["lock-t"].dormant).toBe(false);
    expect(by["lock-t"].onMenus).toEqual([
      { menuId: "m-desserts", kind: "desserts", price: 60 },
    ]);
    expect(by["lock-c"].dormant).toBe(true);
    expect(by["lock-c"].onMenus).toEqual([]);
  });
});

describe("offerMenuLines -- an offer is scoped against drink lines only (ADR 0340 rule 25)", () => {
  it("drops a line the menus service marks kitchen_line and keeps every drink line, on any menu", () => {
    const out = offerMenuLines([
      {
        id: "d1",
        menu_id: "m-drinks",
        menu_type: "beverage",
        name: "Efes",
        category: "Draft Beer",
        wine_library_id: "w-efes",
        kitchen_line: false,
      },
      {
        id: "f1",
        menu_id: "m-food",
        menu_type: "food",
        name: "Lamb shank",
        category: "Mains",
        wine_library_id: "w-lamb",
        kitchen_line: true,
      },
      {
        id: "e1",
        menu_id: "m-desserts",
        menu_type: "desserts",
        name: "Tokaji",
        category: "Sweet wines",
        wine_library_id: "w-tokaji",
        kitchen_line: false,
      },
    ]);
    expect(out).toEqual([
      {
        id: "d1",
        menuId: "m-drinks",
        name: "Efes",
        category: "Draft Beer",
        wineLibraryId: "w-efes",
      },
      {
        id: "e1",
        menuId: "m-desserts",
        name: "Tokaji",
        category: "Sweet wines",
        wineLibraryId: "w-tokaji",
      },
    ]);
  });
});

describe("BeveragesService.readRowRecord -- the menu book reads drink lines only (ADR 0340 rule 25)", () => {
  const svc = () =>
    new BeveragesService({ getClient: () => fakeDb(house()) } as any);
  const menuBook = async (label: string) =>
    (await svc().readRowRecord(RID, label)).books.find(
      (b) => b.book === "menu",
    )!;

  it("a dessert wine on the Desserts menu is on the menu", async () => {
    const book = await menuBook("Tokaji");
    expect(book.readable).toBe(true);
    expect(book.ledger.map((e) => e.label)).toEqual(["Tokaji"]);
  });

  it("a kindless line on the Food menu, and a kitchen line on Drinks, are not", async () => {
    expect((await menuBook("Chablis")).ledger).toEqual([]);
    expect((await menuBook("Mixed olives")).ledger).toEqual([]);
  });
});
