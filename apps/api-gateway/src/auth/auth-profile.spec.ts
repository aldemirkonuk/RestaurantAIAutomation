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

  const from = jest.fn((table: string) => {
    if (table === "users") return usersChain;
    if (table === "user_oauth_accounts") return oauthChain;
    if (table === "user_restaurant_access") return uraChain;
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

  return new AuthService(
    jwtService,
    configService,
    databaseService,
    tokenBlacklist,
    gmail,
  );
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
