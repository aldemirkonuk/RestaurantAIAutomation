import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { MenusService, isMenuKindOrder } from "./menus.service";
import { MenusController } from "./menus.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * ADR 0340 rule 22 (lane 7): the Full menu is every live kind of the house as
 * one document, composed by the server (§F10). These cases drive
 * `MenusService.getFullMenu` and `setMenuKindOrder` through a filtering fake
 * of the database, and the two routes through the controller with the real
 * OrganizationsService (only its access-row read is stubbed).
 */

type Row = Record<string, any>;

const RID = "rest-1";

/** A filtering fake; `update().eq().select()` writes the matching rows and answers them. */
function fakeDb(
  tables: Record<string, Row[]>,
  fails: Record<string, string> = {},
) {
  const from = (table: string) => {
    const keep: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const rows = () =>
      (tables[table] ?? []).filter((r) => keep.every((k) => k(r)));
    const failed = () =>
      fails[table] ? { data: null, error: { message: fails[table] } } : null;
    const q: any = {
      select: () => q,
      update: (p: Row) => ((patch = p), q),
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
            error: { code: "PGRST116", message: "multiple rows" },
          };
        return { data: hit[0] ?? null, error: null };
      },
      then: (resolve: any, reject: any) => {
        const f = failed();
        if (f) return Promise.resolve(f).then(resolve, reject);
        const hit = rows();
        if (patch) for (const r of hit) Object.assign(r, patch);
        return Promise.resolve({ data: hit, error: null }).then(
          resolve,
          reject,
        );
      },
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
  made_current_at: "2026-10-01T00:00:00Z",
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
const section = (
  id: string,
  menu_id: string,
  title: string,
  position: number,
  over: Row = {},
): Row => ({
  id,
  menu_id,
  restaurant_id: RID,
  parent_id: null,
  title,
  position,
  drink_category: null,
  ...over,
});

/** Drinks and Food live; a Drinks line in no section; a legacy dish on Drinks; another house's live menu. */
function house(): Record<string, Row[]> {
  return {
    restaurants: [
      { id: RID, menu_kind_order: null },
      { id: "rest-2", menu_kind_order: ["desserts", "food", "beverage"] },
    ],
    restaurant_menus: [
      menu("m-food", "food"),
      menu("m-drinks", "beverage"),
      menu("m-drinks-draft", "beverage", "draft"),
      menu("m-theirs", "beverage", "active", { restaurant_id: "rest-2" }),
    ],
    menu_sections: [
      section("s-wine", "m-drinks", "Wines", 0),
      section("s-red", "m-drinks", "Red", 1, {
        parent_id: "s-wine",
        drink_category: "red",
      }),
      section("s-white", "m-drinks", "White", 0, {
        parent_id: "s-wine",
        drink_category: "white",
      }),
      section("s-meze", "m-drinks", "Meze", 1),
      section("s-mains", "m-food", "Mains", 0),
      section("s-theirs", "m-theirs", "Their wines", 0, {
        restaurant_id: "rest-2",
      }),
    ],
    menu_items: [
      line("d1", "m-drinks", {
        name: "Barolo",
        category: "red",
        section_id: "s-red",
        position: 2,
        inventory_item_id: "inv-barolo",
      }),
      line("d2", "m-drinks", {
        name: "Amarone",
        category: "red",
        section_id: "s-red",
        position: 1,
      }),
      line("d3", "m-drinks", {
        name: "Soave",
        category: "white",
        section_id: "s-white",
        position: 0,
      }),
      line("d4", "m-drinks", {
        name: "House pour",
        category: "red",
        raw_extracted_text: "House pour,cost 4,supplier X",
      }),
      // A legacy kitchen line (no line_kind; the legacy rule says kitchen),
      // linked to a stock row a food line seeded before F-1170.
      line("k1", "m-drinks", {
        name: "Köfte",
        category: "Meze",
        section_id: "s-meze",
        inventory_item_id: "inv-kofte",
      }),
      line("k2", "m-drinks", {
        name: "Hummus",
        category: "Meze",
        section_id: "s-meze",
      }),
      line("f1", "m-food", {
        name: "Köfte",
        line_kind: "dish",
        price: 18,
        section_id: "s-mains",
      }),
      line("x1", "m-drinks-draft", { name: "Draft wine" }),
      line("t1", "m-theirs", {
        name: "Their wine",
        restaurant_id: "rest-2",
        section_id: "s-theirs",
      }),
    ],
    stock_outs: [
      { inventory_id: "inv-barolo", restaurant_id: RID, ended_at: null },
      { inventory_id: "inv-kofte", restaurant_id: RID, ended_at: null },
    ],
    cocktails: [],
  };
}

const names = (lines: Array<Record<string, unknown>>) =>
  lines.map((l) => l.name);

describe("GET /menus/:rid/full — the Full menu (ADR 0340 rule 22)", () => {
  it("shows every live kind of this house in the default order, sections as a tree in the house's order", async () => {
    const r = await service(house()).getFullMenu(RID);
    expect(r.kindOrder).toEqual(["beverage", "food", "desserts"]);
    expect(r.kindOrderSet).toBe(false);
    expect(r.kinds.map((k) => [k.kind, k.menuId])).toEqual([
      ["beverage", "m-drinks"],
      ["food", "m-food"],
    ]);
    const drinks = r.kinds[0];
    expect(drinks.sections.map((s) => s.title)).toEqual(["Wines", "Meze"]);
    expect(drinks.sections[0].sections.map((s) => s.title)).toEqual([
      "White",
      "Red",
    ]);
    // Lines by their stored position, not by name.
    expect(names(drinks.sections[0].sections[1].lines)).toEqual([
      "Amarone",
      "Barolo",
    ]);
    expect(names(drinks.unsorted)).toEqual(["House pour"]);
    expect(names(r.kinds[1].sections[0].lines)).toEqual(["Köfte"]);
    // Nothing of a draft or of another house.
    const every = JSON.stringify(r);
    expect(every).not.toContain("Draft wine");
    expect(every).not.toContain("Their wine");
    expect(every).not.toContain("Their wines");
  });

  it("F-1563: carries the house's zone, so a kept copy's 'as of' is on the house's clock", async () => {
    const t = house();
    t.restaurants[0].timezone = "Europe/Istanbul";
    expect((await service(t).getFullMenu(RID)).timezone).toBe(
      "Europe/Istanbul",
    );
    // No zone set: null, never the server's.
    expect((await service(house()).getFullMenu(RID)).timezone).toBeNull();
    // Another house's zone is never read for this one.
    const other = house();
    other.restaurants[1].timezone = "America/Chicago";
    expect((await service(other).getFullMenu(RID)).timezone).toBeNull();
  });

  it("follows the house's own kind order", async () => {
    const t = house();
    t.restaurants[0].menu_kind_order = ["food", "desserts", "beverage"];
    const r = await service(t).getFullMenu(RID);
    expect(r.kindOrderSet).toBe(true);
    expect(r.kinds.map((k) => k.kind)).toEqual(["food", "beverage"]);
  });

  it("sends every line through the member allowlist: no raw line, whoever reads", async () => {
    const r = await service(house()).getFullMenu(RID);
    const pour = r.kinds[0].unsorted[0];
    expect(pour).not.toHaveProperty("raw_extracted_text");
    expect(pour.raw_line_withheld).toBe(true);
    expect(r.rawLineWithheld).toBe(true);
    expect(JSON.stringify(r)).not.toContain("supplier X");
  });

  it("hides a legacy dish on the Drinks menu once Food is live, and names it", async () => {
    const r = await service(house()).getFullMenu(RID);
    expect(r.kinds[0].sections[1].lines).toEqual([]);
    expect(r.hiddenDishes).toEqual([
      { id: "k2", name: "Hummus", menuId: "m-drinks", onFood: false },
      { id: "k1", name: "Köfte", menuId: "m-drinks", onFood: true },
    ]);
  });

  it("shows a legacy dish in its section while no Food menu is live", async () => {
    const t = house();
    t.restaurant_menus = t.restaurant_menus.filter((m) => m.id !== "m-food");
    const r = await service(t).getFullMenu(RID);
    expect(r.hiddenDishes).toEqual([]);
    expect(names(r.kinds[0].sections[1].lines)).toEqual(["Hummus", "Köfte"]);
  });

  it("marks an 86'd drink with a house item, and never a dish (F-1434)", async () => {
    const t = house();
    t.restaurant_menus = t.restaurant_menus.filter((m) => m.id !== "m-food");
    const r = await service(t).getFullMenu(RID);
    const red = r.kinds[0].sections[0].sections[1].lines;
    expect(red.find((l) => l.name === "Barolo")?.sold_out).toBe(true);
    expect(red.find((l) => l.name === "Amarone")?.sold_out).toBeUndefined();
    const meze = r.kinds[0].sections[1].lines;
    expect(meze.find((l) => l.name === "Köfte")?.sold_out).toBeUndefined();
    expect(r.soldOutReadable).toBe(true);
  });

  it("a failed 86 read marks nothing and says so; the menu stands", async () => {
    const r = await service(house(), { stock_outs: "timeout" }).getFullMenu(
      RID,
    );
    expect(r.soldOutReadable).toBe(false);
    expect(r.soldOutReason).toMatch(/could not be read/);
    expect(r.kinds).toHaveLength(2);
  });

  it("a failed read of the sections, the lines or the order is an error, never a shorter menu (ADR 0067)", async () => {
    await expect(
      service(house(), { menu_sections: "timeout" }).getFullMenu(RID),
    ).rejects.toThrow(/sections .* could not be read/);
    await expect(
      service(house(), { menu_items: "timeout" }).getFullMenu(RID),
    ).rejects.toThrow(/timeout/);
    await expect(
      service(house(), { restaurants: "timeout" }).getFullMenu(RID),
    ).rejects.toThrow(/order .* could not be read/);
    await expect(
      service(house(), { restaurant_menus: "timeout" }).getFullMenu(RID),
    ).rejects.toThrow(/could not be read/);
  });

  it("a house with nothing live reads as no kinds, never an error", async () => {
    const r = await service({
      restaurants: [{ id: RID }],
      restaurant_menus: [],
    }).getFullMenu(RID);
    expect(r.kinds).toEqual([]);
    expect(r.hiddenDishes).toEqual([]);
  });
});

describe("the kind order (ADR 0340 rule 22)", () => {
  it("is the three kinds, each once", () => {
    expect(isMenuKindOrder(["food", "beverage", "desserts"])).toBe(true);
    expect(isMenuKindOrder(["food", "beverage"])).toBe(false);
    expect(isMenuKindOrder(["food", "food", "desserts"])).toBe(false);
    expect(isMenuKindOrder(["food", "beverage", "bar"])).toBe(false);
    expect(isMenuKindOrder("food,beverage,desserts")).toBe(false);
  });

  it("is written on this house's row only", async () => {
    const t = house();
    const r = await service(t).setMenuKindOrder(RID, [
      "desserts",
      "beverage",
      "food",
    ]);
    expect(r.kindOrder).toEqual(["desserts", "beverage", "food"]);
    expect(t.restaurants[0].menu_kind_order).toEqual([
      "desserts",
      "beverage",
      "food",
    ]);
    expect(t.restaurants[1].menu_kind_order).toEqual([
      "desserts",
      "food",
      "beverage",
    ]);
  });

  it("refuses anything but the three kinds, before anything is written", async () => {
    const t = house();
    await expect(
      service(t).setMenuKindOrder(RID, ["food", "beverage"]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.restaurants[0].menu_kind_order).toBeNull();
  });

  it("a failed write says nothing was changed", async () => {
    await expect(
      service(house(), { restaurants: "permission denied" }).setMenuKindOrder(
        RID,
        ["food", "beverage", "desserts"],
      ),
    ).rejects.toThrow(/was not saved: permission denied/);
  });
});

describe("the routes are house-scoped (ADR 0340 rule 24, ADR 0147)", () => {
  function orgs(role: string | null) {
    const organizations = new OrganizationsService({} as never);
    jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
    return organizations;
  }
  function controller(role: string | null) {
    const getFullMenu = jest.fn(async (rid: string) => ({ rid }));
    const setMenuKindOrder = jest.fn(async (_rid: string, order: string[]) => ({
      kindOrder: order,
    }));
    const c = new MenusController(
      { getFullMenu, setMenuKindOrder } as any,
      orgs(role),
    );
    return { c, getFullMenu, setMenuKindOrder };
  }
  const ORDER = { order: ["food", "beverage", "desserts"] };

  it("any member reads the Full menu of the house in their token", async () => {
    const { c, getFullMenu } = controller(null);
    await expect(c.getFullMenu(RID, RID)).resolves.toEqual({ rid: RID });
    expect(getFullMenu).toHaveBeenCalledWith(RID);
  });

  it("a path naming another house is a 404, and nothing is read", async () => {
    const { c, getFullMenu, setMenuKindOrder } = controller("owner");
    await expect(c.getFullMenu("rest-2", RID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      c.setKindOrder("rest-2", ORDER as any, {
        userId: "u-1",
        restaurantId: RID,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(getFullMenu).not.toHaveBeenCalled();
    expect(setMenuKindOrder).not.toHaveBeenCalled();
  });

  it("a session with no house is refused before anything is read", async () => {
    const { c, getFullMenu } = controller("owner");
    await expect(c.getFullMenu(RID, null)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(getFullMenu).not.toHaveBeenCalled();
  });

  it.each(["owner", "manager"])("a %s sets the kind order", async (role) => {
    const { c, setMenuKindOrder } = controller(role);
    await c.setKindOrder(RID, ORDER as any, {
      userId: "u-1",
      restaurantId: RID,
    });
    expect(setMenuKindOrder).toHaveBeenCalledWith(RID, ORDER.order);
  });

  it.each(["staff", null])(
    "%s is refused the kind order before anything is written",
    async (role) => {
      const { c, setMenuKindOrder } = controller(role as string | null);
      await expect(
        c.setKindOrder(RID, ORDER as any, { userId: "u-1", restaurantId: RID }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(setMenuKindOrder).not.toHaveBeenCalled();
    },
  );

  it("a session naming no one is refused the kind order", async () => {
    const { c, setMenuKindOrder } = controller("owner");
    await expect(
      c.setKindOrder(RID, ORDER as any, { restaurantId: RID }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(setMenuKindOrder).not.toHaveBeenCalled();
  });
});
