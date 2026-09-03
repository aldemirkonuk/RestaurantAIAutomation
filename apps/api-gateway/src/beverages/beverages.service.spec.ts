import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { BeveragesService } from "./beverages.service";

/**
 * Two tables that had a schema and no way in since August. What these tests pin
 * is not the SQL — it is the two sentences the response has to carry, because
 * both are things a page would otherwise state falsely:
 *
 *   * `public.beverages` has NO restaurant_id. Rows from it are a shared
 *     reference catalogue and must never be rendered as this house's stock.
 *   * a full page is not a complete table. `truncated` exists so the browser
 *     cannot print a floor as a total — the exact error the cellar's parent
 *     card was already caught making about `/wines?limit=500`.
 */

type TableResult = { data?: unknown[]; error?: unknown; count?: number };

function chain(result: TableResult) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "or", "ilike", "order", "limit"]) {
    self[m] = jest.fn(() => self);
  }
  self.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({
      data: result.data ?? null,
      error: result.error ?? null,
      count: result.count ?? null,
    }).then(resolve);
  return self;
}

async function serviceWith(seq: Record<string, TableResult[]>) {
  const cursor: Record<string, number> = {};
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const i = cursor[table] ?? 0;
        cursor[table] = i + 1;
        const list = seq[table] ?? [{ data: [] }];
        return chain(list[Math.min(i, list.length - 1)]);
      },
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [BeveragesService, { provide: DatabaseService, useValue: db }],
  }).compile();
  return moduleRef.get(BeveragesService);
}

const RID = "550e8400-e29b-41d4-a716-446655440000";

describe("BeveragesService.listBeverages", () => {
  it("labels the rows as a shared reference catalogue, not as this house's stock", async () => {
    const service = await serviceWith({
      beverages: [{ data: [{ id: "b1", name: "Efes Pilsen", beverage_type: "beer" }] }],
    });
    const out = await service.listBeverages(RID, { limit: 200 });
    expect(out.scope).toBe("global-reference");
    expect(out.scopeNote).toContain("no restaurant_id");
    expect(out.count).toBe(1);
    expect(out.truncated).toBe(false);
  });

  it("says truncated when the read came back at its own limit", async () => {
    const service = await serviceWith({
      beverages: [{ data: [{ id: "b1" }, { id: "b2" }] }],
    });
    const out = await service.listBeverages(RID, { limit: 2 });
    expect(out.truncated).toBe(true);
  });

  it("returns NOTHING for a register this table cannot serve, instead of everything", async () => {
    // Caught live: `?register=soft_drinks` has no beverage_type behind it, the
    // IN() filter was skipped, and the endpoint returned whiskies under the
    // heading "soft drinks". A filter that degrades to "no filter" answers a
    // question it cannot answer.
    const service = await serviceWith({
      beverages: [{ data: [{ id: "b1", name: "Lagavulin 16", beverage_type: "whiskey" }] }],
    });
    const out = await service.listBeverages(RID, { register: "soft_drinks", limit: 3 });
    expect(out.rows).toEqual([]);
    expect(out.count).toBe(0);
    expect(out.servedByThisTable).toBe(false);
    expect(out.scopeNote).toMatch(/absence of a query, not an empty result/);
  });

  it("names the beverage_type values a served register resolved to", async () => {
    const service = await serviceWith({
      beverages: [{ data: [{ id: "b1", name: "Lagavulin 16", beverage_type: "whiskey" }] }],
    });
    const out = await service.listBeverages(RID, { register: "whiskey", limit: 3 });
    expect(out.servedByThisTable).toBe(true);
    expect(out.matchedTypes).toEqual(expect.arrayContaining(["whiskey", "bourbon"]));
  });

  it("explains a missing table in words rather than returning an empty list", async () => {
    const service = await serviceWith({
      beverages: [{ error: { code: "42P01", message: "does not exist" } }],
    });
    await expect(service.listBeverages(RID, { limit: 10 })).rejects.toThrow(
      /public\.beverages is not on this database yet/,
    );
  });
});

describe("BeveragesService.listCocktails", () => {
  it("returns only this house's rows and counts unattributed reference rows apart", async () => {
    const service = await serviceWith({
      cocktails: [
        { data: [{ id: "c1", name: "Negroni" }] },
        { count: 55 },
      ],
    });
    const out = await service.listCocktails(RID, { limit: 200 });
    expect(out.scope).toBe("tenant");
    expect(out.count).toBe(1);
    expect(out.referenceRows).toBe(55);
    // cocktail_ingredients was created empty on purpose and stayed empty.
    expect(out.recipesAvailable).toBe(false);
  });

  it("leaves referenceRows NULL — never 0 — when that count could not be read", async () => {
    const service = await serviceWith({
      cocktails: [{ data: [] }, { error: { message: "boom" } }],
    });
    const out = await service.listCocktails(RID, { limit: 200 });
    expect(out.referenceRows).toBeNull();
    expect(out.count).toBe(0);
  });
});

/* ── the house's own record, and the one register a house can write ─────────
   A richer harness than `chain()` above: these paths call `.rpc()`, and the
   write paths terminate in `.single()` / `.maybeSingle()` rather than being
   thenable. Kept separate rather than widening `chain()`, so the existing
   read tests keep the smallest mock that can express them.               */

type Term = { data?: unknown; error?: unknown };

function writeChain(result: Term) {
  const self: Record<string, unknown> = {};
  for (const m of [
    "select", "eq", "is", "in", "or", "ilike", "order", "limit",
    "insert", "update", "delete",
  ]) {
    self[m] = jest.fn(() => self);
  }
  const settle = () =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  self.single = jest.fn(settle);
  self.maybeSingle = jest.fn(settle);
  self.then = (resolve: (v: unknown) => unknown) => settle().then(resolve);
  return self;
}

async function richService(opts: {
  rpc?: Term;
  tables?: Record<string, Term[]>;
}) {
  const cursor: Record<string, number> = {};
  const calls: { rpc: unknown[][] } = { rpc: [] };
  const db = {
    getClient: () => ({
      rpc: (...args: unknown[]) => {
        calls.rpc.push(args);
        return Promise.resolve({
          data: opts.rpc?.data ?? null,
          error: opts.rpc?.error ?? null,
        });
      },
      from: (table: string) => {
        const i = cursor[table] ?? 0;
        cursor[table] = i + 1;
        const list = opts.tables?.[table] ?? [{ data: [] }];
        return writeChain(list[Math.min(i, list.length - 1)]);
      },
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [BeveragesService, { provide: DatabaseService, useValue: db }],
  }).compile();
  return { service: moduleRef.get(BeveragesService), calls };
}

const COCKTAIL_ID = "7f1c1a2e-0000-4000-8000-000000000001";

describe("BeveragesService.readHouseLedger", () => {
  it("names the migration when the function is not on this database", async () => {
    // The fault this test exists to prevent: returning [] here would render as
    // "this house has no record of anything", which is absence reported as
    // health — the single most expensive shape in this repo.
    const { service } = await richService({
      rpc: { error: { code: "42883", message: "function does not exist" } },
    });
    const out = await service.readHouseLedger(RID, 600);
    expect(out.rows).toBeNull();
    expect(out.status.readable).toBe(false);
    expect(out.status.rows).toBeNull();
    expect(out.status.reason).toContain("20260903120000");
    expect(out.status.reason).toContain("unread, not empty");
  });

  it("passes the tenant and the cap to the function, and nothing else", async () => {
    const { service, calls } = await richService({ rpc: { data: [] } });
    await service.readHouseLedger(RID, 600);
    expect(calls.rpc[0][0]).toBe("house_beverage_ledger");
    expect(calls.rpc[0][1]).toEqual({ p_restaurant_id: RID, p_limit: 600 });
  });

  it("reports a real read failure verbatim rather than as a missing migration", async () => {
    const { service } = await richService({
      rpc: { error: { code: "57014", message: "statement timeout" } },
    });
    const out = await service.readHouseLedger(RID, 600);
    expect(out.status.reason).toBe("statement timeout");
  });
});

describe("BeveragesService.readRegister", () => {
  it("survives a failed ledger and still renders the catalogue", async () => {
    const { service } = await richService({
      rpc: { error: { code: "42883", message: "function does not exist" } },
      tables: {
        beverages: [{ data: [{ id: "b1", name: "Efes Pilsen", beverage_type: "beer" }] }],
      },
    });
    const out = await service.readRegister(RID, "beer", {
      catalogueLimit: 400,
      ledgerLimit: 600,
    });
    expect(out.house.readable).toBe(false);
    expect(out.rows).toHaveLength(1);
    expect(out.stocking.decision).toBe("OD-113");
  });

  it("says the catalogue cannot answer for soft drinks, and asks it nothing", async () => {
    const { service } = await richService({ rpc: { data: [] } });
    const out = await service.readRegister(RID, "soft_drinks", {
      catalogueLimit: 400,
      ledgerLimit: 600,
    });
    expect(out.catalogue.servedByThisTable).toBe(false);
    expect(out.catalogue.readable).toBe(true);
    expect(out.catalogue.reason).toContain("cannot answer");
    expect(out.catalogue.matchedTypes).toEqual([]);
  });
});

describe("BeveragesService cocktail writes", () => {
  it("takes the tenant from the path, never from the body", async () => {
    const inserted: unknown[] = [];
    const cursor = { n: 0 };
    const db = {
      getClient: () => ({
        rpc: () => Promise.resolve({ data: null, error: null }),
        from: () => {
          cursor.n += 1;
          const self: Record<string, unknown> = {};
          for (const m of ["select", "eq", "is", "update", "delete"]) {
            self[m] = jest.fn(() => self);
          }
          self.insert = jest.fn((row: unknown) => {
            inserted.push(row);
            return self;
          });
          self.single = jest.fn(() =>
            Promise.resolve({ data: { id: "c1" }, error: null }),
          );
          return self;
        },
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [BeveragesService, { provide: DatabaseService, useValue: db }],
    }).compile();
    const service = moduleRef.get(BeveragesService);

    await service.createCocktail(RID, {
      name: "  Negroni  ",
      // A body that tries to name another house must not be able to.
      restaurantId: "11111111-1111-4111-8111-111111111111",
    } as never);

    expect(inserted[0]).toMatchObject({
      restaurant_id: RID,
      name: "Negroni",
      source: "manual",
    });
    expect(inserted[0]).not.toHaveProperty("restaurantId");
  });

  it("refuses to report success for an update that matched no row", async () => {
    const { service } = await richService({
      tables: { cocktails: [{ data: null }] },
    });
    await expect(
      service.updateCocktail(RID, COCKTAIL_ID, { price: 22 }),
    ).rejects.toThrow(/Nothing was changed/);
  });

  it("patches only the fields the caller sent", async () => {
    const patches: unknown[] = [];
    const db = {
      getClient: () => ({
        from: () => {
          const self: Record<string, unknown> = {};
          for (const m of ["select", "eq", "is"]) self[m] = jest.fn(() => self);
          self.update = jest.fn((p: unknown) => {
            patches.push(p);
            return self;
          });
          self.maybeSingle = jest.fn(() =>
            Promise.resolve({ data: { id: "c1" }, error: null }),
          );
          return self;
        },
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [BeveragesService, { provide: DatabaseService, useValue: db }],
    }).compile();
    await moduleRef
      .get(BeveragesService)
      .updateCocktail(RID, COCKTAIL_ID, { price: 22 });

    const patch = patches[0] as Record<string, unknown>;
    expect(patch.price).toBe(22);
    // A PATCH that nulled the absent fields would erase the method and the
    // glass on a price edit.
    expect(patch).not.toHaveProperty("method");
    expect(patch).not.toHaveProperty("glass");
    expect(patch).toHaveProperty("updated_at");
  });

  it("retires a cocktail by dating it, never by deleting the row", async () => {
    const patches: unknown[] = [];
    const db = {
      getClient: () => ({
        from: () => {
          const self: Record<string, unknown> = {};
          for (const m of ["select", "eq", "is"]) self[m] = jest.fn(() => self);
          self.update = jest.fn((p: unknown) => {
            patches.push(p);
            return self;
          });
          self.maybeSingle = jest.fn(() =>
            Promise.resolve({ data: { id: "c1" }, error: null }),
          );
          self.delete = jest.fn(() => {
            throw new Error("a retired cocktail must not be deleted");
          });
          return self;
        },
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [BeveragesService, { provide: DatabaseService, useValue: db }],
    }).compile();
    const out = await moduleRef
      .get(BeveragesService)
      .deleteCocktail(RID, COCKTAIL_ID);
    expect(out).toEqual({ id: "c1", retired: true });
    expect(patches[0]).toHaveProperty("deleted_at");
  });

  it("checks ownership before writing a recipe line", async () => {
    // `cocktail_ingredients` has no restaurant_id of its own, so this lookup IS
    // the tenancy boundary for the write.
    const { service } = await richService({
      tables: { cocktails: [{ data: null }] },
    });
    await expect(
      service.setCocktailIngredients(RID, COCKTAIL_ID, {
        lines: [{ freeText: "fresh lime juice" }],
      }),
    ).rejects.toThrow(/No recipe line was written/);
  });

  it("writes the recipe lines a bartender typed — the table's first writer", async () => {
    const inserted: unknown[] = [];
    const db = {
      getClient: () => ({
        from: (table: string) => {
          const self: Record<string, unknown> = {};
          for (const m of ["select", "eq", "is", "order", "delete"]) {
            self[m] = jest.fn(() => self);
          }
          self.insert = jest.fn((rows: unknown) => {
            inserted.push(rows);
            return self;
          });
          self.maybeSingle = jest.fn(() =>
            Promise.resolve({ data: { id: COCKTAIL_ID }, error: null }),
          );
          self.then = (resolve: (v: unknown) => unknown) =>
            Promise.resolve({
              data: table === "cocktail_ingredients" ? [{ id: "i1" }, { id: "i2" }] : [],
              error: null,
            }).then(resolve);
          return self;
        },
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [BeveragesService, { provide: DatabaseService, useValue: db }],
    }).compile();
    const out = await moduleRef
      .get(BeveragesService)
      .setCocktailIngredients(RID, COCKTAIL_ID, {
        lines: [
          { beverageId: "b-1", quantity: 30, unit: "ml" },
          { freeText: "fresh lime juice", quantity: 20, unit: "ml", sortOrder: 5 },
        ],
      });

    expect(out).toEqual({ cocktailId: COCKTAIL_ID, lines: 2, recipesAvailable: true });
    const rows = inserted[0] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ cocktail_id: COCKTAIL_ID, beverage_id: "b-1", sort_order: 0 });
    expect(rows[1]).toMatchObject({ free_text: "fresh lime juice", sort_order: 5 });
  });
});
