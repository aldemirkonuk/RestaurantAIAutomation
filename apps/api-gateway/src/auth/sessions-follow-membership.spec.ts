import "reflect-metadata";
import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { AuthService, JwtPayload } from "./auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import {
  HOUSE_HINT_CLOCK_SKEW_MS,
  HOUSE_RETURN_WINDOW_MS,
  parseLastHouseHints,
  signInHouse,
} from "./house-choice";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";

/**
 * Sessions follow membership (ADR 0164; the founder, 2026-09-18/19).
 *
 *   1. "Membership only": a session in a house needs an active membership row
 *      there. A removed person is out of that house on their next request and
 *      at their next refresh; nothing mints a token naming a house without a
 *      row; the switch route's organisation fallback opens nothing (44.1r).
 *   3. Sign-in: 0 houses, none; 1, that house; 2 or more, the house this
 *      device used within the return window, otherwise the person chooses.
 *      Every sign-in door follows the one rule. `users.role` decides nothing
 *      for a session (44.1t).
 *
 * The real `AuthService`, a real `JwtService` (so tokens are signed and
 * decoded as in production) and the real `JwtStrategy`, over the
 * filter-honouring stub.
 */

const U = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // "Moda"
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // "Kadikoy"
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // same organisation, no row
const ORG = "org-1";
const DAY = 24 * 60 * 60 * 1000;

const HASH = bcrypt.hashSync("right-password", 4);

type Row = Record<string, any>;

function world(
  opts: { houses?: { house: string; role: string }[]; users?: Row[] } = {},
): StubDb {
  return makeStubDb({
    users: [
      {
        user_id: U,
        email: "p@house.test",
        name: "P",
        password_hash: HASH,
        // The account-wide role and home house: decide nothing for a session.
        role: "owner",
        restaurant_id: A,
        email_verified: true,
      },
      ...(opts.users ?? []),
    ],
    user_restaurant_access: (opts.houses ?? []).map((h) => ({
      user_id: U,
      restaurant_id: h.house,
      role: h.role,
      is_active: true,
    })),
    restaurants: [
      { id: A, name: "Moda", city: "Istanbul", organization_id: ORG },
      { id: B, name: "Kadikoy", city: "Istanbul", organization_id: ORG },
      { id: C, name: "Cihangir", city: "Istanbul", organization_id: ORG },
    ],
    organization_members: [{ organization_id: ORG, user_id: U, role: "owner" }],
    user_roles: [],
    user_oauth_accounts: [],
  });
}

const jwt = new JwtService({});

function service(db: StubDb): AuthService {
  const secrets: Record<string, string> = {
    JWT_SECRET: "test-secret-for-sessions-spec",
    JWT_REFRESH_SECRET: "test-refresh-secret-for-sessions-spec",
  };
  return new AuthService(
    jwt,
    { get: (k: string) => secrets[k] } as any,
    asDatabaseService(db),
    { isBlacklisted: async () => false } as any,
    { sendEmail: async () => undefined } as any,
  );
}

const claims = (token: string) => jwt.decode(token) as JwtPayload;

const login = (db: StubDb, lastHouses?: unknown) =>
  service(db).login({
    email: "p@house.test",
    password: "right-password",
    lastHouses,
  });

const hint = (houseId: string, ageMs: number, userId = U) => [
  { userId, houseId, usedAt: Date.now() - ageMs },
];

describe("sign-in lands by the rule (ADR 0164, R1)", () => {
  it("0 houses: no house and no role, whatever users.role and users.restaurant_id say", async () => {
    const result = await login(world());

    expect(result.restaurantId).toBeNull();
    expect(result.chooseHouse).toBeUndefined();
    expect(claims(result.accessToken)).toMatchObject({
      restaurantId: null,
      role: null,
    });
  });

  it("1 house: that house, at its row's role, however old the hint", async () => {
    const result = await login(
      world({ houses: [{ house: B, role: "manager" }] }),
      hint(A, 90 * DAY),
    );

    expect(result.restaurantId).toBe(B);
    expect(result.chooseHouse).toBeUndefined();
    expect(claims(result.accessToken)).toMatchObject({
      restaurantId: B,
      role: "manager",
    });
  });

  it("2+ houses and no hint: no house, and the houses to choose from, by name", async () => {
    const result = await login(
      world({
        houses: [
          { house: A, role: "owner" },
          { house: B, role: "staff" },
        ],
      }),
    );

    expect(result.restaurantId).toBeNull();
    expect(claims(result.accessToken).restaurantId).toBeNull();
    expect(result.chooseHouse).toEqual({
      houses: [
        { id: B, name: "Kadikoy", city: "Istanbul" },
        { id: A, name: "Moda", city: "Istanbul" },
      ],
    });
  });

  it("2+ houses and this device used one within the window: straight back into it", async () => {
    const result = await login(
      world({
        houses: [
          { house: A, role: "owner" },
          { house: B, role: "staff" },
        ],
      }),
      hint(B, 6 * DAY),
    );

    expect(result.restaurantId).toBe(B);
    expect(result.chooseHouse).toBeUndefined();
    expect(claims(result.accessToken).role).toBe("staff");
  });

  it("2+ houses and the device's last use is older than the window: they choose", async () => {
    const result = await login(
      world({
        houses: [
          { house: A, role: "owner" },
          { house: B, role: "staff" },
        ],
      }),
      hint(B, HOUSE_RETURN_WINDOW_MS + 60_000),
    );

    expect(result.restaurantId).toBeNull();
    expect(result.chooseHouse?.houses).toHaveLength(2);
  });

  it("ignores a hint for a house they are not a member of, and another person's hint", async () => {
    const db = world({
      houses: [
        { house: A, role: "owner" },
        { house: B, role: "staff" },
      ],
    });

    const notMine = await login(db, hint(C, DAY));
    expect(notMine.restaurantId).toBeNull();
    expect(notMine.chooseHouse).toBeDefined();

    const someoneElses = await login(db, hint(B, DAY, OTHER));
    expect(someoneElses.restaurantId).toBeNull();
    expect(someoneElses.chooseHouse).toBeDefined();
  });

  it("dev bypass follows the same rule", async () => {
    const env = { ...process.env };
    process.env.NODE_ENV = "test";
    process.env.DEV_AUTH_BYPASS = "true";
    process.env.DEV_AUTH_BYPASS_EMAIL = "p@house.test";
    try {
      const db = world({
        houses: [
          { house: A, role: "owner" },
          { house: B, role: "staff" },
        ],
      });
      const choose = await service(db).devBypassLogin();
      expect(choose.restaurantId).toBeNull();
      expect(choose.chooseHouse?.houses.map((h) => h.id)).toEqual([B, A]);

      const back = await service(db).devBypassLogin(hint(A, DAY));
      expect(back.restaurantId).toBe(A);
      expect(claims(back.accessToken).devBypass).toBe(true);
    } finally {
      process.env = env;
    }
  });

  it("Google sign-in follows the same rule", async () => {
    const db = world({
      houses: [
        { house: A, role: "owner" },
        { house: B, role: "staff" },
      ],
    });
    const svc = service(db);
    jest
      .spyOn(svc as any, "verifyGoogleToken")
      .mockResolvedValue({ sub: "g-1", email: "p@house.test", name: "P" });
    jest
      .spyOn(svc, "findOrCreateOAuthUser")
      .mockResolvedValue(db.tables.users[0] as any);

    const choose = await svc.loginWithGoogle("google-id-token");
    expect(choose.restaurantId).toBeNull();
    expect(choose.chooseHouse).toBeDefined();

    const back = await svc.loginWithGoogle("google-id-token", hint(B, DAY));
    expect(back.restaurantId).toBe(B);
  });

  it("Microsoft sign-in follows the same rule", async () => {
    const db = world({
      houses: [
        { house: A, role: "owner" },
        { house: B, role: "staff" },
      ],
    });
    const svc = service(db);
    jest
      .spyOn(svc as any, "verifyMicrosoftToken")
      .mockResolvedValue({ oid: "m-1", email: "p@house.test", name: "P" });
    jest
      .spyOn(svc, "findOrCreateOAuthUser")
      .mockResolvedValue(db.tables.users[0] as any);

    const back = await svc.loginWithMicrosoft("ms-id-token", hint(A, DAY));
    expect(back.restaurantId).toBe(A);
    const choose = await svc.loginWithMicrosoft("ms-id-token");
    expect(choose.chooseHouse).toBeDefined();
  });

  it("answers 503, and mints nothing, when the houses cannot be read", async () => {
    const db = world({ houses: [{ house: A, role: "owner" }] });
    db.errors["user_restaurant_access:select"] = {
      message: "connection reset",
    };

    await expect(login(db)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("an INACTIVE row does not count as a house (item 7, 2026-09-19 — mutant V1: memberHouses' is_active filter)", async () => {
    // Same reason as the switchRestaurant case below: `world()` only ever
    // seeds `is_active: true`, so no existing case here could tell apart
    // memberHouses reading only active rows from memberHouses reading every
    // row this person has ever had. One active house (A) and one row for a
    // second house (B) that is not active: this must land as "1 house",
    // not 2 asking to choose.
    const db = makeStubDb({
      users: [
        {
          user_id: U,
          email: "p@house.test",
          password_hash: HASH,
          role: "owner",
          restaurant_id: A,
          email_verified: true,
        },
      ],
      user_restaurant_access: [
        { user_id: U, restaurant_id: A, role: "owner", is_active: true },
        { user_id: U, restaurant_id: B, role: "manager", is_active: false },
      ],
      restaurants: [
        { id: A, name: "Moda", city: "Istanbul", organization_id: ORG },
        { id: B, name: "Kadikoy", city: "Istanbul", organization_id: ORG },
      ],
      organization_members: [{ organization_id: ORG, user_id: U, role: "owner" }],
      user_roles: [],
      user_oauth_accounts: [],
    });

    const result = await login(db);

    expect(result.restaurantId).toBe(A);
    expect(result.chooseHouse).toBeUndefined();
    expect(claims(result.accessToken)).toMatchObject({
      restaurantId: A,
      role: "owner",
    });
  });
});

describe("the return rule itself (house-choice.ts)", () => {
  const now = Date.parse("2026-09-18T12:00:00Z");
  const h = (houseId: string, usedAt: number) => ({
    userId: U,
    houseId,
    usedAt,
  });

  it("returns exactly at the window's edge, and not a minute past it", () => {
    expect(
      signInHouse([A, B], h(A, now - HOUSE_RETURN_WINDOW_MS), now),
    ).toEqual({
      house: A,
      choose: false,
    });
    expect(
      signInHouse([A, B], h(A, now - HOUSE_RETURN_WINDOW_MS - 60_000), now),
    ).toEqual({ house: null, choose: true });
  });

  it("the window is seven days", () => {
    expect(HOUSE_RETURN_WINDOW_MS).toBe(7 * DAY);
  });

  it("reads a clock a little ahead, and not one far ahead", () => {
    expect(
      signInHouse([A, B], h(A, now + HOUSE_HINT_CLOCK_SKEW_MS), now).house,
    ).toBe(A);
    expect(signInHouse([A, B], h(A, now + DAY), now)).toEqual({
      house: null,
      choose: true,
    });
  });

  it("drops malformed hints rather than refusing the sign-in", () => {
    expect(
      parseLastHouseHints([
        { userId: U, houseId: A, usedAt: "2026-09-18T10:00:00Z" },
        { userId: "not-a-uuid", houseId: A, usedAt: 1 },
        { userId: U, houseId: B, usedAt: "yesterday" },
        null,
        "x",
      ]),
    ).toEqual([
      { userId: U, houseId: A, usedAt: Date.parse("2026-09-18T10:00:00Z") },
    ]);
    expect(parseLastHouseHints({ userId: U })).toEqual([]);
  });
});

describe("a removed person is out of that house on their next request (44.1r)", () => {
  async function sessionFor(db: StubDb, house: string | null) {
    const pair = await (service(db) as any).generateTokens(
      db.tables.users[0],
      false,
      house,
    );
    return pair as {
      accessToken: string;
      refreshToken: string;
      restaurantId: string | null;
    };
  }

  it("refresh keeps a member in their house, at their row's role", async () => {
    const db = world({ houses: [{ house: B, role: "manager" }] });
    const pair = await sessionFor(db, B);

    const next = await service(db).refreshAccessToken(pair.refreshToken);

    expect(next.restaurantId).toBe(B);
    expect(next.houseAccessEnded).toBeUndefined();
    expect(claims(next.accessToken)).toMatchObject({
      restaurantId: B,
      role: "manager",
    });
  });

  it("refresh after removal names no house and says which one ended; it moves them nowhere", async () => {
    const db = world({
      houses: [
        { house: A, role: "owner" },
        { house: B, role: "manager" },
      ],
    });
    const pair = await sessionFor(db, B);
    db.tables.user_restaurant_access = db.tables.user_restaurant_access.filter(
      (r) => r.restaurant_id !== B,
    );

    const next = await service(db).refreshAccessToken(pair.refreshToken);

    expect(next.restaurantId).toBeNull();
    expect(next.houseAccessEnded).toEqual({ restaurantId: B });
    expect(claims(next.accessToken)).toMatchObject({
      restaurantId: null,
      role: null,
    });
  });

  it("the next request with the old access token is refused with HOUSE_ACCESS_ENDED", async () => {
    const db = world({ houses: [{ house: B, role: "manager" }] });
    const pair = await sessionFor(db, B);
    db.tables.user_restaurant_access = [];

    const err = await new JwtStrategy(service(db))
      .validate(claims(pair.accessToken))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toMatchObject({
      code: "HOUSE_ACCESS_ENDED",
      restaurantId: B,
    });
  });

  it("refresh answers 503, not a sign-out, when the membership cannot be read", async () => {
    const db = world({ houses: [{ house: B, role: "manager" }] });
    const pair = await sessionFor(db, B);
    db.errors["user_restaurant_access:select"] = {
      message: "connection reset",
    };

    await expect(
      service(db).refreshAccessToken(pair.refreshToken),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("refresh answers 503, not a sign-out, when the person cannot be read", async () => {
    const db = world({ houses: [{ house: B, role: "manager" }] });
    const pair = await sessionFor(db, B);
    db.errors["users:select"] = { message: "connection reset" };

    await expect(
      service(db).refreshAccessToken(pair.refreshToken),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("a bad refresh token is still a 401", async () => {
    await expect(
      service(world()).refreshAccessToken("not-a-token"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("a refresh of a token naming no house stays in no house, whatever the users row names", async () => {
    const db = world({
      houses: [
        { house: A, role: "owner" },
        { house: B, role: "owner" },
      ],
    });
    const pair = await sessionFor(db, null);

    const next = await service(db).refreshAccessToken(pair.refreshToken);

    expect(next.restaurantId).toBeNull();
    expect(next.houseAccessEnded).toBeUndefined();
  });
});

describe("nothing mints a token naming a house without a membership row", () => {
  it("switchRestaurant: the organisation fallback opens nothing", async () => {
    // C is in the person's organisation, and they are its organisation owner,
    // but they hold no row in C.
    const db = world({ houses: [{ house: A, role: "owner" }] });

    const err = await service(db)
      .switchRestaurant(U, C)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: "NOT_A_MEMBER",
    });
  });

  it("switchRestaurant: an INACTIVE row is not a membership either (item 7, 2026-09-19 — mutant V1: generateTokens' is_active filter)", async () => {
    // `world()` can only ever seed `is_active: true`, so nothing in this file
    // could tell a mutant that dropped generateTokens' `.eq("is_active",
    // true)` from the real thing: every row it has ever fed that check was
    // already active. Built directly so this house has a row that is NOT one.
    const db = makeStubDb({
      users: [
        {
          user_id: U,
          email: "p@house.test",
          role: "owner",
          restaurant_id: A,
          email_verified: true,
        },
      ],
      user_restaurant_access: [
        { user_id: U, restaurant_id: A, role: "owner", is_active: true },
        { user_id: U, restaurant_id: B, role: "manager", is_active: false },
      ],
      restaurants: [
        { id: A, name: "Moda", city: "Istanbul", organization_id: ORG },
        { id: B, name: "Kadikoy", city: "Istanbul", organization_id: ORG },
      ],
      organization_members: [{ organization_id: ORG, user_id: U, role: "owner" }],
    });

    const err = await service(db)
      .switchRestaurant(U, B)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: "NOT_A_MEMBER",
    });
  });

  it("switchRestaurant: a member gets the house, at their row's role (this is also how a person chooses)", async () => {
    const db = world({
      houses: [
        { house: A, role: "owner" },
        { house: B, role: "staff" },
      ],
    });

    const pair = await service(db).switchRestaurant(U, B);

    expect(pair.restaurantId).toBe(B);
    expect(claims(pair.accessToken)).toMatchObject({
      restaurantId: B,
      role: "staff",
    });
  });

  it("switchRestaurant keeps a dev-bypass session's marker only where the server honours it", async () => {
    const env = { ...process.env };
    const db = world({
      houses: [
        { house: A, role: "owner" },
        { house: B, role: "staff" },
      ],
    });
    try {
      process.env.NODE_ENV = "test";
      process.env.DEV_AUTH_BYPASS = "true";
      expect(
        claims((await service(db).switchRestaurant(U, B, true)).accessToken)
          .devBypass,
      ).toBe(true);
      process.env.DEV_AUTH_BYPASS = "false";
      expect(
        claims((await service(db).switchRestaurant(U, B, true)).accessToken)
          .devBypass,
      ).toBeUndefined();
    } finally {
      process.env = env;
    }
  });

  it("verifyEmail names the users row's house only if the person is a member there", async () => {
    const db = world({ houses: [{ house: B, role: "owner" }] });
    // users.restaurant_id names A, where there is no row.
    db.tables.email_verifications = [
      {
        id: "v1",
        token: "t-1",
        user_id: U,
        verified_at: null,
        expires_at: new Date(Date.now() + DAY).toISOString(),
      },
    ];

    const pair = await service(db).verifyEmail("t-1");

    expect(pair.restaurantId).toBeNull();
    expect(claims(pair.accessToken).restaurantId).toBeNull();
  });

  it("a session in no house has no role, however users.role reads", async () => {
    const db = world({
      houses: [
        { house: A, role: "staff" },
        { house: B, role: "staff" },
      ],
    });
    const user = await new JwtStrategy(service(db)).validate({
      sub: U,
      email: "p@house.test",
      role: "owner",
    });
    expect(user.role).toBeNull();
    expect(user.restaurantId).toBeNull();
  });
});
