/**
 * A house's state and country, changed in the location editor (ADR 0289).
 *
 * The defect (A-052, AW26): the market index tells a United States house with
 * no state to "Set the state in Settings to scope an index line", and nothing
 * an owner could reach wrote `restaurants.state_province` or `country` on an
 * existing house. `UpdateLocationDto` did not declare either key, so
 * `ValidationPipe({ whitelist: true })` stripped them in silence; the
 * controller forwarded five fields; the service patched five columns.
 *
 * This file pins the whole path: the country table is the web's, row for row;
 * the pair rule refuses what would scope a house to the wrong market; the
 * service gates on the house owner before it writes anything, writes once,
 * and files exactly the fields that moved in the settings log; the DTO and the
 * controller let the two keys through.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  ValidationPipe,
} from "@nestjs/common";
import {
  HOUSE_COUNTRIES,
  checkHouseStateCountry,
  checkStateFor,
  resolveHouseCountry,
} from "./house-state-country";
import { OrganizationsService } from "./organizations.service";
import { OrganizationsController } from "./organizations.controller";
import { UpdateLocationDto } from "./dto/update-location.dto";
import { SettingsAuditService } from "../settings-audit/settings-audit.service";
import { DatabaseService } from "../database/database.service";

beforeAll(() => {
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

/* ── 1. the mirror ──────────────────────────────────────────────────────── */

const WEB_COUNTRIES_FILE = resolve(
  __dirname,
  "../../../../apps/web/src/lib/countries.ts",
);

interface Row {
  code: string;
  name: string;
  aliases: string[];
}

/** The web's table, read as TEXT (the two apps are separate builds). */
function webRows(): Row[] {
  const source = readFileSync(WEB_COUNTRIES_FILE, "utf8");
  const start = source.indexOf("export const COUNTRIES");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n];", start);
  expect(end).toBeGreaterThan(start);
  const rows: Row[] = [];
  const unquote = (q: string) => q.replace(/\\'/g, "'");
  for (const line of source.slice(start, end).split("\n")) {
    if (!line.includes("code:")) continue;
    const m = line.match(
      /\{ code: '([A-Z]{2})', name: '((?:[^'\\]|\\.)*)'(?:, currency: '[A-Z]{3}')?(?:, aliases: \[(.*)\])? \},\s*$/,
    );
    // A row this regex cannot read is a failure, never a skip: a silently
    // dropped row would make the comparison below agree with a short table.
    expect(m).not.toBeNull();
    const aliases = m![3]
      ? [...m![3].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((a) => unquote(a[1]))
      : [];
    rows.push({ code: m![1], name: unquote(m![2]), aliases });
  }
  return rows;
}

describe("the gateway's country table mirrors apps/web/src/lib/countries.ts", () => {
  it("holds the same rows, by code, name and aliases, in the same order", () => {
    const web = webRows();
    const gateway = HOUSE_COUNTRIES.map((c) => ({
      code: c.code,
      name: c.name,
      aliases: [...(c.aliases ?? [])],
    }));
    const onlyInWeb = web
      .filter((w) => !gateway.some((g) => g.code === w.code))
      .map((w) => w.code);
    const onlyInGateway = gateway
      .filter((g) => !web.some((w) => w.code === g.code))
      .map((g) => g.code);
    expect({ onlyInWeb, onlyInGateway }).toEqual({
      onlyInWeb: [],
      onlyInGateway: [],
    });
    expect(gateway).toEqual(web);
  });

  it("reads a real table, not an empty match", () => {
    // 194 rows on 2026-10-04. A floor, not the count: adding a country must
    // not fail this, emptying the match must.
    expect(webRows().length).toBeGreaterThan(190);
  });

  it("resolves the spellings production rows carry to one row each", () => {
    expect(resolveHouseCountry("Türkiye")?.name).toBe("Turkey");
    expect(resolveHouseCountry("USA")?.name).toBe("United States");
    expect(resolveHouseCountry("us")?.code).toBe("US");
    expect(resolveHouseCountry("United Kingdom")?.code).toBe("GB");
    expect(resolveHouseCountry("Atlantis")).toBeNull();
  });
});

/* ── 2. the pair rule ───────────────────────────────────────────────────── */

function written(
  country: unknown,
  state: unknown,
): { country: string; state: string | null } {
  const out = checkHouseStateCountry(country, state);
  if ("refused" in out) throw new Error(`refused: ${out.refused}`);
  return { country: out.country.name, state: out.state };
}

function refusal(country: unknown, state: unknown): string {
  const out = checkHouseStateCountry(country, state);
  if (!("refused" in out)) throw new Error(`accepted: ${JSON.stringify(out)}`);
  return out.refused;
}

describe("the pair rule (ADR 0289 R3)", () => {
  it.each([
    ["CA", "CA"],
    ["California", "CA"],
    ["US-CA", "CA"],
    ["  ca ", "CA"],
    ["District of Columbia", "DC"],
  ])("a United States house's %p is written as %p", (sent, stored) => {
    expect(written("United States", sent)).toEqual({
      country: "United States",
      state: stored,
    });
  });

  it("writes a Turkish province as sent, and the country by the table's name", () => {
    expect(written("Türkiye", "Muğla")).toEqual({
      country: "Turkey",
      state: "Muğla",
    });
  });

  it("lets a United Kingdom or Turkish house be the whole country", () => {
    expect(written("United Kingdom", null)).toEqual({
      country: "United Kingdom",
      state: null,
    });
    expect(written("Turkey", "  ")).toEqual({ country: "Turkey", state: null });
    expect(written("United Kingdom", "England")).toEqual({
      country: "United Kingdom",
      state: "England",
    });
  });

  it("takes any other country's state as free text, trimmed", () => {
    expect(written("Germany", " Bavaria ")).toEqual({
      country: "Germany",
      state: "Bavaria",
    });
    expect(written("Australia", "Western Australia")).toEqual({
      country: "Australia",
      state: "Western Australia",
    });
  });

  it.each([null, "", "   "])(
    "refuses a United States house with no state (%p)",
    (state) => {
      expect(refusal("United States", state)).toContain(
        "A United States house needs its state",
      );
    },
  );

  it("refuses a United States state that is not one", () => {
    expect(refusal("United States", "Ontario")).toContain(
      '"Ontario" is not a United States state',
    );
    expect(refusal("USA", "Muğla")).toContain("is not a United States state");
  });

  it("refuses a state that resolves to another country — every reader is region first", () => {
    expect(refusal("Turkey", "England")).toContain(
      "reads as a place in United Kingdom (GB-ENG)",
    );
    expect(refusal("India", "GA")).toContain(
      "reads as the United States state US-GA",
    );
    expect(refusal("Australia", "WA")).toContain(
      "reads as the United States state US-WA",
    );
  });

  it("refuses a United Kingdom or Turkish state that is not one of its subdivisions", () => {
    expect(refusal("United Kingdom", "Greater London")).toContain(
      "England, Scotland, Wales or Northern Ireland",
    );
    expect(refusal("Turkey", "Anatolia")).toContain("81 provinces");
    expect(refusal("Turkey", "Turkey")).toContain(
      "names the country, not a place in it",
    );
    expect(refusal("United Kingdom", "England and Wales")).toContain(
      "is an extent a publication is issued at",
    );
  });

  it("refuses a country the table does not know, and a country cleared", () => {
    expect(refusal("Atlantis", null)).toContain(
      '"Atlantis" is not a country this list knows',
    );
    expect(refusal(null, null)).toContain(
      "A house's country cannot be cleared",
    );
    expect(refusal("", "CA")).toContain("A house's country cannot be cleared");
  });

  it("refuses half a pair: the state is read against the country", () => {
    expect(refusal(undefined, "CA")).toContain(
      "Send the country with the state",
    );
    expect(refusal("United States", undefined)).toContain(
      "Send the state with the country",
    );
  });

  it("refuses a state longer than the column", () => {
    expect(refusal("Germany", "x".repeat(101))).toContain(
      "at most 100 characters",
    );
    expect(checkStateFor("DE", "x".repeat(100))).toEqual({
      write: "x".repeat(100),
    });
  });

  it("ends every refusal by saying nothing was changed", () => {
    for (const r of [
      refusal("United States", null),
      refusal("Atlantis", null),
      refusal("India", "GA"),
    ]) {
      expect(r).toMatch(/Nothing was changed\.$/);
    }
  });
});

/* ── 3. updateLocation, through a recording fake ────────────────────────── */

interface World {
  restaurant?: Record<string, unknown> | null;
  restaurantError?: { message: string } | null;
  access?: { role: string } | null;
  accessError?: { message: string } | null;
  user?: { role: string; restaurant_id: string } | null;
  updateError?: { message: string } | null;
  auditError?: { message: string } | null;
}

interface Probe {
  selects: { table: string; columns: string }[];
  updates: { table: string; patch: Record<string, unknown> }[];
  inserts: { table: string; row: Record<string, unknown> }[];
}

function makeDb(world: World): { db: DatabaseService; probe: Probe } {
  const probe: Probe = { selects: [], updates: [], inserts: [] };
  const from = (table: string) => {
    let op: "select" | "update" = "select";
    const builder: Record<string, unknown> = {
      select(columns: string) {
        probe.selects.push({ table, columns });
        return builder;
      },
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      upsert: () => Promise.resolve({ data: null, error: null }),
      update(patch: Record<string, unknown>) {
        op = "update";
        probe.updates.push({ table, patch });
        return builder;
      },
      insert(row: Record<string, unknown>) {
        probe.inserts.push({ table, row });
        return Promise.resolve({
          error:
            table === "system_audit_log" ? (world.auditError ?? null) : null,
        });
      },
      maybeSingle() {
        if (table === "restaurants") {
          return Promise.resolve({
            data: world.restaurantError ? null : (world.restaurant ?? null),
            error: world.restaurantError ?? null,
          });
        }
        if (table === "user_restaurant_access") {
          return Promise.resolve({
            data: world.accessError ? null : (world.access ?? null),
            error: world.accessError ?? null,
          });
        }
        if (table === "users") {
          return Promise.resolve({ data: world.user ?? null, error: null });
        }
        if (table === "restaurant_chains") {
          return Promise.resolve({
            data: { organization_id: "o1" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(
        resolveFn: (v: unknown) => unknown,
        rejectFn?: (e: unknown) => unknown,
      ) {
        const result =
          op === "update"
            ? { data: null, error: world.updateError ?? null }
            : table === "organization_members"
              ? { data: [{ organization_id: "o1" }], error: null }
              : { data: [], error: null };
        return Promise.resolve(result).then(resolveFn, rejectFn);
      },
    };
    return builder;
  };
  const client = { from };
  return {
    db: { supabase: client, client } as unknown as DatabaseService,
    probe,
  };
}

function makeService(world: World, opts: { audit?: boolean } = {}) {
  const { db, probe } = makeDb(world);
  const audit = opts.audit === false ? undefined : new SettingsAuditService(db);
  return { service: new OrganizationsService(db, audit), probe };
}

/** Tuzlu Rüzgar as the walk found it: country recorded, no state. */
const HOUSE = {
  organization_id: "o1",
  name: "Tuzlu Rüzgar",
  country: "US",
  state_province: null,
};

const OWNER = { access: { role: "owner" } };
const MANAGER = { access: { role: "manager" } };

describe("OrganizationsService.updateLocation — the state and country", () => {
  it("an owner's pair and name land in ONE update, and one log row names what moved", async () => {
    const { service, probe } = makeService({
      ...OWNER,
      restaurant: { ...HOUSE, country: null },
    });

    const out = await service.updateLocation("u-owner", "r1", {
      country: "United States",
      stateProvince: "CA",
      name: "Tuzlu Rüzgar Kadıköy",
    });

    expect(probe.updates).toEqual([
      {
        table: "restaurants",
        patch: {
          country: "United States",
          state_province: "CA",
          name: "Tuzlu Rüzgar Kadıköy",
        },
      },
    ]);
    const audit = probe.inserts.filter((i) => i.table === "system_audit_log");
    expect(audit).toHaveLength(1);
    expect(audit[0].row).toMatchObject({
      actor_id: "u-owner",
      action: "house_state_country_changed",
      entity_type: "restaurant",
      entity_id: "r1",
      restaurant_id: "r1",
      changes: {
        register: "state-and-country",
        subject: "Tuzlu Rüzgar Kadıköy",
        fields: {
          country: { from: null, to: "United States" },
          state_province: { from: null, to: "CA" },
        },
      },
    });
    expect(out).toEqual({
      stateAndCountry: "changed",
      audited: true,
      auditReason: null,
    });
  });

  it("files only the field that moved: the country named the same way is left as it is spelled", async () => {
    const { service, probe } = makeService({ ...OWNER, restaurant: HOUSE });

    await service.updateLocation("u-owner", "r1", {
      country: "United States",
      stateProvince: "California",
    });

    expect(probe.updates).toEqual([
      { table: "restaurants", patch: { state_province: "CA" } },
    ]);
    const row = probe.inserts.find((i) => i.table === "system_audit_log")!.row;
    expect((row.changes as { fields: unknown }).fields).toEqual({
      state_province: { from: null, to: "CA" },
    });
    expect((row.changes as { subject: unknown }).subject).toBe("Tuzlu Rüzgar");
  });

  it("refuses a manager's mixed PATCH whole: no update, no log row", async () => {
    const { service, probe } = makeService({ ...MANAGER, restaurant: HOUSE });

    await expect(
      service.updateLocation("u-mgr", "r1", {
        name: "Renamed",
        country: "United States",
        stateProvince: "CA",
      }),
    ).rejects.toThrow(
      new ForbiddenException(
        "Only an owner of this house can change its state or country, not a manager. Nothing was changed.",
      ),
    );
    expect(probe.updates).toEqual([]);
    expect(probe.inserts).toEqual([]);
  });

  it("refuses staff the same way", async () => {
    const { service, probe } = makeService({
      access: { role: "staff" },
      restaurant: HOUSE,
    });
    await expect(
      service.updateLocation("u-staff", "r1", {
        country: "United States",
        stateProvince: "CA",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(probe.updates).toEqual([]);
  });

  it("answers 503 when the role cannot be read, and writes nothing", async () => {
    const { service, probe } = makeService({
      accessError: { message: "connection reset" },
      user: { role: "owner", restaurant_id: "r1" },
      restaurant: HOUSE,
    });

    const call = service.updateLocation("u-owner", "r1", {
      name: "Renamed",
      country: "United States",
      stateProvince: "CA",
    });
    await expect(call).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service.updateLocation("u-owner", "r1", {
        country: "United States",
        stateProvince: "CA",
      }),
    ).rejects.toThrow(/could not be read/);
    expect(probe.updates).toEqual([]);
    expect(probe.inserts).toEqual([]);
  });

  it("answers 400 for an invalid pair and writes nothing, the name included", async () => {
    const { service, probe } = makeService({ ...OWNER, restaurant: HOUSE });

    await expect(
      service.updateLocation("u-owner", "r1", {
        name: "Renamed",
        country: "United States",
        stateProvince: "Ontario",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateLocation("u-owner", "r1", {
        country: "India",
        stateProvince: "GA",
      }),
    ).rejects.toThrow(/reads as the United States state/);
    expect(probe.updates).toEqual([]);
    expect(probe.inserts).toEqual([]);
  });

  it("writes nothing and files nothing when the pair equals what is recorded", async () => {
    const { service, probe } = makeService({
      ...OWNER,
      restaurant: { ...HOUSE, country: "United States", state_province: "CA" },
    });

    const out = await service.updateLocation("u-owner", "r1", {
      country: "USA",
      stateProvince: "CA",
    });

    expect(probe.updates).toEqual([]);
    expect(probe.inserts).toEqual([]);
    expect(out).toEqual({
      stateAndCountry: "unchanged",
      audited: false,
      auditReason: "nothing changed",
    });
  });

  it("keeps the change when the log row fails, and says so", async () => {
    const { service, probe } = makeService({
      ...OWNER,
      restaurant: HOUSE,
      auditError: { message: "system_audit_log is read-only right now" },
    });

    const out = await service.updateLocation("u-owner", "r1", {
      country: "United States",
      stateProvince: "CA",
    });

    expect(probe.updates).toHaveLength(1);
    expect(out).toEqual({
      stateAndCountry: "changed",
      audited: false,
      auditReason: "system_audit_log is read-only right now",
    });
  });

  it("never claims a record from an instance with no settings log", async () => {
    const { service, probe } = makeService(
      { ...OWNER, restaurant: HOUSE },
      { audit: false },
    );

    const out = await service.updateLocation("u-owner", "r1", {
      country: "United States",
      stateProvince: "CA",
    });

    expect(probe.updates).toHaveLength(1);
    expect(out.audited).toBe(false);
    expect(out.auditReason).toContain("not wired");
  });

  it("answers 503, not 404, when the location itself cannot be read", async () => {
    const { service, probe } = makeService({
      ...OWNER,
      restaurantError: { message: "statement timeout" },
    });

    await expect(
      service.updateLocation("u-owner", "r1", { name: "Renamed" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(probe.updates).toEqual([]);
  });

  it("still 404s a location outside the organisation", async () => {
    const { service } = makeService({ ...OWNER, restaurant: null });
    await expect(
      service.updateLocation("u-owner", "other", {
        country: "United States",
        stateProvince: "CA",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("leaves a manager's name-only PATCH exactly as it was (regression)", async () => {
    const { service, probe } = makeService({ ...MANAGER, restaurant: HOUSE });

    const out = await service.updateLocation("u-mgr", "r1", {
      name: " Renamed ",
      city: "",
    });

    expect(probe.updates).toEqual([
      { table: "restaurants", patch: { name: "Renamed", city: null } },
    ]);
    expect(probe.inserts).toEqual([]);
    expect(out.stateAndCountry).toBe("not-sent");
    // The order of reads is unchanged too: the pair's owner gate is not run.
    expect(
      probe.selects.filter((s) => s.table === "user_restaurant_access"),
    ).toHaveLength(1);
  });
});

/* ── 4. getLocation hands the editor the pair and the caller's role ─────── */

describe("OrganizationsService.getLocation — the editor's read", () => {
  const RECORD = {
    id: "r1",
    name: "Tuzlu Rüzgar",
    city: "Austin",
    email: null,
    phone: null,
    subscription_tier: "pilot",
    country: "US",
    state_province: null,
  };

  it("returns the country, the state and the caller's role in this house", async () => {
    const { service, probe } = makeService({ ...OWNER, restaurant: RECORD });

    const out = await service.getLocation("u-owner", "r1");

    expect(out).toMatchObject({
      country: "US",
      stateProvince: null,
      callerRole: "owner",
    });
    const select =
      probe.selects.find((s) => s.table === "restaurants")?.columns ?? "";
    expect(select).toContain("country");
    expect(select).toContain("state_province");
  });

  it("names a manager as a manager", async () => {
    const { service } = makeService({ ...MANAGER, restaurant: RECORD });
    await expect(service.getLocation("u-mgr", "r1")).resolves.toMatchObject({
      callerRole: "manager",
    });
  });

  it("returns null, not a guess, when the role read failed", async () => {
    const { service } = makeService({
      accessError: { message: "connection reset" },
      user: { role: "owner", restaurant_id: "r1" },
      restaurant: RECORD,
    });
    await expect(service.getLocation("u-owner", "r1")).resolves.toMatchObject({
      callerRole: null,
      country: "US",
    });
  });
});

/* ── 5. the DTO and the controller let the pair through ─────────────────── */

describe("PATCH /organizations/locations/:id carries the pair to the service", () => {
  const pipe = new ValidationPipe({ whitelist: true });
  const transform = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: "body", metatype: UpdateLocationDto });

  it("keeps country and stateProvince under the whitelist", async () => {
    const out = await transform({
      country: "United States",
      stateProvince: "CA",
      nonsense: 1,
    });
    expect(out).toEqual(
      expect.objectContaining({
        country: "United States",
        stateProvince: "CA",
      }),
    );
    expect(out).not.toHaveProperty("nonsense");
  });

  it("keeps an explicit null state, which the service reads as 'none'", async () => {
    const out = await transform({
      country: "United Kingdom",
      stateProvince: null,
    });
    expect(out).toHaveProperty("stateProvince", null);
  });

  it("refuses a state longer than the column", async () => {
    await expect(
      transform({ country: "Germany", stateProvince: "x".repeat(101) }),
    ).rejects.toBeTruthy();
  });

  it("forwards both keys from the controller to the service", async () => {
    const updateLocation = jest.fn().mockResolvedValue({
      stateAndCountry: "changed",
      audited: true,
      auditReason: null,
    });
    const controller = new OrganizationsController({ updateLocation } as never);

    const out = await controller.updateLocation(
      { user: { userId: "u-owner" } } as never,
      "r1",
      { country: "United States", stateProvince: "CA" } as UpdateLocationDto,
    );

    expect(updateLocation).toHaveBeenCalledWith(
      "u-owner",
      "r1",
      expect.objectContaining({
        country: "United States",
        stateProvince: "CA",
      }),
    );
    expect(out).toEqual({
      stateAndCountry: "changed",
      audited: true,
      auditReason: null,
    });
  });
});
