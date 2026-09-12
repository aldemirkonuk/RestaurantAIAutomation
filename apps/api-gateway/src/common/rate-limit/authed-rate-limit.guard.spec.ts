import { ExecutionContext, HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  AUTHED_RATE_LIMIT_KEY,
  AuthedRateLimitGuard,
  AuthedRateLimitRule,
} from "./authed-rate-limit.guard";

/**
 * These tests exist because an unproven rate limit is indistinguishable from
 * no rate limit: both look like a route that works. Every case below is one
 * the guard is meant to refuse or admit, exercised against the real guard.
 */

type FakeUser = { userId?: string; restaurantId?: string } | undefined;

function ctx(
  rules: AuthedRateLimitRule[] | undefined,
  user: FakeUser,
  handlerName = "propose",
): { context: ExecutionContext; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const handler = function propose() {};
  Object.defineProperty(handler, "name", { value: handlerName });
  if (rules) Reflect.defineMetadata(AUTHED_RATE_LIMIT_KEY, rules, handler);
  class FakeController {}
  const context = {
    getHandler: () => handler,
    getClass: () => FakeController,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => ({
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
      }),
    }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

function guard(): AuthedRateLimitGuard {
  return new AuthedRateLimitGuard(new Reflector());
}

function statusOf(err: unknown): number | undefined {
  return err instanceof HttpException ? err.getStatus() : undefined;
}

describe("AuthedRateLimitGuard", () => {
  it("admits a route that declares no limit at all", () => {
    const { context } = ctx(undefined, { userId: "u1" });
    expect(guard().canActivate(context)).toBe(true);
  });

  it("admits exactly `limit` requests and refuses the next one", () => {
    const g = guard();
    const rules = [{ limit: 3, windowSeconds: 60 }];
    const { context } = ctx(rules, { userId: "u1" });
    expect(g.canActivate(context)).toBe(true);
    expect(g.canActivate(context)).toBe(true);
    expect(g.canActivate(context)).toBe(true);
    let thrown: unknown;
    try {
      g.canActivate(context);
    } catch (e) {
      thrown = e;
    }
    expect(statusOf(thrown)).toBe(429);
  });

  it("counts each user separately — one caller cannot exhaust another's allowance", () => {
    const g = guard();
    const rules = [{ limit: 1, windowSeconds: 60 }];
    expect(g.canActivate(ctx(rules, { userId: "u1" }).context)).toBe(true);
    // u1 is now at their limit; u2 must still be admitted.
    expect(g.canActivate(ctx(rules, { userId: "u2" }).context)).toBe(true);
    expect(() => g.canActivate(ctx(rules, { userId: "u1" }).context)).toThrow();
  });

  it("a restaurant-scoped rule binds every member of the house together", () => {
    const g = guard();
    const rules: AuthedRateLimitRule[] = [
      { limit: 2, windowSeconds: 60, scope: "restaurant" },
    ];
    const a = { userId: "u1", restaurantId: "r1" };
    const b = { userId: "u2", restaurantId: "r1" };
    expect(g.canActivate(ctx(rules, a).context)).toBe(true);
    expect(g.canActivate(ctx(rules, b).context)).toBe(true);
    // Two different people, one house, limit 2 — the third is refused even
    // though neither person has made two requests.
    expect(() => g.canActivate(ctx(rules, a).context)).toThrow();
  });

  it("separates routes, so a limit on one does not spend another's", () => {
    const g = guard();
    const rules = [{ limit: 1, windowSeconds: 60 }];
    expect(g.canActivate(ctx(rules, { userId: "u1" }, "propose").context)).toBe(
      true,
    );
    expect(g.canActivate(ctx(rules, { userId: "u1" }, "confirm").context)).toBe(
      true,
    );
  });

  it("sets Retry-After to a positive whole number of seconds", () => {
    const g = guard();
    const rules = [{ limit: 1, windowSeconds: 60 }];
    const first = ctx(rules, { userId: "u1" });
    g.canActivate(first.context);
    const second = ctx(rules, { userId: "u1" });
    expect(() => g.canActivate(second.context)).toThrow();
    const retry = Number(second.headers["Retry-After"]);
    expect(Number.isInteger(retry)).toBe(true);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it("uses the caller's words when the rule supplies a message", () => {
    const g = guard();
    const rules = [
      { limit: 1, windowSeconds: 60, message: "Give it a minute." },
    ];
    g.canActivate(ctx(rules, { userId: "u1" }).context);
    let thrown: any;
    try {
      g.canActivate(ctx(rules, { userId: "u1" }).context);
    } catch (e) {
      thrown = e;
    }
    expect(String(thrown.getResponse()?.message)).toContain(
      "Give it a minute.",
    );
  });

  it("FAILS CLOSED when no authenticated user reached it", () => {
    // The wiring mistake this catches: listing the guard before JwtAuthGuard,
    // which would leave the route with only the global IP limit while the
    // code says otherwise. A 500 and a log line is the honest answer; silently
    // admitting, or bucketing everyone under one shared key, is not.
    const g = guard();
    const rules = [{ limit: 1, windowSeconds: 60 }];
    let thrown: unknown;
    try {
      g.canActivate(ctx(rules, undefined).context);
    } catch (e) {
      thrown = e;
    }
    expect(statusOf(thrown)).toBe(500);
  });

  it("a refused request does not consume any rule's allowance", () => {
    // Two rules on one scope: a burst of 2/min and a sustained 3/hour. After
    // the hourly rule refuses, the per-minute window must still have the two
    // it started with -- not three -- or a caller blocked by one limit
    // silently burns the other and it never drains while they keep knocking.
    const g = guard();
    const rules: AuthedRateLimitRule[] = [
      { limit: 2, windowSeconds: 60 },
      { limit: 3, windowSeconds: 3600 },
    ];
    const u = { userId: "u1" };
    expect(g.canActivate(ctx(rules, u).context)).toBe(true);
    expect(g.canActivate(ctx(rules, u).context)).toBe(true);
    // Third: the per-minute rule refuses first.
    expect(() => g.canActivate(ctx(rules, u).context)).toThrow();
    // The hourly rule has seen exactly 2, so it must still have room. Prove it
    // by relaxing only the per-minute rule and asking again.
    const relaxed: AuthedRateLimitRule[] = [
      { limit: 99, windowSeconds: 60 },
      { limit: 3, windowSeconds: 3600 },
    ];
    expect(g.canActivate(ctx(relaxed, u).context)).toBe(true);
    // That was the hourly rule's third. The fourth must be refused.
    let thrown: unknown;
    try {
      g.canActivate(ctx(relaxed, u).context);
    } catch (e) {
      thrown = e;
    }
    expect(statusOf(thrown)).toBe(429);
  });

  it("two windows on one scope share history rather than overwriting it", () => {
    // Both rules key on the same user and route. If each stored its own array
    // under that key, the narrower window would overwrite the wider one's
    // history and the hourly limit would behave like the per-minute one.
    const g = guard();
    const rules: AuthedRateLimitRule[] = [
      { limit: 10, windowSeconds: 60 },
      { limit: 2, windowSeconds: 3600 },
    ];
    const u = { userId: "u1" };
    expect(g.canActivate(ctx(rules, u).context)).toBe(true);
    expect(g.canActivate(ctx(rules, u).context)).toBe(true);
    // The per-minute rule has room for eight more; the hourly one does not.
    let thrown: unknown;
    try {
      g.canActivate(ctx(rules, u).context);
    } catch (e) {
      thrown = e;
    }
    expect(statusOf(thrown)).toBe(429);
  });
});
