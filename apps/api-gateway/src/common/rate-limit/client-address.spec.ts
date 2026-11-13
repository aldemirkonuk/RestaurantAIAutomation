import {
  MAX_TRUSTED_PROXY_HOPS,
  bucketAddress,
  canonicalAddress,
  requestAddresses,
  trustedProxyHops,
} from "./client-address";

/**
 * A caller cannot buy a fresh rate-limit bucket by writing x-forwarded-for
 * (QA round 11, R11-10).
 *
 * Every limiter keyed on the LEFT-MOST entry, which a caller who reaches the
 * Railway URL directly writes. The cases here cover the address module alone; the guards that use it are
 * covered in client-address-callers.spec.ts. They cover both edge shapes (Railway
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
const FORGED = "192.0.2.66"; // an address the caller wrote

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
