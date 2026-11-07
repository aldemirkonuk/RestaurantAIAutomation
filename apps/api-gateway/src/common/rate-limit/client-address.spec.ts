import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RateLimitGuard } from "./rate-limit.guard";
import {
  MAX_TRUSTED_PROXY_HOPS,
  PEER_LIMIT_FACTOR,
  bucketAddress,
  canonicalAddress,
  requestAddresses,
  trustedProxyHops,
} from "./client-address";
import { PasswordResetThrottleGuard } from "../../auth/guards/password-reset-throttle.guard";
import { requestSource } from "../../passkeys/request-source";
import { AuthController } from "../../auth/auth.controller";

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
const FORGED = "192.0.2.66"; // an address the caller wrote

function loginRequest(xff: string | undefined, email?: string) {
  return {
    headers: xff === undefined ? {} : { "x-forwarded-for": xff },
    url: "/api/v1/auth/login",
    route: { path: "/auth/login" },
    socket: { remoteAddress: "100.64.0.2" },
    body: email === undefined ? {} : { email },
  };
}

/** The real login handler, so its @RateLimit (the account bucket) is read. */
function realLoginContext(xff: string | undefined, email?: string) {
  const res = { setHeader: jest.fn() };
  return {
    switchToHttp: () => ({
      getRequest: () => loginRequest(xff, email),
      getResponse: () => res,
    }),
    getHandler: () => AuthController.prototype.login,
    getClass: () => AuthController,
  } as any;
}

async function allowed(guard: RateLimitGuard, ctx: any): Promise<boolean> {
  try {
    await guard.canActivate(ctx);
    return true;
  } catch (e) {
    expect((e as HttpException).getStatus()).toBe(429);
    return false;
  }
}

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
      requestAddresses({ headers: { "x-forwarded-for": `${FORGED}, ${EDGE_SAW}` } }, 1),
    ).toEqual({ peer: EDGE_SAW, client: FORGED });
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

  it("clamps TRUSTED_PROXY_HOPS to the one edge hop that is known (QA round 14)", () => {
    expect(MAX_TRUSTED_PROXY_HOPS).toBe(1);
    expect(trustedProxyHops(undefined)).toBe(1);
    expect(trustedProxyHops("2")).toBe(1);
    expect(trustedProxyHops("3")).toBe(1);
    expect(trustedProxyHops("0")).toBe(0);
    expect(trustedProxyHops("nonsense")).toBe(1);
    // A hop count above the real one used to make peer a caller-written entry.
    expect(
      requestAddresses(
        { headers: { "x-forwarded-for": `192.0.2.1, 192.0.2.2, ${FORGED}, ${EDGE_SAW}` } },
        3,
      ),
    ).toEqual({ peer: EDGE_SAW, client: FORGED });
  });

  it("ignores the header when the edge-written entry is not an address (fails closed)", () => {
    expect(
      requestAddresses(
        {
          headers: { "x-forwarded-for": `${FORGED}, not-an-address` },
          socket: { remoteAddress: "100.64.0.2" },
        },
        1,
      ),
    ).toEqual({ peer: "100.64.0.2", client: "100.64.0.2" });
  });

  it("a client entry that is not an address is the peer; nothing long is kept", () => {
    const long = "x".repeat(5000);
    expect(
      requestAddresses({ headers: { "x-forwarded-for": `${long}, ${EDGE_SAW}` } }, 1),
    ).toEqual({ peer: EDGE_SAW, client: EDGE_SAW });
  });

  it("buckets IPv6 by /64 and an IPv4-mapped address as IPv4 (QA round 14)", () => {
    expect(bucketAddress("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(bucketAddress("2001:0DB8:0001:0002:ffff:0:0:9")).toBe("2001:db8:1:2::/64");
    expect(bucketAddress("[2001:db8:1:2::7]:443")).toBe("2001:db8:1:2::/64");
    expect(bucketAddress("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
    expect(bucketAddress("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(bucketAddress("198.51.100.7:5555")).toBe("198.51.100.7");
    expect(canonicalAddress("fe80::1%eth0")).toBe("fe80::1");
    expect(canonicalAddress("nonsense")).toBeNull();
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
        headers: { "x-forwarded-for": `192.0.2.1, ${FORGED}, ${EDGE_SAW}` },
      } as any),
    ).toBe(FORGED);
    // An IPv6 caller is one source per /64.
    expect(
      requestSource({ headers: { "x-forwarded-for": "2001:db8:1:2::99" } } as any),
    ).toBe("2001:db8:1:2::/64");
  });
});

/**
 * QA round 14 on PR #855 (round14-pr-retest-misc.md, probe
 * r14-855-xff.probe.spec.ts). At PEER_LIMIT_FACTOR 10, with peer keyed on the
 * full address and TRUSTED_PROXY_HOPS read as given, every case below but the
 * last failed (the last pins the egress-sized bucket, which 169c178f2 also
 * had, at its own factor):
 * 40 browsers x 5 logins behind one Vercel egress were cut off at 100; ten
 * addresses drained the egress for everyone; rotating inside one IPv6 /64, and
 * TRUSTED_PROXY_HOPS set to 2 or 3, let 500 of 500 through; and one account
 * took 300 guesses from 200 addresses.
 */
describe("POST /auth/login after QA round 14", () => {
  const hopsEnv = process.env.TRUSTED_PROXY_HOPS;
  afterEach(() => {
    if (hopsEnv === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = hopsEnv;
  });

  it("40 browsers behind one Vercel egress, 5 logins each: none is refused", async () => {
    const guard = newGuard();
    let refused = 0;
    for (let u = 0; u < 40; u++) {
      for (let t = 0; t < 5; t++) {
        const ok = await allowed(
          guard,
          realLoginContext(`203.0.113.${u}, ${VERCEL}`, `cook${u}@house.test`),
        );
        if (!ok) refused++;
      }
    }
    expect(refused).toBe(0);
  });

  it("ten addresses hammering through Vercel do not lock anyone else out", async () => {
    const guard = newGuard();
    for (let a = 0; a < 10; a++) {
      for (let t = 0; t < 20; t++) {
        await allowed(guard, realLoginContext(`192.0.2.${a}, ${VERCEL}`, `x${t}@spam.test`));
      }
    }
    expect(
      await allowed(guard, realLoginContext(`${BROWSER_A}, ${VERCEL}`, "owner@house.test")),
    ).toBe(true);
  });

  it("rotating inside one IPv6 /64 is one address", async () => {
    const guard = newGuard();
    let n = 0;
    for (let i = 0; i < 500; i++) {
      // The edge replaced the header with the address it saw.
      if (await allowed(guard, realLoginContext(`2001:db8:1:2::${i.toString(16)}`, `u${i}@x.test`))) n++;
    }
    expect(n).toBe(10);
  });

  it("an IPv4 host and its IPv4-mapped IPv6 form share one bucket", async () => {
    const guard = newGuard();
    let n = 0;
    for (let i = 0; i < 20; i++) {
      const addr = i % 2 ? "::ffff:198.51.100.9" : "198.51.100.9";
      if (await allowed(guard, realLoginContext(addr, `u${i}@x.test`))) n++;
    }
    expect(n).toBe(10);
  });

  it.each(["2", "3"])(
    "TRUSTED_PROXY_HOPS=%s: peer stays the edge-written entry, and one account takes 10 guesses",
    async (hops) => {
      process.env.TRUSTED_PROXY_HOPS = hops;
      const guard = newGuard();
      let n = 0;
      for (let i = 0; i < 500; i++) {
        const forged = `10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`;
        if (
          await allowed(
            guard,
            realLoginContext(`192.0.2.1, 192.0.2.2, ${forged}, ${EDGE_SAW}`, "victim@house.test"),
          )
        )
          n++;
      }
      expect(n).toBe(10);
      expect(
        requestAddresses(loginRequest(`192.0.2.1, 192.0.2.2, ${FORGED}, ${EDGE_SAW}`)),
      ).toEqual({ peer: EDGE_SAW, client: FORGED });
    },
  );

  it("one account from 300 real addresses takes 10 guesses, and the next account is unaffected", async () => {
    const guard = newGuard();
    let n = 0;
    for (let i = 0; i < 300; i++) {
      const ok = await allowed(
        guard,
        // Each attempt is a different real address end to end (a botnet on
        // the direct road): no address bucket repeats, so only the account
        // bucket can hold the line.
        realLoginContext(`198.51.${i >> 8}.${i & 255}`, " Victim@House.test "),
      );
      if (ok) n++;
    }
    expect(n).toBe(10);
    expect(
      await allowed(guard, realLoginContext(`${BROWSER_B}, ${VERCEL}`, "owner@house.test")),
    ).toBe(true);
  });

  it("many accounts from one real address are held at the egress-sized bucket", async () => {
    const guard = newGuard();
    let n = 0;
    for (let i = 0; i < 10 * PEER_LIMIT_FACTOR + 50; i++) {
      const forged = `10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`;
      if (await allowed(guard, realLoginContext(`${forged}, ${EDGE_SAW}`, `u${i}@x.test`))) n++;
    }
    expect(n).toBe(10 * PEER_LIMIT_FACTOR);
  });
});
