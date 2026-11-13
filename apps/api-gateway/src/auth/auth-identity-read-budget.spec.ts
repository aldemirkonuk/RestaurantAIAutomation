import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import {
  DEFAULT_RATE_LIMITS,
  IDENTITY_READ_RATE_LIMIT,
  RateLimitGuard,
} from "../common/rate-limit";

/**
 * Identity reads use the read budget; credential routes keep the auth tier
 * (r20, 2026-11-13).
 *
 * The global RateLimitGuard puts every `/auth/` path on 10 per minute per IP.
 * `GET /auth/me` and its sibling reads take no credential, so they now carry
 * the default authenticated-read budget. Every route that takes a password, a
 * code or a refresh token must still resolve to the `auth` tier.
 */

type Handler = keyof AuthController;

function contextFor(handler: Handler, path: string, ip = "203.0.113.7") {
  const headers: Record<string, unknown> = {};
  const response = {
    setHeader: (k: string, v: unknown) => {
      headers[k] = v;
    },
  };
  const request = {
    headers: { "x-forwarded-for": ip },
    route: { path },
    url: path,
  };
  return {
    headers,
    ctx: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
      getHandler: () => AuthController.prototype[handler],
      getClass: () => AuthController,
    } as any,
  };
}

/** Calls the guard n times; returns how many were allowed. */
async function allowedOf(
  guard: RateLimitGuard,
  handler: Handler,
  path: string,
  n: number,
  ip?: string,
): Promise<number> {
  let allowed = 0;
  for (let i = 0; i < n; i++) {
    try {
      if (await guard.canActivate(contextFor(handler, path, ip).ctx)) allowed++;
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(429);
    }
  }
  return allowed;
}

describe("auth routes: identity reads vs credential routes", () => {
  let guard: RateLimitGuard;

  beforeEach(() => {
    guard = new RateLimitGuard(new Reflector(), {} as any);
  });

  afterEach(() => {
    clearInterval((guard as any).cleanupInterval);
  });

  it("the identity-read budget is the default authenticated-read budget, wider than the auth tier", () => {
    expect(IDENTITY_READ_RATE_LIMIT).toEqual({ limit: 100, windowSeconds: 60 });
    expect(DEFAULT_RATE_LIMITS.auth).toEqual({ limit: 10, windowSeconds: 60 });
  });

  it.each<[Handler, string]>([
    ["getProfile", "/api/v1/auth/me"],
    ["getMyRole", "/api/v1/auth/me/role"],
    ["getLinkedProviders", "/api/v1/auth/me/linked-providers"],
    ["houses", "/api/v1/auth/houses"],
    ["verifyToken", "/api/v1/auth/verify"],
  ])("%s allows 100 a minute from one IP, then 429s", async (handler, path) => {
    expect(await allowedOf(guard, handler, path, 101)).toBe(100);
  });

  it("the sixth, eleventh and fiftieth GET /auth/me in a minute from one office IP all pass", async () => {
    expect(await allowedOf(guard, "getProfile", "/api/v1/auth/me", 50)).toBe(50);
  });

  it.each<[Handler, string]>([
    ["login", "/api/v1/auth/login"],
    ["devBypassLogin", "/api/v1/auth/dev-bypass-login"],
    ["registerAccount", "/api/v1/auth/register/account"],
    ["registerAccountWithGoogle", "/api/v1/auth/register/google"],
    ["loginWithGoogle", "/api/v1/auth/oauth/google"],
    ["loginWithMicrosoft", "/api/v1/auth/oauth/microsoft"],
    ["refresh", "/api/v1/auth/refresh"],
    ["changePassword", "/api/v1/auth/me/password"],
    ["updateProfile", "/api/v1/auth/me"],
    ["deleteAccount", "/api/v1/auth/me"],
    ["requestPasswordReset", "/api/v1/auth/request-password-reset"],
    ["resetPassword", "/api/v1/auth/reset-password"],
    ["joinViaInvite", "/api/v1/auth/join"],
    ["getInvitePreview", "/api/v1/auth/invite/:code"],
    ["checkEmail", "/api/v1/auth/check-email"],
    ["switchRestaurant", "/api/v1/auth/switch-restaurant"],
  ])("%s keeps the auth tier: 10 a minute from one IP", async (handler, path) => {
    expect(await allowedOf(guard, handler, path, 11)).toBe(10);
  });

  it("sign-in-methods keeps its own tighter limit", async () => {
    expect(
      await allowedOf(guard, "signInMethods", "/api/v1/auth/sign-in-methods", 11),
    ).toBe(10);
  });

  it("the read budget is per route: a full /auth/me bucket does not open /auth/login", async () => {
    await allowedOf(guard, "getProfile", "/api/v1/auth/me", 100);
    expect(await allowedOf(guard, "login", "/api/v1/auth/login", 11)).toBe(10);
  });
});
