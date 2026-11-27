import { ExecutionContext, HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { AuthController } from "./auth.controller";

/**
 * DD-r108-14: GET /auth/me fell into the 10-per-minute-per-IP `/auth/` bucket,
 * so /verify-email's own load, its waiting poll and the read after a verified
 * code spent one IP's ten and the last read came back 429 ("verified, but your
 * account could not be loaded"). /auth/me now carries a read-sized limit.
 */
function contextFor(handler: (...args: unknown[]) => unknown): ExecutionContext {
  const request = {
    url: "/api/v1/auth/me",
    route: { path: "/api/v1/auth/me" },
    headers: { "x-forwarded-for": "203.0.113.7" },
  };
  const response = { setHeader: jest.fn() };
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getHandler: () => handler,
    getClass: () => AuthController,
  } as unknown as ExecutionContext;
}

describe("GET /auth/me rate limit", () => {
  let guard: RateLimitGuard;
  beforeEach(() => {
    jest.useFakeTimers();
    guard = new RateLimitGuard(new Reflector(), new ConfigService());
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("lets one IP read itself more than ten times a minute", async () => {
    const ctx = contextFor(AuthController.prototype.getProfile);
    for (let i = 0; i < 30; i += 1) {
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
  });

  it("still bounds a flood at one hundred a minute", async () => {
    const ctx = contextFor(AuthController.prototype.getProfile);
    for (let i = 0; i < 100; i += 1) await guard.canActivate(ctx);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });
});
