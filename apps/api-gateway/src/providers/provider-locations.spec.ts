import "reflect-metadata";
import {
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ProvidersService } from "./providers.service";
import {
  CreateProviderLocationDto,
  UpdateProviderLocationDto,
} from "./dto/providers.dto";

/**
 * A vendor's branches (founder, 2026-09-26, round 8, item 51 — ADR 0221).
 *
 * The routes were already house-scoped (`provider-subresources-are-house-
 * scoped.spec.ts` pins the foreign-id and no-house cases). These are the write
 * rules the Mudavym sheet depends on, each one a defect the legacy sheet hid
 * because it re-synced every row on every save:
 *
 *   1. A PATCH with a stale branch id is 404 and changes NOTHING — it used to
 *      clear the primary mark off the vendor's real branch first.
 *   2. The primary mark moves ONLY through the one-transaction functions of
 *      migration a_vendor_has_one_primary_branch (`provider_location_make_
 *      primary`, `provider_location_remove`) — never as separate PostgREST
 *      writes, which could interleave and leave two primaries or none (audit
 *      of #484 at d44056b42, R4). A move that fails writes nothing. The
 *      functions' own SQL is proved against the whole migration corpus in
 *      PGlite (PR #484 body); the fake below models what they promise.
 *   3. A different address with no point clears the old point — it used to
 *      keep the coordinates Google resolved for the previous address. The
 *      same address resent keeps it.
 *   4. A DELETE that matched nothing is 404 — it used to answer success.
 *   5. Removing the primary hands the mark to the oldest remaining branch, the
 *      legacy sheet's own rule, and says which one.
 *   6. The DTO refuses a type the table's CHECK would refuse, and an empty name.
 */

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_HOUSE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VENDOR = "11111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;

interface Fail {
  /** A table, or "rpc" for the two SQL functions. */
  table: string;
  /** For "rpc", the function name. */
  op: string;
  /** Fail only the n-th call of that (table, op), 1-based. Default: every. */
  nth?: number;
}

function makeDb(
  locations: Row[],
  opts: { fail?: Fail[] } = {},
) {
  const tables: Record<string, Row[]> = {
    providers: [
      { id: VENDOR, name: "Sheena Wines", restaurant_id: HOUSE },
    ],
    provider_locations: locations.map((r) => ({ ...r })),
  };
  const calls: { table: string; op: string; payload?: Row }[] = [];
  const counts = new Map<string, number>();

  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let op: "select" | "update" | "delete" | "insert" = "select";
    let patch: Row = {};
    let lim: number | null = null;
    let sortCol: string | null = null;
    const q: Record<string, unknown> = {};

    const failed = () => {
      const key = `${table}:${op}`;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return (opts.fail ?? []).some(
        (f) => f.table === table && f.op === op && (f.nth ?? n) === n,
      );
    };
    const run = () => {
      calls.push({ table, op, payload: op === "update" ? patch : undefined });
      if (failed()) {
        return { data: null, error: { code: "XX000", message: `${op} refused` } };
      }
      if (sortCol) {
        const c = sortCol;
        rows.sort((a, b) => String(a[c]).localeCompare(String(b[c])));
      }
      if (lim !== null) rows = rows.slice(0, lim);
      if (op === "update") for (const r of rows) Object.assign(r, patch);
      if (op === "delete") {
        tables[table] = tables[table].filter((r) => !rows.includes(r));
      }
      return { data: rows, error: null };
    };

    q.select = () => q;
    q.eq = (c: string, v: unknown) => {
      rows = rows.filter((r) => r[c] === v);
      return q;
    };
    q.neq = (c: string, v: unknown) => {
      rows = rows.filter((r) => r[c] !== v);
      return q;
    };
    q.order = (c: string) => {
      // Only the ascending created_at order matters to these rules.
      if (c === "created_at") sortCol = c;
      return q;
    };
    q.limit = (n: number) => {
      lim = n;
      return q;
    };
    q.update = (p: Row) => {
      op = "update";
      patch = p;
      return q;
    };
    q.delete = () => {
      op = "delete";
      return q;
    };
    q.insert = (p: Row) => {
      op = "insert";
      const row = { id: `new-${tables[table].length + 1}`, ...p };
      calls.push({ table, op, payload: p });
      if (failed()) {
        rows = [];
        q.single = () =>
          Promise.resolve({
            data: null,
            error: { code: "XX000", message: "insert refused" },
          });
        return q;
      }
      tables[table].push(row);
      rows = [row];
      return q;
    };
    q.maybeSingle = () => {
      const r = run();
      return Promise.resolve(
        r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null },
      );
    };
    q.single = () => {
      const r = run();
      return Promise.resolve(
        r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null },
      );
    };
    (q as { then: typeof Promise.prototype.then }).then = (ok, bad) =>
      Promise.resolve(run()).then(ok, bad);
    return q;
  };

  // The two SQL functions, as the migration defines them: one transaction
  // each, so a failure writes nothing.
  const rpc = (name: string, args: Record<string, string>) => {
    calls.push({ table: "rpc", op: name, payload: args });
    const key = `rpc:${name}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (
      (opts.fail ?? []).some(
        (f) => f.table === "rpc" && f.op === name && (f.nth ?? n) === n,
      )
    ) {
      return Promise.resolve({
        data: null,
        error: { code: "XX000", message: `${name} refused` },
      });
    }
    const mine = (r: Row) =>
      r.provider_id === args.p_provider_id &&
      r.restaurant_id === args.p_restaurant_id;
    const rows = tables.provider_locations;
    const target = rows.find((r) => r.id === args.p_location_id && mine(r));
    if (name === "provider_location_make_primary") {
      if (!target) return Promise.resolve({ data: false, error: null });
      for (const r of rows) if (mine(r)) r.is_primary = r === target;
      return Promise.resolve({ data: true, error: null });
    }
    if (name === "provider_location_remove") {
      if (!target) {
        return Promise.resolve({
          data: { removed: false, promotedId: null },
          error: null,
        });
      }
      tables.provider_locations = rows.filter((r) => r !== target);
      let promotedId: string | null = null;
      const left = tables.provider_locations.filter(mine);
      if (target.is_primary && !left.some((r) => r.is_primary)) {
        const next = [...left].sort((a, b) =>
          String(a.created_at).localeCompare(String(b.created_at)),
        )[0];
        if (next) {
          next.is_primary = true;
          promotedId = String(next.id);
        }
      }
      return Promise.resolve({
        data: { removed: true, promotedId },
        error: null,
      });
    }
    throw new Error(`fake has no function ${name}`);
  };

  const service = new ProvidersService(
    { supabase: { from, rpc } } as never,
    { track: async () => undefined } as never,
    {} as never,
  );
  return { service, tables, calls };
}

const branch = (id: string, extra: Row = {}): Row => ({
  id,
  provider_id: VENDOR,
  restaurant_id: HOUSE,
  name: id,
  type: "office",
  address: null,
  is_primary: false,
  latitude: null,
  longitude: null,
  geocoded_at: null,
  geocode_source: null,
  ...extra,
});

describe("a vendor's branches — write rules", () => {
  it("PATCH with a stale branch id is 404 and leaves the primary mark where it was", async () => {
    const db = makeDb([branch("hq", { is_primary: true })]);
    await expect(
      db.service.updateProviderLocation(VENDOR, "gone", HOUSE, {
        isPrimary: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.tables.provider_locations[0].is_primary).toBe(true);
    expect(db.calls.filter((c) => c.op === "update")).toEqual([]);
  });

  it("PATCH another house's branch through this house's vendor is 404 and writes nothing", async () => {
    const db = makeDb([
      branch("hq", { is_primary: true }),
      branch("theirs", { restaurant_id: OTHER_HOUSE, is_primary: true }),
    ]);
    await expect(
      db.service.updateProviderLocation(VENDOR, "theirs", HOUSE, {
        name: "mine now",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.calls.filter((c) => c.op === "update")).toEqual([]);
  });

  it("making a branch primary clears the mark on the others and keeps it on this one", async () => {
    const db = makeDb([
      branch("hq", { is_primary: true, created_at: "1" }),
      branch("depot", { created_at: "2" }),
    ]);
    const out = await db.service.updateProviderLocation(
      VENDOR,
      "depot",
      HOUSE,
      { isPrimary: true },
    );
    expect(out.isPrimary).toBe(true);
    const byId = Object.fromEntries(
      db.tables.provider_locations.map((r) => [r.id, r.is_primary]),
    );
    expect(byId).toEqual({ hq: false, depot: true });
  });

  it("the mark moves in ONE call to the transaction, never as separate writes", async () => {
    const db = makeDb([
      branch("hq", { is_primary: true, created_at: "1" }),
      branch("depot", { created_at: "2" }),
    ]);
    await db.service.updateProviderLocation(VENDOR, "depot", HOUSE, {
      isPrimary: true,
      name: "Red Hook depot",
    });
    expect(db.calls.filter((c) => c.table === "rpc")).toEqual([
      {
        table: "rpc",
        op: "provider_location_make_primary",
        payload: {
          p_restaurant_id: HOUSE,
          p_provider_id: VENDOR,
          p_location_id: "depot",
        },
      },
    ]);
    // No PostgREST write touches the mark: the rename is the only update.
    const updates = db.calls.filter((c) => c.op === "update");
    expect(updates).toEqual([
      { table: "provider_locations", op: "update", payload: { name: "Red Hook depot" } },
    ]);
  });

  it("a PATCH that only marks primary sends no empty update and answers the row", async () => {
    const db = makeDb([
      branch("hq", { is_primary: true, created_at: "1" }),
      branch("depot", { created_at: "2" }),
    ]);
    const out = await db.service.updateProviderLocation(VENDOR, "depot", HOUSE, {
      isPrimary: true,
    });
    expect(out).toMatchObject({ id: "depot", isPrimary: true });
    expect(db.calls.filter((c) => c.op === "update")).toEqual([]);
  });

  it("a primary move that fails writes nothing and says so", async () => {
    const db = makeDb([branch("hq", { is_primary: true }), branch("depot")], {
      fail: [{ table: "rpc", op: "provider_location_make_primary" }],
    });
    await expect(
      db.service.updateProviderLocation(VENDOR, "depot", HOUSE, {
        isPrimary: true,
        name: "renamed",
      }),
    ).rejects.toMatchObject({
      message: "provider_location_make_primary refused",
    });
    const byId = Object.fromEntries(
      db.tables.provider_locations.map((r) => [r.id, [r.is_primary, r.name]]),
    );
    expect(byId).toEqual({ hq: [true, "hq"], depot: [false, "depot"] });
    expect(db.calls.filter((c) => c.op === "update")).toEqual([]);
  });

  it("a branch removed between the check and the move is 404, not a success", async () => {
    const db = makeDb([branch("hq", { is_primary: true }), branch("depot")]);
    // The move finds no such branch (the function answers false).
    const realFrom = db.tables.provider_locations;
    const svc = db.service as any;
    const rpc = svc.databaseService.supabase.rpc;
    svc.databaseService.supabase.rpc = (name: string, args: any) => {
      db.tables.provider_locations = realFrom.filter((r) => r.id !== "depot");
      return rpc(name, args);
    };
    await expect(
      db.service.updateProviderLocation(VENDOR, "depot", HOUSE, {
        isPrimary: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("POST primary inserts the branch unmarked, then moves the mark in one call", async () => {
    const db = makeDb([branch("hq", { is_primary: true, created_at: "1" })]);
    const out = await db.service.createProviderLocation(VENDOR, HOUSE, {
      name: "Depot",
      isPrimary: true,
    });
    expect(out.isPrimary).toBe(true);
    const insert = db.calls.find((c) => c.op === "insert");
    expect(insert?.payload).toMatchObject({ is_primary: false });
    expect(
      db.calls.filter((c) => c.table === "rpc").map((c) => c.op),
    ).toEqual(["provider_location_make_primary"]);
    const byName = Object.fromEntries(
      db.tables.provider_locations.map((r) => [r.name, r.is_primary]),
    );
    expect(byName).toEqual({ hq: false, Depot: true });
  });

  it("POST primary whose new branch vanished before the move is 404, never 'primary'", async () => {
    const db = makeDb([branch("hq", { is_primary: true })]);
    const svc = db.service as any;
    const rpc = svc.databaseService.supabase.rpc;
    svc.databaseService.supabase.rpc = (name: string, args: any) => {
      db.tables.provider_locations = db.tables.provider_locations.filter(
        (r) => r.id !== args.p_location_id,
      );
      return rpc(name, args);
    };
    await expect(
      db.service.createProviderLocation(VENDOR, HOUSE, {
        name: "Depot",
        isPrimary: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      db.tables.provider_locations.map((r) => [r.id, r.is_primary]),
    ).toEqual([["hq", true]]);
  });

  it("POST primary whose move fails takes the new branch back out and keeps the old primary", async () => {
    const db = makeDb([branch("hq", { is_primary: true })], {
      fail: [{ table: "rpc", op: "provider_location_make_primary" }],
    });
    await expect(
      db.service.createProviderLocation(VENDOR, HOUSE, {
        name: "Depot",
        isPrimary: true,
      }),
    ).rejects.toMatchObject({
      message: "provider_location_make_primary refused",
    });
    expect(
      db.tables.provider_locations.map((r) => [r.id, r.is_primary]),
    ).toEqual([["hq", true]]);
  });

  it("POST primary whose move AND undo fail says the branch is there but not primary", async () => {
    const db = makeDb([branch("hq", { is_primary: true })], {
      fail: [
        { table: "rpc", op: "provider_location_make_primary" },
        { table: "provider_locations", op: "delete" },
      ],
    });
    const err = await db.service
      .createProviderLocation(VENDOR, HOUSE, { name: "Depot", isPrimary: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toMatch(
      /"Depot" was added but could not be made primary.*previous primary branch is unchanged/,
    );
    expect(
      db.tables.provider_locations.filter((r) => r.is_primary).map((r) => r.id),
    ).toEqual(["hq"]);
  });

  it("POST without isPrimary never calls the move", async () => {
    const db = makeDb([branch("hq", { is_primary: true })]);
    const out = await db.service.createProviderLocation(VENDOR, HOUSE, {
      name: "Depot",
    });
    expect(out.isPrimary).toBe(false);
    expect(db.calls.filter((c) => c.table === "rpc")).toEqual([]);
  });

  it("a new typed address with no point clears the point resolved for the old one", async () => {
    const db = makeDb([
      branch("hq", {
        address: "1 Old St",
        latitude: "40.7",
        longitude: "-74.0",
        geocoded_at: "2026-09-01T00:00:00Z",
        geocode_source: "google_places",
      }),
    ]);
    const out = await db.service.updateProviderLocation(VENDOR, "hq", HOUSE, {
      address: "9 New Ave",
    });
    expect(out).toMatchObject({
      address: "9 New Ave",
      latitude: null,
      longitude: null,
      geocodedAt: null,
      geocodeSource: null,
    });
  });

  it("the same address sent again keeps its point", async () => {
    const db = makeDb([
      branch("hq", {
        address: "1 Old St",
        latitude: "40.7",
        longitude: "-74.0",
        geocode_source: "google_places",
      }),
    ]);
    const out = await db.service.updateProviderLocation(VENDOR, "hq", HOUSE, {
      address: "1 Old St",
      name: "HQ",
    });
    expect(out).toMatchObject({ latitude: 40.7, longitude: -74, geocodeSource: "google_places" });
  });

  it("a new address picked with its point stores the point", async () => {
    const db = makeDb([branch("hq", { address: "1 Old St" })]);
    const out = await db.service.updateProviderLocation(VENDOR, "hq", HOUSE, {
      address: "9 New Ave",
      latitude: 41.1,
      longitude: -73.2,
    });
    expect(out).toMatchObject({
      latitude: 41.1,
      longitude: -73.2,
      geocodeSource: "google_places",
    });
  });

  it("a rename alone leaves the point alone", async () => {
    const db = makeDb([
      branch("hq", { latitude: "40.7", longitude: "-74.0", geocode_source: "google_places" }),
    ]);
    const out = await db.service.updateProviderLocation(VENDOR, "hq", HOUSE, {
      name: "Head office",
    });
    expect(out).toMatchObject({ name: "Head office", latitude: 40.7, longitude: -74 });
  });

  it("DELETE of an id that is not this vendor's branch is 404, never success", async () => {
    const db = makeDb([
      branch("hq"),
      branch("theirs", { restaurant_id: OTHER_HOUSE }),
    ]);
    await expect(
      db.service.deleteProviderLocation(VENDOR, "theirs", HOUSE),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.tables.provider_locations.map((r) => r.id)).toEqual([
      "hq",
      "theirs",
    ]);
  });

  it("removing the primary hands the mark to the oldest remaining branch and names it", async () => {
    const db = makeDb([
      branch("hq", { is_primary: true, created_at: "1" }),
      branch("store", { created_at: "3" }),
      branch("depot", { created_at: "2" }),
    ]);
    const out = await db.service.deleteProviderLocation(VENDOR, "hq", HOUSE);
    expect(out).toEqual({ promotedId: "depot" });
    expect(
      db.calls.filter((c) => c.table === "rpc").map((c) => c.op),
    ).toEqual(["provider_location_remove"]);
    expect(db.calls.filter((c) => c.op === "update" || c.op === "delete")).toEqual([]);
    const byId = Object.fromEntries(
      db.tables.provider_locations.map((r) => [r.id, r.is_primary]),
    );
    expect(byId).toEqual({ store: false, depot: true });
  });

  it("removing a branch that was not primary moves nothing", async () => {
    const db = makeDb([
      branch("hq", { is_primary: true, created_at: "1" }),
      branch("depot", { created_at: "2" }),
    ]);
    const out = await db.service.deleteProviderLocation(VENDOR, "depot", HOUSE);
    expect(out).toEqual({ promotedId: null });
    expect(
      db.tables.provider_locations.map((r) => [r.id, r.is_primary]),
    ).toEqual([["hq", true]]);
  });

  it("removing the last branch promotes nothing", async () => {
    const db = makeDb([branch("hq", { is_primary: true })]);
    const out = await db.service.deleteProviderLocation(VENDOR, "hq", HOUSE);
    expect(out).toEqual({ promotedId: null });
    expect(db.tables.provider_locations).toEqual([]);
  });

  it("a removal whose transaction fails removes nothing and says so", async () => {
    const db = makeDb(
      [
        branch("hq", { is_primary: true, created_at: "1" }),
        branch("depot", { created_at: "2" }),
      ],
      { fail: [{ table: "rpc", op: "provider_location_remove" }] },
    );
    await expect(
      db.service.deleteProviderLocation(VENDOR, "hq", HOUSE),
    ).rejects.toMatchObject({ message: "provider_location_remove refused" });
    expect(
      db.tables.provider_locations.map((r) => [r.id, r.is_primary]),
    ).toEqual([
      ["hq", true],
      ["depot", false],
    ]);
  });
});

describe("a vendor's branches — what the body may say", () => {
  const errorsOf = async (cls: new () => object, body: object) =>
    (await validate(plainToInstance(cls, body))).map((e) => e.property);

  it("accepts the four kinds the table admits", async () => {
    for (const type of ["office", "warehouse", "store", "other"]) {
      expect(
        await errorsOf(CreateProviderLocationDto, { name: "x", type }),
      ).toEqual([]);
    }
  });

  it("refuses a fifth kind before the CHECK would", async () => {
    expect(
      await errorsOf(CreateProviderLocationDto, { name: "x", type: "depot" }),
    ).toEqual(["type"]);
    expect(
      await errorsOf(UpdateProviderLocationDto, { type: "depot" }),
    ).toEqual(["type"]);
  });

  it("refuses an empty name on create and on edit", async () => {
    expect(await errorsOf(CreateProviderLocationDto, { name: "" })).toEqual([
      "name",
    ]);
    expect(await errorsOf(UpdateProviderLocationDto, { name: "" })).toEqual([
      "name",
    ]);
  });
});
