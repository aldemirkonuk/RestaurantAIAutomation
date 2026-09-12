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
    "select", "eq", "is", "in", "or", "ilike", "gte", "lte", "order", "limit", "range", "not",
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
