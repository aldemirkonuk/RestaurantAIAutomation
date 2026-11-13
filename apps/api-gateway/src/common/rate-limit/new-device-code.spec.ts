import { createHmac } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RateLimitGuard } from "./rate-limit.guard";
import {
  accountDigest,
  foldAccount,
  issueSignInDevice,
  readSignInDevice,
  signInDeviceSecret,
} from "./sign-in-device";
import { resolveJwtSecret } from "../../auth/jwt-secret";
import { AuthController } from "../../auth/auth.controller";
import { SignInController } from "../../passkeys/sign-in.controller";

// QA round 21 (#943 PARTIAL): a NEW device -- no token, right password -- is
// refused while a stranger keeps the untrusted buckets full. The way in is
// the emailed code, and that sign-in leaves the device known.

const JWT = "spec-jwt-secret";
const SECRET = signInDeviceSecret(JWT);
const EDGE = "198.51.100.7";
const OWNER = "owner@x.com";
const rot = (i: number) => `10.9.${i >> 8}.${i & 255}, ${EDGE}`;

const LOGIN = [AuthController.prototype.login, AuthController] as const;
const CODE = [SignInController.prototype.emailCodeVerify, SignInController] as const;

function ctx(
  body: Record<string, unknown>,
  xff: string,
  [handler, cls]: readonly [unknown, unknown] = LOGIN,
) {
  const res = { setHeader: jest.fn() };
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { "x-forwarded-for": xff },
        url: "/api/v1/auth/x",
        route: { path: "/auth/x" },
        socket: { remoteAddress: "100.64.0.2" },
        body,
      }),
      getResponse: () => res,
    }),
    getHandler: () => handler,
    getClass: () => cls,
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

function codeController() {
  const codes = { verify: jest.fn(async () => "user-1") } as any;
  const auth = {
    issueSessionForVerifiedSignIn: jest.fn(async () => ({
      accessToken: "a",
      refreshToken: "r",
    })),
  } as any;
  return new SignInController({} as any, codes, auth, { get: () => JWT } as any);
}

describe("QA round 21: a new device gets in by the emailed code", () => {
  it("under a sustained attack on the owner, the code door opens and the device is known after", async () => {
    const guard = newGuard();
    for (let i = 0; i < 50; i++) await ok(guard, ctx({ email: OWNER }, rot(i)));
    // The owner's new phone, right password: still refused (by design).
    expect(await ok(guard, ctx({ email: OWNER }, rot(700)))).toBe(false);
    // The emailed-code door does not share the login buckets.
    expect(await ok(guard, ctx({ email: OWNER, code: "1" }, rot(701), CODE))).toBe(true);
    const out: any = await codeController().emailCodeVerify({
      email: OWNER,
      code: "123456",
    } as any);
    expect(readSignInDevice(SECRET, out.signInDevice, foldAccount(OWNER))).toMatch(/^[0-9a-f]{32}$/);
    // Next password sign-in from that phone: its own bucket, it gets in.
    expect(
      await ok(guard, ctx({ email: OWNER, signInDevice: out.signInDevice }, rot(702))),
    ).toBe(true);
    // And the stranger is still held.
    expect(await ok(guard, ctx({ email: OWNER }, rot(703)))).toBe(false);
  });

  it("the untrusted peer budget spent by random emails: a first-timer gets in by the code", async () => {
    const guard = newGuard();
    for (let i = 0; i < 120; i++) await ok(guard, ctx({ email: `u${i}@x.test` }, rot(i)));
    expect(await ok(guard, ctx({ email: "new@x.test" }, rot(800)))).toBe(false);
    expect(await ok(guard, ctx({ email: "new@x.test", code: "1" }, rot(801), CODE))).toBe(true);
    const out: any = await codeController().emailCodeVerify({
      email: "new@x.test",
      code: "123456",
    } as any);
    expect(
      await ok(guard, ctx({ email: "new@x.test", signInDevice: out.signInDevice }, rot(802))),
    ).toBe(true);
  });

  it("a valid token sent to the code door keeps its device id; another account's does not", async () => {
    const id = (t: string) =>
      JSON.parse(Buffer.from(t.split(".")[0], "base64url").toString()).d;
    const mine = issueSignInDevice(SECRET, foldAccount(OWNER));
    const kept: any = await codeController().emailCodeVerify({
      email: OWNER,
      code: "123456",
      signInDevice: mine,
    } as any);
    expect(id(kept.signInDevice)).toBe(id(mine));
    const theirs: any = await codeController().emailCodeVerify({
      email: "other@x.com",
      code: "123456",
      signInDevice: mine,
    } as any);
    expect(id(theirs.signInDevice)).not.toBe(id(mine));
  });
});

// Mutation survivors m5, m16, m17 of round 21: each check isolated, so the
// token is otherwise valid and only the check under test can refuse it.
function signed(secret: string, payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret)
    .update("sign-in-device.v1." + b64)
    .digest("base64url");
  return `${b64}.${sig}`;
}
const A = () => accountDigest(foldAccount(OWNER)).slice(0, 32);
const HEX = "0123456789abcdef0123456789abcdef";

describe("the code door folds the address (round 23 survivor)", () => {
  it("a code sign-in typed as Owner@X.com earns the bucket of owner@x.com", async () => {
    const out: any = await codeController().emailCodeVerify({
      email: "Owner@X.com",
      code: "123456",
    } as any);
    expect(readSignInDevice(SECRET, out.signInDevice, foldAccount(OWNER))).toMatch(/^[0-9a-f]{32}$/);
    const guard = newGuard();
    for (let i = 0; i < 12; i++) await ok(guard, ctx({ email: OWNER }, rot(i)));
    expect(await ok(guard, ctx({ email: OWNER, signInDevice: out.signInDevice }, rot(50)))).toBe(true);
  });
});

describe("device token checks (round 21 survivors)", () => {
  it("m5: a correctly signed token with an odd device id is untrusted", () => {
    const base = { v: 1, a: A(), t: Date.now() };
    expect(readSignInDevice(SECRET, signed(SECRET, { ...base, d: HEX }), foldAccount(OWNER))).toBe(HEX);
    for (const d of [HEX.toUpperCase(), HEX + "0", HEX.slice(1), "../" + HEX.slice(3), 7]) {
      expect(readSignInDevice(SECRET, signed(SECRET, { ...base, d }), foldAccount(OWNER))).toBeNull();
    }
  });

  it("m16: a correctly signed token over 512 characters is untrusted", () => {
    const base = { v: 1, a: A(), d: HEX, t: Date.now() };
    const under = signed(SECRET, { ...base, p: "x".repeat(200) });
    const over = signed(SECRET, { ...base, p: "x".repeat(400) });
    expect(under.length).toBeLessThanOrEqual(512);
    expect(over.length).toBeGreaterThan(512);
    expect(readSignInDevice(SECRET, under, foldAccount(OWNER))).toBe(HEX);
    expect(readSignInDevice(SECRET, over, foldAccount(OWNER))).toBeNull();
  });

  it("m17: the token key is derived, never the JWT secret itself", () => {
    expect(SECRET).not.toBe(resolveJwtSecret(JWT));
    expect(SECRET).toBe(signInDeviceSecret(JWT));
    expect(SECRET).not.toBe(signInDeviceSecret(JWT + "2"));
    const raw = issueSignInDevice(resolveJwtSecret(JWT), foldAccount(OWNER));
    expect(readSignInDevice(SECRET, raw, foldAccount(OWNER))).toBeNull();
  });
});

describe("POST /auth/email-code/verify accepts the token field", () => {
  // main.ts runs ValidationPipe with forbidNonWhitelisted: an undeclared
  // field would turn every code sign-in from a known device into a 400.
  const check = async (body: Record<string, unknown>) => {
    const { plainToInstance } = await import("class-transformer");
    const { validate } = await import("class-validator");
    const { EmailCodeVerifyDto } = await import("../../passkeys/dto/passkeys.dto");
    const errors = await validate(plainToInstance(EmailCodeVerifyDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return errors.map((e) => e.property);
  };
  const base = { email: OWNER, code: "123456" };

  it("takes a token, refuses one over 512 characters or not a string", async () => {
    expect(await check({ ...base, signInDevice: issueSignInDevice(SECRET, OWNER) })).toEqual([]);
    expect(await check({ ...base, signInDevice: "x".repeat(513) })).toEqual(["signInDevice"]);
    expect(await check({ ...base, signInDevice: 7 })).toEqual(["signInDevice"]);
  });
});
