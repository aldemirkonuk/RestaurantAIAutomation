import { HttpException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import * as bcrypt from "bcrypt";
import { readFileSync } from "fs";
import { resolve } from "path";
import { AuthService } from "./auth.service";
import { AuthController, inviteLogRef } from "./auth.controller";
import { SignInAttempts } from "./sign-in-attempts";
import { clientIp } from "../common/rate-limit/client-ip";
import { RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";

/**
 * Wave 14 sim, public landing + auth edges (2026-10-09): F-510 to F-515.
 * Each block fails against origin/main 31152ab34 and passes after.
 */

const ISSUER = "issuer-1";
const HOUSE = "rest-1";
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

function makeService(tables: Record<string, any[]>) {
  const db = makeStubDb({
    organization_invites: [],
    users: [],
    user_restaurant_access: [
      { user_id: ISSUER, restaurant_id: HOUSE, role: "owner", is_active: true },
    ],
    organization_members: [],
    user_oauth_accounts: [],
    ...tables,
  });
  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    {
      get: (k: string) =>
        k === "JWT_SECRET" ? "test-secret-value" : undefined,
    } as any,
    asDatabaseService(db),
    {
      isBlacklisted: async () => false,
      blacklist: async () => undefined,
    } as any,
    { sendEmail: async () => undefined } as any,
  );
  (svc as any).signIn = jest
    .fn()
    .mockResolvedValue({ accessToken: "a", refreshToken: "r" });
  (svc as any).generateTokens = jest
    .fn()
    .mockResolvedValue({ accessToken: "a", refreshToken: "r" });
  (svc as any).claimTeamMemberFromInvite = jest
    .fn()
    .mockResolvedValue(undefined);
  return { svc, db };
}

describe("F-510: wrong passwords are limited per address", () => {
  it("locks an address after MAX_FAILURES wrong passwords, even for the right one", async () => {
    const email = "owner@house.test";
    const { svc } = makeService({
      users: [
        {
          user_id: "u1",
          email,
          password_hash: await bcrypt.hash("right-one", 4),
        },
      ],
    });
    for (let i = 0; i < SignInAttempts.MAX_FAILURES; i++) {
      await expect(svc.validateUser(email, `wrong-${i}`)).rejects.toThrow(
        UnauthorizedException,
      );
    }
    await expect(svc.validateUser(email, "right-one")).rejects.toMatchObject({
      status: 429,
    });
  });

  it("answers an address with no account the same way, so the lock is not an oracle", async () => {
    const { svc } = makeService({});
    const stranger = "nobody@house.test";
    for (let i = 0; i < SignInAttempts.MAX_FAILURES; i++) {
      await expect(svc.validateUser(stranger, "x")).rejects.toThrow(
        UnauthorizedException,
      );
    }
    const err: HttpException = await svc.validateUser(stranger, "x").then(
      () => null as any,
      (e) => e,
    );
    expect(err.getStatus()).toBe(429);
    expect((err.getResponse() as any).message).toMatch(
      /Too many wrong passwords/,
    );
  });

  it("counts by the normalised address, so changing case does not reset it", () => {
    const now = 1_000_000;
    const a = new SignInAttempts(() => now);
    for (let i = 0; i < SignInAttempts.MAX_FAILURES; i++) {
      a.recordFailure(i % 2 ? "Owner@House.test" : " owner@house.test ");
    }
    expect(() => a.assertOpen("OWNER@HOUSE.TEST")).toThrow(HttpException);
  });

  it("opens again once the window has passed", () => {
    let now = 1_000_000;
    const a = new SignInAttempts(() => now);
    for (let i = 0; i < SignInAttempts.MAX_FAILURES; i++)
      a.recordFailure("a@b.c");
    expect(() => a.assertOpen("a@b.c")).toThrow(HttpException);
    now += SignInAttempts.WINDOW_MS + 1;
    expect(() => a.assertOpen("a@b.c")).not.toThrow();
  });
});

describe("F-510: the per-IP key is not a client-typed header", () => {
  it("reads the last x-forwarded-for hop, not the first", () => {
    expect(
      clientIp({ headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } }),
    ).toBe("203.0.113.9");
  });

  it("falls back to the socket when there is no header", () => {
    expect(
      clientIp({ headers: {}, socket: { remoteAddress: "10.0.0.1" } }),
    ).toBe("10.0.0.1");
  });

  it("rotating the first entry does not buy a fresh /auth/ limit", async () => {
    const guard = new RateLimitGuard(new Reflector(), {
      get: jest.fn(),
    } as any);
    try {
      const ctx = (first: string) =>
        ({
          switchToHttp: () => ({
            getRequest: () => ({
              headers: { "x-forwarded-for": `${first}, 203.0.113.50` },
              url: "/api/v1/auth/login",
              route: { path: "/auth/login" },
            }),
            getResponse: () => ({ setHeader: jest.fn() }),
          }),
          getHandler: () => AuthController.prototype.login,
          getClass: () => AuthController,
        }) as any;
      for (let i = 0; i < 10; i++) {
        await expect(guard.canActivate(ctx(`198.51.100.${i}`))).resolves.toBe(
          true,
        );
      }
      await expect(
        guard.canActivate(ctx("198.51.100.99")),
      ).rejects.toMatchObject({
        status: 429,
      });
    } finally {
      clearInterval((guard as any).cleanupInterval);
    }
  });
});

describe("F-511: password sign-in ignores the address's case", () => {
  it("signs in with capitals and spaces typed into a lowercased address", async () => {
    const { svc } = makeService({
      users: [
        {
          user_id: "u1",
          email: "deniz@house.test",
          email_verified: true,
          password_hash: await bcrypt.hash("pw-1234567", 4),
        },
      ],
    });
    await expect(
      svc.validateUser("  Deniz@House.TEST ", "pw-1234567"),
    ).resolves.toMatchObject({
      user_id: "u1",
    });
  });

  it("still finds an older row stored with capitals by its exact spelling", async () => {
    const { svc } = makeService({
      users: [
        {
          user_id: "u2",
          email: "Old@House.test",
          email_verified: true,
          password_hash: await bcrypt.hash("pw-1234567", 4),
        },
      ],
    });
    await expect(
      svc.validateUser("Old@House.test", "pw-1234567"),
    ).resolves.toMatchObject({
      user_id: "u2",
    });
  });
});

describe("F-512: a wrong password on an invite join gives the invite back", () => {
  it("releases the invite after the mismatch, like the other failure branches", async () => {
    const email = "owner@house.test";
    const invite = {
      id: "inv-1",
      code: "ABCDEFGH",
      restaurant_id: HOUSE,
      invited_by: ISSUER,
      role: "staff",
      used_at: null,
      used_by_email: null,
      expires_at: FUTURE,
    };
    const { svc, db } = makeService({
      organization_invites: [invite],
      users: [
        {
          user_id: "u1",
          email,
          password_hash: await bcrypt.hash("right-one", 4),
        },
      ],
    });
    await expect(
      svc.joinViaInvite({
        code: "ABCDEFGH",
        email,
        name: "X",
        password: "wrong",
      } as any),
    ).rejects.toThrow(UnauthorizedException);
    const row = db.tables.organization_invites.find(
      (r: any) => r.id === "inv-1",
    );
    expect(row?.used_at).toBeNull();
    expect(row?.used_by_email).toBeNull();
  });
});

describe("F-514: invite codes stay out of the gateway log", () => {
  it("names an invite by a short hash, never the code", () => {
    const ref = inviteLogRef("abcdefgh");
    expect(ref).toMatch(/^#[0-9a-f]{8}$/);
    expect(ref).not.toContain("ABCDEFGH");
    expect(inviteLogRef(" ABCDEFGH ")).toBe(ref);
  });

  it("no log line in the controller interpolates a raw code", () => {
    const src = readFileSync(resolve(__dirname, "auth.controller.ts"), "utf8");
    const logs = src.match(/this\.logger\.\w+\(\s*`[^`]*`/g) ?? [];
    for (const line of logs) {
      expect(line).not.toMatch(/\$\{(dto\.)?code\}/);
    }
  });
});

describe("F-515: check-email follows the sign-in-methods rule", () => {
  const reflector = new Reflector();
  const handler = AuthController.prototype.checkEmail;

  it("is a POST, so the address never sits in a URL", () => {
    expect(Reflect.getMetadata("method", handler)).toBe(1); // RequestMethod.POST
    expect(Reflect.getMetadata("path", handler)).toBe("check-email");
  });

  it("carries the same 10-per-10-minutes limit as sign-in-methods", () => {
    const own = reflector.get("rateLimit", handler);
    const peer = reflector.get(
      "rateLimit",
      AuthController.prototype.signInMethods,
    );
    expect(own).toMatchObject({
      limit: peer.limit,
      windowSeconds: peer.windowSeconds,
    });
  });
});
