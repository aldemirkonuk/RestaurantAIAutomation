/**
 * The house's time zone and the Jev switch, stated in Settings (ADR 0207,
 * round 3; the founder, 2026-09-21: "Add it to Settings", and on Jev: "this
 * feature can also be disabled").
 *
 * The real SettingsController, the real services, the real
 * OrganizationsService (the role gate) and the real SettingsAuditService run
 * over an in-memory PostgREST double that honours its filters and records
 * every write. Both sides of each rule are exercised.
 */

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SettingsController } from "./settings.controller";
import {
  HouseTimeZoneService,
  notAZoneBecause,
  TIME_ZONE_AUDIT_ACTION,
} from "./house-time-zone.service";
import {
  HouseToneScoringService,
  TONE_SCORING_AUDIT_ACTION,
} from "./house-tone-scoring.service";
import { OrganizationsService } from "../organizations/organizations.service";
import {
  SettingsAuditService,
  SETTINGS_AUDIT_ACTIONS,
} from "../settings-audit/settings-audit.service";

type Row = Record<string, any>;

/**
 * A PostgREST double that HONOURS the filters it is handed (a stub that
 * returned fixed rows would pass with every house clause deleted) and records
 * every write. Per-table failures stand in for a register that refuses.
 */
class FakeQuery {
  private filters: ((r: Row) => boolean)[] = [];
  private rangeFrom = 0;
  private rangeTo: number | null = null;
  private limitN: number | null = null;
  private single = false;
  private orderKey: string | null = null;
  private desc = false;
  private write: {
    kind: "insert" | "upsert" | "update";
    row: Row;
    keys?: string[];
  } | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select() {
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  not(col: string, op: string, v: unknown) {
    if (op !== "is" || v !== null) throw new Error(`fake: not(${col}, ${op})`);
    this.filters.push((r) => (r[col] ?? null) !== null);
    return this;
  }
  ilike(col: string, v: string) {
    this.filters.push(
      (r) => String(r[col] ?? "").toLowerCase() === v.toLowerCase(),
    );
    return this;
  }
  gte(col: string, v: string) {
    this.filters.push((r) => r[col] != null && String(r[col]) >= v);
    return this;
  }
  lte(col: string, v: string) {
    this.filters.push((r) => r[col] != null && String(r[col]) <= v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    if (this.orderKey === null) {
      this.orderKey = col;
      this.desc = opts?.ascending === false;
    }
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  insert(row: Row) {
    this.write = { kind: "insert", row };
    return this;
  }
  upsert(row: Row, opts?: { onConflict?: string }) {
    this.write = { kind: "upsert", row, keys: opts?.onConflict?.split(",") };
    return this;
  }
  update(row: Row) {
    this.write = { kind: "update", row };
    return this;
  }
  then(
    resolve: (v: { data: any; error: any }) => unknown,
    reject?: (e: unknown) => unknown,
  ) {
    try {
      return Promise.resolve(resolve(this.run())).catch(reject);
    } catch (e) {
      return Promise.reject(e).catch(reject);
    }
  }
  private run(): { data: any; error: any } {
    const fail = this.db.failures[this.table];
    if (fail) return { data: null, error: { code: "57014", message: fail } };
    if (this.write) {
      this.db.writes.push({ table: this.table, ...this.write });
      const t = (this.db.tables[this.table] ??= []);
      const w = this.write;
      if (w.kind === "update") {
        for (const r of t)
          if (this.filters.every((f) => f(r))) Object.assign(r, w.row);
      } else if (w.kind === "upsert" && w.keys) {
        const hit = t.find((r) => w.keys!.every((k) => r[k] === w.row[k]));
        if (hit) Object.assign(hit, w.row);
        else t.push({ ...w.row });
      } else t.push({ ...w.row });
      return { data: null, error: null };
    }
    let rows = (this.db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) => f(r)),
    );
    if (this.orderKey) {
      const k = this.orderKey;
      rows = [...rows].sort((a, b) => String(a[k]).localeCompare(String(b[k])));
      if (this.desc) rows.reverse();
    }
    if (this.rangeTo !== null)
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}

class FakeDb {
  tables: Record<string, Row[]> = {};
  failures: Record<string, string> = {};
  writes: { table: string; kind: string; row: Row }[] = [];
  from(table: string) {
    return new FakeQuery(this, table);
  }
  get supabase() {
    return this;
  }
  get client() {
    return this;
  }
  getClient() {
    return this;
  }
}

const A = "house-A";
const B = "house-B";

function make() {
  const db = new FakeDb();
  db.tables.restaurants = [
    {
      id: B,
      timezone: "Asia/Tokyo",
      country: "JP",
      vendor_tone_scoring_enabled: true,
    },
    {
      id: A,
      timezone: null,
      country: "US",
      vendor_tone_scoring_enabled: false,
    },
  ];
  db.tables.user_restaurant_access = [
    { user_id: "owner-a", restaurant_id: A, role: "owner", is_active: true },
    {
      user_id: "manager-a",
      restaurant_id: A,
      role: "manager",
      is_active: true,
    },
    { user_id: "staff-a", restaurant_id: A, role: "staff", is_active: true },
  ];
  db.tables.users = [{ user_id: "owner-a", name: "Owner A" }];
  db.tables.system_audit_log = [];
  const dbs = { client: db, supabase: db, getClient: () => db } as never;
  const audit = new SettingsAuditService(dbs);
  const controller = new SettingsController(
    {} as never,
    {} as never,
    new OrganizationsService(dbs),
    {} as never,
    {} as never,
    new HouseTimeZoneService(dbs, audit),
    new HouseToneScoringService(dbs, audit),
  );
  return { db, controller };
}

const houseA = (db: FakeDb) => db.tables.restaurants.find((r) => r.id === A)!;
const houseB = (db: FakeDb) => db.tables.restaurants.find((r) => r.id === B)!;

describe("PUT /settings/time-zone", () => {
  it("records an owner's or a manager's zone on THIS house, audited with both values", async () => {
    const { db, controller } = make();
    const out = await controller.setHouseTimeZone(
      A,
      { zone: "America/Los_Angeles" },
      "owner-a",
    );
    expect(out).toMatchObject({
      zone: "America/Los_Angeles",
      readable: true,
      audited: true,
    });
    expect(houseA(db).timezone).toBe("America/Los_Angeles");
    expect(houseB(db).timezone).toBe("Asia/Tokyo");
    const row = db.tables.system_audit_log[0];
    expect(row).toMatchObject({
      action: TIME_ZONE_AUDIT_ACTION,
      restaurant_id: A,
      actor_id: "owner-a",
    });
    expect(JSON.stringify(row)).toContain("America/Los_Angeles");
    await controller.setHouseTimeZone(
      A,
      { zone: "Europe/Istanbul" },
      "manager-a",
    );
    expect(houseA(db).timezone).toBe("Europe/Istanbul");
  });

  it("refuses staff with 403 and writes nothing", async () => {
    const { db, controller } = make();
    await expect(
      controller.setHouseTimeZone(A, { zone: "Europe/Istanbul" }, "staff-a"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.writes).toHaveLength(0);
    expect(houseA(db).timezone).toBeNull();
  });

  it("refuses an abbreviation, an offset, a lower-case name, a padded one and an invented one", async () => {
    const { db, controller } = make();
    for (const zone of [
      "EST",
      "+03:00",
      "utc",
      " Europe/Istanbul",
      "Mars/Olympus",
      "",
    ]) {
      await expect(
        controller.setHouseTimeZone(A, { zone }, "owner-a"),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(db.writes).toHaveLength(0);
    expect(notAZoneBecause("UTC")).toBeNull();
    expect(notAZoneBecause("Europe/Istanbul")).toBeNull();
  });

  it("writes nothing when the current zone cannot be read — the trail would record a false 'from'", async () => {
    const { db, controller } = make();
    db.failures.restaurants = "statement timeout";
    await expect(
      controller.setHouseTimeZone(A, { zone: "Europe/Istanbul" }, "owner-a"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.writes).toHaveLength(0);
  });
});

describe("GET /settings/time-zone", () => {
  it("says nobody has stated one (zone null), keeps an unreadable value verbatim, and never reads a failure as empty", async () => {
    const { db, controller } = make();
    expect(await controller.getHouseTimeZone(A)).toMatchObject({
      zone: null,
      unreadZone: null,
      readable: true,
      country: "US",
    });
    houseA(db).timezone = "Mars/Olympus";
    expect(await controller.getHouseTimeZone(A)).toMatchObject({
      zone: null,
      unreadZone: "Mars/Olympus",
    });
    db.failures.restaurants = "statement timeout";
    expect(await controller.getHouseTimeZone(A)).toMatchObject({
      readable: false,
      reason: "statement timeout",
    });
  });

  it("refuses a session with no house", async () => {
    const { controller } = make();
    await expect(controller.getHouseTimeZone("")).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});

describe("the Jev switch", () => {
  it("is off by default, and an owner turns it on for THIS house, audited", async () => {
    const { db, controller } = make();
    expect(await controller.getHouseToneScoring(A)).toMatchObject({
      enabled: false,
      readable: true,
    });
    const out = await controller.setHouseToneScoring(
      A,
      { enabled: true },
      "owner-a",
    );
    expect(out).toMatchObject({ enabled: true, audited: true });
    expect(houseA(db).vendor_tone_scoring_enabled).toBe(true);
    expect(db.tables.system_audit_log[0]).toMatchObject({
      action: TONE_SCORING_AUDIT_ACTION,
      actor_id: "owner-a",
    });
    await controller.setHouseToneScoring(A, { enabled: false }, "manager-a");
    expect(houseA(db).vendor_tone_scoring_enabled).toBe(false);
    expect(houseB(db).vendor_tone_scoring_enabled).toBe(true);
  });

  it("refuses staff, and a body that is not a boolean", async () => {
    const { db, controller } = make();
    await expect(
      controller.setHouseToneScoring(A, { enabled: true }, "staff-a"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.setHouseToneScoring(
        A,
        { enabled: "yes" as unknown as boolean },
        "owner-a",
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(db.writes).toHaveLength(0);
  });

  it("never reads a failed read as off", async () => {
    const { db, controller } = make();
    db.failures.restaurants = "statement timeout";
    expect(await controller.getHouseToneScoring(A)).toMatchObject({
      enabled: null,
      readable: false,
    });
  });

  it("files both actions in the settings trail's allow-list", () => {
    expect(SETTINGS_AUDIT_ACTIONS).toContain(TIME_ZONE_AUDIT_ACTION);
    expect(SETTINGS_AUDIT_ACTIONS).toContain(TONE_SCORING_AUDIT_ACTION);
  });
});
