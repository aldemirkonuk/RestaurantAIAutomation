import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Request } from "express";
import {
  PEER_LIMIT_FACTOR,
  bucketAddress,
  requestAddresses,
} from "../../common/rate-limit/client-address";

/**
 * Per-IP rate limit on POST /auth/request-password-reset.
 *
 * This is deliberately a second, coarser layer alongside the per-email
 * cooldown in AuthService#requestPasswordReset, not a replacement for it. The
 * two guards see different things: this one cannot tell which email address
 * is being requested, so it is the only thing that catches one IP cycling
 * through many addresses; the per-email check is the only thing that catches
 * many IPs (or a proxy pool) hammering one address.
 *
 * In-memory and per-process. That is an honest limitation, not an oversight —
 * api-gateway does not currently have a shared cache reachable from a guard
 * without DI-order complications (CacheService is request-scoped elsewhere in
 * this module), and a per-process limit still stops the common case, a single
 * client script retrying against one instance. If api-gateway ever runs
 * multiple instances behind a load balancer, this stops being a real limit
 * across the fleet and should move to CacheService/Redis — same caveat as
 * any in-memory rate limiter, written down instead of discovered in an
 * incident.
 */
@Injectable()
export class PasswordResetThrottleGuard implements CanActivate {
  private static readonly WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  private static readonly MAX_REQUESTS_PER_WINDOW = 5;

  // ip -> request timestamps within the current window
  private readonly hits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    // R11-10: `client` may be caller-written on a direct call, so the address
    // Railway's edge saw (`peer`) gets its own, looser bucket as well.
    // QA round 14: an IPv6 address counts as its /64.
    const addresses = requestAddresses(req);
    const client = bucketAddress(addresses.client);
    const peer = bucketAddress(addresses.peer);
    const now = Date.now();

    const windowStart = now - PasswordResetThrottleGuard.WINDOW_MS;
    const max = PasswordResetThrottleGuard.MAX_REQUESTS_PER_WINDOW;
    const buckets: Array<[string, number]> = [[`ip:${client || "unknown"}`, max]];
    if (peer && peer !== client) {
      buckets.push([`peer:${peer}`, max * PEER_LIMIT_FACTOR]);
    }
    const kept = buckets.map(([key, limit]) => {
      const times = (this.hits.get(key) || []).filter((t) => t > windowStart);
      return { key, limit, times };
    });

    if (kept.some((b) => b.times.length >= b.limit)) {
      throw new HttpException(
        "Too many password reset requests from this address. Please try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    for (const b of kept) {
      b.times.push(now);
      this.hits.set(b.key, b.times);
    }

    // Opportunistic cleanup so `hits` does not grow without bound across the
    // life of the process — every call trims one entry's window rather than
    // running a separate sweep timer.
    if (this.hits.size > 10_000) {
      for (const [key, times] of this.hits) {
        if (times.every((t) => t <= windowStart)) this.hits.delete(key);
      }
    }

    return true;
  }

}
