import { InternalServerErrorException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { OrganizationsService } from "./organizations.service";
import { CreateLocationDto } from "./dto/create-location.dto";

/**
 * `POST /organizations/locations` — a location its creator could not open.
 *
 * MEASURED 2026-09-03 against a local gateway on `main`: an owner added a
 * location through the product's own door. The `restaurants` row was written
 * (slug `sim-meyhouse-9ef3dde7`, org set) but no `user_restaurant_access` row
 * was, so the very next call on that restaurant —
 * `GET /restaurants/:id/operating-hours`, which goes through
 * `MembersService.assertMembership` (restaurants/members.service.ts:25) —
 * answered 403 "Access denied to this restaurant". `assertMembership` reads a
 * URA row and falls back only to `users.restaurant_id`, which still names the
 * creator's ORIGINAL restaurant; there is no org-level path.
 *
 * `registerRestaurant` (auth.service.ts:759) has always written that row for
 * the founding owner. The second door into `restaurants` did not.
 */

const USER_ID = "user-owner-1";
const ORG_ID = "org-1";
const REST_ID = "rest-new-1";

type Recorded = {
  accessInserts: any[];
  restaurantInserts: any[];
  restaurantDeletes: { col: string; val: any }[];
};

function makeService(opts: { accessInsertError?: { message: string } } = {}) {
  const calls: Recorded = {
    accessInserts: [],
    restaurantInserts: [],
    restaurantDeletes: [],
  };

  // Terminal-awaitable chain: supabase-js resolves with `{ data, error }`
  // whether the caller ends on `.single()` or awaits the builder directly
  // (the URA insert does the latter), so the stub must be thenable too.
  const chain = (result: any): any => {
    const c: any = {
      select: () => c,
      insert: () => c,
      update: () => c,
      delete: () => c,
      eq: () => c,
      in: () => c,
      maybeSingle: async () => result,
      single: async () => result,
      then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    };
    return c;
  };

  // OD-131(a) (2026-09-19, `createLocation` now also reads an EXISTING active
  // house for the caller before creating the new one): the bare-awaited
  // (no `.single()`) path on "restaurants" previously answered `data: null`
  // unconditionally, which was fine while nothing but the rollback `delete()`
  // used it (only its `.error` mattered). `createLocation`'s new
  // "does the caller already hold a house in this organisation" read shares
  // that same bare-await path, so it now needs a non-empty answer — this
  // spec is about the access-grant-after-creation flow (ADR 0164 item 7,
  // round 1), not the organisation-membership gate, so ANY seeded house
  // satisfies it without changing what either test below asserts.
  const EXISTING_HOUSE_ID = "existing-house-1";

  const restaurantsChain = (): any => {
    let deleting = false;
    const c: any = {
      insert: (payload: any) => {
        calls.restaurantInserts.push(payload);
        return c;
      },
      select: () => c,
      delete: () => {
        deleting = true;
        return c;
      },
      eq: (col: string, val: any) => {
        if (deleting) calls.restaurantDeletes.push({ col, val });
        return c;
      },
      in: () => c,
      single: async () => ({
        data: { id: REST_ID, name: "Sim Meyhouse" },
        error: null,
      }),
      maybeSingle: async () => ({
        data: { id: REST_ID, name: "Sim Meyhouse" },
        error: null,
      }),
      then: (res: any, rej: any) =>
        Promise.resolve({
          data: [{ id: EXISTING_HOUSE_ID, organization_id: ORG_ID }],
          error: null,
        }).then(res, rej),
    };
    return c;
  };

  const accessChain = (): any => {
    // Two different callers share this table now: `createLocation`'s NEW
    // "does the caller already hold an active house" read (a plain SELECT,
    // always answered from the fixture below) and its EXISTING access-grant
    // INSERT (still gated by `opts.accessInsertError`, below). Collapsing
    // them into one `result` made the read fail with the insert's forced
    // error before the insert ever ran — caught by the "rolls back and
    // throws" case actually asserting the wrong exception type.
    let inserting = false;
    const selectResult = {
      data: [{ restaurant_id: EXISTING_HOUSE_ID }],
      error: null,
    };
    const insertResult = { data: null, error: opts.accessInsertError ?? null };
    const c: any = {
      insert: (payload: any) => {
        inserting = true;
        calls.accessInserts.push(payload);
        return c;
      },
      select: () => c,
      eq: () => c,
      maybeSingle: async () => (inserting ? insertResult : selectResult),
      single: async () => (inserting ? insertResult : selectResult),
      then: (res: any, rej: any) =>
        Promise.resolve(inserting ? insertResult : selectResult).then(
          res,
          rej,
        ),
    };
    return c;
  };

  const supabase = {
    from: (table: string) => {
      // An owner of the organisation (ADR 0164: only they may open a location).
      if (table === "organization_members")
        return chain({
          data: [{ organization_id: ORG_ID, role: "owner" }],
          error: null,
        });
      if (table === "organizations")
        return chain({ data: { id: ORG_ID }, error: null });
      if (table === "restaurants") return restaurantsChain();
      if (table === "user_restaurant_access") return accessChain();
      return chain({ data: null, error: null });
    },
  };

  const svc = new OrganizationsService({ supabase } as any);
  return { svc, calls };
}

const DTO = {
  name: "Sim Meyhouse",
  address: "1 Test St",
  city: "Istanbul",
};

describe("OrganizationsService#createLocation — creator access", () => {
  it("grants the creator owner access to the location it just created", async () => {
    const { svc, calls } = makeService();

    const result = await svc.createLocation(USER_ID, DTO);

    // The house, and the clock it was given (none here: no country, no zone
    // sent) — F-1486, so the dialog can ask for one.
    expect(result).toEqual({
      id: REST_ID,
      name: "Sim Meyhouse",
      timezone: null,
    });

    // The decisive assertion: the membership row the 403 was missing.
    expect(calls.accessInserts).toHaveLength(1);
    expect(calls.accessInserts[0]).toMatchObject({
      user_id: USER_ID,
      restaurant_id: REST_ID,
      role: "owner",
      is_active: true,
    });

    // Nothing was rolled back on the happy path.
    expect(calls.restaurantDeletes).toHaveLength(0);
  });

  it("rolls the restaurant back and throws when the access grant fails", async () => {
    const { svc, calls } = makeService({
      accessInsertError: { message: "duplicate key value" },
    });

    await expect(svc.createLocation(USER_ID, DTO)).rejects.toThrow(
      InternalServerErrorException,
    );

    // The restaurant row was created, so it must not be left behind
    // unreachable — same rollback discipline as `registerRestaurant`.
    expect(calls.restaurantInserts).toHaveLength(1);
    expect(calls.restaurantDeletes).toEqual([{ col: "id", val: REST_ID }]);
  });
});

/**
 * The new house's clock is the zone `Intl` vouches for, or nothing
 * (founder item 62, "Browser zone, else none"; TD-2026-09-27-CREATE-LOCATION-
 * TIMEZONE-UNVALIDATED). Until 2026-09-28 this route wrote
 * `dto.timezone ?? null`, so any string the client sent became the house's
 * clock — an offset or a wrong-case name that Python's `zoneinfo` cannot read.
 */
describe("OrganizationsService#createLocation — timezone", () => {
  const storedZone = async (timezone?: string) => {
    const { svc, calls } = makeService();
    await svc.createLocation(USER_ID, { ...DTO, timezone });
    expect(calls.restaurantInserts).toHaveLength(1);
    return calls.restaurantInserts[0].timezone;
  };

  it("stores a real IANA zone exactly", async () => {
    expect(await storedZone("Europe/Istanbul")).toBe("Europe/Istanbul");
  });

  it("stores Intl's own name for a zone spelled another way", async () => {
    expect(await storedZone("america/new_york")).toBe("America/New_York");
  });

  it.each([
    ["an unknown name", "Mars/Olympus"],
    ["a bare UTC offset", "+05:00"],
    ["free text", "not a zone; drop table"],
    ["an empty string", ""],
  ])("stores nothing for %s", async (_label, zone) => {
    expect(await storedZone(zone)).toBeNull();
  });

  it("stores nothing when no zone was sent — never a default", async () => {
    expect(await storedZone(undefined)).toBeNull();
  });
});

/**
 * F-1400 (re-hit of F-915): a second house in another country got the
 * browser's clock. ADR 0304 puts the address before the device: a country
 * that keeps one clock names the zone, recorded as from the address. A
 * country with several clocks, or a device in one of the country's
 * territories (Reading 1), keeps the device's zone as before.
 */
describe("OrganizationsService#createLocation — the zone comes from the country first", () => {
  const stored = async (
    country: string | undefined,
    timezone: string | undefined,
  ) => {
    const { svc, calls } = makeService();
    await svc.createLocation(USER_ID, { ...DTO, country, timezone });
    const row = calls.restaurantInserts[0];
    return {
      zone: row.timezone,
      source: row.timezone_source ?? null,
      sourceZone: row.timezone_source_zone ?? null,
    };
  };

  it("gives a German house Berlin's clock, not the Istanbul browser's", async () => {
    expect(await stored("Germany", "Europe/Istanbul")).toEqual({
      zone: "Europe/Berlin",
      source: "address",
      sourceZone: "Europe/Berlin",
    });
  });

  it("names the country's one zone even when the browser sent none", async () => {
    expect(await stored("United Kingdom", undefined)).toMatchObject({
      zone: "Europe/London",
      source: "address",
    });
  });

  it("keeps the device's zone in a country with several clocks", async () => {
    expect(await stored("Spain", "Atlantic/Canary")).toEqual({
      zone: "Atlantic/Canary",
      source: null,
      sourceZone: null,
    });
  });

  it("gives none, not the browser's, when the browser sits in another country", async () => {
    expect(await stored("Spain", "Europe/Istanbul")).toEqual({
      zone: null,
      source: null,
      sourceZone: null,
    });
    expect(await stored("United States", "Europe/Istanbul")).toMatchObject({
      zone: null,
    });
  });

  it("keeps a device in one of the country's territories (Réunion under France)", async () => {
    expect(await stored("France", "Indian/Reunion")).toMatchObject({
      zone: "Indian/Reunion",
      source: null,
    });
  });

  it("leaves a United States house to the device, until its state is read", async () => {
    expect(await stored("United States", "America/Chicago")).toMatchObject({
      zone: "America/Chicago",
      source: null,
    });
  });
});

/**
 * F-241: a second house (Add a location) recorded neither a currency nor a
 * map point, while the first house records both. The dialog now sends the
 * currency it stated from the country and the picked place's point; the
 * route writes them, a point only as a whole finite pair.
 */
describe("OrganizationsService#createLocation — currency and map point", () => {
  const stored = async (extra: Record<string, unknown>) => {
    const { svc, calls } = makeService();
    await svc.createLocation(USER_ID, { ...DTO, ...extra });
    expect(calls.restaurantInserts).toHaveLength(1);
    const row = calls.restaurantInserts[0];
    return {
      currency: row.currency,
      latitude: row.latitude,
      longitude: row.longitude,
    };
  };

  it("stores the currency and the point the dialog sent", async () => {
    expect(
      await stored({
        currency: "USD",
        latitude: 37.7594,
        longitude: -122.4211,
      }),
    ).toEqual({ currency: "USD", latitude: 37.7594, longitude: -122.4211 });
  });

  it("stores nothing for what was not sent — never a default", async () => {
    expect(await stored({})).toEqual({
      currency: null,
      latitude: null,
      longitude: null,
    });
  });

  it.each([
    ["one coordinate alone", { latitude: 37.7594 }],
    ["a non-finite coordinate", { latitude: Infinity, longitude: 10 }],
    ["an out-of-range coordinate", { latitude: 91, longitude: 10 }],
  ])("stores no point for %s", async (_label, point) => {
    const row = await stored(point);
    expect([row.latitude, row.longitude]).toEqual([null, null]);
  });
});

describe("CreateLocationDto — currency and map point", () => {
  const check = (extra: Record<string, unknown>) =>
    validate(plainToInstance(CreateLocationDto, { ...DTO, ...extra }));

  it("accepts an ISO 4217 code and a point in range", async () => {
    expect(
      await check({ currency: "TRY", latitude: 41.03, longitude: 28.98 }),
    ).toEqual([]);
  });

  it("refuses a made-up currency and a point off the map", async () => {
    const errors = await check({
      currency: "XXQ",
      latitude: 91,
      longitude: 181,
    });
    expect(errors.map((e) => e.property).sort()).toEqual([
      "currency",
      "latitude",
      "longitude",
    ]);
  });
});

/**
 * F-1486: a US house added from a device abroad gets no clock (ADR 0304: a US
 * address names no zone, and a device outside the US vouches for none). The
 * zone goes back with the house so the dialog can say so and ask for one.
 */
describe("OrganizationsService#createLocation — says which clock the house got", () => {
  it("answers no zone for a US house added from Berlin", async () => {
    const { svc } = makeService();
    const result = await svc.createLocation(USER_ID, {
      ...DTO,
      city: "Detroit",
      country: "United States",
      timezone: "Europe/Berlin",
    });
    expect(result.timezone).toBeNull();
  });

  it("answers the zone a US house added from Detroit keeps", async () => {
    const { svc } = makeService();
    const result = await svc.createLocation(USER_ID, {
      ...DTO,
      city: "Detroit",
      country: "United States",
      timezone: "America/Detroit",
    });
    expect(result.timezone).toBe("America/Detroit");
  });
});
