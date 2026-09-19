/**
 * The webhook verifier — the one place in this module where a bug is silent
 * and total.
 *
 * A verifier that returns `true` too easily turns a public URL into an
 * unauthenticated write endpoint on the payment register, and nothing in the
 * product would look different afterwards. So these tests cover the two cases
 * nobody writes: a header carrying a VALID signature for a DIFFERENT payload,
 * and a valid signature REPLAYED outside the tolerance window. Both are passes
 * for the naive implementations (`===` on the hex, or no timestamp check).
 */

import * as crypto from "crypto";
import {
  STRIPE_SIGNATURE_TOLERANCE_SECONDS,
  verifyStripeSignature,
} from "./stripe-signature";

const SECRET = "whsec_test_0123456789abcdef";
const BODY = JSON.stringify({ id: "evt_1", type: "payment_method.attached" });
const NOW_MS = 1_780_000_000_000;
const T = Math.floor(NOW_MS / 1000);

function sign(body: string, secret = SECRET, t = T): string {
  const mac = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${body}`, "utf8")
    .digest("hex");
  return `t=${t},v1=${mac}`;
}

describe("verifyStripeSignature — the happy path", () => {
  it("accepts a signature computed over the exact bytes", () => {
    const out = verifyStripeSignature(Buffer.from(BODY), sign(BODY), SECRET, NOW_MS);
    expect(out).toEqual({ ok: true, timestamp: T });
  });

  it("accepts when ANY of several v1 entries matches, so a secret can be rolled", () => {
    const header = `${sign(BODY, "whsec_the_old_one")},v1=${crypto
      .createHmac("sha256", SECRET)
      .update(`${T}.${BODY}`, "utf8")
      .digest("hex")}`;
    expect(verifyStripeSignature(Buffer.from(BODY), header, SECRET, NOW_MS).ok).toBe(
      true,
    );
  });

  it("accepts a string body identically to a Buffer", () => {
    expect(verifyStripeSignature(BODY, sign(BODY), SECRET, NOW_MS).ok).toBe(true);
  });
});

describe("verifyStripeSignature — fails closed", () => {
  it("refuses everything when no webhook secret is configured", () => {
    const out = verifyStripeSignature(Buffer.from(BODY), sign(BODY), undefined, NOW_MS);
    expect(out).toEqual({ ok: false, reason: "no-secret" });
  });

  it("treats a whitespace-only secret as absent, not as configured", () => {
    expect(
      verifyStripeSignature(Buffer.from(BODY), sign(BODY), "   ", NOW_MS),
    ).toEqual({ ok: false, reason: "no-secret" });
  });

  it("refuses a request with no signature header", () => {
    expect(verifyStripeSignature(Buffer.from(BODY), undefined, SECRET, NOW_MS)).toEqual(
      { ok: false, reason: "no-signature" },
    );
  });

  it("refuses an empty body — a re-serialised body cannot match a real signature", () => {
    expect(verifyStripeSignature(Buffer.alloc(0), sign(BODY), SECRET, NOW_MS)).toEqual({
      ok: false,
      reason: "no-body",
    });
  });

  it("refuses a header with no timestamp or no v1", () => {
    expect(
      verifyStripeSignature(Buffer.from(BODY), "v1=deadbeef", SECRET, NOW_MS).ok,
    ).toBe(false);
    expect(verifyStripeSignature(Buffer.from(BODY), `t=${T}`, SECRET, NOW_MS)).toEqual({
      ok: false,
      reason: "malformed-header",
    });
  });
});

describe("verifyStripeSignature — the two cases a naive implementation passes", () => {
  it("refuses a VALID signature computed over a DIFFERENT payload", () => {
    // Signed correctly, with the right secret, at the right time — for another
    // body. An implementation that verifies the header's own consistency, or
    // that hashes a re-serialised `req.body`, lets this through.
    const other = JSON.stringify({ id: "evt_2", type: "payment_method.detached" });
    const out = verifyStripeSignature(
      Buffer.from(BODY),
      sign(other),
      SECRET,
      NOW_MS,
    );
    expect(out).toEqual({ ok: false, reason: "no-matching-signature" });
  });

  it("refuses a valid signature replayed outside the tolerance window", () => {
    const header = sign(BODY);
    const later = NOW_MS + (STRIPE_SIGNATURE_TOLERANCE_SECONDS + 60) * 1000;
    expect(verifyStripeSignature(Buffer.from(BODY), header, SECRET, later)).toEqual({
      ok: false,
      reason: "timestamp-outside-tolerance",
    });
    // …and still accepts it INSIDE the window, so the check is a window and not
    // an off-by-one that rejects everything.
    expect(
      verifyStripeSignature(
        Buffer.from(BODY),
        header,
        SECRET,
        NOW_MS + (STRIPE_SIGNATURE_TOLERANCE_SECONDS - 5) * 1000,
      ).ok,
    ).toBe(true);
  });

  it("refuses a signature minted with the wrong secret", () => {
    expect(
      verifyStripeSignature(
        Buffer.from(BODY),
        sign(BODY, "whsec_somebody_elses"),
        SECRET,
        NOW_MS,
      ),
    ).toEqual({ ok: false, reason: "no-matching-signature" });
  });

  it("refuses a truncated signature rather than throwing on a length mismatch", () => {
    // `crypto.timingSafeEqual` throws when the buffers differ in length. If that
    // escaped, a one-character signature would 500 the endpoint instead of
    // being rejected.
    const header = `t=${T},v1=abcd`;
    expect(() =>
      verifyStripeSignature(Buffer.from(BODY), header, SECRET, NOW_MS),
    ).not.toThrow();
    expect(verifyStripeSignature(Buffer.from(BODY), header, SECRET, NOW_MS).ok).toBe(
      false,
    );
  });
});
