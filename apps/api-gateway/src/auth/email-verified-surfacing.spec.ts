/**
 * OD-79 — `emailVerified` must reach the two places that can act on it.
 *
 * The defect these tests pin was structural, not a wrong comparison:
 *   - `getProfileForUser` did not SELECT `email_verified` and did not return
 *     it, so `GET /auth/me` could never report verification state.
 *   - `JwtStrategy.validate` did not project it onto `req.user`, so no
 *     server-side check was even expressible.
 *
 * WHY THE USERS MOCK PROJECTS THE SELECT LIST
 * -------------------------------------------
 * The obvious mock (`select: () => chain`) ignores the column list and hands
 * back the whole fixture row. Against that mock, deleting `email_verified`
 * from the production SELECT still yields a passing test — the assertion
 * would be checking the fixture, not the query. This repo has been bitten by
 * exactly that shape before, so the mock below behaves like PostgREST and
 * returns ONLY the columns the caller asked for. Dropping the column from
 * either the select list or the returned object fails these tests.
 */
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";

type Row = Record<string, unknown>;

/** A `users` chain that honours `.select()` the way PostgREST does. */
function usersChainProjecting(row: Row) {
  let selected: string[] | null = null;
  const chain: any = {
    select: (cols?: string) => {
      selected =
        typeof cols === "string" && cols.trim() !== "" && cols.trim() !== "*"
          ? cols.split(",").map((c) => c.trim())
          : null;
      return chain;
    },
    eq: () => chain,
    update: () => chain,
    single: async () => ({ data: project(row, selected), error: null }),
    maybeSingle: async () => ({ data: project(row, selected), error: null }),
  };
  return chain;
}

function project(row: Row, selected: string[] | null): Row {
  if (!selected) return { ...row };
  const out: Row = {};
  for (const col of selected) if (col in row) out[col] = row[col];
  return out;
}

function makeAuthService(userRow: Row) {
  const oauthChain: any = {
    select: () => ({
      eq: () => ({
        then: (resolve: any) => resolve({ data: [], error: null }),
      }),
    }),
  };

  const from = jest.fn((table: string) =>
    table === "user_oauth_accounts" ? oauthChain : usersChainProjecting(userRow),
  );

  return new AuthService(
    { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() } as any,
    { get: jest.fn() } as any,
    { supabase: { from } } as any,
    { blacklistToken: jest.fn() } as any,
    {} as any,
  );
}

const BASE_ROW: Row = {
  user_id: "u1",
  email: "owner@example.com",
  name: "Ada",
  phone: null,
  role: "owner",
  password_hash: "$2b$10$hash",
  oauth_provider: null,
  restaurant_id: "r1",
};

describe("OD-79: GET /auth/me surfaces emailVerified", () => {
  it("returns emailVerified: true for a verified account", async () => {
    const svc = makeAuthService({ ...BASE_ROW, email_verified: true });
    const profile = await svc.getProfileForUser("u1");
    expect(profile).toHaveProperty("emailVerified");
    expect(profile.emailVerified).toBe(true);
  });

  it("returns emailVerified: false for an unverified account", async () => {
    const svc = makeAuthService({ ...BASE_ROW, email_verified: false });
    const profile = await svc.getProfileForUser("u1");
    expect(profile.emailVerified).toBe(false);
  });

  it("reports false, never undefined, when the column is NULL", async () => {
    // The web reader compares `emailVerified === false`. `undefined` is the
    // exact value that made the gate unfireable, so the contract is that this
    // key is always a boolean.
    const svc = makeAuthService({ ...BASE_ROW, email_verified: null });
    const profile = await svc.getProfileForUser("u1");
    expect(profile.emailVerified).toBe(false);
    expect(profile.emailVerified).not.toBeUndefined();
  });

  it("asks the database for the column (guards the SELECT list itself)", async () => {
    // Belt-and-braces on top of the projecting mock: name the regression
    // directly, so a future edit that trims the select list fails with a
    // message that says which column went missing.
    const captured: string[] = [];
    const chain: any = {
      select: (cols: string) => {
        captured.push(cols);
        return chain;
      },
      eq: () => chain,
      single: async () => ({
        data: { ...BASE_ROW, email_verified: true },
        error: null,
      }),
      // `getLinkedProviders` also reads `users`, via maybeSingle().
      maybeSingle: async () => ({
        data: { ...BASE_ROW, email_verified: true },
        error: null,
      }),
    };
    const oauthChain: any = {
      select: () => ({
        eq: () => ({ then: (r: any) => r({ data: [], error: null }) }),
      }),
    };
    const svc = new AuthService(
      { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() } as any,
      { get: jest.fn() } as any,
      {
        supabase: {
          from: (t: string) => (t === "user_oauth_accounts" ? oauthChain : chain),
        },
      } as any,
      { blacklistToken: jest.fn() } as any,
      {} as any,
    );
    await svc.getProfileForUser("u1");
    expect(captured.join(" ")).toContain("email_verified");
  });
});

describe("OD-79: JwtStrategy projects emailVerified onto req.user", () => {
  function strategyFor(userRow: Row) {
    const authService = {
      validateJwtPayload: jest.fn().mockResolvedValue(userRow),
    } as any;
    return new JwtStrategy(authService);
  }

  const PAYLOAD = {
    sub: "u1",
    email: "owner@example.com",
    role: "owner",
    restaurantId: "r1",
  } as any;

  it("carries emailVerified: true through to req.user", async () => {
    const strategy = strategyFor({ ...BASE_ROW, email_verified: true });
    const result = await strategy.validate(PAYLOAD);
    expect(result).toHaveProperty("emailVerified");
    expect(result.emailVerified).toBe(true);
  });

  it("carries emailVerified: false through to req.user", async () => {
    const strategy = strategyFor({ ...BASE_ROW, email_verified: false });
    const result = await strategy.validate(PAYLOAD);
    expect(result.emailVerified).toBe(false);
  });

  it("prefers the database row over the signed payload", async () => {
    // An access token lives 15 minutes. If the projection trusted
    // `payload.emailVerified`, a user who just verified would keep presenting
    // `false` until it expired, and a flag cleared by an operator would keep
    // presenting `true`. The DB row is the only current answer.
    const strategy = strategyFor({ ...BASE_ROW, email_verified: true });
    const staleFalse = { ...PAYLOAD, emailVerified: false };
    const result = await strategy.validate(staleFalse);
    expect(result.emailVerified).toBe(true);
  });

  it("defaults to false when the column is NULL", async () => {
    const strategy = strategyFor({ ...BASE_ROW, email_verified: null });
    const result = await strategy.validate(PAYLOAD);
    expect(result.emailVerified).toBe(false);
  });
});
