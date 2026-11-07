import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Request } from "express";

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
    const ip = this.resolveIp(req);
    const now = Date.now();

    const windowStart = now - PasswordResetThrottleGuard.WINDOW_MS;
    const existing = (this.hits.get(ip) || []).filter((t) => t > windowStart);

    if (existing.length >= PasswordResetThrottleGuard.MAX_REQUESTS_PER_WINDOW) {
      throw new HttpException(
        "Too many password reset requests from this address. Please try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    existing.push(now);
    this.hits.set(ip, existing);

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

  private resolveIp(req: Request): string {
    // x-forwarded-for can carry a comma-separated chain when behind a proxy;
    // the client is the first entry. Falls back to the socket address for a
    // direct connection (e.g. local dev, health checks).
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      return forwarded.split(",")[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || "unknown";
  }
}
