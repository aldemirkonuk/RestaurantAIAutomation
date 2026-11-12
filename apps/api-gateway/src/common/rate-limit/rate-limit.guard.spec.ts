import { ExecutionContext, HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { RateLimitGuard } from "./rate-limit.guard";
import { AuthController } from "../../auth/auth.controller";

/**
 * The global limiter puts every path containing `/auth/` at 10 a minute per
 * address. These tests hold the session reads out of that bucket and keep
 * the sign-in routes in it, against the real guard and the real metadata on
 * AuthController's handlers.
 *
 * A full page load asks `/auth/me` two or three times (2026-11-12, local
 * stack), so the 10-a-minute bucket answered 429 on the fourth load from one
 * address, and every device in a house shares one address.
 */

const ADDRESS = "203.0.113.7";

function ctx(
  handler: (...args: any[]) => any,
  routePath: string,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => AuthController,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { "x-forwarded-for": ADDRESS },
        route: { path: routePath },
        url: routePath,
      }),
      getResponse: () => ({ setHeader: () => undefined }),
    }),
  } as unknown as ExecutionContext;
}

/** How many of `n` back-to-back requests from one address the guard admits. */
async function admitted(
  guard: RateLimitGuard,
  handler: (...args: any[]) => any,
  routePath: string,
  n: number,
): Promise<number> {
  let ok = 0;
  for (let i = 0; i < n; i++) {
    try {
      if (await guard.canActivate(ctx(handler, routePath))) ok++;
    } catch (e) {
      if (!(e instanceof HttpException) || e.getStatus() !== 429) throw e;
    }
  }
  return ok;
}

describe("RateLimitGuard: a session reading itself is not a sign-in attempt", () => {
  let guard: RateLimitGuard;

  beforeEach(() => {
    guard = new RateLimitGuard(new Reflector(), {} as ConfigService);
  });

  afterEach(() => {
    clearInterval((guard as any).cleanupInterval);
  });

  const proto = AuthController.prototype as any;

  it.each([
    ["GET /auth/me", proto.getProfile, "/api/v1/auth/me"],
    ["GET /auth/me/role", proto.getMyRole, "/api/v1/auth/me/role"],
    [
      "GET /auth/me/linked-providers",
      proto.getLinkedProviders,
      "/api/v1/auth/me/linked-providers",
    ],
    ["GET /auth/houses", proto.houses, "/api/v1/auth/houses"],
  ])(
    "%s admits 30 loads' worth of reads a minute from one address",
    async (_label, handler, path) => {
      expect(typeof handler).toBe("function");
      // 30 = ten full page loads on three devices behind one house router.
      expect(await admitted(guard, handler, path, 30)).toBe(30);
    },
  );

  it("still refuses the 11th sign-in attempt in a minute from one address", async () => {
    expect(await admitted(guard, proto.login, "/api/v1/auth/login", 11)).toBe(
      10,
    );
  });

  it("still refuses the 11th refresh in a minute (no opt-in there)", async () => {
    expect(
      await admitted(guard, proto.refresh, "/api/v1/auth/refresh", 11),
    ).toBe(10);
  });

  it("a session read is still bounded (the ordinary 100 a minute)", async () => {
    expect(
      await admitted(guard, proto.getProfile, "/api/v1/auth/me", 101),
    ).toBe(100);
  });
});
