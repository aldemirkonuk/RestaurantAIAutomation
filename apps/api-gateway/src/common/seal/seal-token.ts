/**
 * The arithmetic of a provable seal. No database, no Nest, no policy.
 *
 * ADR 0114 shipped the seal as an assertion and said so: `sealed: true` was a
 * claim in the same request as the thing it claimed about, so anything holding
 * a manager's session could send it. The founder's rule of 2026-09-04 replaces
 * that with challenge-and-redeem, and this file is the three primitives it
 * needs — kept apart from the service so each is testable on its own and so
 * "what is the token bound to" has exactly one answer.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";

/** How long a seal lives. Long enough to finish a hold, short enough that a
 *  token left in a log is worthless by the time anyone reads it. */
export const SEAL_TTL_MS = 120_000;

/** A fresh token. 32 bytes of CSPRNG — never derived from anything guessable. */
export function newSealToken(): string {
  return randomBytes(32).toString("hex");
}

/** What is stored. The token itself never is; see the migration's header. */
export function hashSealToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A stable hash of the call arguments, so a seal minted for one call cannot be
 * spent on another.
 *
 * Keys are sorted at every level, because two JSON objects that differ only in
 * key order are the same arguments and must not produce two different seals —
 * a manager would approve a call and then be refused for it. Everything else is
 * compared exactly: a string "6" and a number 6 are different arguments, and
 * deciding they are the same is the kind of helpfulness that ends in an order
 * for six hundred.
 */
export function hashCallArgs(args: Record<string, unknown> | undefined): string {
  return createHash("sha256")
    .update(canonical(args ?? {}))
    .digest("hex");
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`)
    .join(",")}}`;
}

/**
 * Constant-time comparison of two hex digests.
 *
 * The hashes are not secrets, so this is belt rather than braces — but a token
 * check that short-circuits on the first differing byte is a habit worth not
 * having anywhere near a seal.
 */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
