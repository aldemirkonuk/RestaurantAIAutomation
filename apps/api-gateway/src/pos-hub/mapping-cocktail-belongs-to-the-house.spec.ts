import {
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PosHubService } from "./pos-hub.service";
import { cocktailIdOf } from "./cocktail-link";

/**
 * Inventory r28 audit, gap 1, slice 2 of 4: a till button can name the drink
 * recipe it sells (`pos_item_mappings.cocktail_id`, migration 20271015100000).
 *
 * Invariants, each pinned below with a control:
 *   L1 House. Only the caller's own recipe is written. Another house's is a
 *      403, an unattributed reference recipe (restaurant_id NULL) is a 403,
 *      a failed read is a 422, and in every refusal nothing is upserted.
 *   L2 One thing drawn. A button names a shelf item OR a recipe, never both,
 *      and a recipe is never a wine pour.
 *   L3 Shape. cocktail_id is a uuid or null; anything else is refused in
 *      words before any read.
 *   L4 The whole link. Every upsert states it: re-mapping a button to a
 *      shelf item clears its recipe, and to a recipe clears its item.
 */

type Row = Record<string, any>;

const HOUSE_A = "restaurant-a";
const HOUSE_B = "restaurant-b";
const ITEM_B = "inventory-of-restaurant-b";
const NEGRONI_A = "c0c0c0c0-0000-4000-8000-00000000000a";
const NEGRONI_B = "c0c0c0c0-0000-4000-8000-00000000000b";
const REFERENCE = "c0c0c0c0-0000-4000-8000-0000000000ff";
const REMOVED_B = "c0c0c0c0-0000-4000-8000-0000000000bd";

const COCKTAILS: Row[] = [
  { id: NEGRONI_A, restaurant_id: HOUSE_A },
  { id: NEGRONI_B, restaurant_id: HOUSE_B },
  { id: REFERENCE, restaurant_id: null },
  { id: REMOVED_B, restaurant_id: HOUSE_B, deleted_at: "2026-11-01T00:00:00Z" },
].map((r) => ({ deleted_at: null, ...r }));
const INVENTORY: Row[] = [{ id: ITEM_B, restaurant_id: HOUSE_B }];

const quietLogger = { error: () => {}, warn: () => {}, log: () => {}, debug: () => {} };

function houseClient(opts: { cocktailReadFails?: boolean } = {}) {
  const upserts: Row[] = [];
  const reads: string[] = [];
  const client: any = {
    from(table: string) {
      reads.push(table);
      const filters: Array<[string, unknown]> = [];
      const source = (): Row[] =>
        table === "cocktails" ? COCKTAILS : table === "restaurant_inventory" ? INVENTORY : [];
      const rows = () => source().filter((r) => filters.every(([c, v]) => r[c] === v));
      const q: any = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          filters.push([col, v]);
          return q;
        },
        is: (col: string, v: unknown) => {
          filters.push([col, v]);
          return q;
        },
        maybeSingle: async () =>
          table === "cocktails" && opts.cocktailReadFails
            ? { data: null, error: { message: "connection reset" } }
            : { data: rows()[0] ?? null, error: null },
        upsert: (row: Row) => {
          upserts.push(row);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        },
      };
      return q;
    },
  };
  return { client, upserts, reads };
}

function posHub(client: any): PosHubService {
  const svc = Object.create(PosHubService.prototype) as any;
  svc.dbService = { getClient: () => client };
  svc.logger = quietLogger;
  return svc as PosHubService;
}

const button = (over: Row = {}): Row => ({
  external_item_id: "negroni-1",
  item_name: "Negroni",
  is_wine: false,
  ...over,
});

describe("L1: a till button's drink recipe is written only for the caller's own house", () => {
  it("writes the caller's own recipe (control)", async () => {
    const { client, upserts } = houseClient();
    await posHub(client).upsertItemMapping(HOUSE_B, button({ cocktail_id: NEGRONI_B }));
    expect(upserts).toHaveLength(1);
    expect(upserts[0].cocktail_id).toBe(NEGRONI_B);
    expect(upserts[0].inventory_id).toBeNull();
  });

  it("refuses another house's recipe with a 403 and writes nothing", async () => {
    const { client, upserts } = houseClient();
    await expect(
      posHub(client).upsertItemMapping(HOUSE_B, button({ cocktail_id: NEGRONI_A })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(upserts).toHaveLength(0);
  });

  it("refuses an unattributed reference recipe (restaurant_id NULL) and writes nothing", async () => {
    const { client, upserts } = houseClient();
    const err = await posHub(client)
      .upsertItemMapping(HOUSE_B, button({ cocktail_id: REFERENCE }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe(
      `Drink recipe ${REFERENCE} is not one of this restaurant's recipes, so the till button was not mapped.`,
    );
    expect(upserts).toHaveLength(0);
  });

  it("refuses a recipe the house removed, and writes nothing", async () => {
    const { client, upserts } = houseClient();
    await expect(
      posHub(client).upsertItemMapping(HOUSE_B, button({ cocktail_id: REMOVED_B })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(upserts).toHaveLength(0);
  });

  it("refuses with a 422 when the recipe's house could not be read, rather than writing", async () => {
    const { client, upserts } = houseClient({ cocktailReadFails: true });
    const err = await posHub(client)
      .upsertItemMapping(HOUSE_B, button({ cocktail_id: NEGRONI_B }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.message).toContain("Could not confirm that drink recipe");
    expect(err.message).toContain("connection reset");
    expect(upserts).toHaveLength(0);
  });

  it("reads no recipe for a button that names none", async () => {
    const { client, reads } = houseClient();
    await posHub(client).upsertItemMapping(HOUSE_B, button());
    expect(reads).not.toContain("cocktails");
  });
});

describe("L2: a button draws one thing", () => {
  it("refuses a shelf item and a recipe together, before any read", async () => {
    const { client, upserts, reads } = houseClient();
    const err = await posHub(client)
      .upsertItemMapping(HOUSE_B, button({ cocktail_id: NEGRONI_B, inventory_id: ITEM_B }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/either one shelf item or one drink recipe, not both/);
    expect(upserts).toHaveLength(0);
    expect(reads).toHaveLength(0);
  });

  it("refuses a recipe marked as a wine pour", async () => {
    const { client, upserts } = houseClient();
    await expect(
      posHub(client).upsertItemMapping(HOUSE_B, button({ cocktail_id: NEGRONI_B, is_wine: true })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upserts).toHaveLength(0);
  });

  it("still writes a shelf item alone (control)", async () => {
    const { client, upserts } = houseClient();
    await posHub(client).upsertItemMapping(HOUSE_B, button({ inventory_id: ITEM_B, is_wine: true }));
    expect(upserts[0].inventory_id).toBe(ITEM_B);
    expect(upserts[0].cocktail_id).toBeNull();
  });
});

describe("L3: cocktail_id is a uuid or nothing", () => {
  it.each([[42], ["negroni"], [""], [{}], [true]])("refuses %p in words", (bad) => {
    expect(() => cocktailIdOf({ cocktail_id: bad })).toThrow(BadRequestException);
    expect(() => cocktailIdOf({ cocktail_id: bad })).toThrow(/cocktail_id must be the id of one of this house's drink recipes/);
  });

  it("reads null or absent as no recipe, and a uuid in any case as itself", () => {
    expect(cocktailIdOf({})).toBeNull();
    expect(cocktailIdOf({ cocktail_id: null })).toBeNull();
    expect(cocktailIdOf({ cocktail_id: ` ${NEGRONI_B.toUpperCase()} ` })).toBe(NEGRONI_B);
  });
});

describe("L4: every upsert states the whole link", () => {
  it("re-mapping a recipe button to a shelf item clears the recipe", async () => {
    const { client, upserts } = houseClient();
    await posHub(client).upsertItemMapping(HOUSE_B, button({ inventory_id: ITEM_B }));
    expect(upserts[0]).toHaveProperty("cocktail_id", null);
  });
});
