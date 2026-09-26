import type { Request } from "express";

/**
 * The caller's address, for the per-source limit on emailed codes (ADR 0229).
 * Read the way the gateway's other limiters read it (`RateLimitGuard`,
 * `PasswordResetThrottleGuard`): the first `x-forwarded-for` entry, then the
 * socket. That first entry is whatever the client sent when a proxy appends
 * rather than overwrites, so this limit slows a careless script and nothing
 * more; the per-address and per-code limits are kept in the database and are
 * the ones that hold. The value is hashed before it is stored.
 */
export function requestSource(req: Request): string | null {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || null;
}
