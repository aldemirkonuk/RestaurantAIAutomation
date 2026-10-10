/**
 * The house's address and map point, set in Settings after sign-up (F-174).
 *
 * The calendar said "Set the address on Settings" and Settings had no address:
 * only sign-up wrote `restaurants.latitude`/`longitude`, the one thing the
 * weather reads. The real HouseLocationController, HouseLocationService,
 * OrganizationsService (the role gate), SettingsAuditService and WeatherService
 * run over an in-memory PostgREST double that honours its filters and records
 * every write.
 */

import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { HouseLocationController } from "./house-location.controller";
import {
  HouseLocationService,
  LOCATION_AUDIT_ACTION,
  notALocationBecause,
} from "./house-location.service";
import { OrganizationsService } from "../organizations/organizations.service";
import {
  SettingsAuditService,
  SETTINGS_AUDIT_ACTIONS,
} from "../settings-audit/settings-audit.service";
import { WeatherService } from "../weather/weather.service";
import { WeatherUnavailableError } from "../weather/weather-provider";

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((r: Row) => boolean)[] = [];
  private limitN: number | null = null;
  private one = false;
  private write: { kind: "insert" | "update" | "upsert"; row: Row } | null =
    null;

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
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
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
  order() {
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  single() {
    this.one = true;
    return this;
  }
  insert(row: Row) {
    this.write = { kind: "insert", row };
    return this;
  }
  upsert(row: Row) {
    this.write = { kind: "upsert", row };
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
    return Promise.resolve(resolve(this.run())).catch(reject);
  }
  private run(): { data: any; error: any } {
    const fail = this.db.failures[this.table];
    if (fail) return { data: null, error: { code: "57014", message: fail } };
    if (this.write) {
      this.db.writes.push({ table: this.table, ...this.write });
      const t = (this.db.tables[this.table] ??= []);
      if (this.write.kind === "update") {
        for (const r of t)
          if (this.filters.every((f) => f(r))) Object.assign(r, this.write.row);
      } else t.push({ ...this.write.row });
      return { data: null, error: null };
    }
    let rows = (this.db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) => f(r)),
    );
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return this.one
      ? { data: rows[0] ?? null, error: null }
      : { data: rows, error: null };
  }
}

class FakeDb {
  tables: Record<string, Row[]> = {};
  failures: Record<string, string> = {};
  writes: { table: string; kind: string; row: Row }[] = [];
  from(table: string) {
    return new FakeQuery(this, table);
  }
}

const A = "house-A";
const B = "house-B";

function make() {
  const db = new FakeDb();
  db.tables.restaurants = [
    {
      id: B,
      name: "B",
      address: { street: "1 Other Road" },
      latitude: "51.5",
      longitude: "-0.12",
    },
    {
      id: A,
      name: "A",
      address: { street: "Typed by hand 4" },
      latitude: null,
      longitude: null,
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
  db.tables.system_audit_log = [];
  db.tables.weather_readings = [];
  const dbs = { client: db, supabase: db, getClient: () => db } as never;
  const audit = new SettingsAuditService(dbs);
  const service = new HouseLocationService(dbs, audit);
  const controller = new HouseLocationController(
    service,
    new OrganizationsService(dbs),
  );
  const forecast = jest.fn(async () => {
    throw new WeatherUnavailableError("outside the test", "issuer-unreachable");
  });
  const weather = new WeatherService(dbs, { issuer: "NWS", forecast } as never);
  return { db, controller, weather, forecast };
}

const houseA = (db: FakeDb) => db.tables.restaurants.find((r) => r.id === A)!;
const houseB = (db: FakeDb) => db.tables.restaurants.find((r) => r.id === B)!;
const PLACE = {
  street: "12 Rıhtım Caddesi",
  latitude: 40.9905,
  longitude: 29.0253,
};

describe("PUT /settings/location", () => {
  it("writes an owner's picked address and point on THIS house, audited with both values", async () => {
    const { db, controller } = make();
    const out = await controller.write(A, PLACE, "owner-a");
    expect(out).toMatchObject({
      street: "12 Rıhtım Caddesi",
      latitude: 40.9905,
      longitude: 29.0253,
      readable: true,
      audited: true,
    });
    expect(houseA(db)).toMatchObject({
      address: { street: "12 Rıhtım Caddesi" },
      latitude: 40.9905,
      longitude: 29.0253,
    });
    expect(houseB(db)).toMatchObject({ latitude: "51.5", longitude: "-0.12" });
    const row = db.tables.system_audit_log[0];
    expect(row).toMatchObject({
      action: LOCATION_AUDIT_ACTION,
      restaurant_id: A,
      actor_id: "owner-a",
    });
    expect(row.changes.fields).toEqual({
      street: { from: "Typed by hand 4", to: "12 Rıhtım Caddesi" },
      latitude: { from: null, to: 40.9905 },
      longitude: { from: null, to: 29.0253 },
    });
    expect(SETTINGS_AUDIT_ACTIONS).toContain(LOCATION_AUDIT_ACTION);
  });

  it("moves only the street inside the address, keeping any other key a writer stored", async () => {
    const { db, controller } = make();
    houseA(db).address = { street: "Typed by hand 4", postal_code: "34710" };
    await controller.write(A, PLACE, "owner-a");
    expect(houseA(db).address).toEqual({
      street: "12 Rıhtım Caddesi",
      postal_code: "34710",
    });
  });

  it("lets a manager move it, and re-sending the same place files nothing", async () => {
    const { db, controller } = make();
    await controller.write(A, PLACE, "manager-a");
    const again = await controller.write(A, PLACE, "manager-a");
    expect(again.audited).toBe(false);
    expect(db.tables.system_audit_log).toHaveLength(1);
  });

  it("refuses staff with 403 and writes nothing", async () => {
    const { db, controller } = make();
    await expect(controller.write(A, PLACE, "staff-a")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.writes).toHaveLength(0);
    expect(houseA(db).latitude).toBeNull();
  });

  it("refuses a half pair, a non-finite number, a point off the Earth and an empty street", async () => {
    const { db, controller } = make();
    for (const bad of [
      { ...PLACE, latitude: undefined },
      { ...PLACE, longitude: null },
      { ...PLACE, latitude: Number.NaN },
      { ...PLACE, longitude: Number.POSITIVE_INFINITY },
      { ...PLACE, latitude: "40.99" },
      { ...PLACE, latitude: 91 },
      { ...PLACE, longitude: -180.5 },
      { ...PLACE, street: "   " },
      { ...PLACE, street: "x".repeat(301) },
    ]) {
      await expect(
        controller.write(A, bad as never, "owner-a"),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(db.writes).toHaveLength(0);
    expect(notALocationBecause("a", 0, 0)).toBeNull();
    expect(notALocationBecause("a", -90, 180)).toBeNull();
  });

  it("writes nothing when the current address cannot be read", async () => {
    const { db, controller } = make();
    db.failures.restaurants = "statement timeout";
    await expect(controller.write(A, PLACE, "owner-a")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(db.writes).toHaveLength(0);
  });
});

describe("GET /settings/location", () => {
  it("reads decimal strings as numbers and a half pair as no point", async () => {
    const { db, controller } = make();
    expect(await controller.read(B)).toMatchObject({
      street: "1 Other Road",
      latitude: 51.5,
      longitude: -0.12,
    });
    houseA(db).latitude = "40";
    expect(await controller.read(A)).toMatchObject({
      street: "Typed by hand 4",
      latitude: null,
      longitude: null,
      readable: true,
    });
  });

  it("says a failed read failed rather than reading as no address", async () => {
    const { db, controller } = make();
    db.failures.restaurants = "statement timeout";
    expect(await controller.read(A)).toMatchObject({
      readable: false,
      reason: "statement timeout",
      street: null,
    });
  });
});

describe("the calendar's weather, before and after", () => {
  it("points the owner at the Settings section that exists, and asks for the new point once it is set", async () => {
    const { controller, weather, forecast } = make();
    const before = await weather.windowFor(A, "2026-10-01", "2026-10-07");
    expect(before.refusalReason).toBe("no-coordinate");
    expect(before.refusal).toContain("Settings, under Address and map point");
    expect(forecast).not.toHaveBeenCalled();

    await controller.write(A, PLACE, "owner-a");
    await weather.windowFor(A, "2026-10-01", "2026-10-07");
    expect(forecast).toHaveBeenCalledWith(40.9905, 29.0253);
  });
});
