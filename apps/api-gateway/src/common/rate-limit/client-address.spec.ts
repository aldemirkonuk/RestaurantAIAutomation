import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RateLimitGuard } from "./rate-limit.guard";
import {
  PEER_LIMIT_FACTOR,
  requestAddresses,
  trustedProxyHops,
} from "./client-address";
import { PasswordResetThrottleGuard } from "../../auth/guards/password-reset-throttle.guard";
import { requestSource } from "../../passkeys/request-source";

/**
 * A caller cannot buy a fresh rate-limit bucket by writing x-forwarded-for
 * (QA round 11, R11-10).
 *
 * Every limiter keyed on the LEFT-MOST entry, which a caller who reaches the
 * Railway URL directly writes. These cases cover both edge shapes (Railway
 * appending the address it saw, or replacing the header with it) on both
 * roads (through Vercel's /api rewrite, which overwrites the header with the
 * browser's address, or direct).
 *
 * PRE-FIX PROOF: with the three limiters back on the left-most entry, the
 * "rotating" cases never see a 429 and the requestSource case returns the
 * invented address -- they fail; the per-browser and replace cases pass both
 * before and after, which is the point (nothing real users see changes).
 */

const EDGE_SAW = "198.51.100.7"; // the caller's real address, written by Railway's edge
const VERCEL = "76.76.21.21"; // a Vercel egress address
const BROWSER_A = "203.0.113.5";
const BROWSER_B = "203.0.113.6";

function loginContext(xff: string | undefined) {
  const res = { setHeader: jest.fn() };
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: xff === undefined ? {} : { "x-forwarded-for": xff },
        url: "/api/v1/auth/login",
        route: { path: "/auth/login" },
        socket: { remoteAddress: "100.64.0.2" },
      }),
      getResponse: () => res,
    }),
    getHandler: () => function login() {},
    getClass: () => class AuthController {},
  } as any;
}

function newGuard() {
  const guard = new RateLimitGuard(new Reflector(), {} as any);
  clearInterval((guard as any).cleanupInterval);
  return guard;
}

/** How many calls pass before the first 429 (stops at `cap`). */
async function passesBeforeRefusal(
  guard: { canActivate(ctx: any): boolean | Promise<boolean> },
  xff: (i: number) => string | undefined,
  ctx: (xff: string | undefined) => any,
  cap: number,
): Promise<number> {
  for (let i = 0; i < cap; i++) {
    try {
      await guard.canActivate(ctx(xff(i)));
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(429);
      return i;
    }
  }
  return cap;
}

describe("requestAddresses (R11-10)", () => {
  it("reads the edge-written entry as peer and the one left of it as client", () => {
    expect(
      requestAddresses({ headers: { "x-forwarded-for": `forged, ${EDGE_SAW}` } }, 1),
    ).toEqual({ peer: EDGE_SAW, client: "forged" });
    expect(
      requestAddresses({ headers: { "x-forwarded-for": `${BROWSER_A}, ${VERCEL}` } }, 1),
    ).toEqual({ peer: VERCEL, client: BROWSER_A });
  });

  it("treats a one-entry header (the edge replaced it) as both", () => {
    expect(
      requestAddresses({ headers: { "x-forwarded-for": EDGE_SAW } }, 1),
    ).toEqual({ peer: EDGE_SAW, client: EDGE_SAW });
  });

  it("falls back to the socket when there is no header", () => {
    expect(
      requestAddresses({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }, 1),
    ).toEqual({ peer: "127.0.0.1", client: "127.0.0.1" });
  });

  it("never reads x-real-ip", () => {
    expect(
      requestAddresses(
        { headers: { "x-real-ip": "forged" }, socket: { remoteAddress: EDGE_SAW } },
        1,
      ).client,
    ).toBe(EDGE_SAW);
  });

  it("honours TRUSTED_PROXY_HOPS for a further appending hop", () => {
    expect(trustedProxyHops(undefined)).toBe(1);
    expect(trustedProxyHops("2")).toBe(2);
    expect(trustedProxyHops("nonsense")).toBe(1);
    expect(
      requestAddresses(
        { headers: { "x-forwarded-for": `forged, ${EDGE_SAW}, 151.101.1.1` } },
        2,
      ),
    ).toEqual({ peer: EDGE_SAW, client: "forged" });
  });

  it("caps what a caller can make a bucket key hold", () => {
    const long = "x".repeat(5000);
    expect(
      requestAddresses({ headers: { "x-forwarded-for": `${long}, ${EDGE_SAW}` } }, 1)
        .client!.length,
    ).toBe(64);
  });
});

describe("RateLimitGuard on /auth/login, 10 a minute (R11-10)", () => {
  const LIMIT = 10;

  it("direct call, edge APPENDS: a fresh invented address per call is still refused", async () => {
    const n = await passesBeforeRefusal(
      newGuard(),
      (i) => `10.0.${i >> 8}.${i & 255}, ${EDGE_SAW}`,
      loginContext,
      LIMIT * PEER_LIMIT_FACTOR + 5,
    );
    expect(n).toBe(LIMIT * PEER_LIMIT_FACTOR);
  });

  it("direct call, edge REPLACES: the caller is held to the route's own limit", async () => {
    const n = await passesBeforeRefusal(newGuard(), () => EDGE_SAW, loginContext, 50);
    expect(n).toBe(LIMIT);
  });

  it("through Vercel, edge appends: each browser keeps its own limit", async () => {
    const guard = newGuard();
    expect(
      await passesBeforeRefusal(guard, () => `${BROWSER_A}, ${VERCEL}`, loginContext, 50),
    ).toBe(LIMIT);
    expect(
      await passesBeforeRefusal(guard, () => `${BROWSER_B}, ${VERCEL}`, loginContext, 50),
    ).toBe(LIMIT);
  });

  it("a local call with no header still has a limit", async () => {
    const n = await passesBeforeRefusal(newGuard(), () => undefined, loginContext, 50);
    expect(n).toBe(LIMIT);
  });
});

describe("PasswordResetThrottleGuard, 5 per 15 minutes (R11-10)", () => {
  const resetContext = (xff: string | undefined) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: xff === undefined ? {} : { "x-forwarded-for": xff },
          socket: { remoteAddress: "100.64.0.2" },
        }),
      }),
    }) as any;

  it("direct call, edge appends: invented addresses are still refused", async () => {
    const n = await passesBeforeRefusal(
      new PasswordResetThrottleGuard(),
      (i) => `10.1.${i >> 8}.${i & 255}, ${EDGE_SAW}`,
      resetContext,
      5 * PEER_LIMIT_FACTOR + 5,
    );
    expect(n).toBe(5 * PEER_LIMIT_FACTOR);
  });

  it("through Vercel: one browser is held to 5", async () => {
    const n = await passesBeforeRefusal(
      new PasswordResetThrottleGuard(),
      () => `${BROWSER_A}, ${VERCEL}`,
      resetContext,
      20,
    );
    expect(n).toBe(5);
  });
});

describe("requestSource (R11-10)", () => {
  it("names the browser behind Vercel, not the egress and not a forged prefix", () => {
    expect(
      requestSource({ headers: { "x-forwarded-for": `${BROWSER_A}, ${VERCEL}` } } as any),
    ).toBe(BROWSER_A);
    // A forged entry the caller prepended through Vercel is overwritten by
    // Vercel; directly, the entry left of the edge's is what we can know.
    expect(
      requestSource({
        headers: { "x-forwarded-for": `forged-1, forged-2, ${EDGE_SAW}` },
      } as any),
    ).toBe("forged-2");
  });
});
