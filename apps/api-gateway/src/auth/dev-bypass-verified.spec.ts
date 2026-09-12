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
 * THE SECOND HALF (added in the same branch)
 * -----------------------------------------
 * Reporting the session as verified to `GET /auth/me` gets the founder PAST
 * ProtectedRoute and onto a page — and then every data call behind it took
 * `403 EMAIL_NOT_VERIFIED`, because `JwtAuthGuard` reads
 * `req.user.emailVerified`, which came from the row. So the gate is applied
 * there too, and the tests below drive `JwtStrategy.validate` INTO the real
 * `JwtAuthGuard.canActivate` rather than hand-seeding `req.user` — a check
 * that is correct but unreachable is the exact failure this repo has been
 * bitten by before (see guards/jwt-auth.guard.spec.ts).
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
import { ForbiddenException } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { EMAIL_NOT_VERIFIED_CODE } from "./assert-email-verified";

type Row = Record<string, unknown>;

const BYPASS_EMAIL = "founder@example.com";

/** Any non-default value; `resolveJwtSecret` only rejects unset/published. */
const TEST_SECRET = "test-jwt-secret-not-the-published-default";

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
  const jwt = {
    sign: jest.fn((payload: any) => {
      signed.push(payload);
      return "signed.jwt.token";
    }),
    verify: jest.fn(),
    decode: jest.fn(),
  };

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
    jwt as any,
    // `resolveJwtSecret` REFUSES to construct under NODE_ENV=production with no
    // secret — correctly. The production-case tests below are about the bypass
    // gate, not about that guard, so give them the secret a real production
    // server would have.
    {
      get: jest.fn((key: string) =>
        key === "JWT_SECRET" ? TEST_SECRET : undefined,
      ),
    } as any,
    { supabase: { from } } as any,
    { blacklistToken: jest.fn() } as any,
    {} as any,
  );

  return { service, signed, jwt };
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

const MARKED_PAYLOAD: any = { ...PAYLOAD, devBypass: true };

describe("dev bypass: JwtStrategy projects the marker onto req.user", () => {
  const ORIGINAL = { ...process.env };

  // Every test in here sets the env it means to test. Leaving it implicit
  // would make the result depend on the runner's NODE_ENV, and a test that
  // passes for a reason it did not state is not evidence.
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  function devEnv() {
    process.env.NODE_ENV = "development";
    process.env.DEV_AUTH_BYPASS = "true";
  }

  it("carries devBypass: true through", async () => {
    devEnv();
    const result = await strategyFor(BYPASS_ROW).validate(MARKED_PAYLOAD);
    expect(result.devBypass).toBe(true);
  });

  it("reports false when the claim is absent", async () => {
    devEnv();
    const result = await strategyFor(BYPASS_ROW).validate(PAYLOAD);
    expect(result.devBypass).toBe(false);
  });

  it("sets emailVerified: true for a marked session, from an unverified row", async () => {
    // This is the field `assertEmailVerified` reads. The row still says false
    // and is never written.
    devEnv();
    const result = await strategyFor(BYPASS_ROW).validate(MARKED_PAYLOAD);
    expect(result.emailVerified).toBe(true);
    expect(BYPASS_ROW.email_verified).toBe(false);
  });

  it("leaves emailVerified at the row value under NODE_ENV=production", async () => {
    process.env.NODE_ENV = "production";
    process.env.DEV_AUTH_BYPASS = "true";
    process.env.JWT_SECRET = TEST_SECRET;
    const result = await strategyFor(BYPASS_ROW).validate(MARKED_PAYLOAD);
    expect(result.emailVerified).toBe(false);
  });

  it("leaves emailVerified at the row value when DEV_AUTH_BYPASS is unset", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.DEV_AUTH_BYPASS;
    const result = await strategyFor(BYPASS_ROW).validate(MARKED_PAYLOAD);
    expect(result.emailVerified).toBe(false);
  });

  it("still reports the marker even where the environment refuses to honour it", async () => {
    // `devBypass` answers "is this a dev session?", which is true regardless.
    // Collapsing it into the gate would make "not a dev session" and "a dev
    // session this server ignores" the same value — and the second is the one
    // worth seeing in a log.
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = TEST_SECRET;
    const result = await strategyFor(BYPASS_ROW).validate(MARKED_PAYLOAD);
    expect(result.devBypass).toBe(true);
    expect(result.emailVerified).toBe(false);
  });

  it("never lets an unmarked session inherit verification", async () => {
    devEnv();
    const result = await strategyFor(BYPASS_ROW).validate(PAYLOAD);
    expect(result.emailVerified).toBe(false);
  });
});

/**
 * (e) and (f): the wiring, driven end to end.
 *
 * `JwtStrategy.validate` builds `req.user`; `JwtAuthGuard.canActivate` reads
 * it. Hand-seeding `req.user` here would test the guard against a fixture
 * rather than against what the strategy actually produces, and "correct
 * comparison, unreachable code" is precisely the shape that made the tenant
 * check inert on every authenticated route. So these run the real strategy and
 * feed its output to the real guard, with only passport itself stubbed.
 */
describe("dev bypass: a marked session reaches a guarded handler", () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.restoreAllMocks();
  });

  function makeGuard(metadata: Record<string, boolean> = {}) {
    const reflector = {
      getAllAndOverride: jest.fn(
        (key: string) => metadata[key] as boolean | undefined,
      ),
    } as any;
    const blacklist = {
      isBlacklisted: jest.fn().mockResolvedValue(false),
    } as any;
    return new JwtAuthGuard(reflector, blacklist);
  }

  /** Stand in for passport: succeed, leaving `request.user` as seeded. */
  function stubPassport(guard: JwtAuthGuard) {
    const parent = Object.getPrototypeOf(Object.getPrototypeOf(guard));
    return jest.spyOn(parent, "canActivate").mockResolvedValue(true as any);
  }

  function contextFor(user: Record<string, unknown>) {
    const request: any = { headers: {}, params: {}, query: {}, body: {}, user };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as any;
  }

  it("(e) passes the guard's email check on a route with no @AllowUnverified", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_AUTH_BYPASS = "true";

    const reqUser = await strategyFor(BYPASS_ROW).validate(MARKED_PAYLOAD);
    const guard = makeGuard();
    stubPassport(guard);

    await expect(guard.canActivate(contextFor(reqUser))).resolves.toBe(true);
  });

  it("(f) the SAME token is refused 403 EMAIL_NOT_VERIFIED under NODE_ENV=production", async () => {
    process.env.NODE_ENV = "production";
    process.env.DEV_AUTH_BYPASS = "true";
    process.env.JWT_SECRET = TEST_SECRET;

    const reqUser = await strategyFor(BYPASS_ROW).validate(MARKED_PAYLOAD);
    const guard = makeGuard();
    stubPassport(guard);

    // Captured rather than asserted through `.rejects` + `.catch`: if the call
    // ever RESOLVED, a trailing `.catch` would simply not run and the code
    // assertion would vanish silently — a test that passes by not executing.
    // Here a resolve yields `null` and fails the first expectation loudly.
    const err = await guard.canActivate(contextFor(reqUser)).then(
      () => null,
      (e: any) => e,
    );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse().code).toBe(EMAIL_NOT_VERIFIED_CODE);
  });

  it("is refused when DEV_AUTH_BYPASS is not set, on any NODE_ENV", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.DEV_AUTH_BYPASS;

    const reqUser = await strategyFor(BYPASS_ROW).validate(MARKED_PAYLOAD);
    const guard = makeGuard();
    stubPassport(guard);

    await expect(guard.canActivate(contextFor(reqUser))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("an unmarked unverified session is still refused with the bypass fully on", async () => {
    // The blast radius: enabling the bypass must not verify OTHER sessions.
    process.env.NODE_ENV = "development";
    process.env.DEV_AUTH_BYPASS = "true";

    const reqUser = await strategyFor(BYPASS_ROW).validate(PAYLOAD);
    const guard = makeGuard();
    stubPassport(guard);

    await expect(guard.canActivate(contextFor(reqUser))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

/** (g): the marker has to survive the 15-minute access-token expiry. */
describe("dev bypass: refreshAccessToken", () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  async function refreshWith(refreshPayload: Record<string, unknown>) {
    const { service, signed, jwt } = makeAuthService(BYPASS_ROW);
    jwt.verify.mockReturnValue(refreshPayload as any);
    await service.refreshAccessToken("refresh.jwt.token");
    return signed;
  }

  it("keeps the marker and emailVerified when both gates hold", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_AUTH_BYPASS = "true";

    const signed = await refreshWith({
      sub: "u-dev",
      restaurantId: "r1",
      devBypass: true,
    });

    expect(signed.length).toBeGreaterThan(0);
    for (const payload of signed) {
      expect(payload.devBypass).toBe(true);
      expect(payload.emailVerified).toBe(true);
    }
  });

  it("drops the marker under NODE_ENV=production", async () => {
    process.env.NODE_ENV = "production";
    process.env.DEV_AUTH_BYPASS = "true";
    process.env.JWT_SECRET = TEST_SECRET;

    const signed = await refreshWith({
      sub: "u-dev",
      restaurantId: "r1",
      devBypass: true,
    });

    for (const payload of signed) {
      expect("devBypass" in payload).toBe(false);
      expect(payload.emailVerified).toBe(false);
    }
  });

  it("drops the marker when DEV_AUTH_BYPASS is not set", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.DEV_AUTH_BYPASS;

    const signed = await refreshWith({
      sub: "u-dev",
      restaurantId: "r1",
      devBypass: true,
    });

    for (const payload of signed) {
      expect("devBypass" in payload).toBe(false);
      expect(payload.emailVerified).toBe(false);
    }
  });

  it("does not invent a marker for an ordinary refresh token", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_AUTH_BYPASS = "true";

    const signed = await refreshWith({ sub: "u-dev", restaurantId: "r1" });

    for (const payload of signed) {
      expect("devBypass" in payload).toBe(false);
      expect(payload.emailVerified).toBe(false);
    }
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
    process.env.JWT_SECRET = TEST_SECRET;

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
