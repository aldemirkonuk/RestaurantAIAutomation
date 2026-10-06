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

describe("BeveragesService.readRegister — Sold split by unit (ADR 0301, 2026-10-05)", () => {
  // The founder's ruling of 2026-10-05: "Sold is split into bottles and pours
  // by the till's sale unit; Taken is summed", shown as "Bottles · glasses".
  // house_beverage_ledger returns the split (migration
  // a_till_name_with_a_serve_size_joins_its_row); the register carries it.
  const row = (over: Record<string, unknown>) => ({
    house_key: "x",
    label: "X",
    books: ["menu", "pos"],
    first_seen: "2026-08-01T00:00:00Z",
    menu_lines: 1,
    menu_bottle_price: 4,
    menu_glass_price: null,
    menu_sections: ["Soft Drinks"],
    invoice_lines: 0,
    order_lines: 0,
    quote_count: 0,
    pos_lines: 0,
    poured_qty: null,
    poured_revenue: null,
    first_poured: null,
    last_poured: null,
    beverage_id: null,
    match_method: null,
    ...over,
  });
  const read = async (rows: Record<string, unknown>[]) => {
    const { service } = await richService({ rpc: { data: rows } });
    const out = await service.readRegister(RID, "soft_drinks", {
      catalogueLimit: 400,
      ledgerLimit: 600,
    });
    return (name: string) =>
      out.rows.find((r) => r.name === name)?.house?.poured;
  };

  it("carries bottles, glasses and unknown unit, which sum to Sold", async () => {
    const poured = await read([
      row({
        house_key: "cola",
        label: "Cola",
        pos_lines: 12,
        // PostgREST sends numerics as strings.
        poured_qty: "15",
        poured_revenue: "60",
        poured_bottles: "9",
        poured_glasses: "4",
        poured_unit_unknown: "2",
        tied_lines: 0,
      }),
    ]);
    expect(poured("Cola")).toMatchObject({
      lines: 12,
      qty: 15,
      bottles: 9,
      glasses: 4,
      unitUnknown: 2,
      tiedLines: 0,
    });
  });

  it("keeps a row whose only till lines tied, with no lines and its tie, never a blank", async () => {
    const poured = await read([
      row({
        house_key: "lemonade",
        label: "Lemonade",
        pos_lines: 0,
        tied_lines: 3,
      }),
    ]);
    expect(poured("Lemonade")).toMatchObject({
      lines: 0,
      qty: null,
      tiedLines: 3,
    });
  });

  it("names the till names that tied on the row, with their lines, counted on neither (ADR 0301, F2 of 2026-10-06)", async () => {
    // The founder's answer: "Each tied row's record lists the till names that
    // tied, so the owner sees why its Sold is short and can fix the menu
    // name. The lines still join neither row." The ledger lists them in
    // tied_names; the register carries them, trimmed, beside tiedLines.
    const poured = await read([
      row({
        house_key: "rose",
        label: "Lal Rosé",
        pos_lines: 2,
        poured_qty: "2",
        tied_lines: 3,
        tied_names: [
          { item_name: "Lal Rosé Kavak (glass)", lines: 2, how: "tie" },
          { item_name: " Lal Rosé Kavak Magnum ", lines: "1", how: "tie" },
          // Not a name: dropped, never shown as a blank.
          { item_name: "", lines: 4, how: "tie" },
          "not an object",
        ],
      }),
    ]);
    expect(poured("Lal Rosé")).toMatchObject({
      lines: 2,
      qty: 2,
      tiedLines: 3,
      tiedNames: [
        { name: "Lal Rosé Kavak (glass)", lines: 2 },
        { name: "Lal Rosé Kavak Magnum", lines: 1 },
      ],
    });
  });

  it("reads a database before the split as no split, not as zero", async () => {
    const poured = await read([
      row({ house_key: "ayran", label: "Ayran", pos_lines: 2, poured_qty: 3 }),
    ]);
    expect(poured("Ayran")).toMatchObject({
      lines: 2,
      qty: 3,
      bottles: null,
      glasses: null,
      unitUnknown: null,
      tiedLines: 0,
      // [ADDED 2026-10-06, F2: and no tied names. A database before
      // tied_names reads as none tied, as tiedLines 0 does.]
      tiedNames: [],
    });
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
   every call, so a test can see what was asked for, page by page. A line's
   item_name here is the function's own output, btrim(name), so it can keep a
   tab or a no-break space at its edge, and p_names keeps a line only on an
   exact match, as `btrim(name) = ANY(p_names)` does. Which lines the
   functions return (voided checks out, a queued line with its check counted
   once, each listed name round-tripping to its lines) is pinned in SQL, in
   that migration's test file.                                               */

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

/**
 * The names `house_beverage_ledger` counts on one row, keyed by the label the
 * record asks with: what `house_till_names(p_restaurant_id, p_label)` returns.
 * The rule that makes them is SQL's, and its own test pins it
 * (supabase/tests/20261222180000_a_till_name_with_a_serve_size_joins_its_row_test.sql);
 * this fake only serves its answer. A label with no entry joins the names
 * whose trimmed text is the label's, as 'exact'.
 * [CHANGED 2026-10-06, ADR 0301 F1 and F2: a name can also join
 * 'without_maker', or be listed on the row as 'tie' (counted on neither).]
 */
type TillJoins = Record<
  string,
  Array<[string, "exact" | "contains" | "without_maker" | "tie"]>
>;

function tillQuery(
  fn: string,
  args: Record<string, unknown>,
  lines: TillLine[],
  errors: Record<string, Term["error"]>,
  calls: TillCall[],
  joins: TillJoins,
) {
  const call: TillCall = { fn, args, gt: null, order: null, limit: null };
  calls.push(call);
  const settle = () => {
    if (errors[fn]) return Promise.resolve({ data: null, error: errors[fn] });
    let rows: Record<string, unknown>[];
    if (fn === "house_till_names") {
      const count = new Map<string, number>();
      for (const l of lines) count.set(l.item_name, (count.get(l.item_name) ?? 0) + 1);
      const label = args.p_label;
      if (typeof label !== "string") {
        // house_till_names(p_restaurant_id): every name the till has rung.
        rows = [...count].map(([item_name, n]) => ({ item_name, lines: n }));
      } else {
        const named =
          joins[label] ??
          [...count.keys()]
            .filter((n) => n.trim() === label.trim())
            .map((n): [string, "exact"] => [n, "exact"]);
        rows = named
          .filter(([n]) => count.has(n))
          .map(([item_name, joined_by]) => ({
            item_name,
            lines: count.get(item_name),
            joined_by,
          }));
      }
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
  joins: TillJoins = {},
) {
  const calls: TillCall[] = [];
  const tables: string[] = [];
  const db = {
    getClient: () => ({
      rpc: (fn: string, args: Record<string, unknown>) =>
        tillQuery(fn, args, lines, errors, calls, joins),
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
    // pos-hub flags rakı is_wine and maps it to stock; when its sale volume
    // resolves against this house's own item it never reaches the unresolved
    // queue. The old read skipped every is_wine line of a check.
    // [CHANGED 2026-10-05, a_till_name_with_a_serve_size_joins_its_row: the
    // record takes which names join, and how, from the ledger's own join
    // (house_till_names with p_label), served here by the fake's `joins`.]
    const { service } = await tillService(
      [
        tillLine(1, "Yeni Rakı 35cl", 1, 38),
        tillLine(2, "Yeni Rakı (single)", 2, 9),
      ],
      {},
      {
        "Yeni Rakı": [
          ["Yeni Rakı 35cl", "contains"],
          ["Yeni Rakı (single)", "contains"],
        ],
      },
    );
    const out = await service.readRowRecord(RID, "Yeni Rakı");
    const pos = out.books.find((b) => b.book === "pos");
    expect(pos?.readable).toBe(true);
    expect(pos?.rows).toBe(2);
    expect(pos?.ledger.map((e) => [e.label, e.qty, e.matchedBy]).sort()).toEqual([
      ["Yeni Rakı (single)", 2, "contains"],
      ["Yeni Rakı 35cl", 1, "contains"],
    ]);
  });

  it("lists exactly the till names its row's Sold cell counts, Tuzlu Rüzgar's sized names included (A-016, ADR 0301 2026-10-05)", async () => {
    // The names are the sim feed's own (p4-scratch/sim-run/rebuild/run/feed).
    // [CHANGED 2026-10-05, a_till_name_with_a_serve_size_joins_its_row: was
    // "finds Tuzlu Rüzgar's own till names", which found them with matchLine,
    // a weaker rule than the cell's, so 'Yeni Rakı Âlâ (single 50ml)' showed in
    // Yeni Rakı's record while no Sold cell counted it, and 'Efes Pilsen
    // (draft 400ml)' was missing from the 'Efes Pilsen (draft)' row's record
    // ('(draft)' is not inside '(draft 400ml)'). The record now lists the
    // names the ledger counts on the row, as the ledger joined them on the
    // sim feed (local measurement, ADR 0301): the Âlâ's single joins the Âlâ,
    // the more specific row, and the draft joins its row.]
    const joins: TillJoins = {
      "Yeni Rakı": [
        ["Yeni Rakı (single 50ml)", "contains"],
        ["Yeni Rakı 70cl bottle", "contains"],
        ["Yeni Rakı 100cl bottle", "contains"],
      ],
      "Yeni Rakı Âlâ": [["Yeni Rakı Âlâ (single 50ml)", "contains"]],
      "Efes Pilsen (draft)": [["Efes Pilsen (draft 400ml)", "contains"]],
      "Efes Pilsen": [["Efes Pilsen", "exact"]],
    };
    const lines = [
      tillLine(1, "Yeni Rakı (single 50ml)", 4, 14),
      tillLine(2, "Yeni Rakı 70cl bottle", 1, 80),
      tillLine(3, "Yeni Rakı 100cl bottle", 1, 110),
      tillLine(4, "Yeni Rakı Âlâ (single 50ml)", 2, 16),
      tillLine(5, "Kulüp Rakı (single 50ml)", 3, 12),
      tillLine(6, "Efes Pilsen", 2, 8),
      tillLine(7, "Efes Pilsen (draft 400ml)", 3, 10),
      tillLine(8, "Tito's Handmade Vodka (50ml)", 1, 12),
    ];
    const read = async (label: string) => {
      const { service } = await tillService(lines, {}, joins);
      const out = await service.readRowRecord(RID, label);
      const pos = out.books.find((b) => b.book === "pos");
      expect(pos?.readable).toBe(true);
      return pos?.ledger.map((e) => [e.label, e.qty, e.matchedBy]).sort();
    };

    expect(await read("Yeni Rakı")).toEqual([
      ["Yeni Rakı (single 50ml)", 4, "contains"],
      ["Yeni Rakı 100cl bottle", 1, "contains"],
      ["Yeni Rakı 70cl bottle", 1, "contains"],
    ]);
    expect(await read("Yeni Rakı Âlâ")).toEqual([
      ["Yeni Rakı Âlâ (single 50ml)", 2, "contains"],
    ]);
    expect(await read("Efes Pilsen (draft)")).toEqual([
      ["Efes Pilsen (draft 400ml)", 3, "contains"],
    ]);
    expect(await read("Efes Pilsen")).toEqual([["Efes Pilsen", 2, "exact"]]);
    // A row the ledger counts no name on reads none, even where a name
    // contains its label: the record never re-derives the join.
    expect(await read("Kulüp")).toEqual([]);
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

  it("asks the ledger for this row's names by its label, and fetches only those", async () => {
    // [CHANGED 2026-10-05, a_till_name_with_a_serve_size_joins_its_row: was
    // "matches names with the record's own matcher", which listed every name
    // and ran matchLine here. The row's names, and how each joined, are now
    // the ledger's (house_till_names with p_label), so the record and the
    // Sold cell use one rule.]
    const { service, calls } = await tillService(
      [
        tillLine(1, "Turkish Coffee", 1, 4.5),
        tillLine(2, "Turkish Coffee Double", 1, 6),
        tillLine(3, "Turkish Tea", 2, 3),
        tillLine(4, "Coffee", 1, 3),
      ],
      {},
      {
        "turkish  COFFEE": [
          ["Turkish Coffee", "exact"],
          ["Turkish Coffee Double", "contains"],
        ],
      },
    );
    const out = await service.readRowRecord(RID, "turkish  COFFEE");
    const pos = out.books.find((b) => b.book === "pos");
    expect(pos?.rows).toBe(2);
    expect(
      Object.fromEntries(
        (pos?.ledger ?? []).map((e) => [e.label, e.matchedBy]),
      ),
    ).toEqual({
      "Turkish Coffee": "exact",
      "Turkish Coffee Double": "contains",
    });

    const names = calls.filter((c) => c.fn === "house_till_names");
    expect(names).toHaveLength(1);
    expect(names[0].args).toEqual({
      p_restaurant_id: RID,
      p_label: "turkish  COFFEE",
    });
    expect(names[0].order).toBe("item_name");

    const lineCalls = calls.filter((c) => c.fn === "house_till_lines");
    expect(lineCalls).toHaveLength(1);
    expect(lineCalls[0].args).toEqual({
      p_restaurant_id: RID,
      p_names: ["Turkish Coffee", "Turkish Coffee Double"],
    });
  });

  it("sends each matched name back exactly as the till listed it, so a tab or no-break space at its edge keeps its lines (A-016)", async () => {
    // house_till_names returns btrim(name), and SQL btrim strips spaces only,
    // so 'Zqtl Cola\t' and 'Zqtl Cola\u00a0' come back with their edge kept.
    // house_till_lines keeps a line only when btrim(name) = ANY(p_names), an
    // exact comparison, which this fake's p_names filter is too. A name sent
    // back JS-trimmed ('Zqtl Cola') matches neither, and their lines vanish.
    const { service, calls } = await tillService([
      tillLine(1, "Zqtl Cola", 1, 4),
      tillLine(2, "Zqtl Cola\t", 2, 4),
      tillLine(3, "Zqtl Cola\u00a0", 3, 4),
    ]);
    const out = await service.readRowRecord(RID, "Zqtl Cola");
    const pos = out.books.find((b) => b.book === "pos");
    expect(pos?.readable).toBe(true);
    expect(pos?.rows).toBe(3);
    // Shown trimmed; matched and fetched by the name the till holds.
    expect(
      pos?.ledger.map((e) => [e.label, e.qty, e.matchedBy]).sort(),
    ).toEqual([
      ["Zqtl Cola", 1, "exact"],
      ["Zqtl Cola", 2, "exact"],
      ["Zqtl Cola", 3, "exact"],
    ]);
    const lineCalls = calls.filter((c) => c.fn === "house_till_lines");
    expect(lineCalls).toHaveLength(1);
    expect(new Set(lineCalls[0].args.p_names as string[])).toEqual(
      new Set(["Zqtl Cola", "Zqtl Cola\t", "Zqtl Cola\u00a0"]),
    );
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

  it("reads the lines of a name the ledger joined without the row's maker, as a loose match (ADR 0301, F1 of 2026-10-06)", async () => {
    // The founder's answer: "If a till name holds none of a row's full words,
    // try the row's name without the maker, under the same most-specific and
    // tie rules." A menu that carries producers keys 'Anadolu Efes' + 'Efes
    // Pilsen', and the till rings 'Efes Pilsen (draft 400ml)'. The ledger
    // says 'without_maker'; the record reads its lines and shows the match
    // as loose, which it is. Before this, the record dropped the name, so the
    // record listed none of the lines its Sold cell counted.
    const { service, calls } = await tillService(
      [
        tillLine(1, "Efes Pilsen (draft 400ml)", 4, 10),
        tillLine(2, "Efes Pilsen", 2, 9),
      ],
      {},
      {
        "Anadolu Efes Efes Pilsen": [
          ["Efes Pilsen", "without_maker"],
          ["Efes Pilsen (draft 400ml)", "without_maker"],
        ],
      },
    );
    const out = await service.readRowRecord(RID, "Anadolu Efes Efes Pilsen");
    const pos = out.books.find((b) => b.book === "pos");
    expect(pos?.readable).toBe(true);
    expect(pos?.rows).toBe(2);
    expect(
      pos?.ledger.map((e) => [e.label, e.qty, e.matchedBy]).sort(),
    ).toEqual([
      ["Efes Pilsen (draft 400ml)", 4, "contains"],
      ["Efes Pilsen", 2, "contains"],
    ]);
    expect(pos?.tied).toEqual([]);
    const lineCalls = calls.filter((c) => c.fn === "house_till_lines");
    expect(lineCalls).toHaveLength(1);
    expect(new Set(lineCalls[0].args.p_names as string[])).toEqual(
      new Set(["Efes Pilsen", "Efes Pilsen (draft 400ml)"]),
    );
  });

  it("lists the till names that tied on the row, reads none of their lines, and says why its Sold is short (ADR 0301, F2 of 2026-10-06)", async () => {
    // The founder's answer: "Each tied row's record lists the till names that
    // tied, so the owner sees why its Sold is short and can fix the menu
    // name. The lines still join neither row."
    const lines = [
      tillLine(1, "Lal Rosé", 1, 40),
      tillLine(2, "Lal Rosé Kavak (glass)", 1, 12),
      tillLine(3, "Lal Rosé Kavak (glass)", 2, 12),
      tillLine(4, "Lal Rosé Kavak Magnum", 1, 90),
    ];
    const tiedOnly = await tillService(
      lines,
      {},
      {
        "Lal Kavak": [
          ["Lal Rosé Kavak (glass)", "tie"],
          ["Lal Rosé Kavak Magnum", "tie"],
        ],
      },
    );
    const onlyRec = await tiedOnly.service.readRowRecord(RID, "Lal Kavak");
    const only = onlyRec.books.find((b) => b.book === "pos");
    // No line counts on this row, so the record has no lines, and its words
    // say why, naming each tied name and its lines.
    expect(only?.readable).toBe(true);
    expect(only?.rows).toBe(0);
    expect(only?.ledger).toEqual([]);
    expect(only?.tied).toEqual([
      { name: "Lal Rosé Kavak (glass)", lines: 2 },
      { name: "Lal Rosé Kavak Magnum", lines: 1 },
    ]);
    expect(only?.reason).toContain("'Lal Rosé Kavak (glass)' (2 lines)");
    expect(only?.reason).toContain("'Lal Rosé Kavak Magnum' (1 line)");
    expect(only?.reason).toContain("counted on neither");
    expect(only?.reason).not.toContain("The till has not rung this up");
    // Said once: the book's reason names them, the match rule does not repeat it.
    expect(onlyRec.matchRule).not.toContain("Lal Rosé Kavak");
    // Their lines are never read: the record lists only what Sold counts.
    expect(
      tiedOnly.calls.filter((c) => c.fn === "house_till_lines"),
    ).toHaveLength(0);

    // A row that also counts a name reads that name's lines only, and still
    // lists the tie.
    const both = await tillService(
      lines,
      {},
      {
        "Lal Rosé": [
          ["Lal Rosé", "exact"],
          ["Lal Rosé Kavak (glass)", "tie"],
        ],
      },
    );
    const bothRec = await both.service.readRowRecord(RID, "Lal Rosé");
    const pos = bothRec.books.find((b) => b.book === "pos");
    expect(pos?.rows).toBe(1);
    // The book shows its reason only when it has no line, so the record's
    // last sentence names the tie instead.
    expect(bothRec.matchRule).toContain(
      "counted on neither: 'Lal Rosé Kavak (glass)' (2 lines).",
    );
    expect(pos?.ledger.map((e) => [e.label, e.qty, e.matchedBy])).toEqual([
      ["Lal Rosé", 1, "exact"],
    ]);
    expect(pos?.tied).toEqual([{ name: "Lal Rosé Kavak (glass)", lines: 2 }]);
    const lineCalls = both.calls.filter((c) => c.fn === "house_till_lines");
    expect(lineCalls).toHaveLength(1);
    expect(lineCalls[0].args.p_names).toEqual(["Lal Rosé"]);
  });

  it("gives a catalogue-only row's record no till lines, though the till rang a name holding its label (ADR 0301, F5 of 2026-10-06)", async () => {
    // The founder's answer, "Keep one rule": "The record lists exactly the
    // lines its Sold counts, so the two never disagree. A catalogue-only row
    // shows no till lines." No book of the house names 'Kalecik Karası', so
    // the ledger counts no name on it and house_till_names returns none. The
    // record must not fall back to matching names itself (matchLine would
    // find 'Kalecik Karası (glass)' as 'contains').
    const { service, calls } = await tillService([
      tillLine(1, "Kalecik Karası (glass)", 3, 11),
    ]);
    const out = await service.readRowRecord(RID, "Kalecik Karası");
    const pos = out.books.find((b) => b.book === "pos");
    expect(pos?.readable).toBe(true);
    expect(pos?.rows).toBe(0);
    expect(pos?.ledger).toEqual([]);
    expect(pos?.tied).toEqual([]);
    // One read, by this row's label; never the till's whole name list.
    const names = calls.filter((c) => c.fn === "house_till_names");
    expect(names).toHaveLength(1);
    expect(names[0].args).toEqual({
      p_restaurant_id: RID,
      p_label: "Kalecik Karası",
    });
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
    // [CHANGED 2026-10-05: the per-row house_till_names is in migration
    // a_till_name_with_a_serve_size_joins_its_row. Was:
    // the_cellar_reads_the_tills_own_record.]
    expect(pos?.reason).toContain(
      "a_till_name_with_a_serve_size_joins_its_row",
    );
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
