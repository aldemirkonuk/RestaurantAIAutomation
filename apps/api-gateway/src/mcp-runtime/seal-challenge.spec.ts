/**
 * The seal's arithmetic, on its own.
 *
 * ADR 0114 shipped `sealed: true` as an assertion and named its own limit. The
 * founder's rule of 2026-09-04 makes it a redemption, and a redemption is only
 * as good as what the token is BOUND to — which is what this file pins.
 */

import {
  SEAL_TTL_MS,
  digestsMatch,
  hashCallArgs,
  hashSealToken,
  newSealToken,
} from "./seal-challenge";

describe("the token", () => {
  it("is never the same twice", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newSealToken()));
    expect(seen.size).toBe(200);
  });

  it("is long enough that guessing is not a strategy", () => {
    expect(newSealToken()).toHaveLength(64); // 32 bytes, hex
  });

  it("hashes stably, and the hash is not the token", () => {
    const t = newSealToken();
    expect(hashSealToken(t)).toEqual(hashSealToken(t));
    expect(hashSealToken(t)).not.toEqual(t);
  });
});

describe("what the seal is bound to", () => {
  it("treats the same arguments in a different key order as the same call", () => {
    // A manager approves a call; the client serialises it again before sending.
    // If key order changed the hash, they would be refused for the call they
    // just approved — and would learn to distrust the seal.
    expect(hashCallArgs({ a: 1, b: { x: 1, y: 2 } })).toEqual(
      hashCallArgs({ b: { y: 2, x: 1 }, a: 1 }),
    );
  });

  it("treats different arguments as a different call", () => {
    expect(hashCallArgs({ bottles: 6 })).not.toEqual(hashCallArgs({ bottles: 600 }));
  });

  it("does not treat a string and a number as the same argument", () => {
    // The helpfulness that would collapse these is the helpfulness that ends in
    // an order for six hundred.
    expect(hashCallArgs({ n: 6 })).not.toEqual(hashCallArgs({ n: "6" }));
  });

  it("treats an absent argument object as the empty one, and says so once", () => {
    expect(hashCallArgs(undefined)).toEqual(hashCallArgs({}));
  });

  it("distinguishes a null from a missing key", () => {
    expect(hashCallArgs({ a: null })).not.toEqual(hashCallArgs({}));
  });
});

describe("comparison and lifetime", () => {
  it("matches equal digests and rejects unequal ones of the same length", () => {
    const a = hashSealToken("one");
    expect(digestsMatch(a, a)).toBe(true);
    expect(digestsMatch(a, hashSealToken("two"))).toBe(false);
  });

  it("rejects an empty or differently sized digest rather than throwing", () => {
    expect(digestsMatch("", hashSealToken("x"))).toBe(false);
    expect(digestsMatch("aa", hashSealToken("x"))).toBe(false);
  });

  it("lives minutes, not hours", () => {
    expect(SEAL_TTL_MS).toBeLessThanOrEqual(5 * 60_000);
    expect(SEAL_TTL_MS).toBeGreaterThanOrEqual(30_000);
  });
});
