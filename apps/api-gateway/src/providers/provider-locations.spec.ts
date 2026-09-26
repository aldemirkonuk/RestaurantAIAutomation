import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
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
 *   2. A demotion that fails stops the write — its error used to be ignored.
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
  table: string;
  op: "select" | "update" | "delete" | "insert";
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

  const service = new ProvidersService(
    { supabase: { from } } as never,
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

  it("a demotion that fails stops the write and says so", async () => {
    const db = makeDb([branch("hq", { is_primary: true }), branch("depot")], {
      fail: [{ table: "provider_locations", op: "update", nth: 1 }],
    });
    await expect(
      db.service.updateProviderLocation(VENDOR, "depot", HOUSE, {
        isPrimary: true,
      }),
    ).rejects.toMatchObject({ message: "update refused" });
    const depot = db.tables.provider_locations.find((r) => r.id === "depot");
    expect(depot?.is_primary).toBe(false);
  });

  it("POST primary with a failing demotion inserts nothing", async () => {
    const db = makeDb([branch("hq", { is_primary: true })], {
      fail: [{ table: "provider_locations", op: "update" }],
    });
    await expect(
      db.service.createProviderLocation(VENDOR, HOUSE, {
        name: "Depot",
        isPrimary: true,
      }),
    ).rejects.toMatchObject({ message: "update refused" });
    expect(db.calls.filter((c) => c.op === "insert")).toEqual([]);
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
    expect(out).toEqual({ promotedId: "depot", promotionFailed: false });
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
    expect(out).toEqual({ promotedId: null, promotionFailed: false });
    expect(db.calls.filter((c) => c.op === "update")).toEqual([]);
  });

  it("removing the last branch promotes nothing", async () => {
    const db = makeDb([branch("hq", { is_primary: true })]);
    const out = await db.service.deleteProviderLocation(VENDOR, "hq", HOUSE);
    expect(out).toEqual({ promotedId: null, promotionFailed: false });
    expect(db.tables.provider_locations).toEqual([]);
  });

  it("a failed promotion keeps the removal and says the mark went nowhere", async () => {
    const db = makeDb(
      [
        branch("hq", { is_primary: true, created_at: "1" }),
        branch("depot", { created_at: "2" }),
      ],
      { fail: [{ table: "provider_locations", op: "update" }] },
    );
    const out = await db.service.deleteProviderLocation(VENDOR, "hq", HOUSE);
    expect(out).toEqual({ promotedId: null, promotionFailed: true });
    expect(db.tables.provider_locations.map((r) => r.id)).toEqual(["depot"]);
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
