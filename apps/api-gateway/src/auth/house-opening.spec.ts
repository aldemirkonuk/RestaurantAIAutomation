import {
  BadRequestException,
  HttpException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AuthService } from "./auth.service";
import { CreateFirstHouseDto } from "./dto/create-first-house.dto";
import { RegisterRestaurantDto } from "./dto/register-restaurant.dto";
import {
  CAP,
  HOUSE_DETAIL_TOO_LONG,
  HOUSE_NOT_OPENED,
  HouseWriteError,
  PLACE_ID_TOO_LONG,
  isSharedPlace,
  refuseHouseOpening,
  slugBase,
} from "./house-opening";

jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("hashed"),
  compare: jest.fn(),
}));

/**
 * F-006: a place another house already holds opens the house anyway, with its
 * pin and without the place id (the founder, 2026-10-02: "Open it, keep the
 * pin (Recommended)"), and every refused opening is said in a fixed sentence
 * that names no constraint, index or other house. The error fixtures are the
 * texts PostgreSQL gives, measured in PGlite on 2026-10-03.
 */

const PLACE_HELD = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "idx_restaurants_google_place_id"',
  details: "Key (google_place_id)=(ChIJ-held) already exists.",
};
const SLUG_TAKEN = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "restaurants_slug_key"',
  details: "Key (slug)=(meyhane-a1b2c3) already exists.",
};
const EMAIL_TAKEN = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "users_email_key"',
  details: "Key (email)=(selin@example.com) already exists.",
};
const ONBOARDING_TAKEN = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "user_onboarding_progress_user_id_key"',
  details: "Key (user_id)=(user-1) already exists.",
};
const PLACE_TOO_LONG = {
  code: "23514",
  message:
    'new row for relation "restaurants" violates check constraint "restaurants_google_place_id_length"',
  details: "Failing row contains (ChIJ-held).",
};
const VALUE_TOO_LONG = {
  code: "22001",
  message: "value too long for type character varying(100)",
};
const NUL_IN_TEXT = {
  code: "22P05",
  message: "unsupported Unicode escape sequence",
  details: "\\u0000 cannot be converted to text.",
};
const NO_ANSWER = { code: "", message: "fetch failed" };

/** Nothing raw may reach a response body (B3, F6). */
const RAW_WORDS = [
  "ChIJ",
  "Key (",
  "already exists",
  "idx_",
  "restaurants_",
  "duplicate",
  "violates",
  "character varying",
  "Unicode",
  "23505",
  "constraint",
  "fetch",
  "Registration failed: ",
];

type Result = { data?: unknown; error?: unknown };

/**
 * A fake database: a queue of results per table for `.single()`, for
 * `.maybeSingle()` and for an awaited write, with every insert and delete
 * recorded, and every call logged in order as `table:verb(columns):end`.
 * `heldPlace` is a place id another house holds: looking it up finds that
 * house, and inserting it is refused as the place index refuses it.
 * `realTokens` keeps AuthService's own token mint, with a signer that writes
 * the claims out, so a response can be compared byte for byte.
 */
function makeService(
  fixtures: {
    single?: Record<string, Result[]>;
    maybeSingle?: Record<string, Result[]>;
    then?: Record<string, Result[]>;
  } = {},
  { realTokens = false, heldPlace = "" } = {},
) {
  // A copy, so a shared fixture is never used up by an earlier test.
  const queues = structuredClone(fixtures);
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const deletes: { table: string; col: string; v: unknown }[] = [];
  const calls: string[] = [];
  const singleDefault: Record<string, Result> = {
    organizations: { data: { id: "org-1" }, error: null },
    restaurants: { data: { id: "rest-1" }, error: null },
    users: {
      data: {
        user_id: "user-1",
        email: "selin@example.com",
        role: "owner",
        email_verified: true,
        restaurant_id: null,
      },
      error: null,
    },
  };
  const maybeSingleDefault: Record<string, Result> = {
    user_restaurant_access: { data: { role: "owner" }, error: null },
  };
  const next = (
    queue: Record<string, Result[]> | undefined,
    table: string,
    fallback: Result,
  ) => (queue?.[table]?.length ? queue[table].shift()! : fallback);

  const chain = (table: string): any => {
    let deleting = false;
    let row: Record<string, unknown> = {};
    let place: unknown;
    let verb: string | undefined;
    let columns: string | undefined;
    const log = (end: string) =>
      calls.push(
        `${table}:${verb ?? "?"}${columns === undefined ? "" : `(${columns})`}:${end}`,
      );
    const c: any = {
      select: (cols?: string) => {
        verb ??= "select";
        columns = cols ?? "";
        return c;
      },
      update: () => {
        verb = "update";
        return c;
      },
      insert: (values: Record<string, unknown>) => {
        verb = "insert";
        row = values;
        inserts.push({ table, row });
        return c;
      },
      delete: () => {
        verb = "delete";
        deleting = true;
        return c;
      },
      eq: (col: string, v: unknown) => {
        if (deleting) deletes.push({ table, col, v });
        if (col === "google_place_id") place = v;
        return c;
      },
      is: () => c,
      maybeSingle: async () => {
        log("maybeSingle");
        if (heldPlace && place === heldPlace)
          return { data: { id: "rest-0" }, error: null };
        return next(
          queues.maybeSingle,
          table,
          maybeSingleDefault[table] ?? { data: null, error: null },
        );
      },
      single: async () => {
        log("single");
        if (heldPlace && row.google_place_id === heldPlace)
          return { data: null, error: PLACE_HELD };
        return next(
          queues.single,
          table,
          singleDefault[table] ?? { data: null },
        );
      },
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => {
        log("then");
        return Promise.resolve(
          deleting
            ? { error: null }
            : next(queues.then, table, { error: null }),
        ).then(resolve, reject);
      },
    };
    return c;
  };

  const sign = (claims: object) => JSON.stringify(claims);
  const svc = new AuthService(
    { sign, signAsync: async (claims: object) => sign(claims) } as any,
    { get: () => undefined } as any,
    { supabase: { from: (table: string) => chain(table) } } as any,
    {
      isBlacklisted: async () => false,
      blacklist: async () => undefined,
    } as any,
    { sendOnboardingEmail: async () => undefined } as any,
  );
  if (!realTokens)
    (svc as any).generateTokens = jest
      .fn()
      .mockResolvedValue({ accessToken: "a", refreshToken: "r" });
  (svc as any).emailAlreadyRegistered = jest.fn().mockResolvedValue(false);
  (svc as any).queueEmailVerification = jest.fn().mockResolvedValue(undefined);
  const logError = jest
    .spyOn((svc as any).logger, "error")
    .mockImplementation(() => undefined);
  const logLog = jest
    .spyOn((svc as any).logger, "log")
    .mockImplementation(() => undefined);
  jest.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);

  const restaurantRows = () =>
    inserts.filter((i) => i.table === "restaurants").map((i) => i.row);
  return { svc, inserts, deletes, calls, logError, logLog, restaurantRows };
}

/** Another house holds the place HOUSE picks. */
const HELD = { heldPlace: "ChIJ-held" };

const HOUSE = {
  restaurantName: "Meyhane",
  address: "1 House Street",
  city: "Istanbul",
  country: "Türkiye",
  latitude: 41.0369,
  longitude: 28.985,
  googlePlaceId: "ChIJ-held",
} as CreateFirstHouseDto;

const REGISTRATION = {
  name: "Selin Kaya",
  email: "selin@example.com",
  password: "long-enough",
  ...HOUSE,
} as RegisterRestaurantDto;

/** The row as the client sends it: an undefined key is left out. */
const sent = (row: Record<string, unknown>) => JSON.parse(JSON.stringify(row));

async function refusal(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error("expected a refusal");
}

function expectPlain(
  exception: HttpException,
  kind: typeof BadRequestException | typeof InternalServerErrorException,
  sentence: string,
) {
  expect(exception).toBeInstanceOf(kind);
  expect((exception.getResponse() as { message: string }).message).toBe(
    sentence,
  );
  const body = JSON.stringify(exception.getResponse());
  for (const word of RAW_WORDS) expect(body).not.toContain(word);
}

describe("isSharedPlace", () => {
  it("is true for the place index's own 23505 (A1)", () => {
    expect(isSharedPlace(PLACE_HELD)).toBe(true);
  });

  it("is false for every other duplicate, code or failure (A2)", () => {
    for (const error of [
      SLUG_TAKEN,
      EMAIL_TAKEN,
      ONBOARDING_TAKEN,
      {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "idx_restaurants_google_place_id_v2"',
      },
      PLACE_TOO_LONG,
      null,
      { code: "" },
      NO_ANSWER,
    ])
      expect(isSharedPlace(error)).toBe(false);
  });
});

describe("refuseHouseOpening", () => {
  const tooLong = [
    new HouseWriteError("restaurant", "23514", PLACE_TOO_LONG.message),
    new HouseWriteError("organization", "22001", VALUE_TOO_LONG.message),
  ];
  const other = [
    new HouseWriteError("restaurant", "23505", SLUG_TAKEN.message),
    new HouseWriteError("restaurant", "", NO_ANSWER.message),
    new Error("something raw"),
    new ServiceUnavailableException("token store is down"),
  ];

  it("says a too-long detail as a plain 400 (B1, B3)", () => {
    for (const error of tooLong)
      expectPlain(
        refuseHouseOpening("createFirstHouse", error, { error: jest.fn() }),
        BadRequestException,
        HOUSE_DETAIL_TOO_LONG,
      );
  });

  it("says anything else as a plain 500 (B2, B3)", () => {
    for (const error of other) {
      const exception = refuseHouseOpening("registerRestaurant", error, {
        error: jest.fn(),
      });
      expectPlain(exception, InternalServerErrorException, HOUSE_NOT_OPENED);
      expect(JSON.stringify(exception.getResponse())).not.toContain(
        error.message,
      );
    }
  });

  it("keeps the PG code and the raw message in the server log only (B4)", () => {
    const logger = { error: jest.fn() };
    refuseHouseOpening("createFirstHouse", tooLong[0], logger);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      `createFirstHouse rolled back at restaurant: 23514 ${PLACE_TOO_LONG.message}`,
    );
  });
});

describe("slugBase", () => {
  it("leaves room for -xxxxxx in varchar(100) (C1t)", () => {
    expect(slugBase("a".repeat(249)).length).toBeLessThanOrEqual(90);
    expect(slugBase("a".repeat(89) + " Bistro")).not.toMatch(/-$/);
    expect(slugBase("The Oak Room")).toBe("the-oak-room");
  });
});

describe("the sentences (G-L)", () => {
  const sentences = [
    HOUSE_DETAIL_TOO_LONG,
    HOUSE_NOT_OPENED,
    PLACE_ID_TOO_LONG,
    ...Object.values(CAP).map((cap) => cap.message),
  ];
  const forbidden = [
    "idx",
    "constraint",
    "unique",
    "duplicate",
    "database",
    "index",
    "column",
    "row",
    "varchar",
    "byte",
    "another house",
    "already has a house",
    "already held",
    "taken",
  ];

  it("name no rule, no storage and no other house", () => {
    expect(sentences).toHaveLength(10);
    for (const sentence of sentences)
      for (const word of forbidden)
        expect(sentence.toLowerCase()).not.toContain(word);
  });
});

describe.each([
  {
    dto: CreateFirstHouseDto,
    base: {
      restaurantName: "Meyhane",
      address: "1 House Street",
      city: "Istanbul",
      country: "Türkiye",
    },
    phone: "restaurantPhone",
  },
  {
    dto: RegisterRestaurantDto,
    base: {
      name: "Selin Kaya",
      email: "selin@example.com",
      password: "long-enough",
      restaurantName: "Meyhane",
      address: "1 House Street",
      city: "Istanbul",
      country: "Türkiye",
    },
    phone: "phone",
  },
])("$dto.name caps", ({ dto, base, phone }) => {
  const errorsFor = async (field: string, value: string) => {
    const errors = await validate(
      plainToInstance(dto as any, { ...base, [field]: value }) as object,
    );
    return errors.find((e) => e.property === field)?.constraints;
  };

  it("bounds googlePlaceId at 2048 bytes, said plainly (D1)", async () => {
    expect(await errorsFor("googlePlaceId", "a".repeat(2048))).toBeUndefined();
    expect(await errorsFor("googlePlaceId", "a".repeat(2049))).toEqual({
      fitsInBytes: PLACE_ID_TOO_LONG,
    });
  });

  it("counts bytes, not characters (D2)", async () => {
    const twoBytes = "é".repeat(1024);
    const short = "ş".repeat(683);
    const threeBytes = "€".repeat(683);
    expect(Buffer.byteLength(twoBytes, "utf8")).toBe(2048);
    expect(Buffer.byteLength(short, "utf8")).toBe(1366);
    expect(Buffer.byteLength(threeBytes, "utf8")).toBe(2049);
    expect(await errorsFor("googlePlaceId", twoBytes)).toBeUndefined();
    expect(await errorsFor("googlePlaceId", short)).toBeUndefined();
    expect(await errorsFor("googlePlaceId", threeBytes)).toEqual({
      fitsInBytes: PLACE_ID_TOO_LONG,
    });
  });

  it("answers a lone surrogate instead of throwing (D3)", async () => {
    await expect(errorsFor("googlePlaceId", "\ud800")).resolves.toBeUndefined();
  });

  it("caps each field at its column, in the house's words (D4)", async () => {
    const caps: [string, number, string][] = [
      ["restaurantName", 249, CAP.name.message],
      ["city", 100, CAP.city.message],
      ["stateProvince", 100, CAP.state.message],
      ["neighborhood", 100, CAP.neighborhood.message],
      ["country", 100, CAP.country.message],
      ["postalCode", 20, CAP.postal.message],
      [phone, 50, CAP.phone.message],
    ];
    for (const [field, max, sentence] of caps) {
      expect(await errorsFor(field, "a".repeat(max))).toBeUndefined();
      expect(await errorsFor(field, "a".repeat(max + 1))).toEqual({
        maxLength: sentence,
      });
      // `city` and `country` are plain words too; the camelCase names are not.
      if (/[A-Z]/.test(field)) expect(sentence).not.toContain(field);
      expect(sentence).not.toContain("must be shorter than");
    }
  });
});

/** A clock and a free or held place, for the parity tests (E2, F1). */
const NOW = Date.UTC(2026, 9, 3, 12);
const runFor = (place: "free" | "held") =>
  makeService({}, { realTokens: true, ...(place === "held" ? HELD : {}) });

describe("createFirstHouse", () => {
  beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());

  it("opens a house at a held place with its pin and without the id (E1)", async () => {
    const free = makeService();
    await free.svc.createFirstHouse("user-1", HOUSE);
    const held = makeService({}, HELD);
    const result = await held.svc.createFirstHouse("user-1", HOUSE);

    expect(held.restaurantRows()).toHaveLength(1);
    const [landed] = held.restaurantRows();
    expect(JSON.stringify(landed)).not.toContain("google_place_id");
    expect(landed.latitude).toBe(HOUSE.latitude);
    expect(landed.longitude).toBe(HOUSE.longitude);
    expect(free.restaurantRows()[0].google_place_id).toBe("ChIJ-held");
    const {
      slug: _a,
      google_place_id: _id,
      ...freeRow
    } = sent(free.restaurantRows()[0]);
    const { slug: _b, ...heldRow } = sent(landed);
    expect(heldRow).toEqual(freeRow);

    expect(held.deletes).toEqual([]);
    expect(Object.keys(result).sort()).toEqual([
      "accessToken",
      "refreshToken",
      "restaurantId",
    ]);
    expect(result.restaurantId).toBe("rest-1");
    expect(held.logLog).toHaveBeenCalledTimes(1);
    expect(held.logLog.mock.calls[0][0]).toContain("already held");
    expect(free.logLog).not.toHaveBeenCalled();
  });

  it("re-inserts without the id when the place is taken after the look-up (E1b)", async () => {
    const run = makeService({
      single: {
        restaurants: [{ error: PLACE_HELD }, { data: { id: "rest-2" } }],
      },
    });
    const result = await run.svc.createFirstHouse("user-1", HOUSE);

    const [first, second] = run.restaurantRows();
    expect(run.restaurantRows()).toHaveLength(2);
    expect(first.google_place_id).toBe("ChIJ-held");
    expect(JSON.stringify(second)).not.toContain("google_place_id");
    const { slug: _a, google_place_id: _id, ...kept } = sent(first);
    const { slug: _b, ...again } = sent(second);
    expect(again).toEqual(kept);
    expect(result.restaurantId).toBe("rest-2");
    expect(run.deletes).toEqual([]);
    expect(run.logLog).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the place cannot be looked up, and says so plainly (E1c)", async () => {
    const run = makeService({
      maybeSingle: { restaurants: [{ data: null, error: NO_ANSWER }] },
    });
    const exception = await refusal(run.svc.createFirstHouse("user-1", HOUSE));
    expectPlain(exception, InternalServerErrorException, HOUSE_NOT_OPENED);
    expect(run.restaurantRows()).toEqual([]);
    expect(run.deletes).toEqual([
      { table: "organizations", col: "id", v: "org-1" },
    ]);
    expect(run.logError).toHaveBeenCalledWith(
      `createFirstHouse rolled back at place look-up: no code ${NO_ANSWER.message}`,
    );
  });

  it("looks nothing up when no place was picked (E1d)", async () => {
    const run = makeService();
    await run.svc.createFirstHouse("user-1", {
      ...HOUSE,
      googlePlaceId: undefined,
    });
    expect(run.calls).not.toContain("restaurants:select(id):maybeSingle");
    expect(run.restaurantRows()).toHaveLength(1);
    expect(JSON.stringify(run.restaurantRows()[0])).not.toContain(
      "google_place_id",
    );
    expect(run.logLog).not.toHaveBeenCalled();
  });

  it("makes the same calls and answers the same bytes, free or held (E2)", async () => {
    const free = runFor("free");
    const held = runFor("held");
    const freeAnswer = await free.svc.createFirstHouse("user-1", HOUSE);
    const heldAnswer = await held.svc.createFirstHouse("user-1", HOUSE);

    expect(free.restaurantRows()[0].google_place_id).toBe("ChIJ-held");
    expect(held.calls).toEqual(free.calls);
    expect(free.calls.filter((c) => c.startsWith("restaurants:"))).toEqual([
      "restaurants:select(id):maybeSingle",
      "restaurants:insert(id):single",
    ]);
    expect(JSON.stringify(heldAnswer)).toBe(JSON.stringify(freeAnswer));
    expect(JSON.parse(freeAnswer.accessToken)).toMatchObject({
      role: "owner",
      restaurantId: "rest-1",
    });
    expect(JSON.stringify(freeAnswer)).not.toContain("ChIJ");
  });

  it("does not treat another duplicate as a held place (E3)", async () => {
    const run = makeService({
      single: { restaurants: [{ error: SLUG_TAKEN }] },
    });
    const exception = await refusal(run.svc.createFirstHouse("user-1", HOUSE));
    expectPlain(exception, InternalServerErrorException, HOUSE_NOT_OPENED);
    expect(run.restaurantRows()).toHaveLength(1);
    expect(run.deletes).toEqual([
      { table: "organizations", col: "id", v: "org-1" },
    ]);
  });

  it("rolls back the re-inserted row when a later write fails (E4)", async () => {
    const run = makeService({
      single: {
        restaurants: [{ error: PLACE_HELD }, { data: { id: "rest-2" } }],
      },
      then: { user_restaurant_access: [{ error: NO_ANSWER }] },
    });
    const exception = await refusal(run.svc.createFirstHouse("user-1", HOUSE));
    expectPlain(exception, InternalServerErrorException, HOUSE_NOT_OPENED);
    expect(run.deletes).toEqual([
      { table: "restaurants", col: "id", v: "rest-2" },
      { table: "organizations", col: "id", v: "org-1" },
    ]);
  });

  it("says the place CHECK as a plain 400 and rolls back (E5)", async () => {
    const run = makeService({
      single: { restaurants: [{ error: PLACE_TOO_LONG }] },
    });
    const exception = await refusal(run.svc.createFirstHouse("user-1", HOUSE));
    expectPlain(exception, BadRequestException, HOUSE_DETAIL_TOO_LONG);
    expect(run.deletes).toEqual([
      { table: "organizations", col: "id", v: "org-1" },
    ]);
    expect(run.logError).toHaveBeenCalledWith(
      expect.stringContaining(`23514 ${PLACE_TOO_LONG.message}`),
    );
  });

  it("keeps the code of an early step (E6)", async () => {
    const run = makeService({
      single: { organizations: [{ error: VALUE_TOO_LONG }] },
    });
    const exception = await refusal(run.svc.createFirstHouse("user-1", HOUSE));
    expectPlain(exception, BadRequestException, HOUSE_DETAIL_TOO_LONG);
    expect(run.deletes).toEqual([]);
  });

  it("keeps the code of an access row, and rolls both rows back (E6b)", async () => {
    const run = makeService({
      then: { user_restaurant_access: [{ error: VALUE_TOO_LONG }] },
    });
    const exception = await refusal(run.svc.createFirstHouse("user-1", HOUSE));
    expectPlain(exception, BadRequestException, HOUSE_DETAIL_TOO_LONG);
    expect(run.logError).toHaveBeenCalledWith(
      `createFirstHouse rolled back at access rows: 22001 ${VALUE_TOO_LONG.message}`,
    );
    expect(run.deletes).toEqual([
      { table: "restaurants", col: "id", v: "rest-1" },
      { table: "organizations", col: "id", v: "org-1" },
    ]);
  });

  it("rolls back when the token mint fails, and says so plainly (E7)", async () => {
    const run = makeService();
    (run.svc as any).generateTokens.mockRejectedValue(
      new ServiceUnavailableException("token store is down"),
    );
    const exception = await refusal(run.svc.createFirstHouse("user-1", HOUSE));
    expectPlain(exception, InternalServerErrorException, HOUSE_NOT_OPENED);
    expect(JSON.stringify(exception.getResponse())).not.toContain("token");
    expect(run.deletes).toEqual([
      { table: "restaurants", col: "id", v: "rest-1" },
      { table: "organizations", col: "id", v: "org-1" },
    ]);
  });

  it("keeps the slug inside varchar(100) for the longest name (E8)", async () => {
    const run = makeService();
    await run.svc.createFirstHouse("user-1", {
      ...HOUSE,
      restaurantName: "a".repeat(249),
    });
    const slug = run.restaurantRows()[0].slug as string;
    expect(slug.length).toBeLessThanOrEqual(100);
  });
});

describe("registerRestaurant", () => {
  beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());

  const userRow = (run: ReturnType<typeof makeService>) =>
    run.inserts.find((i) => i.table === "users")!.row;

  it("opens a house at a held place on the public route too (F1)", async () => {
    const run = makeService({}, HELD);
    await run.svc.registerRestaurant(REGISTRATION);
    expect(run.restaurantRows()).toHaveLength(1);
    const [landed] = run.restaurantRows();
    expect(JSON.stringify(landed)).not.toContain("google_place_id");
    expect(landed.latitude).toBe(HOUSE.latitude);
    expect(landed.longitude).toBe(HOUSE.longitude);
    expect(userRow(run).restaurant_id).toBe("rest-1");
    expect(run.deletes).toEqual([]);
    expect(run.logLog).toHaveBeenCalledTimes(1);
  });

  it("makes the same calls and answers the same bytes, free or held (F1b)", async () => {
    const free = runFor("free");
    const held = runFor("held");
    const freeAnswer = await free.svc.registerRestaurant(REGISTRATION);
    const heldAnswer = await held.svc.registerRestaurant(REGISTRATION);

    expect(free.restaurantRows()[0].google_place_id).toBe("ChIJ-held");
    expect(held.calls).toEqual(free.calls);
    expect(free.calls.filter((c) => c.startsWith("restaurants:"))).toEqual([
      "restaurants:select(id):maybeSingle",
      "restaurants:insert(id):single",
    ]);
    expect(JSON.stringify(heldAnswer)).toBe(JSON.stringify(freeAnswer));
    expect(JSON.parse(freeAnswer.accessToken)).toMatchObject({
      role: "owner",
      restaurantId: "rest-1",
    });
    expect(JSON.stringify(freeAnswer)).not.toContain("ChIJ");
  });

  it("re-inserts without the id on a race, keeping the slug (F1c)", async () => {
    const run = makeService({
      single: {
        restaurants: [{ error: PLACE_HELD }, { data: { id: "rest-2" } }],
      },
    });
    await run.svc.registerRestaurant(REGISTRATION);
    const [first, second] = run.restaurantRows();
    expect(first.google_place_id).toBe("ChIJ-held");
    const { google_place_id: _id, ...kept } = sent(first);
    expect(sent(second)).toEqual(kept);
    expect(userRow(run).restaurant_id).toBe("rest-2");
    expect(run.deletes).toEqual([]);
  });

  it("says the loser of a same-email race plainly and leaves no rows (F2, F6)", async () => {
    const run = makeService({ single: { users: [{ error: EMAIL_TAKEN }] } });
    const exception = await refusal(run.svc.registerRestaurant(REGISTRATION));
    expectPlain(exception, InternalServerErrorException, HOUSE_NOT_OPENED);
    expect(run.deletes).toEqual([
      { table: "restaurants", col: "id", v: "rest-1" },
      { table: "organizations", col: "id", v: "org-1" },
    ]);
  });

  it("says a too-long detail as a plain 400 (F3, F6)", async () => {
    const run = makeService({
      single: { restaurants: [{ error: VALUE_TOO_LONG }] },
    });
    const exception = await refusal(run.svc.registerRestaurant(REGISTRATION));
    expectPlain(exception, BadRequestException, HOUSE_DETAIL_TOO_LONG);
  });

  it("keeps the code of the organization and the user rows (F3b, F6)", async () => {
    const org = makeService({
      single: { organizations: [{ error: VALUE_TOO_LONG }] },
    });
    expectPlain(
      await refusal(org.svc.registerRestaurant(REGISTRATION)),
      BadRequestException,
      HOUSE_DETAIL_TOO_LONG,
    );
    expect(org.deletes).toEqual([]);

    const user = makeService({
      single: { users: [{ error: VALUE_TOO_LONG }] },
    });
    expectPlain(
      await refusal(user.svc.registerRestaurant(REGISTRATION)),
      BadRequestException,
      HOUSE_DETAIL_TOO_LONG,
    );
    expect(user.logError).toHaveBeenCalledWith(
      `registerRestaurant rolled back at user: 22001 ${VALUE_TOO_LONG.message}`,
    );
    expect(user.deletes).toEqual([
      { table: "restaurants", col: "id", v: "rest-1" },
      { table: "organizations", col: "id", v: "org-1" },
    ]);
  });

  it("says a network failure plainly (F4, F6)", async () => {
    const run = makeService({
      single: { organizations: [{ error: NO_ANSWER }] },
    });
    const exception = await refusal(run.svc.registerRestaurant(REGISTRATION));
    expectPlain(exception, InternalServerErrorException, HOUSE_NOT_OPENED);
    expect(run.deletes).toEqual([]);
  });

  it("gives a code the scope does not list the plain 500, with rollback (F7, F6)", async () => {
    const run = makeService({ single: { users: [{ error: NUL_IN_TEXT }] } });
    const exception = await refusal(
      run.svc.registerRestaurant({ ...REGISTRATION, name: "Selin\u0000" }),
    );
    expectPlain(exception, InternalServerErrorException, HOUSE_NOT_OPENED);
    expect(run.deletes).toEqual([
      { table: "restaurants", col: "id", v: "rest-1" },
      { table: "organizations", col: "id", v: "org-1" },
    ]);
  });

  it("keeps the slug inside varchar(100) for the longest name (F8)", async () => {
    const run = makeService();
    await run.svc.registerRestaurant({
      ...REGISTRATION,
      restaurantName: "a".repeat(249),
    });
    const slug = run.restaurantRows()[0].slug as string;
    expect(slug.length).toBeLessThanOrEqual(100);
  });
});
