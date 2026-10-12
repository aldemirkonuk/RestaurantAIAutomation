import { ForbiddenException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { BeveragesService } from "./beverages.service";
import { lineCost, recipeMeasure, serveCost } from "./cocktail-recipe";
import { BeveragesController, cocktailsForRole } from "./beverages.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * F-1329 (OD-113, founder S195: the industry approach). A recipe line names
 * one of the house's stock rows and an amount; the cocktail's cost per serve
 * is the sum of its linked lines' recorded costs, withheld when any is not
 * known; a line with no stock row is not linked and costs nothing.
 */

const RID = "550e8400-e29b-41d4-a716-446655440000";
const COCKTAIL_ID = "7f1c1a2e-0000-4000-8000-000000000001";
const GIN = "9a000000-0000-4000-8000-0000000000a1";
const CAMPARI = "9a000000-0000-4000-8000-0000000000a2";

type Term = { data?: unknown; error?: unknown };

function chain(result: Term, log: unknown[][], table: string) {
  const self: Record<string, unknown> = {};
  for (const m of [
    "select",
    "eq",
    "neq",
    "is",
    "in",
    "order",
    "limit",
    "update",
    "delete",
  ]) {
    self[m] = jest.fn(() => self);
  }
  self.insert = jest.fn((rows: unknown) => {
    log.push([table, "insert", rows]);
    return self;
  });
  const settle = () =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  self.single = jest.fn(settle);
  self.maybeSingle = jest.fn(settle);
  self.then = (resolve: (v: unknown) => unknown) => settle().then(resolve);
  return self;
}

async function serviceWith(tables: Record<string, Term[]>) {
  const cursor: Record<string, number> = {};
  const log: unknown[][] = [];
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const i = cursor[table] ?? 0;
        cursor[table] = i + 1;
        const list = tables[table] ?? [{ data: [] }];
        return chain(list[Math.min(i, list.length - 1)], log, table);
      },
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [BeveragesService, { provide: DatabaseService, useValue: db }],
  }).compile();
  return { service: moduleRef.get(BeveragesService), log };
}

describe("recipeMeasure: what one serve of a line takes", () => {
  it("reads ml, cl and the bar's ounce as ml, and a count as units", () => {
    expect(recipeMeasure(30, "ml")).toEqual({ kind: "ml", ml: 30 });
    expect(recipeMeasure(3, "cl")).toEqual({ kind: "ml", ml: 30 });
    expect(recipeMeasure(1, "oz")).toEqual({ kind: "ml", ml: 29.5735 });
    expect(recipeMeasure(1, "each")).toEqual({ kind: "units", units: 1 });
  });

  it("never guesses a measure it cannot read", () => {
    expect(recipeMeasure(2, "dash").kind).toBe("unread");
    expect(recipeMeasure(30, null).kind).toBe("unread");
    expect(recipeMeasure(null, "ml").kind).toBe("unread");
  });
});

describe("serveCost: cost per serve from the linked lines", () => {
  const stock = new Map([
    [GIN, { unitCost: 700, bottleMl: 700 }],
    [CAMPARI, { unitCost: null, bottleMl: 700 }],
  ]);

  it("sums the linked lines' recorded costs and gives the margin on price", () => {
    const out = serveCost(
      [
        { inventory_id: GIN, quantity: 30, unit: "ml" },
        { inventory_id: GIN, quantity: 2, unit: "cl" },
        { inventory_id: null, quantity: null, unit: null },
      ],
      stock,
      400,
    );
    expect(out.costPerServe).toBe(50);
    expect(out.margin).toBe(350);
    expect(out.marginPct).toBe(87.5);
    expect(out.linked).toBe(2);
    expect(out.notLinked).toBe(1);
    expect(out.withheldReason).toBeNull();
  });

  it("withholds the cost when any linked line's cost is unknown, never a partial sum", () => {
    const out = serveCost(
      [
        { inventory_id: GIN, quantity: 30, unit: "ml" },
        { inventory_id: CAMPARI, quantity: 30, unit: "ml" },
      ],
      stock,
      400,
    );
    expect(out.costPerServe).toBeNull();
    expect(out.margin).toBeNull();
    expect(out.withheldReason).toMatch(/no recorded cost/);
  });

  it("a line with no stock row is not linked and costs nothing", () => {
    expect(lineCost({ inventory_id: null }, stock)).toEqual({
      state: "not_linked",
    });
    expect(
      serveCost([{ inventory_id: null }], stock, 400).withheldReason,
    ).toMatch(/no recipe line is linked/);
  });
});

describe("BeveragesService: a recipe line takes from the house's own stock", () => {
  it("writes the stock row a line names", async () => {
    const { service, log } = await serviceWith({
      cocktails: [{ data: { id: COCKTAIL_ID } }],
      restaurant_inventory: [{ data: [{ id: GIN }] }],
      cocktail_ingredients: [{ data: [] }, { data: [{ id: "new-0" }] }],
    });
    await service.setCocktailIngredients(RID, COCKTAIL_ID, {
      lines: [{ freeText: "gin", quantity: 30, unit: "ml", inventoryId: GIN }],
      },
      true,
    );
    const insert = log.find((l) => l[1] === "insert");
    expect((insert![2] as any[])[0]).toMatchObject({
      inventory_id: GIN,
      quantity: 30,
      unit: "ml",
    });
  });

  it("refuses a stock row this house does not have, and writes nothing", async () => {
    const { service, log } = await serviceWith({
      cocktails: [{ data: { id: COCKTAIL_ID } }],
      restaurant_inventory: [{ data: [] }],
    });
    await expect(
      service.setCocktailIngredients(RID, COCKTAIL_ID, {
        lines: [
          { freeText: "gin", quantity: 30, unit: "ml", inventoryId: GIN },
        ],
        },
        true,
      ),
    ).rejects.toThrow(
      /stock row this house does not have\. No recipe line was written/,
    );
    expect(log.filter((l) => l[1] === "insert")).toHaveLength(0);
  });

  it("lists each cocktail with its cost per serve and margin", async () => {
    const { service } = await serviceWith({
      cocktails: [
        { data: [{ id: COCKTAIL_ID, name: "Negroni", price: 400 }] },
        { data: null },
      ],
      cocktail_ingredients: [
        {
          data: [
            {
              cocktail_id: COCKTAIL_ID,
              inventory_id: GIN,
              quantity: 30,
              unit: "ml",
            },
            {
              cocktail_id: COCKTAIL_ID,
              inventory_id: null,
              quantity: null,
              unit: null,
            },
          ],
        },
      ],
      restaurant_inventory: [
        {
          data: [
            {
              id: GIN,
              display_name: "Gin",
              bottle_size_ml: 700,
              last_purchase_price: 700,
            },
          ],
        },
      ],
      inventory_lot_rollup: [{ data: [] }],
      restaurants: [{ data: { currency: "TRY" } }],
    });
    const out = await service.listCocktails(RID, { limit: 200 });
    const row = out.rows[0] as {
      serve: { costPerServe: number; marginPct: number; notLinked: number };
    };
    expect(row.serve.costPerServe).toBe(30);
    expect(row.serve.marginPct).toBe(92.5);
    expect(row.serve.notLinked).toBe(1);
    expect(out.costsUnread).toBeNull();
  });

  // F-1474: an 86'd spirit reaches the cocktails whose recipe takes it.
  it("says a cocktail is not available while a spirit its recipe takes is 86'd, and names it", async () => {
    const { service } = await serviceWith({
      cocktails: [
        { data: [{ id: COCKTAIL_ID, name: "Negroni", price: 400 }] },
        { data: null },
      ],
      cocktail_ingredients: [
        {
          data: [
            {
              cocktail_id: COCKTAIL_ID,
              inventory_id: GIN,
              free_text: "gin",
              quantity: 30,
              unit: "ml",
            },
            {
              cocktail_id: COCKTAIL_ID,
              inventory_id: CAMPARI,
              free_text: "Campari",
              quantity: 30,
              unit: "ml",
            },
          ],
        },
      ],
      stock_outs: [{ data: [{ inventory_id: GIN }] }],
    });
    const out = await service.listCocktails(RID, { limit: 200 });
    expect((out.rows[0] as { soldOut: unknown }).soldOut).toEqual(["gin"]);
    expect(out.soldOutUnread).toBeNull();
  });

  it("an unread stock-out list says so, never that every cocktail is available", async () => {
    const { service } = await serviceWith({
      cocktails: [
        { data: [{ id: COCKTAIL_ID, name: "Negroni", price: 400 }] },
        { data: null },
      ],
      cocktail_ingredients: [
        {
          data: [
            {
              cocktail_id: COCKTAIL_ID,
              inventory_id: GIN,
              free_text: "gin",
              quantity: 30,
              unit: "ml",
            },
          ],
        },
      ],
      stock_outs: [{ error: { message: "statement timeout" } }],
    });
    const out = await service.listCocktails(RID, { limit: 200 });
    expect((out.rows[0] as { soldOut: unknown }).soldOut).toBeNull();
    expect(out.soldOutUnread).toMatch(
      /sold out could not be read.*statement timeout/,
    );
  });

  it("a failed cost read leaves the list standing and says the costs are unread", async () => {
    const { service } = await serviceWith({
      cocktails: [
        { data: [{ id: COCKTAIL_ID, name: "Negroni", price: 400 }] },
        { data: null },
      ],
      cocktail_ingredients: [{ error: { message: "statement timeout" } }],
    });
    const out = await service.listCocktails(RID, { limit: 200 });
    expect(out.count).toBe(1);
    expect((out.rows[0] as { serve: unknown }).serve).toBeNull();
    expect(out.costsUnread).toMatch(/could not be read/);
  });
});

describe("cocktailsForRole: what the house paid stays with the owner and managers (ADR 0145)", () => {
  const list = {
    rows: [
      {
        id: COCKTAIL_ID,
        price: 400,
        serve: {
          costPerServe: 30,
          margin: 370,
          marginPct: 92.5,
          linked: 1,
          notLinked: 1,
          withheldReason: null,
        },
      },
    ],
  };
  const recipe = {
    rows: [
      { inventory_id: GIN, cost: { state: "costed", cost: 30 } },
      { inventory_id: null, cost: { state: "not_linked" } },
    ],
  };

  it("an owner or a manager reads the cost per serve and margin", () => {
    expect(cocktailsForRole(list, "manager")).toBe(list);
    expect(cocktailsForRole(recipe, "owner")).toBe(recipe);
  });

  it("staff read how many lines are linked, never a cost, and are told it is kept", () => {
    const out = cocktailsForRole(list, "staff");
    expect(out.amountsWithheld).toBe(true);
    expect(out.rows[0].serve).toEqual({ linked: 1, notLinked: 1 });
    const lines = cocktailsForRole(recipe, "staff").rows;
    expect(JSON.stringify(lines)).not.toMatch(/"cost":30/);
    expect(lines[0].cost).toMatchObject({ state: "withheld" });
    expect(lines[1].cost).toEqual({ state: "not_linked" });
  });
});

/**
 * F-1471: a recipe line linked to stock is what every till sale of the drink
 * takes off the shelf, so linking, unlinking or re-measuring one is an
 * owner's or a manager's, as mapping a till button is (F-387). The words and
 * the unlinked lines stay open to anyone of the house (F-270).
 */
const USER = { userId: "u-1" };

/** The real OrganizationsService decides; only its access-row read is stubbed. */
function orgs(role: string | null) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  return organizations;
}

/** A service whose recipe holds `before`, recording every insert. */
function recipeService(before: Array<Record<string, unknown>>) {
  const inserts: unknown[] = [];
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const self: Record<string, unknown> = {};
        for (const m of ["select", "is", "order"])
          self[m] = jest.fn(() => self);
        self.maybeSingle = jest.fn(() =>
          Promise.resolve({ data: { id: COCKTAIL_ID }, error: null }),
        );
        self.eq = jest.fn(() =>
          table === "cocktail_ingredients"
            ? Object.assign(
                Promise.resolve({ data: before, error: null }),
                self,
              )
            : self,
        );
        self.in = jest.fn(() =>
          Promise.resolve({
            data: [{ id: GIN }, { id: CAMPARI }],
            error: null,
          }),
        );
        self.insert = jest.fn((rows: unknown) => {
          inserts.push(rows);
          return {
            select: () =>
              Promise.resolve({ data: [{ id: "new-0" }], error: null }),
          };
        });
        self.delete = jest.fn(() => self);
        return self;
      },
    }),
  };
  return { svc: new BeveragesService(db as never), inserts };
}

const LINKED_GIN = [
  { id: "old-0", inventory_id: GIN, quantity: "30", unit: "ml" },
];

describe("recipe lines that take stock — owner or manager only (F-1471)", () => {
  it.each(["staff", null])(
    "%s is refused pointing a line at a different stock row, and nothing is written",
    async (role) => {
      const { svc, inserts } = recipeService(LINKED_GIN);
      const c = new BeveragesController(svc, orgs(role as string | null));
      await expect(
        c.setIngredients(
          RID,
          COCKTAIL_ID,
          {
            lines: [
              {
                freeText: "gin",
                quantity: 30,
                unit: "ml",
                inventoryId: CAMPARI,
              },
            ],
          },
          USER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(inserts).toHaveLength(0);
    },
  );

  it("staff are refused linking a line that took nothing, or changing its amount", async () => {
    const c = new BeveragesController(recipeService([]).svc, orgs("staff"));
    await expect(
      c.setIngredients(
        RID,
        COCKTAIL_ID,
        {
          lines: [
            { freeText: "gin", quantity: 30, unit: "ml", inventoryId: GIN },
          ],
        },
        USER,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const again = new BeveragesController(
      recipeService(LINKED_GIN).svc,
      orgs("staff"),
    );
    await expect(
      again.setIngredients(
        RID,
        COCKTAIL_ID,
        {
          lines: [
            { freeText: "gin", quantity: 60, unit: "ml", inventoryId: GIN },
          ],
        },
        USER,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("staff may rewrite the words and add an unlinked line when the links come back unchanged", async () => {
    const { svc, inserts } = recipeService(LINKED_GIN);
    const c = new BeveragesController(svc, orgs("staff"));
    await c.setIngredients(
      RID,
      COCKTAIL_ID,
      {
        lines: [
          {
            freeText: "London dry gin",
            quantity: 30,
            unit: "ml",
            inventoryId: GIN,
          },
          { freeText: "orange peel" },
        ],
      },
      USER,
    );
    expect(inserts).toHaveLength(1);
  });

  it.each(["owner", "manager"])(
    "a %s may link a line to stock",
    async (role) => {
      const { svc, inserts } = recipeService([]);
      const c = new BeveragesController(svc, orgs(role));
      await c.setIngredients(
        RID,
        COCKTAIL_ID,
        {
          lines: [
            { freeText: "gin", quantity: 30, unit: "ml", inventoryId: GIN },
          ],
        },
        USER,
      );
      expect(inserts).toHaveLength(1);
    },
  );
});
