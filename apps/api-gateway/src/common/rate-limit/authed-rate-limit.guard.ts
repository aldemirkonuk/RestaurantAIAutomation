import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

/**
 * A SECOND rate limiter, and the reason there are two is guard order.
 *
 * `RateLimitGuard` in this same folder is registered as an `APP_GUARD` in
 * `app.module.ts`. Nest runs global guards BEFORE controller-level ones, so it
 * executes before `JwtAuthGuard` has put anything on `request.user`. Its
 * `generateKey` reaches for `request.user?.id`, then `request.user?.restaurantId`,
 * and finds neither — every request it sees is anonymous, so in practice it
 * keys on the client IP for every route in the gateway.
 *
 * That is the right shape for a global limiter: it is the only layer that can
 * see a caller who has no token at all, and an IP is the only handle available
 * before authentication. It is the wrong shape for "this ONE member of this ONE
 * house may ask the model ten times a minute", because the identity that
 * sentence is about does not exist yet when it runs.
 *
 * So this guard is listed AFTER `JwtAuthGuard` on the controllers that need it,
 * where `request.user` is populated and `userId` and `restaurantId` are real.
 * The two compose: the global one bounds an IP, this one bounds a person and a
 * house. Neither replaces the other, and this one is deliberately not global —
 * a route that does not declare `@AuthedRateLimit` is untouched by it.
 *
 * ## The honest limitation
 *
 * In-memory and per-process, like `RateLimitGuard` and
 * `PasswordResetThrottleGuard` before it, and for the same reason: no shared
 * cache is reachable from a guard here without DI-order complications. With one
 * gateway instance this is a real limit; behind N instances the effective
 * ceiling is N times the configured one. Written down rather than discovered in
 * an incident — and it is why a route that spends money also carries a spend
 * ceiling, which reads a SHARED ledger and therefore binds the whole fleet.
 */

export const AUTHED_RATE_LIMIT_KEY = "authedRateLimit";

/** What an authenticated limit counts against. */
export type AuthedRateLimitScope = "user" | "restaurant";

export interface AuthedRateLimitRule {
  /** Server-declared routes sharing one spend budget. Never read from a request. */
  bucket?: string;
  /** Requests admitted per window. */
  limit: number;
  /** Window length in seconds, matching RateLimitConfig's unit. */
  windowSeconds: number;
  /** Default `user`. */
  scope?: AuthedRateLimitScope;
  /** Shown to the caller. Write it for an operator, not for a log. */
  message?: string;
}

/**
 * Declare one or more authenticated rate limits on a route.
 *
 * Several rules are AND, never OR: a burst limit and a sustained limit both
 * have to admit the request. A deliberately DIFFERENT metadata key from
 * `RateLimit`'s, so putting one of these on a route does not silently
 * reconfigure the global guard as well.
 */
export const AuthedRateLimit =
  (...rules: AuthedRateLimitRule[]) =>
  (target: any, key?: string, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(AUTHED_RATE_LIMIT_KEY, rules, descriptor.value);
    } else {
      Reflect.defineMetadata(AUTHED_RATE_LIMIT_KEY, rules, target);
    }
    return descriptor || target;
  };

@Injectable()
export class AuthedRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(AuthedRateLimitGuard.name);

  /** key -> ascending hit timestamps inside that key's widest window. */
  private readonly hits = new Map<string, number[]>();

  /** Distinct keys retained before dead windows are swept. */
  private static readonly SWEEP_AT = 10_000;

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rules =
      this.reflector.get<AuthedRateLimitRule[]>(
        AUTHED_RATE_LIMIT_KEY,
        context.getHandler(),
      ) ??
      this.reflector.get<AuthedRateLimitRule[]>(
        AUTHED_RATE_LIMIT_KEY,
        context.getClass(),
      );
    if (!rules || rules.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const user = req?.user;

    // No token here means JwtAuthGuard did not run before this guard, which is
    // a wiring mistake, not a caller's doing. Refusing is the only safe read:
    // letting it through would leave the route with nothing but the global
    // IP limit while the code says otherwise, and bucketing every such
    // request under one shared key would let a single caller exhaust the
    // allowance of everyone else. Fail closed, and say which it is.
    if (!user?.userId) {
      this.logger.error(
        `${context.getClass().name}.${context.getHandler().name} declares ` +
          "@AuthedRateLimit but no authenticated user reached it — list this " +
          "guard AFTER JwtAuthGuard in @UseGuards.",
      );
      throw new HttpException(
        "This route is misconfigured and is refusing requests.",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const now = Date.now();
    const route = `${context.getClass().name}.${context.getHandler().name}`;

    // Rules are grouped by the key they count against, because a burst limit
    // and a sustained limit on the same scope share one key. One array per
    // key, filtered on READ by each rule's own window — storing a separate
    // array per rule would let the narrower window overwrite the wider one's
    // history, silently truncating an hourly limit to a minute.
    const byKey = new Map<
      string,
      { widestMs: number; rules: AuthedRateLimitRule[] }
    >();
    for (const rule of rules) {
      const scope: AuthedRateLimitScope = rule.scope ?? "user";
      // A restaurant-scoped rule for a caller with no house counts that PERSON.
      // It used to fall back to the literal key `r:none`, which every
      // tenantless caller in the gateway shared, so one of them could spend the
      // house allowance of all the others (ADR 0146, second adversarial pass).
      const subject =
        scope === "restaurant" && user.restaurantId
          ? `r:${String(user.restaurantId)}`
          : `u:${String(user.userId)}`;
      const key = `${rule.bucket ? `shared:${rule.bucket}` : route}|${scope}|${subject}`;
      const windowMs = rule.windowSeconds * 1000;
      const entry = byKey.get(key);
      if (entry) {
        entry.widestMs = Math.max(entry.widestMs, windowMs);
        entry.rules.push(rule);
      } else {
        byKey.set(key, { widestMs: windowMs, rules: [rule] });
      }
    }

    // Two passes. Pass one only READS; pass two records the hit, and runs only
    // if every rule admitted the request. Fusing them has a defect that is
    // easy to miss and hard to explain afterwards: an early rule would count a
    // request a later rule refuses, so a caller blocked by their hourly cap
    // would also burn their per-minute cap, and that window would never drain
    // while they kept knocking. A request that is refused did not happen.
    const pending: Array<{ key: string; kept: number[] }> = [];
    for (const [key, { widestMs, rules: keyRules }] of byKey) {
      const kept = (this.hits.get(key) ?? []).filter((t) => t > now - widestMs);
      for (const rule of keyRules) {
        const windowStart = now - rule.windowSeconds * 1000;
        let count = 0;
        for (const t of kept) if (t > windowStart) count++;
        if (count >= rule.limit) {
          const oldestInWindow = kept.find((t) => t > windowStart) ?? now;
          const retryAfter = Math.max(
            1,
            Math.ceil(
              (oldestInWindow + rule.windowSeconds * 1000 - now) / 1000,
            ),
          );
          // Keep the recomputed window, but do NOT append this request: a
          // caller who keeps knocking while limited would otherwise push
          // their own window forward and never be let back in.
          this.hits.set(key, kept);
          try {
            res?.setHeader?.("Retry-After", String(retryAfter));
          } catch {
            // A response that cannot take a header (a test double, a
            // non-HTTP context) must not turn a 429 into a 500.
          }
          this.logger.warn(
            `Authenticated rate limit hit on ${route} for ${key} ` +
              `(${rule.limit} per ${rule.windowSeconds}s)`,
          );
          throw new HttpException(
            {
              statusCode: HttpStatus.TOO_MANY_REQUESTS,
              message:
                rule.message ??
                `Too many requests. Try again in ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`,
              retryAfter,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }
      pending.push({ key, kept });
    }

    for (const { key, kept } of pending) {
      kept.push(now);
      this.hits.set(key, kept);
    }

    this.sweep(now);
    return true;
  }

  /** Drop keys whose newest hit aged out entirely. Cheap, amortised. */
  private sweep(now: number): void {
    if (this.hits.size <= AuthedRateLimitGuard.SWEEP_AT) return;
    const cutoff = now - 86_400_000;
    for (const [key, times] of this.hits) {
      if (times.length === 0 || times[times.length - 1] <= cutoff) {
        this.hits.delete(key);
      }
    }
  }
}
