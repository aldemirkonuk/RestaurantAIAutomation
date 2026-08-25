import { UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { AuthService } from "./auth.service";

/**
 * `POST /auth/join` — account takeover, closed 2026-08-26.
 *
 * `JoinViaInviteDto` requires a password, but it was consumed only by the
 * NEW-user branch. When the supplied email matched an existing account, the
 * code assigned `user = existingUser` and fell through to token generation
 * with nothing verified. The route is `@Public()`, so any holder of one unused
 * invite code could type someone else's email — the owner's, say — and receive
 * a working session for that account.
 *
 * Joining an ADDITIONAL restaurant with an existing account is a legitimate
 * flow and still works; it now costs that account's own password.
 */

function makeService(opts: {
  invite?: any;
  existingUser?: any;
  existingAccess?: any;
}) {
  const invite = opts.invite ?? {
    id: "inv-1",
    restaurant_id: "rest-1",
    role: "staff",
    email: null,
  };

  const chain = (result: any): any => {
    const c: any = {
      select: () => c,
      update: () => c,
      insert: () => c,
      upsert: () => c,
      delete: () => c,
      order: () => c,
      limit: () => c,
      eq: () => c,
      is: () => c,
      gt: () => c,
      maybeSingle: jest.fn().mockResolvedValue(result),
      single: jest.fn().mockResolvedValue(result),
    };
    return c;
  };

  const supabase = {
    from: (table: string) => {
      if (table === "organization_invites")
        return chain({ data: invite, error: null });
      if (table === "users")
        return chain({ data: opts.existingUser ?? null, error: null });
      if (table === "user_restaurant_access")
        return chain({ data: opts.existingAccess ?? null, error: null });
      return chain({ data: null, error: null });
    },
  };

  // Order matters: (jwtService, configService, databaseService,
  // tokenBlacklistService, gmailService) — auth.service.ts:58-64.
  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    {
      get: (k: string) =>
        k === "JWT_SECRET" ? "test-secret-value" : undefined,
    } as any,
    { supabase } as any,
    {
      isBlacklisted: async () => false,
      blacklist: async () => undefined,
    } as any,
    { sendEmail: async () => undefined } as any,
  );
  // The takeover is entirely upstream of token minting and membership
  // bookkeeping; stubbing them keeps the test on the branch under scrutiny.
  (svc as any).generateTokens = jest
    .fn()
    .mockResolvedValue({ accessToken: "a", refreshToken: "r" });
  (svc as any).claimTeamMemberFromInvite = jest
    .fn()
    .mockResolvedValue(undefined);
  return svc;
}

describe("AuthService#joinViaInvite — existing account branch", () => {
  const email = "owner@restaurant.com";

  it("refuses to hand over an existing account on a wrong password", async () => {
    const existingUser = {
      user_id: "victim",
      email,
      name: "Owner",
      password_hash: await bcrypt.hash("the-real-password", 10),
    };
    const svc = makeService({ existingUser });

    await expect(
      svc.joinViaInvite({
        code: "INVITE",
        email,
        name: "Attacker",
        password: "not-the-password",
      } as any),
    ).rejects.toThrow(UnauthorizedException);

    // The decisive assertion: no session was minted for the victim.
    expect((svc as any).generateTokens).not.toHaveBeenCalled();
  });

  it("refuses when the existing account has no usable password hash", async () => {
    // OAuth-only accounts have no local password. Comparing against an empty
    // or absent hash must fail closed rather than pass vacuously.
    const svc = makeService({
      existingUser: { user_id: "victim", email, password_hash: null },
    });

    await expect(
      svc.joinViaInvite({
        code: "INVITE",
        email,
        name: "Attacker",
        password: "anything",
      } as any),
    ).rejects.toThrow(UnauthorizedException);
    expect((svc as any).generateTokens).not.toHaveBeenCalled();
  });

  it("still lets the real owner join an additional restaurant", async () => {
    const password = "the-real-password";
    const svc = makeService({
      existingUser: {
        user_id: "owner",
        email,
        name: "Owner",
        password_hash: await bcrypt.hash(password, 10),
      },
    });

    await expect(
      svc.joinViaInvite({
        code: "INVITE",
        email,
        name: "Owner",
        password,
      } as any),
    ).resolves.toEqual({ accessToken: "a", refreshToken: "r" });
    expect((svc as any).generateTokens).toHaveBeenCalled();
  });
});
