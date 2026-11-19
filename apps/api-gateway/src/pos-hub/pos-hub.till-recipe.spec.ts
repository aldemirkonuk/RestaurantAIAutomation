import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { PosHubService } from "./pos-hub.service";
import { priceNotSentLines, recentChecksLimit } from "./till-check-view";

/**
 * Gap lane till-recipe (g2): the till-to-recipe link is written from a screen,
 * and a check can be read with its margin and its unpriced lines.
 *
 *   T1 The whole link. A recipe clears the shelf item and the wine fields; the
 *      button's category survives; a button that already draws a shelf item
 *      moves only when the caller says so.
 *   T2 Taking it off clears only the recipe, and refuses a button that has none.
 *   T3 House. Another house's recipe writes nothing; an unreadable current
 *      link writes nothing.
 *   T4 The check view says what it could not read, and counts unpriced lines.
 */

type Row = Record<string, any>;
const HOUSE = "house-a";
const OTHER = "house-b";
const MINE = "c0c0c0c0-0000-4000-8000-00000000000a";
const THEIRS = "c0c0c0c0-0000-4000-8000-00000000000b";

function makeClient(
  tables: Record<string, Row[]>,
  opts: { failTable?: string } = {},
) {
  const upserts: Row[] = [];
  const client: any = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let max = Infinity;
      const rows = () =>
        (tables[table] ?? [])
          .filter((r) => filters.every(([c, v]) => r[c] === v))
          .slice(0, max);
      const failed = () => opts.failTable === table;
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        is: (c: string, v: unknown) => (filters.push([c, v]), q),
        not: () => q,
        like: () => q,
        order: () => q,
        limit: (n: number) => ((max = n), q),
        maybeSingle: async () =>
          failed()
            ? { data: null, error: { message: "connection reset" } }
            : { data: rows()[0] ?? null, error: null },
        upsert: (row: Row) => {
          upserts.push(row);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        },
        then: (res: any, rej: any) =>
          Promise.resolve(
            failed()
              ? { data: null, error: { message: "connection reset" } }
              : { data: rows(), error: null },
          ).then(res, rej),
      };
      return q;
    },
  };
  return { client, upserts };
}

function posHub(client: any): PosHubService {
  const svc = Object.create(PosHubService.prototype) as any;
  svc.dbService = { getClient: () => client };
  svc.logger = { error: () => {}, warn: () => {}, log: () => {}, debug: () => {} };
  return svc as PosHubService;
}

const COCKTAILS = [
  { id: MINE, restaurant_id: HOUSE, deleted_at: null },
  { id: THEIRS, restaurant_id: OTHER, deleted_at: null },
];
const button = { source: "toast", external_item_id: "neg-1", item_name: "Negroni" };

describe("T1: a recipe link states the whole link", () => {
  it("clears the shelf and wine fields, keeps the category", async () => {
    const { client, upserts } = makeClient({
      cocktails: COCKTAILS,
      pos_item_mappings: [
        { restaurant_id: HOUSE, ...button, category: "Cocktails", inventory_id: null, cocktail_id: null },
      ],
    });
    await posHub(client).setTillRecipe(HOUSE, { ...button, cocktail_id: MINE });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      restaurant_id: HOUSE,
      source: "toast",
      external_item_id: "neg-1",
      item_name: "Negroni",
      category: "Cocktails",
      cocktail_id: MINE,
      inventory_id: null,
      master_wine_id: null,
      is_wine: false,
      sale_unit: null,
      sale_volume_ml: null,
    });
  });

  it("links a button the house has no row for yet", async () => {
    const { client, upserts } = makeClient({ cocktails: COCKTAILS, pos_item_mappings: [] });
    await posHub(client).setTillRecipe(HOUSE, { ...button, category: "Bar", cocktail_id: MINE });
    expect(upserts[0]).toMatchObject({ cocktail_id: MINE, category: "Bar" });
  });

  it("will not move a button off its shelf item unless told to", async () => {
    const shelf = [{ restaurant_id: HOUSE, ...button, inventory_id: "inv-1", cocktail_id: null }];
    const refused = makeClient({ cocktails: COCKTAILS, pos_item_mappings: shelf });
    await expect(
      posHub(refused.client).setTillRecipe(HOUSE, { ...button, cocktail_id: MINE }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(refused.upserts).toHaveLength(0);

    const told = makeClient({ cocktails: COCKTAILS, pos_item_mappings: shelf });
    await posHub(told.client).setTillRecipe(HOUSE, {
      ...button,
      cocktail_id: MINE,
      replace_shelf_link: true,
    });
    expect(told.upserts[0]).toMatchObject({ cocktail_id: MINE, inventory_id: null });
  });
});

describe("T2: taking the recipe off", () => {
  it("clears only the recipe", async () => {
    const { client, upserts } = makeClient({
      cocktails: COCKTAILS,
      pos_item_mappings: [
        { restaurant_id: HOUSE, ...button, category: "Cocktails", inventory_id: null, cocktail_id: MINE },
      ],
    });
    await posHub(client).setTillRecipe(HOUSE, { ...button, cocktail_id: null });
    expect(upserts[0]).toMatchObject({ cocktail_id: null, inventory_id: null, category: "Cocktails" });
  });

  it("refuses a button that has no recipe, and writes nothing", async () => {
    const { client, upserts } = makeClient({
      cocktails: COCKTAILS,
      pos_item_mappings: [{ restaurant_id: HOUSE, ...button, inventory_id: "inv-1", cocktail_id: null }],
    });
    await expect(
      posHub(client).setTillRecipe(HOUSE, { ...button, cocktail_id: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(upserts).toHaveLength(0);
  });
});

describe("T3: house and failed reads", () => {
  it("writes nothing for another house's recipe", async () => {
    const { client, upserts } = makeClient({ cocktails: COCKTAILS, pos_item_mappings: [] });
    await expect(
      posHub(client).setTillRecipe(HOUSE, { ...button, cocktail_id: THEIRS }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(upserts).toHaveLength(0);
  });

  it("writes nothing when the button's current link could not be read", async () => {
    const { client, upserts } = makeClient(
      { cocktails: COCKTAILS, pos_item_mappings: [] },
      { failTable: "pos_item_mappings" },
    );
    await expect(
      posHub(client).setTillRecipe(HOUSE, { ...button, cocktail_id: MINE }),
    ).rejects.toThrow(/could not be read.*nothing was changed/);
    expect(upserts).toHaveLength(0);
  });

  it("needs a source and a button name", async () => {
    const { client } = makeClient({ cocktails: COCKTAILS });
    await expect(posHub(client).setTillRecipe(HOUSE, { cocktail_id: MINE })).rejects.toThrow(/source/);
    await expect(
      posHub(client).setTillRecipe(HOUSE, { source: "toast", cocktail_id: MINE }),
    ).rejects.toThrow(/external_item_id or item_name/);
  });
});

describe("T4: the check view", () => {
  const check = (items: unknown) => ({
    restaurant_id: HOUSE,
    external_check_id: "chk-1",
    items,
    total: 40,
    closed_at: "2026-11-18T20:00:00Z",
    voided: false,
  });

  it("counts lines sent without a price, never a comped one", () => {
    expect(
      priceNotSentLines([
        { name: "a", price: null },
        { name: "b" },
        { name: "c", price: null, comped: true },
        { name: "d", price: 12 },
        { name: "e", price: 0 },
      ]),
    ).toBe(2);
    expect(priceNotSentLines(null)).toBe(0);
  });

  it("bounds the list", () => {
    expect(recentChecksLimit(undefined)).toBe(30);
    expect(recentChecksLimit("5")).toBe(5);
    expect(recentChecksLimit("9999")).toBe(100);
    expect(recentChecksLimit("-3")).toBe(30);
  });

  it("returns the margin with the unpriced count", async () => {
    const { client } = makeClient({
      wine_consumption_log: [],
      pos_checks: [check([{ name: "x", price: null }, { name: "y", price: 9 }])],
    });
    const v = await posHub(client).getCheckView(HOUSE, "chk-1");
    expect(v.checkKnown).toBe(true);
    expect(v.priceNotSentLines).toBe(1);
    expect(v.total).toBe(40);
  });

  it("says the check is unknown rather than counting zero", async () => {
    const { client } = makeClient({ wine_consumption_log: [], pos_checks: [] });
    const v = await posHub(client).getCheckView(HOUSE, "nope");
    expect(v.checkKnown).toBe(false);
    expect(v.priceNotSentLines).toBeNull();
  });

  it("a failed check read throws, it does not show zero", async () => {
    const { client } = makeClient({ wine_consumption_log: [] }, { failTable: "pos_checks" });
    await expect(posHub(client).getCheckView(HOUSE, "chk-1")).rejects.toThrow(/could not be read/);
  });

  it("a failed list read throws, it is not an empty list", async () => {
    const { client } = makeClient({}, { failTable: "pos_checks" });
    await expect(posHub(client).listRecentChecks(HOUSE)).rejects.toThrow(/not a claim that there are none/);
  });

  it("lists this house's checks only", async () => {
    const { client } = makeClient({
      pos_checks: [check([]), { ...check([]), restaurant_id: OTHER, external_check_id: "x" }],
    });
    const r = await posHub(client).listRecentChecks(HOUSE);
    expect(r.checks).toHaveLength(1);
  });
});
