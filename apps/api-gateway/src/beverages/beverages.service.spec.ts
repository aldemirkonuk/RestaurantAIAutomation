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
  for (const m of ["select", "eq", "neq", "is", "in", "gt", "or", "ilike", "order", "limit"]) {
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
    "select", "eq", "neq", "is", "in", "gt", "or", "ilike", "order", "limit",
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

/* ── the till book: the till's own record, every line (ADR 0301 §1) ──────────
   Q9 (founder 2026-09-22) wired LIVE non-wine sales into the cellar heat map;
   A-016 found the read that did it sampled 200 unordered checks and skipped
   every wine-flagged line, so a MAPPED rakı read "the till never rang it".
   The till book now reads two functions of migration
   the_cellar_reads_the_tills_own_record. This fake serves them: it applies the
   call's p_names and its gt / order / limit to the lines it holds, and keeps
   every call, so a test can see what was asked for, page by page. Which lines
   the functions return (voided checks out, a queued line with its check counted
   once) is pinned in SQL, in that migration's test file.                    */

type TillLine = {
  id: string;
  item_name: string;
  qty: number | null;
  price: number | null;
  sold_at: string;
  external_check_id: string | null;
};

type TillCall = {
  fn: string;
  args: Record<string, unknown>;
  gt: [string, string] | null;
  order: string | null;
  limit: number | null;
};

function tillQuery(
  fn: string,
  args: Record<string, unknown>,
  lines: TillLine[],
  errors: Record<string, Term["error"]>,
  calls: TillCall[],
) {
  const call: TillCall = { fn, args, gt: null, order: null, limit: null };
  calls.push(call);
  const settle = () => {
    if (errors[fn]) return Promise.resolve({ data: null, error: errors[fn] });
    let rows: Record<string, unknown>[];
    if (fn === "house_till_names") {
      const count = new Map<string, number>();
      for (const l of lines) count.set(l.item_name, (count.get(l.item_name) ?? 0) + 1);
      rows = [...count].map(([item_name, n]) => ({ item_name, lines: n }));
    } else {
      const names = args.p_names as string[] | null;
      rows = lines.filter((l) => names === null || names.includes(l.item_name));
    }
    if (call.gt) {
      const [col, v] = call.gt;
      rows = rows.filter((r) => String(r[col]) > v);
    }
    if (call.order) {
      const col = call.order;
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1));
    }
    if (call.limit !== null) rows = rows.slice(0, call.limit);
    return Promise.resolve({ data: rows, error: null });
  };
  const q: Record<string, unknown> = {
    gt: (col: string, v: string) => ((call.gt = [col, v]), q),
    order: (col: string) => ((call.order = col), q),
    limit: (n: number) => ((call.limit = n), q),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      settle().then(resolve, reject),
  };
  return q;
}

async function tillService(
  lines: TillLine[],
  errors: Record<string, Term["error"]> = {},
) {
  const calls: TillCall[] = [];
  const tables: string[] = [];
  const db = {
    getClient: () => ({
      rpc: (fn: string, args: Record<string, unknown>) =>
        tillQuery(fn, args, lines, errors, calls),
      from: (table: string) => {
        tables.push(table);
        return writeChain({ data: [] });
      },
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [BeveragesService, { provide: DatabaseService, useValue: db }],
  }).compile();
  return { service: moduleRef.get(BeveragesService), calls, tables };
}

function tillLine(
  n: number,
  item_name: string,
  qty: number | null,
  price: number | null,
  sold_at = "2026-08-09T21:00:00.000Z",
): TillLine {
  return {
    // Shaped like the function's own id: check uuid, colon, line ordinal.
    id: `c${String(n).padStart(6, "0")}:1`,
    item_name,
    qty,
    price,
    sold_at,
    external_check_id: `clover-${n}`,
  };
}

describe("BeveragesService.readRowRecord — live non-wine till lines (Q9)", () => {
  it("surfaces a non-alcoholic sale from pos_checks.items", async () => {
    const { service } = await tillService([
      {
        ...tillLine(1, "Turkish Coffee", 2, 4.5, "2026-09-20T09:12:00.000Z"),
        external_check_id: "toast-99",
      },
      tillLine(2, "House Cabernet", 1, 14),
    ]);

    const out = await service.readRowRecord(RID, "Turkish Coffee");
    const pos = out.books.find((b) => b.book === "pos");
    expect(pos?.readable).toBe(true);
    expect(pos?.source).toContain("pos_checks.items");
    expect(pos?.rows).toBe(1);
    expect(pos?.ledger).toEqual([
      expect.objectContaining({
        label: "Turkish Coffee",
        qty: 2,
        unitPrice: 4.5,
        total: 9,
        at: "2026-09-20T09:12:00.000Z",
        note: "toast-99",
        matchedBy: "exact",
      }),
    ]);
  });

  it("counts a wine-flagged, mapped line: the till rang Yeni Rakı, so the record says so (A-016)", async () => {
    // pos-hub flags rakı is_wine and maps it to stock, so it never reaches the
    // unresolved queue. The old read skipped every is_wine line of a check.
    const { service } = await tillService([
      tillLine(1, "Yeni Rakı 35cl", 1, 38),
      tillLine(2, "Yeni Rakı (single)", 2, 9),
    ]);
    const out = await service.readRowRecord(RID, "Yeni Rakı");
    const pos = out.books.find((b) => b.book === "pos");
    expect(pos?.readable).toBe(true);
    expect(pos?.rows).toBe(2);
    expect(pos?.ledger.map((e) => [e.label, e.qty, e.matchedBy]).sort()).toEqual([
      ["Yeni Rakı (single)", 2, "contains"],
      ["Yeni Rakı 35cl", 1, "contains"],
    ]);
  });

  it("reads all 2,152 lines of a row across three pages, with no sample cap (A-015)", async () => {
    const lines = Array.from({ length: 2152 }, (_, i) => tillLine(i + 1, "Lions Milk", 1, 17));
    const { service, calls } = await tillService(lines);

    const out = await service.readRowRecord(RID, "Lions Milk");
    const pos = out.books.find((b) => b.book === "pos");
    expect(pos?.readable).toBe(true);
    expect(pos?.rows).toBe(2152);

    const pages = calls.filter((c) => c.fn === "house_till_lines");
    expect(pages).toHaveLength(3);
    expect(pages.map((c) => c.limit)).toEqual([1000, 1000, 1000]);
    expect(pages.map((c) => c.order)).toEqual(["id", "id", "id"]);
    // Keyset, not offset: each page starts after the last id of the one before.
    expect(pages[0].gt).toBeNull();
    expect(pages[1].gt).toEqual(["id", "c001000:1"]);
    expect(pages[2].gt).toEqual(["id", "c002000:1"]);
  });

  it("matches names with the record's own matcher and fetches only the names that matched", async () => {
    const { service, calls } = await tillService([
      tillLine(1, "Turkish Coffee", 1, 4.5),
      tillLine(2, "Turkish Coffee Double", 1, 6),
      tillLine(3, "Turkish Tea", 2, 3),
      tillLine(4, "Coffee", 1, 3),
    ]);
    const out = await service.readRowRecord(RID, "turkish  COFFEE");
    const pos = out.books.find((b) => b.book === "pos");
    expect(pos?.rows).toBe(2);

    const names = calls.filter((c) => c.fn === "house_till_names");
    expect(names).toHaveLength(1);
    expect(names[0].args).toEqual({ p_restaurant_id: RID });
    expect(names[0].order).toBe("item_name");

    const lineCalls = calls.filter((c) => c.fn === "house_till_lines");
    expect(lineCalls).toHaveLength(1);
    expect(lineCalls[0].args).toEqual({
      p_restaurant_id: RID,
      p_names: ["Turkish Coffee", "Turkish Coffee Double"],
    });
  });

  it("does not invent a till series, nor read lines, when no name the till rang matches", async () => {
    const { service, calls } = await tillService([tillLine(1, "House Cabernet", 1, 14)]);
    const out = await service.readRowRecord(RID, "Turkish Coffee");
    const pos = out.books.find((b) => b.book === "pos");
    expect(pos?.readable).toBe(true);
    expect(pos?.rows).toBe(0);
    expect(pos?.ledger).toEqual([]);
    expect(pos?.reason).toContain("Every line of every check that was not voided");
    expect(calls.filter((c) => c.fn === "house_till_lines")).toHaveLength(0);
  });

  it("keeps a line with no quantity or price as unknown, never as zero", async () => {
    const { service } = await tillService([tillLine(1, "Ayran", null, null)]);
    const out = await service.readRowRecord(RID, "Ayran");
    const pos = out.books.find((b) => b.book === "pos");
    expect(pos?.rows).toBe(1);
    expect(pos?.ledger[0]).toMatchObject({ qty: null, unitPrice: null, total: null });
  });

  it.each([
    ["house_till_names"],
    ["house_till_lines"],
  ])("leaves the book unreadable, not empty, when %s fails", async (fn) => {
    const { service } = await tillService([tillLine(1, "Ayran", 1, 2)], {
      [fn]: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    const out = await service.readRowRecord(RID, "Ayran");
    const pos = out.books.find((b) => b.book === "pos");
    expect(pos?.readable).toBe(false);
    expect(pos?.rows).toBeNull();
    expect(pos?.reason).toBe("canceling statement due to statement timeout");
  });

  it("names the migration when the till's functions are not on this database", async () => {
    const { service } = await tillService([], {
      house_till_names: { code: "PGRST202", message: "Could not find the function" },
    });
    const out = await service.readRowRecord(RID, "Ayran");
    const pos = out.books.find((b) => b.book === "pos");
    expect(pos?.readable).toBe(false);
    expect(pos?.reason).toContain("the_cellar_reads_the_tills_own_record");
    expect(pos?.reason).toContain("Unread, not empty.");
  });

  it("reads the till only through those functions, never a pos_checks sample or the queue alone", async () => {
    const { service, tables } = await tillService([tillLine(1, "Ayran", 1, 2)]);
    await service.readRowRecord(RID, "Ayran");
    expect(tables).not.toContain("pos_checks");
    expect(tables).not.toContain("pos_unresolved_lines");
  });
});

/* ── the invoice book's vendor link and the menu book's current menu ────────
   A fake that FILTERS: each `.from()` gets a fresh query that records every
   call and, when awaited, applies its eq / neq / in / gt / order / limit to
   the table's rows. So a read that forgets a scope gets the rows that scope
   would have kept out, exactly as PostgREST would serve them. A row may be a
   function of the select string, so a column the read never asked for is
   never served.                                                             */

type FakeRow = Record<string, unknown>;
type Served = FakeRow[] | ((select: string) => FakeRow[]);

function filteringQuery(served: Served, error: unknown) {
  const calls: Array<[string, unknown[]]> = [];
  const keep: Array<(r: FakeRow) => boolean> = [];
  let select = "";
  let orderBy: string | null = null;
  let limit: number | null = null;
  const self: Record<string, unknown> = {};
  const on = (m: string, effect: (...a: any[]) => void = () => undefined) => {
    self[m] = jest.fn((...a: unknown[]) => {
      calls.push([m, a]);
      effect(...a);
      return self;
    });
  };
  on("select", (cols: string) => (select = cols));
  // A dotted filter names an embedded table; the fake does not model embeds.
  on("eq", (c: string, v: unknown) => !c.includes(".") && keep.push((r) => r[c] === v));
  on("neq", (c: string, v: unknown) => keep.push((r) => r[c] !== v));
  on("in", (c: string, vs: unknown[]) => keep.push((r) => vs.includes(r[c])));
  on("gt", (c: string, v: unknown) => keep.push((r) => String(r[c]) > String(v)));
  // `or` / `ilike` are recorded, not modelled: no row here depends on them.
  for (const m of ["is", "or", "ilike"]) on(m);
  on("order", (c: string) => (orderBy = c));
  on("limit", (n: number) => (limit = n));
  self.then = (resolve: (v: unknown) => unknown) => {
    const rows = typeof served === "function" ? served(select) : served;
    let out = rows.filter((r) => keep.every((k) => k(r)));
    if (orderBy) {
      const col = orderBy;
      out = [...out].sort((a, z) => (String(a[col]) < String(z[col]) ? -1 : 1));
    }
    if (limit !== null) out = out.slice(0, limit);
    return Promise.resolve({
      data: error ? null : out,
      error: error ?? null,
    }).then(resolve);
  };
  return { query: self, calls };
}

async function filteringService(
  tables: Record<string, { rows?: Served; error?: unknown }>,
) {
  const log: Array<{ table: string; calls: Array<[string, unknown[]]> }> = [];
  const db = {
    getClient: () => ({
      // The till book reads two functions (ADR 0301 §1); these tests are not
      // about it, so it is served a till that has rung nothing.
      rpc: () => filteringQuery([], undefined).query,
      from: (table: string) => {
        const t = tables[table] ?? {};
        const { query, calls } = filteringQuery(t.rows ?? [], t.error);
        log.push({ table, calls });
        return query;
      },
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [BeveragesService, { provide: DatabaseService, useValue: db }],
  }).compile();
  const readsOf = (table: string) => log.filter((l) => l.table === table);
  return { service: moduleRef.get(BeveragesService), readsOf };
}

describe("BeveragesService.readRowRecord — the invoice book names its vendor link (A-043, A-044)", () => {
  /** One invoice line, serving `doc_number` only to a read that asks for it. */
  const invoiceLine = (select: string): FakeRow[] => [
    {
      id: "pdl-1",
      restaurant_id: RID,
      description: "Yeni Raki 70cl",
      unit_price: 610,
      line_total: 7320,
      qty_bottles: 12,
      created_at: "2026-09-30T08:00:00.000Z",
      procurement_documents: {
        id: "doc-1",
        doc_type: "invoice",
        doc_date: "2026-09-29",
        restaurant_id: RID,
        ...(select.includes("doc_number") ? { doc_number: "INV-7" } : {}),
        providers: { name: "Anise Trading" },
      },
    },
  ];

  it("embeds the vendor through procurement_documents_provider_id_fkey, never a bare providers(name)", async () => {
    const { service, readsOf } = await filteringService({
      procurement_document_lines: { rows: invoiceLine },
    });
    await service.readRowRecord(RID, "Yeni Raki 70cl");

    const [read] = readsOf("procurement_document_lines");
    const select = String(read.calls.find(([m]) => m === "select")?.[1][0]);
    const embed = select.slice(select.indexOf("procurement_documents!inner("));
    // Two foreign keys join these tables (provider_id, and
    // providers.created_from_document_id), so a bare embed 400s the read.
    expect(embed).toContain("providers!procurement_documents_provider_id_fkey(name)");
    expect(embed).not.toMatch(/(^|[\s,(])providers\(/);
    expect(embed).toContain("doc_number");
  });

  it("prints the invoice's own number as the line's note", async () => {
    const { service } = await filteringService({
      procurement_document_lines: { rows: invoiceLine },
    });
    const out = await service.readRowRecord(RID, "Yeni Raki 70cl");
    const invoice = out.books.find((b) => b.book === "invoice");
    expect(invoice?.readable).toBe(true);
    expect(invoice?.ledger).toEqual([
      expect.objectContaining({
        label: "Yeni Raki 70cl",
        who: "Anise Trading",
        note: "INV-7",
        at: "2026-09-29",
      }),
    ]);
  });
});

describe("BeveragesService.readRowRecord — the menu book reads the CURRENT menu only (A-028)", () => {
  const menus: FakeRow[] = [
    { id: "live", restaurant_id: RID, status: "active" },
    { id: "old", restaurant_id: RID, status: "archived" },
    { id: "scan", restaurant_id: RID, status: "draft" },
  ];
  const line = (id: string, menuId: string): FakeRow => ({
    id,
    menu_id: menuId,
    restaurant_id: RID,
    status: "approved",
    name: "Yeni Raki 70cl",
    producer: null,
    category: "Raki",
    bottle_price: 1800,
    by_glass_price: 220,
    created_at: "2026-09-01T00:00:00.000Z",
  });

  it("lists a line on the current menu once, not once per kept copy of the menu", async () => {
    const { service, readsOf } = await filteringService({
      restaurant_menus: { rows: menus },
      // The same line on the current menu, its archived copy and a draft.
      menu_items: { rows: [line("mi-1", "live"), line("mi-2", "old"), line("mi-3", "scan")] },
    });
    const out = await service.readRowRecord(RID, "Yeni Raki 70cl");
    const menu = out.books.find((b) => b.book === "menu");
    expect(menu?.readable).toBe(true);
    expect(menu?.rows).toBe(1);

    const [menusRead] = readsOf("restaurant_menus");
    expect(menusRead.calls).toContainEqual(["eq", ["restaurant_id", RID]]);
    expect(menusRead.calls).toContainEqual(["eq", ["status", "active"]]);
    const [linesRead] = readsOf("menu_items");
    expect(linesRead.calls).toContainEqual(["in", ["menu_id", ["live"]]]);
    expect(linesRead.calls).toContainEqual(["neq", ["status", "discarded"]]);
  });

  it("says a house with no current menu has none, and never reads its kept lines", async () => {
    const { service, readsOf } = await filteringService({
      restaurant_menus: { rows: menus.filter((m) => m.status !== "active") },
      menu_items: { rows: [line("mi-2", "old"), line("mi-3", "scan")] },
    });
    const out = await service.readRowRecord(RID, "Yeni Raki 70cl");
    const menu = out.books.find((b) => b.book === "menu");
    expect(menu?.readable).toBe(true);
    expect(menu?.rows).toBe(0);
    expect(menu?.reason).toMatch(/no current menu/);
    expect(readsOf("menu_items")).toHaveLength(0);
  });

  it("says the menu book is unread — not empty — when the current menu cannot be read", async () => {
    const { service } = await filteringService({
      restaurant_menus: { error: { code: "57014", message: "statement timeout" } },
    });
    const out = await service.readRowRecord(RID, "Yeni Raki 70cl");
    const menu = out.books.find((b) => b.book === "menu");
    expect(menu?.readable).toBe(false);
    expect(menu?.rows).toBeNull();
    expect(menu?.reason).toMatch(/statement timeout/);
  });
});
