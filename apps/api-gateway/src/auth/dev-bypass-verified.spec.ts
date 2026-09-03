/**
 * A dev-bypass session must report itself as verified — and nothing else may.
 *
 * THE DEFECT
 * ----------
 * `POST /api/v1/auth/dev-bypass-login` mints a real session for
 * DEV_AUTH_BYPASS_EMAIL. That account's `users.email_verified` is false in the
 * database, and `ProtectedRoute` (apps/web/src/components/ProtectedRoute.tsx:42)
 * redirects on `user?.emailVerified === false`. So the bypass issued a working
 * token that could not open a single page: every route went to /verify-email.
 *
 * WHY THE FIX IS A CLAIM AND NOT A COLUMN
 * ---------------------------------------
 * Setting `email_verified = true` on the row would edit production-shaped data
 * to work around a local tool, and would follow the account anywhere the row
 * goes. Instead the token carries a `devBypass` marker, and the ONE reader that
 * has to act on it re-checks the environment at read time.
 *
 * WHAT THESE TESTS ARE GUARDING AGAINST
 * -------------------------------------
 * Not "does the happy path work" — that is one test of five. The rest pin the
 * blast radius, because the failure mode of a bypass is silent over-reach:
 *   - a normal token must not carry the marker AT ALL (not even `false`);
 *   - the marker must be inert when NODE_ENV=production, even though the
 *     signature is still valid there;
 *   - the marker must be inert when DEV_AUTH_BYPASS is not "true";
 *   - a session without the marker must always get the database column.
 * The lesson is taken from the OAuth self-provision hole
 * (.planning/v3.0-TECH-DEBT.md:732): an unset env var must never be the only
 * thing between a caller and a privilege.
 */
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";

type Row = Record<string, unknown>;

const BYPASS_EMAIL = "founder@example.com";

/** The bypass account as it actually is in the database: NOT verified. */
const BYPASS_ROW: Row = {
  user_id: "u-dev",
  email: BYPASS_EMAIL,
  name: "Founder",
  role: "owner",
  restaurant_id: "r1",
  email_verified: false,
};

/**
 * An AuthService whose only real behaviour is `jwtService.sign` capture.
 * `generateTokens` also reads `user_roles` and `user_restaurant_access`; both
 * are stubbed to the empty/absent answer so the payload under test is the
 * user row plus whatever the bypass adds.
 */
function makeAuthService(userRow: Row) {
  const signed: Array<Record<string, any>> = [];

  const usersChain: any = {
    select: () => usersChain,
    eq: () => usersChain,
    maybeSingle: async () => ({ data: userRow, error: null }),
    single: async () => ({ data: userRow, error: null }),
  };
  const rolesChain: any = {
    select: () => rolesChain,
    eq: () => rolesChain,
    is: () => Promise.resolve({ data: [], error: null }),
  };
  const accessChain: any = {
    select: () => accessChain,
    eq: () => accessChain,
    maybeSingle: async () => ({ data: null, error: null }),
  };

  const from = jest.fn((table: string) => {
    if (table === "user_roles") return rolesChain;
    if (table === "user_restaurant_access") return accessChain;
    return usersChain;
  });

  const service = new AuthService(
    {
      sign: jest.fn((payload: any) => {
        signed.push(payload);
        return "signed.jwt.token";
      }),
      verify: jest.fn(),
      decode: jest.fn(),
    } as any,
    { get: jest.fn() } as any,
    { supabase: { from } } as any,
    { blacklistToken: jest.fn() } as any,
    {} as any,
  );

  return { service, signed };
}

/** The profile `getProfileForUser` returns for the bypass account. */
const UNVERIFIED_PROFILE = {
  userId: "u-dev",
  email: BYPASS_EMAIL,
  name: "Founder",
  phone: null,
  role: "owner",
  restaurantId: "r1",
  hasPassword: true,
  linkedProviders: [],
  emailVerified: false,
};

function controllerReturning(profile: Record<string, unknown>) {
  return new AuthController({
    getProfileForUser: jest.fn().mockResolvedValue(profile),
  } as any);
}

/** `GET /auth/me` with a given `req.user`. */
async function getProfile(reqUser: Record<string, unknown>) {
  const controller = controllerReturning({ ...UNVERIFIED_PROFILE });
  const res: any = await controller.getProfile({ user: reqUser } as any);
  return res.user;
}

describe("dev bypass: the minted token", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = "development";
    process.env.DEV_AUTH_BYPASS = "true";
    process.env.DEV_AUTH_BYPASS_EMAIL = BYPASS_EMAIL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("signs emailVerified: true even though the row says false", async () => {
    const { service, signed } = makeAuthService(BYPASS_ROW);
    await service.devBypassLogin();

    expect(signed.length).toBeGreaterThan(0);
    // Both the access and the refresh token are signed from one payload.
    for (const payload of signed) {
      expect(payload.emailVerified).toBe(true);
    }
    // The row itself is the control: if a future edit "fixes" this by reading
    // a different column, this assertion still holds and the next one fails.
    expect(BYPASS_ROW.email_verified).toBe(false);
  });

  it("signs an explicit devBypass: true marker", async () => {
    const { service, signed } = makeAuthService(BYPASS_ROW);
    await service.devBypassLogin();

    for (const payload of signed) {
      expect(payload.devBypass).toBe(true);
    }
  });

  it("still mints only for DEV_AUTH_BYPASS_EMAIL", async () => {
    // The marker must not have widened WHO gets a session. The lookup is by
    // the env-named address and nothing else.
    const { service } = makeAuthService(BYPASS_ROW);
    delete process.env.DEV_AUTH_BYPASS_EMAIL;
    await expect(service.devBypassLogin()).rejects.toThrow(
      "DEV_AUTH_BYPASS_EMAIL is not set",
    );
  });

  it("refuses to mint at all when DEV_AUTH_BYPASS is off", async () => {
    const { service } = makeAuthService(BYPASS_ROW);
    process.env.DEV_AUTH_BYPASS = "false";
    await expect(service.devBypassLogin()).rejects.toThrow(
      "Dev auth bypass is not enabled",
    );
  });

  it("a NORMAL login omits the marker entirely and signs the row's value", async () => {
    // Absent, not `false`. Two ways to say "not a dev session" is one way too
    // many — a reader that checked truthiness would still be correct, but a
    // reader that checked `in` would not.
    const { service, signed } = makeAuthService({
      ...BYPASS_ROW,
      password_hash: "$2b$10$hash",
    });
    await (service as any).generateTokens(BYPASS_ROW);

    expect(signed.length).toBeGreaterThan(0);
    for (const payload of signed) {
      expect(payload.emailVerified).toBe(false);
      expect("devBypass" in payload).toBe(false);
    }
  });
});

describe("dev bypass: JwtStrategy projects the marker onto req.user", () => {
  function strategyFor(userRow: Row) {
    return new JwtStrategy({
      validateJwtPayload: jest.fn().mockResolvedValue(userRow),
    } as any);
  }

  const PAYLOAD: any = {
    sub: "u-dev",
    email: BYPASS_EMAIL,
    role: "owner",
    restaurantId: "r1",
  };

  it("carries devBypass: true through", async () => {
    const result = await strategyFor(BYPASS_ROW).validate({
      ...PAYLOAD,
      devBypass: true,
    });
    expect(result.devBypass).toBe(true);
  });

  it("reports false when the claim is absent", async () => {
    const result = await strategyFor(BYPASS_ROW).validate(PAYLOAD);
    expect(result.devBypass).toBe(false);
  });

  it("does NOT let the marker touch req.user.emailVerified", async () => {
    // `assertEmailVerified` reads `req.user.emailVerified` on every guarded
    // route. Widening it here would turn a display fix into a server-side
    // authorisation change, so the database row stays the answer.
    const result = await strategyFor(BYPASS_ROW).validate({
      ...PAYLOAD,
      devBypass: true,
    });
    expect(result.emailVerified).toBe(false);
  });
});

describe("dev bypass: GET /auth/me", () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("reports emailVerified: true when the marker and both env gates hold", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_AUTH_BYPASS = "true";

    const user = await getProfile({
      userId: "u-dev",
      restaurantId: "r1",
      emailVerified: false,
      devBypass: true,
    });

    expect(user.emailVerified).toBe(true);
  });

  it("returns the database value under NODE_ENV=production", async () => {
    // Same signed token, different server. The signature is still valid in
    // production — the claim is what must be inert, not the token.
    process.env.NODE_ENV = "production";
    process.env.DEV_AUTH_BYPASS = "true";

    const user = await getProfile({
      userId: "u-dev",
      restaurantId: "r1",
      emailVerified: false,
      devBypass: true,
    });

    expect(user.emailVerified).toBe(false);
  });

  it("returns the database value when DEV_AUTH_BYPASS is not set", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.DEV_AUTH_BYPASS;

    const user = await getProfile({
      userId: "u-dev",
      restaurantId: "r1",
      emailVerified: false,
      devBypass: true,
    });

    expect(user.emailVerified).toBe(false);
  });

  it("returns the database value for a normal session (no marker)", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_AUTH_BYPASS = "true";

    const user = await getProfile({
      userId: "u-dev",
      restaurantId: "r1",
      emailVerified: false,
    });

    expect(user.emailVerified).toBe(false);
  });

  it("does not invent verification for a verified-column account either", async () => {
    // The override only ever forces TRUE. A verified account with no marker
    // must still read true — i.e. the branch must not have replaced the
    // column with the marker.
    process.env.NODE_ENV = "development";
    process.env.DEV_AUTH_BYPASS = "true";

    const controller = controllerReturning({
      ...UNVERIFIED_PROFILE,
      emailVerified: true,
    });
    const res: any = await controller.getProfile({
      user: { userId: "u-dev", restaurantId: "r1", emailVerified: true },
    } as any);

    expect(res.user.emailVerified).toBe(true);
  });
});
