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
