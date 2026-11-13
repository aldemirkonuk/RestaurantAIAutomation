/**
 * A known-device token for per-account rate limits (QA round 19, #906): a
 * signed token bound to the account that a password login returns. Sent back,
 * it puts the attempt in a bucket of its own so a stranger filling the shared
 * "untrusted" one cannot lock the owner out. A rate-limit key, never a session.
 */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { resolveJwtSecret } from "../../auth/jwt-secret";

const MAX_TOKEN_LENGTH = 512;
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;
const ZERO_WIDTH = /[​-‍⁠﻿]/g;

/** An account name as one comparable string: NFKC, no zero-width, trimmed, lower-cased. */
export function foldAccount(raw: string): string {
  return raw.normalize("NFKC").replace(ZERO_WIDTH, "").trim().toLowerCase();
}

/** sha256 hex of the WHOLE folded account (never sliced, never stored raw). */
export function accountDigest(folded: string): string {
  return createHash("sha256").update(folded).digest("hex");
}

/** The signing secret, derived so it is never the raw JWT secret. */
export function signInDeviceSecret(configuredJwtSecret: string | undefined): string {
  return createHmac("sha256", resolveJwtSecret(configuredJwtSecret))
    .update("sign-in-device")
    .digest("hex");
}

function sign(secret: string, payloadB64: string): string {
  return createHmac("sha256", secret)
    .update("sign-in-device.v1." + payloadB64)
    .digest("base64url");
}

export function issueSignInDevice(
  secret: string,
  folded: string,
  deviceId?: string,
  now: number = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      a: accountDigest(folded).slice(0, 32),
      d: deviceId ?? randomBytes(16).toString("hex"),
      t: now,
    }),
  ).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

/** The device id a valid token for this account carries, else null. */
export function readSignInDevice(
  secret: string,
  token: unknown,
  folded: string,
  now: number = Date.now(),
): string | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payloadB64, sig] = parts;
  const expected = Buffer.from(sign(secret, payloadB64));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  let p: any;
  try {
    p = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || p.v !== 1) return null;
  if (p.a !== accountDigest(folded).slice(0, 32)) return null;
  if (typeof p.t !== "number" || !Number.isFinite(p.t)) return null;
  if (p.t < now - MAX_AGE_MS || p.t > now + MAX_FUTURE_MS) return null;
  if (typeof p.d !== "string" || !/^[0-9a-f]{32}$/.test(p.d)) return null;
  return p.d;
}
