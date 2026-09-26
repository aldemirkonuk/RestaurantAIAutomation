import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { CellarRegistersService } from "./cellar-registers.service";

/**
 * The service half: which SOURCE a register's answer came from, and — the part
 * that matters most — what happens when a source cannot be read at all.
 *
 * The failure this file exists to prevent is the one the project memory calls
 * `absence reported as health`: a table that is not on this database yet
 * answering "nobody has said they carry beer", which is indistinguishable from
 * a house that answered "no". On the local gateway that failure is not
 * hypothetical — `restaurant_cellar_registers` does not exist on the database
 * the dev server points at until the migration lands, and the endpoint was
 * curl-verified against exactly that state.
 */

type TableResult = { data?: unknown[]; error?: unknown; count?: number };

/**
 * A thenable that answers every PostgREST chain method with itself, so the
 * builder can be driven the way the service drives it without pinning the exact
 * call order — which is a detail of the query, not of the behaviour under test.
 */
function chain(result: TableResult) {
  const self: Record<string, unknown> = {};
  const passthrough = () => self;
  for (const m of [
    "select", "eq", "neq", "is", "in", "or", "ilike", "gte", "lte", "order", "limit", "range", "not",
  ]) {
    self[m] = jest.fn(passthrough);
  }
  self.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({
      data: result.data ?? null,
      error: result.error ?? null,
      count: result.count ?? null,
    }).then(resolve);
  return self;
}

function dbWith(tables: Record<string, TableResult>, upsert?: jest.Mock) {
  return {
    getClient: () => ({
      from: (table: string) => {
        const built = chain(tables[table] ?? { data: [] });
        built.upsert = upsert ?? jest.fn(async () => ({ error: null }));
        return built;
      },
    }),
  };
}

const RID = "550e8400-e29b-41d4-a716-446655440000";

async function serviceWith(
  tables: Record<string, TableResult>,
  upsert?: jest.Mock,
): Promise<CellarRegistersService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      CellarRegistersService,
      { provide: DatabaseService, useValue: dbWith(tables, upsert) },
    ],
  }).compile();
  return moduleRef.get(CellarRegistersService);
}

describe("CellarRegistersService.read", () => {
  it("reports an ABSENT answers table as unreadable, not as 'nobody answered'", async () => {
    const service = await serviceWith({
      restaurant_cellar_registers: {
        error: { code: "42P01", message: 'relation "restaurant_cellar_registers" does not exist' },
      },
      restaurant_inventory: {
        data: [{ wine_name: "Sierra Nevada Pale Ale", master_wine_library: { beverage_kind: "beer", name: "Pale Ale", primary_type: null } }],
      },
      menu_items: { data: [] },
      cocktails: { count: 0 },
    });

    const out = await service.read(RID);
    expect(out.sources.answers.readable).toBe(false);
    expect(out.sources.answers.reason).toContain("migration has not been applied");
    // Crucially: rows is null, not 0. "We could not ask" is not "the answer is none".
    expect(out.sources.answers.rows).toBeNull();
    // And "has this house confirmed?" is returned as UNKNOWN, not as "no" —
    // answering `false` here would suppress the onboarding step on every
    // database where the migration has not landed.
    expect(out.awaitingConfirmation).toBeNull();
    expect(out.decidedBy).toBe("inferred");
  });

  it("counts one row once per register, even when two signals point at it", async () => {
    // Caught live against the dev gateway: 50 inventory rows reported
    // `inventoryRows: 100` for Wines, because a bottle classified `wine` whose
    // name also said "Red" was credited twice.
    const service = await serviceWith({
      restaurant_cellar_registers: { data: [] },
      restaurant_inventory: {
        data: [
          { wine_name: "Barolo Red", master_wine_library: { beverage_kind: "wine", name: "Barolo", primary_type: "red" } },
          { wine_name: "Chablis White", master_wine_library: { beverage_kind: "wine", name: "Chablis", primary_type: "white" } },
        ],
      },
      menu_items: { data: [] },
      cocktails: { count: 0 },
    });
    const out = await service.read(RID);
    const wines = out.registers.find((r) => r.id === "wines")!;
    expect(wines.evidence.inventoryRows).toBe(2);
    expect(out.sources.inventory.rows).toBe(2);
  });

  it("infers from the cellar's own classified rows and lists only what is carried", async () => {
    const service = await serviceWith({
      restaurant_cellar_registers: { data: [] },
      restaurant_inventory: {
        data: [
          { wine_name: null, master_wine_library: { beverage_kind: "wine", name: "Chablis", primary_type: "white" } },
          { wine_name: null, master_wine_library: { beverage_kind: "wine", name: "Barolo", primary_type: "red" } },
          { wine_name: null, master_wine_library: { beverage_kind: "beer", name: "Efes", primary_type: null } },
        ],
      },
      menu_items: { data: [] },
      cocktails: { count: 0 },
    });

    const out = await service.read(RID);
    expect(out.carried.sort()).toEqual(["beer", "wines"]);
    expect(out.awaitingConfirmation).toBe(true);
    expect(out.sources.inventory.rows).toBe(3);
  });

  it("handles the embedded library row arriving as a one-element array", async () => {
    // PostgREST returns an embedded to-one either way depending on the
    // relationship shape. Assuming one produced a silent zero here.
    const service = await serviceWith({
      restaurant_cellar_registers: { data: [] },
      restaurant_inventory: {
        data: [{ wine_name: null, master_wine_library: [{ beverage_kind: "spirit", name: "Yeni Raki", primary_type: null }] }],
      },
      menu_items: { data: [] },
      cocktails: { count: 0 },
    });
    const out = await service.read(RID);
    expect(out.carried).toContain("spirits");
  });

  it("excludes a discarded menu_items row from the register inference read (migration 20260922230200)", async () => {
    // The `chain()` fake does not itself filter by the predicates the service
    // applies — it always answers with the table's configured `data`
    // regardless — so the thing this test can actually prove is that the
    // service ASKS for `status <> 'discarded'` on `menu_items`, the same
    // predicate `getMenu` already applies and the ledger/beverages readers
    // gained alongside this fix.
    const menuChain = chain({ data: [{ category: null, name: "Draft Cola" }] });
    const service = await (
      await Test.createTestingModule({
        providers: [
          CellarRegistersService,
          {
            provide: DatabaseService,
            useValue: {
              getClient: () => ({
                from: (table: string) =>
                  table === "menu_items"
                    ? menuChain
                    : chain(table === "cocktails" ? { count: 0 } : { data: [] }),
              }),
            },
          },
        ],
      }).compile()
    ).get(CellarRegistersService);

    await service.read(RID);
    expect(menuChain.neq).toHaveBeenCalledWith("status", "discarded");
  });

  it("reports sake and cider rather than folding them into a neighbouring register", async () => {
    const service = await serviceWith({
      restaurant_cellar_registers: { data: [] },
      restaurant_inventory: {
        data: [
          { wine_name: null, master_wine_library: { beverage_kind: "sake", name: "Dassai 45", primary_type: null } },
          { wine_name: null, master_wine_library: { beverage_kind: "cider", name: "Somersby", primary_type: null } },
        ],
      },
      menu_items: { data: [] },
      cocktails: { count: 0 },
    });
    const out = await service.read(RID);
    expect(out.unmappedKinds).toEqual({ sake: 1, cider: 1 });
    expect(out.carried).toEqual([]);
  });

  it("returns the reading count off the SAME menu read the registers were inferred from", async () => {
    // The founder's 2026-09-22 decision keeps three numbers on the reveal, and
    // `notPlaced` is the one no read returned before. It has to be derived from
    // the register reader's own pass — not from a second count of the menu —
    // or the reveal's headline can disagree with the registers under it.
    const service = await serviceWith({
      restaurant_cellar_registers: { data: [] },
      restaurant_inventory: { data: [] },
      menu_items: {
        data: [
          { category: "Wines by the glass", name: "Barolo" },
          { category: "Wines by the glass", name: "Chablis" },
          { category: "Draft Beer", name: "Efes" },
          { category: "Kitchen", name: "Mixed olives" },
          { category: null, name: "Today's plate" },
        ],
      },
      cocktails: { count: 0 },
    });

    const out = await service.read(RID);
    expect(out.menuLines).toEqual({ read: 5, placed: 3, notPlaced: 2 });
    // The same pass: the placed lines are exactly the lines credited to a
    // register below, so the headline cannot drift from the body.
    expect(out.sources.menu.rows).toBe(5);
    expect(out.registers.find((r) => r.id === "wines")!.evidence.menuRows).toBe(2);
    expect(out.registers.find((r) => r.id === "beer")!.evidence.menuRows).toBe(1);
  });

  it("leaves the reading count NULL — never zeroes — when the menu could not be read", async () => {
    // "0 lines read, 0 placed, 0 not placed" over a failed read is the same
    // absence-reported-as-health failure this file exists to prevent.
    const service = await serviceWith({
      restaurant_cellar_registers: { data: [] },
      restaurant_inventory: { data: [] },
      menu_items: { error: { code: "57014", message: "statement timeout" } },
      cocktails: { count: 0 },
    });
    const out = await service.read(RID);
    expect(out.sources.menu.readable).toBe(false);
    expect(out.menuLines).toBeNull();
  });

  it("reports an empty but readable menu as zero lines read", async () => {
    const service = await serviceWith({
      restaurant_cellar_registers: { data: [] },
      restaurant_inventory: { data: [] },
      menu_items: { data: [] },
      cocktails: { count: 0 },
    });
    const out = await service.read(RID);
    expect(out.menuLines).toEqual({ read: 0, placed: 0, notPlaced: 0 });
  });

  it("a house with nothing in any book gets UNKNOWN on every register, not false", async () => {
    const service = await serviceWith({
      restaurant_cellar_registers: { data: [] },
      restaurant_inventory: { data: [] },
      menu_items: { data: [] },
      cocktails: { count: 0 },
    });
    const out = await service.read(RID);
    expect(out.decidedBy).toBe("unknown");
    expect(out.carried).toEqual([]);
    expect(out.registers.every((r) => r.carried === null)).toBe(true);
  });

  it("a stored confirmation wins, and a manual-on with no rows raises needsEvidence", async () => {
    const service = await serviceWith({
      restaurant_cellar_registers: {
        data: [
          { register: "wines", carried: true, source: "confirmed", confirmed_at: "2026-09-03T10:00:00Z" },
          { register: "whiskey", carried: true, source: "manual", confirmed_at: "2026-09-03T11:00:00Z" },
          { register: "beer", carried: false, source: "confirmed", confirmed_at: "2026-09-03T10:00:00Z" },
        ],
      },
      restaurant_inventory: {
        data: [
          { wine_name: null, master_wine_library: { beverage_kind: "wine", name: "Chablis", primary_type: "white" } },
          { wine_name: null, master_wine_library: { beverage_kind: "beer", name: "Efes", primary_type: null } },
        ],
      },
      menu_items: { data: [] },
      cocktails: { count: 0 },
    });

    const out = await service.read(RID);
    expect(out.carried.sort()).toEqual(["whiskey", "wines"]);
    expect(out.needsEvidence).toEqual(["whiskey"]);
    expect(out.awaitingConfirmation).toBe(false);
    expect(out.decidedBy).toBe("mixed");
    const beer = out.registers.find((r) => r.id === "beer")!;
    expect(beer.carried).toBe(false);
    expect(beer.basis).toContain("overrides the books");
  });

  it("lists the registers that are off with this house's items still behind them", async () => {
    const service = await serviceWith({
      restaurant_cellar_registers: {
        data: [
          { register: "wines", carried: true, source: "confirmed", confirmed_at: "2026-09-03T10:00:00Z" },
          { register: "beer", carried: false, source: "manual", confirmed_at: "2026-09-30T10:00:00Z" },
        ],
      },
      restaurant_inventory: {
        data: [
          { wine_name: null, master_wine_library: { beverage_kind: "wine", name: "Chablis", primary_type: "white" } },
          { wine_name: null, master_wine_library: { beverage_kind: "beer", name: "Efes", primary_type: null } },
          { wine_name: null, master_wine_library: { beverage_kind: "beer", name: "Bomonti", primary_type: null } },
        ],
      },
      menu_items: { data: [] },
      cocktails: { count: 0 },
    });
    const out = await service.read(RID);
    expect(out.carried).toEqual(["wines"]);
    expect(out.stranded).toEqual(["beer"]);
    expect(out.registers.find((r) => r.id === "beer")!.strandedItems).toBe(2);
    // and the wine register, which is ON, strands nothing
    expect(out.registers.find((r) => r.id === "wines")!.strandedItems).toBe(0);
  });

  it("ignores a source value this build does not know rather than treating it as an answer", async () => {
    const service = await serviceWith({
      restaurant_cellar_registers: {
        data: [{ register: "beer", carried: false, source: "imported", confirmed_at: null }],
      },
      restaurant_inventory: {
        data: [{ wine_name: null, master_wine_library: { beverage_kind: "beer", name: "Efes", primary_type: null } }],
      },
      menu_items: { data: [] },
      cocktails: { count: 0 },
    });
    const out = await service.read(RID);
    expect(out.carried).toEqual(["beer"]);
    expect(out.registers.find((r) => r.id === "beer")!.decidedBy).toBe("inferred");
  });
});

describe("CellarRegistersService.write", () => {
  const readable = {
    restaurant_cellar_registers: { data: [] },
    restaurant_inventory: {
      data: [{ wine_name: null, master_wine_library: { beverage_kind: "wine", name: "Chablis", primary_type: "white" } }],
    },
    menu_items: { data: [] },
    cocktails: { count: 0 },
  };

  it("stamps confirmed_at and the JWT's user, and snapshots what the machine said", async () => {
    const upsert = jest.fn(async (..._a: unknown[]) => ({ error: null }));
    const service = await serviceWith(readable, upsert);

    await service.write(
      RID,
      { registers: [{ id: "wines", carried: true }], source: "confirmed" },
      "b79f9d94-b1ba-4b74-bd92-32df08421bf1",
    );

    const rows = upsert.mock.calls[0][0] as unknown as Array<Record<string, unknown>>;
    expect(rows[0].source).toBe("confirmed");
    expect(rows[0].confirmed_at).toEqual(expect.any(String));
    expect(rows[0].confirmed_by).toBe("b79f9d94-b1ba-4b74-bd92-32df08421bf1");
    // The evidence is the machine's own answer, recorded by the machine.
    expect(rows[0].evidence).toMatchObject({ carried: true, confidence: "certain" });
  });

  it("leaves confirmed_at null for a recorded proposal, matching the CHECK constraint", async () => {
    const upsert = jest.fn(async (..._a: unknown[]) => ({ error: null }));
    const service = await serviceWith(readable, upsert);
    await service.write(RID, { registers: [{ id: "beer", carried: false }], source: "inferred" }, "u1");
    const rows = upsert.mock.calls[0][0] as unknown as Array<Record<string, unknown>>;
    expect(rows[0].confirmed_at).toBeNull();
    expect(rows[0].confirmed_by).toBeNull();
  });

  it("THROWS when the write fails — it never returns the readout as if it had landed", async () => {
    const upsert = jest.fn(async () => ({
      error: { code: "42P01", message: 'relation "restaurant_cellar_registers" does not exist' },
    }));
    const service = await serviceWith(readable, upsert);
    await expect(
      service.write(RID, { registers: [{ id: "wines", carried: true }], source: "confirmed" }, null),
    ).rejects.toThrow(/was not recorded/);
  });
});

/**
 * OD-140 — `GET /cellar/:id/registers/unplaced` (founder 2026-09-25:
 * "Separate list endpoint", with a test that pins count and list to the same
 * `placeMenuLine` rule so they cannot drift). The anti-drift test the founder
 * asked for is the first one: for the SAME menu, the readout's `notPlaced` and
 * the list's length are one number.
 */
describe("CellarRegistersService.readUnplaced", () => {
  const MENU = [
    { id: "m-1", category: "Wines by the glass", name: "Barolo" },
    { id: "m-2", category: "Draft Beer", name: "Efes" },
    { id: "m-3", category: "Kitchen", name: "Mixed olives" },
    { id: "m-4", category: null, name: "Today's plate" },
    { id: "m-5", category: "House Selection", name: "Draft Lager" },
    { id: "m-6", category: "Signature Cocktails", name: "Merlot Sour" },
    { id: "m-7", category: "House Selection", name: "Grilled halloumi" },
  ];

  const tablesFor = (menu: TableResult): Record<string, TableResult> => ({
    restaurant_cellar_registers: { data: [] },
    restaurant_inventory: { data: [] },
    menu_items: menu,
    cocktails: { count: 0 },
  });

  it("returns as many lines as the readout counts not placed — for the same menu", async () => {
    const service = await serviceWith(tablesFor({ data: MENU }));
    const readout = await service.read(RID);
    const unplaced = await service.readUnplaced(RID);

    expect(readout.menuLines).not.toBeNull();
    expect(unplaced.lines.length).toBe(readout.menuLines!.notPlaced);
    expect(unplaced.read).toBe(readout.menuLines!.read);
    expect(unplaced.lines.map((l) => l.id)).toEqual(["m-3", "m-4", "m-7"]);
    expect(unplaced.restaurantId).toBe(RID);
  });

  it("sends only the id, section and name of each line", async () => {
    const service = await serviceWith(
      tablesFor({ data: [{ id: "m-9", category: "Kitchen", name: "Bread", menu_id: "x", by_glass_price: 4 }] }),
    );
    const unplaced = await service.readUnplaced(RID);
    expect(unplaced.lines).toEqual([{ id: "m-9", category: "Kitchen", name: "Bread" }]);
  });

  it("reads the menu with the SAME query the readout's count is taken from", async () => {
    // Recording db: every call made on the menu_items builder, per request.
    const calls: Array<Array<[string, unknown[]]>> = [];
    const recording = {
      getClient: () => ({
        from: (table: string) => {
          const result = table === "menu_items" ? { data: MENU } : table === "cocktails" ? { count: 0 } : { data: [] };
          const built = chain(result);
          if (table === "menu_items") {
            const log: Array<[string, unknown[]]> = [];
            calls.push(log);
            for (const m of ["select", "eq", "neq", "order", "is", "in"]) {
              const inner = built[m] as jest.Mock;
              built[m] = jest.fn((...args: unknown[]) => {
                log.push([m, args]);
                return inner(...args);
              });
            }
          }
          return built;
        },
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [CellarRegistersService, { provide: DatabaseService, useValue: recording }],
    }).compile();
    const service = moduleRef.get(CellarRegistersService);

    await service.read(RID);
    await service.readUnplaced(RID);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    // …and that query is the house's own, without its discarded lines.
    expect(calls[0]).toContainEqual(["eq", ["restaurant_id", RID]]);
    expect(calls[0]).toContainEqual(["neq", ["status", "discarded"]]);
  });

  it("returns an empty list when the reader placed every line", async () => {
    const service = await serviceWith(tablesFor({ data: [MENU[0], MENU[1]] }));
    const unplaced = await service.readUnplaced(RID);
    expect(unplaced).toEqual({ restaurantId: RID, read: 2, lines: [] });
  });

  it("THROWS when the menu cannot be read — never an empty list", async () => {
    // An empty list says "the reader placed every line". Over a failed read
    // that is the absence-reported-as-health failure this file refuses.
    const service = await serviceWith(
      tablesFor({ error: { code: "57014", message: "statement timeout" } }),
    );
    await expect(service.readUnplaced(RID)).rejects.toThrow(/could not be read.*statement timeout/);
  });
});
