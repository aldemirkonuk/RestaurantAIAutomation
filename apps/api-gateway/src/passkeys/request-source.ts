import type { Request } from "express";
import { clientIp } from "../common/rate-limit/client-ip";

/**
 * The caller's address, for the per-source limit on emailed codes (ADR 0229).
 * Read the way the gateway's other limiters read it (`RateLimitGuard`,
 * `PasswordResetThrottleGuard`): the LAST `x-forwarded-for` entry, which is
 * the hop Railway's edge saw, then the socket (`common/rate-limit/client-ip.ts`
 * says why the first entry is not read: a client can type it). The per-address
 * and per-code limits are kept in the database and are the ones that hold
 * across instances. The value is hashed before it is stored.
 */
export function requestSource(req: Request): string | null {
  const ip = clientIp(req);
  return ip === "unknown" ? null : ip;
}
