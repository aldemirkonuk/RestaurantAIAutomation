import type { Request } from "express";
import {
  bucketAddress,
  clientAddress,
} from "../common/rate-limit/client-address";

/**
 * The caller's address, for the per-source limit on emailed codes (ADR 0229).
 * Read the way every gateway limiter reads it (common/rate-limit/
 * client-address.ts): behind Vercel it is the browser; on a direct call to the
 * gateway it is the entry left of the one Railway's edge wrote, which the
 * caller may have written. So this per-source count slows a careless script
 * and nothing more. What bounds an inventive one is the global
 * `RateLimitGuard`'s bucket on the edge-seen address (R11-10), and the
 * per-address and per-code limits kept in the database. The value is hashed
 * before it is stored. An IPv6 address is counted as its /64 (QA round 14), so
 * rotating inside one allocation is one source.
 */
export function requestSource(req: Request): string | null {
  return bucketAddress(clientAddress(req));
}
