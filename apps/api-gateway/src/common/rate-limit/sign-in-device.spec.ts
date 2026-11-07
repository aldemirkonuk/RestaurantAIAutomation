import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RateLimitGuard } from "./rate-limit.guard";
import { UNTRUSTED_PEER_FACTOR } from "./client-address";
import {
  foldAccount,
  issueSignInDevice,
  signInDeviceSecret,
} from "./sign-in-device";
import { PasswordResetThrottleGuard } from "../../auth/guards/password-reset-throttle.guard";
import { AuthController } from "../../auth/auth.controller";

const JWT = "spec-jwt-secret";
const SECRET = signInDeviceSecret(JWT);
const EDGE = "198.51.100.7";
const OWNER = "owner@x.com";

function ctx(email: unknown, xff: string, signInDevice?: unknown, route = "/auth/login") {
  const res = { setHeader: jest.fn() };
  const body: Record<string, unknown> = { email };
  if (signInDevice !== undefined) body.signInDevice = signInDevice;
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { "x-forwarded-for": xff },
        url: `/api/v1${route}`,
        route: { path: route },
        socket: { remoteAddress: "100.64.0.2" },
        body,
      }),
      getResponse: () => res,
    }),
    getHandler: () => AuthController.prototype.login,
    getClass: () => AuthController,
  } as any;
}

function newGuard() {
  const guard = new RateLimitGuard(new Reflector(), { get: () => JWT } as any);
  clearInterval((guard as any).cleanupInterval);
  return guard;
}

async function ok(guard: RateLimitGuard, c: any): Promise<boolean> {
  try {
    await guard.canActivate(c);
    return true;
  } catch (e) {
    expect((e as HttpException).getStatus()).toBe(429);
    return false;
  }
}

const rot = (i: number) => `10.9.${i >> 8}.${i & 255}, ${EDGE}`;
const token = (email: string, id?: string, now?: number) =>
  issueSignInDevice(SECRET, foldAccount(email), id, now);

describe("a stranger cannot lock an owner out (D1)", () => {
  it("12 untrusted tries stop at 10; the owner's device still gets in", async () => {
    const guard = newGuard();
    let passed = 0;
    for (let i = 0; i < 12; i++) if (await ok(guard, ctx(OWNER, rot(i)))) passed++;
    expect(passed).toBe(10);
    expect(await ok(guard, ctx(OWNER, rot(500)))).toBe(false);
    expect(await ok(guard, ctx(OWNER, rot(501), token(OWNER)))).toBe(true);
  });

  it("a token issued for another account is untrusted for this one", async () => {
    const guard = newGuard();
    for (let i = 0; i < 10; i++) await ok(guard, ctx(OWNER, rot(i)));
    expect(await ok(guard, ctx(OWNER, rot(100), token("other@x.com")))).toBe(false);
    expect(await ok(guard, ctx(OWNER, rot(101), token(OWNER)))).toBe(true);
  });

  it("tampered, expired, future, garbage, oversized, non-string: untrusted", async () => {
    const good = token(OWNER);
    const DAY = 24 * 60 * 60 * 1000;
    const bad: unknown[] = [
      good.slice(0, -2) + (good.endsWith("AA") ? "BB" : "AA"),
      token(OWNER, undefined, Date.now() - 181 * DAY),
      token(OWNER, undefined, Date.now() + 10 * 60 * 1000),
      "not-a-token",
      "x".repeat(600),
      12345,
      { a: 1 },
    ];
    const guard = newGuard();
    for (let i = 0; i < 10; i++) await ok(guard, ctx(OWNER, rot(i)));
    for (let i = 0; i < bad.length; i++) {
      expect(await ok(guard, ctx(OWNER, rot(200 + i), bad[i]))).toBe(false);
    }
    expect(await ok(guard, ctx(OWNER, rot(300), good))).toBe(true);
  });

  it("a known device has its own limit: the 11th try with one token is refused", async () => {
    const guard = newGuard();
    const t = token(OWNER);
    let passed = 0;
    for (let i = 0; i < 12; i++) if (await ok(guard, ctx(OWNER, rot(i), t))) passed++;
    expect(passed).toBe(10);
    expect(await ok(guard, ctx(OWNER, rot(50), token(OWNER)))).toBe(true);
  });
});

describe("untrusted peer budget (D2)", () => {
  it("one peer, fresh address and email each try, no token: 100 pass", async () => {
    expect(UNTRUSTED_PEER_FACTOR).toBe(10);
    const guard = newGuard();
    let passed = 0;
    for (let i = 0; i < 300; i++) {
      if (await ok(guard, ctx(`u${i}@x.test`, rot(i)))) passed++;
    }
    expect(passed).toBe(100);
  });

  it("untrusted budget spent: a known device behind the same peer gets in", async () => {
    const guard = newGuard();
    for (let i = 0; i < 120; i++) await ok(guard, ctx(`u${i}@x.test`, rot(i)));
    expect(await ok(guard, ctx("fresh@x.test", rot(900)))).toBe(false);
    expect(await ok(guard, ctx(OWNER, rot(901), token(OWNER)))).toBe(true);
  });
});

describe("account folding (D3)", () => {
  async function shareBucket(a: string, b: string) {
    const guard = newGuard();
    let n = 0;
    for (let i = 0; i < 20; i++) {
      if (await ok(guard, ctx(i % 2 ? a : b, rot(i)))) n++;
    }
    return n === 10;
  }

  it.each([
    ["Owner@X.com ", "owner@x.com"],
    ["owner​@x.com", "owner@x.com"],
    ["ｏｗｎｅｒ@x.com", "owner@x.com"],
  ])("%j and %j share one bucket", async (a, b) => {
    expect(await shareBucket(a, b)).toBe(true);
  });

  it("400-character emails differing at character 330 do not share one", async () => {
    const base = "a".repeat(329);
    const e1 = `${base}b${"c".repeat(70)}@x.com`;
    const e2 = `${base}d${"c".repeat(70)}@x.com`;
    expect(await shareBucket(e1, e2)).toBe(false);
  });

  it("the account bucket is scoped to its route", async () => {
    const guard = newGuard();
    const other = (email: string, xff: string) =>
      ctx(email, xff, undefined, "/auth/other");
    let a = 0;
    let b = 0;
    for (let i = 0; i < 12; i++) if (await ok(guard, ctx(OWNER, rot(i)))) a++;
    for (let i = 0; i < 12; i++) if (await ok(guard, other(OWNER, rot(100 + i)))) b++;
    expect(a).toBe(10);
    expect(b).toBe(10);
  });
});

describe("password reset throttle (survivors of #906)", () => {
  const resetCtx = (xff: string | undefined, ip?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: xff === undefined ? {} : { "x-forwarded-for": xff },
          ip,
          socket: { remoteAddress: "100.64.0.2" },
        }),
      }),
    }) as any;

  it("keys on the client address, not req.ip (the shared edge)", () => {
    const g = new PasswordResetThrottleGuard();
    // every caller has the same req.ip; different browsers behind Vercel
    for (let u = 0; u < 3; u++) {
      for (let t = 0; t < 5; t++) {
        expect(g.canActivate(resetCtx(`203.0.113.${u}, 76.76.21.21`, "100.64.0.2"))).toBe(true);
      }
    }
  });

  it("two IPv6 clients in one /64 share the reset bucket", () => {
    const g = new PasswordResetThrottleGuard();
    for (let i = 0; i < 5; i++) {
      expect(g.canActivate(resetCtx(`2001:db8:1:2::${i + 1}`))).toBe(true);
    }
    expect(() => g.canActivate(resetCtx("2001:db8:1:2:ffff::9"))).toThrow(HttpException);
  });

  it("the controller hands the service the client address, not req.ip", async () => {
    const seen: unknown[] = [];
    const service = {
      requestPasswordReset: async (...args: unknown[]) => void seen.push(args),
    } as any;
    const controller = new AuthController(service, { get: () => JWT } as any);
    await controller.requestPasswordReset(
      { email: "a@b.test" } as any,
      {
        ip: "100.64.0.2",
        headers: { "x-forwarded-for": "203.0.113.5, 76.76.21.21" },
        socket: { remoteAddress: "100.64.0.2" },
      } as any,
    );
    expect(seen).toEqual([["a@b.test", "203.0.113.5"]]);
  });
});

describe("POST /auth/login returns the known-device token", () => {
  const service = { login: async () => ({ accessToken: "a", refreshToken: "r" }) } as any;
  const controller = new AuthController(service, { get: () => JWT } as any);

  it("issues one, and a valid token sent back keeps its device id", async () => {
    const first: any = await controller.login({ email: " Owner@x.com", password: "pw" });
    expect(typeof first.signInDevice).toBe("string");
    const again: any = await controller.login({
      email: OWNER,
      password: "pw",
      signInDevice: first.signInDevice,
    });
    const id = (t: string) => JSON.parse(Buffer.from(t.split(".")[0], "base64url").toString()).d;
    expect(id(again.signInDevice)).toBe(id(first.signInDevice));
    const stranger: any = await controller.login({
      email: "other@x.com",
      password: "pw",
      signInDevice: first.signInDevice,
    });
    expect(id(stranger.signInDevice)).not.toBe(id(first.signInDevice));
  });
});
