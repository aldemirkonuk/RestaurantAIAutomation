/**
 * Meta's webhook handshake and payload signature, as pure functions.
 *
 * WHY PURE FUNCTIONS AND NOT METHODS (the same reason as `stripe-signature.ts`)
 * -----------------------------------------------------------------------------
 * These two checks are the whole of the authentication on a PUBLIC URL that
 * writes rows into a house's conversation book. A verifier that returns `true`
 * too easily turns that URL into an unauthenticated write endpoint, and nothing
 * in the product would look different afterwards. So both are functions of
 * their arguments with no config lookup, no clock and no database, and every
 * failure path is reachable from a spec.
 *
 * THE SCHEME, FROM META'S OWN PAGE
 * --------------------------------
 * `developers.facebook.com/docs/graph-api/webhooks/getting-started`, fetched
 * 2026-09-06:
 *
 *   Verification (GET). Meta calls the endpoint with `hub.mode`, which "must
 *   equal `subscribe`", `hub.verify_token`, which must match "the string you
 *   set in the Verify Token field" in the App Dashboard, and `hub.challenge`.
 *   On a match the endpoint responds **200** with `hub.challenge` as the body.
 *
 *   Payloads (POST). The header is `X-Hub-Signature-256`, its value is
 *   `sha256=<signature>`, and the signature is "a SHA256 signature using the
 *   payload and your app's App Secret" — i.e. HMAC-SHA256 of the raw body,
 *   keyed on the app secret, compared against the header's value after the
 *   `sha256=` prefix.
 *
 * THREE THINGS THAT ARE DELIBERATE
 * --------------------------------
 *  1. **The raw bytes, never a re-serialised body.** `JSON.stringify(req.body)`
 *     is a different string from what Meta signed — key order, unicode escaping
 *     and number formatting all differ — so it fails against a real signature,
 *     and the tempting "fix" is to loosen the comparison. `main.ts` sets
 *     `rawBody: true` for exactly this.
 *  2. **`crypto.timingSafeEqual`, over equal-length buffers.** A `===` on hex
 *     leaks the position of the first differing byte, and a public webhook can
 *     be probed at whatever rate an attacker likes.
 *  3. **No secret means REFUSE, and it is its own reason.** A deployment with
 *     `WHATSAPP_APP_SECRET` unset must not accept anything. Treating a missing
 *     secret as "nothing to check" is the exact shape this repo calls
 *     absence-reported-as-health, aimed at the one door where it would be
 *     invisible: rows would appear in houses' books from anybody who found the
 *     URL, and every one of them would look like a vendor reply.
 */

import * as crypto from "crypto";

export const META_SIGNATURE_HEADER = "x-hub-signature-256";
export const META_SIGNATURE_PREFIX = "sha256=";

export type MetaSignatureFailure =
  | "no-secret"
  | "no-signature"
  | "no-body"
  | "malformed-header"
  | "no-matching-signature";

export type MetaSignatureResult =
  | { ok: true }
  | { ok: false; reason: MetaSignatureFailure; says: string };

const SAYS: Record<MetaSignatureFailure, string> = {
  "no-secret":
    "This deployment holds no WhatsApp app secret, so an inbound webhook cannot be authenticated. Nothing was stored. That is ours to fix, not the sender's.",
  "no-signature":
    "This request carried no X-Hub-Signature-256 header, so it cannot be shown to have come from Meta. Nothing was stored.",
  "no-body":
    "This request carried no body to verify, so nothing could be authenticated and nothing was stored.",
  "malformed-header":
    "This request's X-Hub-Signature-256 header is not in Meta's `sha256=<hex>` form, so it cannot be checked. Nothing was stored.",
  "no-matching-signature":
    "This request's signature does not match its body, so it is not from Meta's app for this deployment. Nothing was stored.",
};

/**
 * Verify one payload.
 *
 * `rawBody` must be the exact bytes received. Passing a string is allowed for
 * tests and is encoded as UTF-8, which is what Express would have produced.
 */
export function verifyMetaSignature(params: {
  rawBody: Buffer | string | null | undefined;
  header: string | null | undefined;
  appSecret: string | null | undefined;
}): MetaSignatureResult {
  const fail = (reason: MetaSignatureFailure): MetaSignatureResult => ({
    ok: false,
    reason,
    says: SAYS[reason],
  });

  // The secret is checked FIRST and on its own. If it were folded into the
  // header check, a deployment with no secret would report the SENDER's fault
  // for our own missing configuration.
  if (!params.appSecret) return fail("no-secret");
  if (!params.header) return fail("no-signature");
  if (params.rawBody === null || params.rawBody === undefined)
    return fail("no-body");

  const body =
    typeof params.rawBody === "string"
      ? Buffer.from(params.rawBody, "utf8")
      : params.rawBody;
  if (body.length === 0) return fail("no-body");

  const header = params.header.trim();
  if (!header.startsWith(META_SIGNATURE_PREFIX)) return fail("malformed-header");

  const given = header.slice(META_SIGNATURE_PREFIX.length).toLowerCase();
  // 64 lowercase hex characters, and nothing else. A length check alone would
  // let `Buffer.from(…, "hex")` silently truncate a header with a stray
  // character into a shorter buffer, and a shorter buffer compares against a
  // shorter slice of the expected value.
  if (!/^[0-9a-f]{64}$/.test(given)) return fail("malformed-header");

  const expected = crypto
    .createHmac("sha256", params.appSecret)
    .update(body)
    .digest("hex");

  const a = Buffer.from(given, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return fail("no-matching-signature");
  if (!crypto.timingSafeEqual(a, b)) return fail("no-matching-signature");

  return { ok: true };
}

export type MetaHandshakeResult =
  | { ok: true; challenge: string }
  | {
      ok: false;
      reason: "no-verify-token" | "wrong-mode" | "wrong-token" | "no-challenge";
      says: string;
    };

/**
 * The GET verification handshake.
 *
 * Returns the challenge to echo, or a refusal. It never returns the challenge
 * on a token it could not check: a deployment with no `verify_token` set
 * refuses rather than echoing, because echoing would let anybody subscribe an
 * arbitrary Meta app to this endpoint.
 */
export function verifyMetaHandshake(params: {
  mode: string | undefined;
  token: string | undefined;
  challenge: string | undefined;
  verifyToken: string | null | undefined;
}): MetaHandshakeResult {
  if (!params.verifyToken) {
    return {
      ok: false,
      reason: "no-verify-token",
      says: "This deployment holds no WhatsApp webhook verify token, so a subscription cannot be verified. Nothing was echoed.",
    };
  }
  if (params.mode !== "subscribe") {
    return {
      ok: false,
      reason: "wrong-mode",
      says: `hub.mode was ${params.mode ? `"${params.mode}"` : "absent"} and Meta's handshake sends "subscribe". Nothing was echoed.`,
    };
  }
  if (!params.token) {
    return {
      ok: false,
      reason: "wrong-token",
      says: "This request carried no hub.verify_token, so it cannot be shown to be Meta's handshake for this deployment. Nothing was echoed.",
    };
  }

  // Constant-time again. The token is a shared secret and this endpoint is
  // public, so a `!==` here is an oracle for it one byte at a time.
  const given = Buffer.from(params.token, "utf8");
  const want = Buffer.from(params.verifyToken, "utf8");
  const matches =
    given.length === want.length && crypto.timingSafeEqual(given, want);
  if (!matches) {
    return {
      ok: false,
      reason: "wrong-token",
      says: "This request's hub.verify_token does not match this deployment's. Nothing was echoed.",
    };
  }

  if (!params.challenge) {
    return {
      ok: false,
      reason: "no-challenge",
      says: "The token matched but the request carried no hub.challenge to echo, so there was nothing to answer with.",
    };
  }

  return { ok: true, challenge: params.challenge };
}
