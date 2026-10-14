import { ForbiddenException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { BeveragesService, cocktailTax } from "./beverages.service";
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

describe("serveCost on a house whose till prices include tax (F-1587)", () => {
  const stock = new Map([
    [
      GIN,
      {
        unitCost: 700,
        bottleMl: 700,
        costTax: "pre_tax" as const,
        name: "Gin",
      },
    ],
    [
      CAMPARI,
      {
        unitCost: 700,
        bottleMl: 700,
        costTax: "not_stated" as const,
        name: "Campari",
      },
    ],
  ]);

  it("works the margin on the price without tax (480 with 20% inside is 400)", () => {
    const out = serveCost(
      [{ inventory_id: GIN, quantity: 50, unit: "ml" }],
      stock,
      480,
      { rate: 0.2 },
    );
    expect(out.costPerServe).toBe(50);
    expect(out.margin).toBe(350);
    expect(out.marginPct).toBe(87.5);
    expect(out.marginRefusal).toBeNull();
  });

  it("keeps the cost and refuses the margin, naming the line whose cost is not proven without tax", () => {
    const out = serveCost(
      [
        { inventory_id: GIN, quantity: 30, unit: "ml" },
        { inventory_id: CAMPARI, quantity: 30, unit: "ml" },
      ],
      stock,
      480,
      { rate: 0.2 },
    );
    expect(out.costPerServe).toBe(60);
    expect(out.margin).toBeNull();
    expect(out.marginPct).toBeNull();
    expect(out.marginRefusal).toMatch(
      /^No margin: cost basis not stated.*Campari/,
    );
  });

  it("says the house's own refusal when no rate covers a cocktail", () => {
    const out = serveCost(
      [{ inventory_id: GIN, quantity: 50, unit: "ml" }],
      stock,
      480,
      { refusal: "No margin: no rate." },
    );
    expect(out.margin).toBeNull();
    expect(out.marginRefusal).toBe("No margin: no rate.");
  });

  it("a house that does not include tax keeps its margin, key for key", () => {
    const out = serveCost(
      [{ inventory_id: GIN, quantity: 50, unit: "ml" }],
      stock,
      480,
    );
    expect(out.margin).toBe(430);
    expect("marginRefusal" in out).toBe(false);
  });

  it("takes the whole-house rate only when no till-category rate is in force", () => {
    const house = {
      keyKind: "house" as const,
      key: "",
      version: 1,
      rate: 0.2,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    };
    const terms = {
      day: "2026-10-12",
      rates: [house],
      since: null,
      targetReconfirm: false,
    };
    // F-1669: the whole-house rate says the margin is without it, too.
    expect(cocktailTax(terms)).toEqual({
      rate: 0.2,
      note: "worked out on the price without the 20% tax inside it",
    });
    const category = {
      ...house,
      keyKind: "pos_category" as const,
      key: "Alcohol",
      version: 2,
    };
    expect(cocktailTax({ ...terms, rates: [house, category] })).toEqual({
      refusal: expect.stringMatching(/set by till category/),
    });
    expect(cocktailTax({ ...terms, day: null })).toEqual({
      refusal: expect.stringMatching(/time zone isn't set/),
    });
  });

  describe("F-1615: the till category the owner chose for cocktails", () => {
    const food = {
      keyKind: "pos_category" as const,
      key: "Yiyecek",
      version: 1,
      rate: 0.1,
      effectiveFrom: "2026-10-01",
      effectiveTo: null,
    };
    const alcohol = { ...food, key: "Alkol", version: 2, rate: 0.2 };
    const terms = {
      day: "2026-10-12",
      rates: [food, alcohol],
      since: null,
      targetReconfirm: false,
    };

    it("prices cocktails at the chosen category's rate and says which", () => {
      expect(cocktailTax(terms, "Alkol")).toEqual({
        rate: 0.2,
        note: expect.stringMatching(/20% rate of the till category “Alkol”/),
      });
      const out = serveCost(
        [{ inventory_id: GIN, quantity: 50, unit: "ml" }],
        stock,
        480,
        cocktailTax(terms, "Alkol"),
      );
      expect(out.margin).toBe(350);
      expect(out.marginTaxNote).toMatch(/“Alkol”/);
    });

    it("with no choice made, keeps the named refusal and points to Settings", () => {
      expect(cocktailTax(terms)).toEqual({
        refusal: expect.stringMatching(
          /nobody has said which one prices cocktails.*Settings/,
        ),
      });
    });

    it("a chosen category with no rate in force today refuses, naming it", () => {
      const ended = { ...alcohol, effectiveTo: "2026-10-12" };
      expect(cocktailTax({ ...terms, rates: [food, ended] }, "Alkol")).toEqual({
        refusal: expect.stringMatching(/“Alkol”.*no rate in force today/),
      });
    });

    it("a refused margin carries no rate note", () => {
      const out = serveCost(
        [{ inventory_id: CAMPARI, quantity: 50, unit: "ml" }],
        stock,
        480,
        cocktailTax(terms, "Alkol"),
      );
      expect(out.margin).toBeNull();
      expect("marginTaxNote" in out).toBe(false);
    });
  });
});

describe("BeveragesService: a recipe line takes from the house's own stock", () => {
  it("writes the stock row a line names", async () => {
    const { service, log } = await serviceWith({
      cocktails: [{ data: { id: COCKTAIL_ID } }],
      restaurant_inventory: [{ data: [{ id: GIN }] }],
      cocktail_ingredients: [{ data: [] }, { data: [{ id: "new-0" }] }],
    });
    await service.setCocktailIngredients(
      RID,
      COCKTAIL_ID,
      {
        lines: [
          { freeText: "gin", quantity: 30, unit: "ml", inventoryId: GIN },
        ],
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
      service.setCocktailIngredients(
        RID,
        COCKTAIL_ID,
        {
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
      // tax_basis is NOT NULL on every house (ADR 0341); unset reads as before.
      restaurants: [{ data: { currency: "TRY", tax_basis: "unset" } }],
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

  // F-1615: on an inclusive house with till-category rates, the category the
  // owner chose for cocktails prices the margin; with none chosen, the refusal.
  it.each([
    ["Alkol", 350, null],
    [null, null, /nobody has said which one prices cocktails/],
  ])(
    "an inclusive house's cocktail margin follows the category chosen for cocktails (%s)",
    async (chosen, margin, refusal) => {
      const { service } = await serviceWith({
        cocktails: [
          { data: [{ id: COCKTAIL_ID, name: "Negroni", price: 480 }] },
          { data: null },
        ],
        cocktail_ingredients: [
          {
            data: [
              {
                cocktail_id: COCKTAIL_ID,
                inventory_id: GIN,
                quantity: 50,
                unit: "ml",
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
                last_purchase_price_tax_basis: "excludes_tax",
              },
            ],
          },
        ],
        inventory_lot_rollup: [{ data: [] }],
        restaurants: [
          {
            data: {
              currency: "TRY",
              country: "TR",
              timezone: "Europe/Istanbul",
              tax_basis: "prices_include_tax",
              tax_basis_confirmed_at: "2026-10-01T09:00:00Z",
              cocktail_tax_category: chosen,
            },
          },
        ],
        house_tax_rates: [
          {
            data: [
              {
                id: "r1",
                version: 1,
                key_kind: "pos_category",
                key: "Alkol",
                rate: 0.2,
                effective_from: "2026-01-01",
                effective_to: null,
              },
            ],
          },
          { data: [] },
        ],
      });
      const out = await service.listCocktails(RID, { limit: 200 });
      const serve = (out.rows[0] as { serve: Record<string, unknown> }).serve;
      expect(serve.costPerServe).toBe(50);
      expect(serve.margin).toBe(margin);
      if (refusal) expect(serve.marginRefusal).toMatch(refusal);
      else expect(serve.marginTaxNote).toMatch(/“Alkol”/);
    },
  );

  // F-1668: the margin is on the /cocktails price; the live menu's price for
  // the same cocktail is carried beside it, so a difference can be shown.
  it("carries the live menu's price for a cocktail beside its own price", async () => {
    const { service } = await serviceWith({
      cocktails: [
        {
          data: [
            { id: COCKTAIL_ID, name: "Negroni", price: 450 },
            { id: "c-2", name: "Spritz", price: 300 },
          ],
        },
        { data: null },
      ],
      restaurant_menus: [
        { data: [{ id: "m-1", status: "active", menu_type: "beverage" }] },
      ],
      menu_items: [
        {
          data: [
            {
              id: "l-1",
              menu_id: "m-1",
              name: "negroni ",
              category: "Cocktails",
              line_kind: "drink",
              drink_category: "cocktail",
              by_glass_price: 520,
              bottle_price: null,
            },
          ],
        },
      ],
    });
    const out = await service.listCocktails(RID, { limit: 200 });
    const rows = out.rows as Array<{ id: string; menuPrices: unknown }>;
    expect(rows.find((r) => r.id === COCKTAIL_ID)!.menuPrices).toEqual([520]);
    expect(rows.find((r) => r.id === "c-2")!.menuPrices).toEqual([]);
    expect(out.menuPricesUnread).toBeNull();
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
