import { AuthService } from "./auth.service";
import { BadRequestException } from "@nestjs/common";

function makeAuthService(
  userRow: Record<string, unknown>,
  oauthRows: { provider: string }[] = [],
) {
  const usersChain: any = {
    select: () => usersChain,
    update: () => usersChain,
    delete: () => usersChain,
    eq: () => usersChain,
    single: jest.fn().mockResolvedValue({ data: userRow, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: userRow, error: null }),
  };

  const oauthChain: any = {
    select: () => {
      const c: any = {
        eq: () => ({
          then: (resolve: any) => resolve({ data: oauthRows, error: null }),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      };
      return c;
    },
    delete: () => ({
      eq: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
    upsert: () => Promise.resolve({ error: null }),
  };

  const uraChain: any = {
    select: () => uraChain,
    delete: () => uraChain,
    eq: () => uraChain,
    maybeSingle: jest.fn().mockResolvedValue({
      data: { role: "manager" },
      error: null,
    }),
  };
  uraChain.then = (resolve: any) =>
    resolve({ count: 2, data: [], error: null });

  const rolesChain: any = {
    select: () => rolesChain,
    eq: () => rolesChain,
    is: jest.fn().mockResolvedValue({ data: [], error: null }),
  };

  const from = jest.fn((table: string) => {
    if (table === "users") return usersChain;
    if (table === "user_oauth_accounts") return oauthChain;
    if (table === "user_restaurant_access") return uraChain;
    if (table === "user_roles") return rolesChain;
    return usersChain;
  });

  const databaseService = { supabase: { from } } as any;
  const jwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
    decode: jest.fn(),
  } as any;
  const configService = { get: jest.fn() } as any;
  const tokenBlacklist = { blacklistToken: jest.fn() } as any;
  const gmail = {} as any;

  const service = new AuthService(
    jwtService,
    configService,
    databaseService,
    tokenBlacklist,
    gmail,
  );
  // Exposed so the token-payload test can assert on what was signed;
  // `generateTokens` is private and has no other seam.
  (service as any).__jwtService = jwtService;
  return service;
}

describe("AuthService profile APIs", () => {
  it("getProfileForUser returns hasPassword and linked providers", async () => {
    const svc = makeAuthService(
      {
        user_id: "u1",
        email: "a@b.com",
        name: "Ada",
        phone: null,
        role: "manager",
        password_hash: "hash",
        oauth_provider: null,
      },
      [{ provider: "google" }],
    );

    const profile = await svc.getProfileForUser("u1");
    expect(profile.userId).toBe("u1");
    expect(profile.hasPassword).toBe(true);
    expect(profile.linkedProviders.google).toBe(true);
    expect(profile.linkedProviders.microsoft).toBe(false);
  });

  // OD-79: /auth/me is the ONLY source AuthContext uses to populate `user`,
  // and ProtectedRoute gates on `user?.emailVerified === false`. While the
  // field was omitted that comparison was `undefined === false` — always
  // false — so the gate could never fire. These assert the field is present
  // AND strictly boolean, because `undefined` is the exact bug.
  it("getProfileForUser surfaces emailVerified: true", async () => {
    const svc = makeAuthService({
      user_id: "u1",
      email: "a@b.com",
      name: "Ada",
      phone: null,
      role: "manager",
      password_hash: "hash",
      email_verified: true,
    });

    const profile = await svc.getProfileForUser("u1");
    expect(profile.emailVerified).toBe(true);
  });

  it("getProfileForUser surfaces emailVerified: false, not undefined", async () => {
    const svc = makeAuthService({
      user_id: "u1",
      email: "a@b.com",
      name: "Ada",
      phone: null,
      role: "manager",
      password_hash: "hash",
      email_verified: false,
    });

    const profile = await svc.getProfileForUser("u1");
    expect(profile.emailVerified).toBe(false);
    // `undefined === false` is false, which is what disabled the gate.
    expect(profile.emailVerified).not.toBeUndefined();
  });

  it("getProfileForUser defaults a missing email_verified column to false", async () => {
    const svc = makeAuthService({
      user_id: "u1",
      email: "a@b.com",
      name: "Ada",
      phone: null,
      role: "manager",
      password_hash: "hash",
    });

    const profile = await svc.getProfileForUser("u1");
    expect(profile.emailVerified).toBe(false);
  });

  // Closes a coverage hole found while verifying this fix: `generateTokens`
  // has signed `emailVerified` into every token since before OD-79, and
  // nothing asserted it. Deleting that line broke no test — which is why a
  // revert aimed at it looked like a passing revert.
  it("generateTokens signs emailVerified into the token payload", async () => {
    const svc = makeAuthService({
      user_id: "u1",
      email: "a@b.com",
      name: "Ada",
      role: "manager",
      password_hash: "hash",
      restaurant_id: null,
      email_verified: true,
    });

    await (svc as any).generateTokens({
      user_id: "u1",
      email: "a@b.com",
      role: "manager",
      restaurant_id: null,
      email_verified: true,
    });

    const signed = (svc as any).__jwtService.sign.mock.calls[0][0];
    expect(signed.emailVerified).toBe(true);
  });

  it("updateProfile rejects short names", async () => {
    const svc = makeAuthService({
      user_id: "u1",
      email: "a@b.com",
      name: "Ada",
      phone: null,
      role: "manager",
      password_hash: "hash",
    });

    await expect(svc.updateProfile("u1", { name: "A" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("changePassword requires current password when one is set", async () => {
    const svc = makeAuthService({
      user_id: "u1",
      email: "a@b.com",
      name: "Ada",
      phone: null,
      role: "manager",
      password_hash: "hash",
    });

    await expect(
      svc.changePassword("u1", undefined, "newpassword1"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("unlinkOAuthProvider blocks removing the only sign-in method", async () => {
    const svc = makeAuthService(
      {
        user_id: "u1",
        email: "a@b.com",
        name: "Ada",
        phone: null,
        role: "manager",
        password_hash: null,
        oauth_provider: "google",
      },
      [{ provider: "google" }],
    );

    await expect(
      svc.unlinkOAuthProvider("u1", "google"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
