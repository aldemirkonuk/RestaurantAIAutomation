import * as crypto from "crypto";

/**
 * Stripe webhook signature verification, as a pure function.
 *
 * WHY THIS IS NOT A METHOD ON A SERVICE
 * ------------------------------------
 * It is the one piece of this module where a bug is silent and total: a
 * verifier that returns `true` too easily turns a public URL into an
 * unauthenticated write endpoint on the payment register, and nothing in the
 * product would look different afterwards. So it is a pure function of
 * (bytes, header, secret, tolerance, now) with no injected clock, no config
 * lookup and no database — every one of its failure modes is reachable from a
 * spec, including the two nobody writes a test for: a header with a valid `v1`
 * for a DIFFERENT payload, and a valid signature replayed a day later.
 *
 * THE SCHEME (Stripe's, verbatim)
 * -------------------------------
 *   Stripe-Signature: t=1690000000,v1=<hex>,v1=<hex>
 *   signed_payload   = `${t}.${rawBody}`
 *   expected         = HMAC-SHA256(signed_payload, whsec_...) as lowercase hex
 *
 * Multiple `v1` entries appear during a secret roll; any ONE matching is a
 * pass, which is what makes rolling a secret possible without downtime.
 *
 * TWO THINGS THAT ARE DELIBERATE
 * ------------------------------
 *  1. `rawBody` is the exact bytes Express received. `JSON.stringify(req.body)`
 *     is NOT the same string — key order, unicode escaping and float formatting
 *     all differ — so a re-serialised body fails against a real signature and,
 *     worse, would tempt someone to "fix" it by loosening the comparison.
 *     `main.ts` sets `rawBody: true` for exactly this reason.
 *  2. The comparison is `crypto.timingSafeEqual` over equal-length buffers. A
 *     `===` on hex strings leaks the position of the first differing byte, and
 *     a webhook endpoint can be probed at whatever rate the attacker likes.
 */

/** Stripe's own default: five minutes either side of the stamped time. */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export type StripeSignatureFailure =
  | "no-secret"
  | "no-signature"
  | "no-body"
  | "malformed-header"
  | "timestamp-outside-tolerance"
  | "no-matching-signature";

export type StripeSignatureResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: StripeSignatureFailure };

interface ParsedHeader {
  timestamp: number;
  signatures: string[];
}

function parseHeader(header: string): ParsedHeader | null {
  let timestamp = Number.NaN;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = Number.parseInt(value, 10);
    else if (key === "v1" && /^[0-9a-f]+$/i.test(value)) signatures.push(value);
  }

  if (!Number.isFinite(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function equalsConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // (very coarse) oracle if it escaped. Length is not secret; the bytes are.
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * @param rawBody the exact bytes of the request, never a re-serialisation
 * @param header  the `Stripe-Signature` request header
 * @param secret  `STRIPE_WEBHOOK_SECRET` (`whsec_...`)
 * @param nowMs   injected so the replay window is testable without faking time
 */
export function verifyStripeSignature(
  rawBody: Buffer | string | undefined | null,
  header: string | undefined | null,
  secret: string | undefined | null,
  nowMs: number = Date.now(),
  toleranceSeconds: number = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
): StripeSignatureResult {
  // Fails CLOSED on a missing secret. An endpoint that accepts everything
  // because it was never configured is the absence-reported-as-health shape at
  // its most expensive: it writes.
  if (!secret || secret.trim().length === 0) {
    return { ok: false, reason: "no-secret" };
  }
  if (!header || header.trim().length === 0) {
    return { ok: false, reason: "no-signature" };
  }
  if (rawBody === undefined || rawBody === null || rawBody.length === 0) {
    return { ok: false, reason: "no-body" };
  }

  const parsed = parseHeader(header);
  if (!parsed) return { ok: false, reason: "malformed-header" };

  const ageSeconds = Math.abs(nowMs / 1000 - parsed.timestamp);
  if (ageSeconds > toleranceSeconds) {
    return { ok: false, reason: "timestamp-outside-tolerance" };
  }

  const payload =
    typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = crypto
    .createHmac("sha256", secret.trim())
    .update(`${parsed.timestamp}.${payload}`, "utf8")
    .digest("hex");

  for (const candidate of parsed.signatures) {
    if (equalsConstantTime(candidate.toLowerCase(), expected)) {
      return { ok: true, timestamp: parsed.timestamp };
    }
  }
  return { ok: false, reason: "no-matching-signature" };
}

/** The words the endpoint answers with. One sentence per failure, never "invalid". */
export const SIGNATURE_FAILURE_MESSAGE: Record<StripeSignatureFailure, string> =
  {
    "no-secret":
      "STRIPE_WEBHOOK_SECRET is not configured on this deployment, so no delivery can be authenticated and every delivery is refused.",
    "no-signature": "The request carried no Stripe-Signature header.",
    "no-body":
      "The request carried no body to verify. The raw bytes are required — a re-serialised JSON body cannot match a real signature.",
    "malformed-header":
      "The Stripe-Signature header had no timestamp or no v1 signature in it.",
    "timestamp-outside-tolerance":
      "The signature's timestamp is outside the five-minute tolerance. This is a replay, or the server clock is wrong.",
    "no-matching-signature":
      "No v1 signature in the header matched this endpoint's secret over the exact request bytes.",
  };
