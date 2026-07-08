import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
  /** Key prefix for storage */
  keyPrefix?: string;
}

/**
 * Default rate limits by endpoint type
 */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  default: { limit: 100, windowSeconds: 60 }, // 100 requests per minute
  auth: { limit: 10, windowSeconds: 60 }, // 10 auth requests per minute
  upload: { limit: 10, windowSeconds: 300 }, // 10 uploads per 5 minutes
  ai: { limit: 20, windowSeconds: 60 }, // 20 AI requests per minute
  webhook: { limit: 1000, windowSeconds: 60 }, // 1000 webhooks per minute
};

/**
 * Decorator to set custom rate limit for a route
 */
export const RATE_LIMIT_KEY = "rateLimit";
export const RateLimit = (config: RateLimitConfig) => {
  return (target: any, key?: string, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(RATE_LIMIT_KEY, config, descriptor.value);
    } else {
      Reflect.defineMetadata(RATE_LIMIT_KEY, config, target);
    }
    return descriptor || target;
  };
};

/**
 * Decorator to skip rate limiting for a route
 */
export const SKIP_RATE_LIMIT_KEY = "skipRateLimit";
export const SkipRateLimit = () => {
  return (target: any, key?: string, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(SKIP_RATE_LIMIT_KEY, true, descriptor.value);
    } else {
      Reflect.defineMetadata(SKIP_RATE_LIMIT_KEY, true, target);
    }
    return descriptor || target;
  };
};

/**
 * In-memory rate limit store
 * In production, use Redis for distributed rate limiting
 */
class RateLimitStore {
  private store: Map<string, { count: number; resetAt: number }> = new Map();

  /**
   * Check and increment rate limit
   * @returns { allowed: boolean, remaining: number, resetAt: number }
   */
  check(
    key: string,
    limit: number,
    windowSeconds: number,
  ): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  } {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    const entry = this.store.get(key);

    if (!entry || entry.resetAt < now) {
      // New window
      this.store.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
    }

    if (entry.count >= limit) {
      // Rate limited
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    // Increment
    entry.count++;
    return {
      allowed: true,
      remaining: limit - entry.count,
      resetAt: entry.resetAt,
    };
  }

  /**
   * Clean up expired entries periodically
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt < now) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * Rate Limit Guard
 *
 * Implements rate limiting for API endpoints:
 * - Per-IP rate limiting (default)
 * - Per-user rate limiting (when authenticated)
 * - Per-restaurant rate limiting (when restaurant context available)
 * - Custom limits per endpoint
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly store = new RateLimitStore();
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.store.cleanup();
    }, 60000);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const handler = context.getHandler();
    const classRef = context.getClass();

    // Check if rate limiting should be skipped
    const skipRateLimit =
      this.reflector.get<boolean>(SKIP_RATE_LIMIT_KEY, handler) ||
      this.reflector.get<boolean>(SKIP_RATE_LIMIT_KEY, classRef);

    if (skipRateLimit) {
      return true;
    }

    // Get rate limit config
    const config = this.getRateLimitConfig(handler, classRef, request);

    // Generate rate limit key
    const key = this.generateKey(request, config.keyPrefix);

    // Check rate limit
    const result = this.store.check(key, config.limit, config.windowSeconds);

    // Set rate limit headers
    const response = context.switchToHttp().getResponse();
    response.setHeader("X-RateLimit-Limit", config.limit);
    response.setHeader("X-RateLimit-Remaining", result.remaining);
    response.setHeader("X-RateLimit-Reset", Math.ceil(result.resetAt / 1000));

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      response.setHeader("Retry-After", retryAfter);

      this.logger.warn(
        `Rate limit exceeded for ${key} - ${config.limit} requests per ${config.windowSeconds}s`,
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too many requests. Please try again later.",
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Get rate limit configuration for the current request
   */
  private getRateLimitConfig(
    handler: any,
    classRef: any,
    request: any,
  ): RateLimitConfig {
    // Check for custom rate limit on handler
    const handlerConfig = this.reflector.get<RateLimitConfig>(
      RATE_LIMIT_KEY,
      handler,
    );
    if (handlerConfig) {
      return handlerConfig;
    }

    // Check for custom rate limit on class
    const classConfig = this.reflector.get<RateLimitConfig>(
      RATE_LIMIT_KEY,
      classRef,
    );
    if (classConfig) {
      return classConfig;
    }

    // Determine limit based on route
    const path = request.route?.path || request.url;

    if (path.includes("/auth/")) {
      return DEFAULT_RATE_LIMITS.auth;
    }
    if (path.includes("/upload") || path.includes("/invoice")) {
      return DEFAULT_RATE_LIMITS.upload;
    }
    if (path.includes("/ai/") || path.includes("/agent/")) {
      return DEFAULT_RATE_LIMITS.ai;
    }
    if (path.includes("/webhook")) {
      return DEFAULT_RATE_LIMITS.webhook;
    }

    return DEFAULT_RATE_LIMITS.default;
  }

  /**
   * Generate rate limit key
   */
  private generateKey(request: any, prefix?: string): string {
    const parts: string[] = [];

    // Add prefix
    if (prefix) {
      parts.push(prefix);
    }

    // Add user ID if authenticated
    if (request.user?.id) {
      parts.push(`user:${request.user.id}`);
    }
    // Add restaurant ID if available
    else if (request.user?.restaurantId) {
      parts.push(`restaurant:${request.user.restaurantId}`);
    }
    // Fall back to IP
    else {
      const ip = this.getClientIp(request);
      parts.push(`ip:${ip}`);
    }

    // Add route
    const route = request.route?.path || request.url.split("?")[0];
    parts.push(`route:${route}`);

    return parts.join(":");
  }

  /**
   * Get client IP address
   */
  private getClientIp(request: any): string {
    return (
      request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      request.headers["x-real-ip"] ||
      request.connection?.remoteAddress ||
      request.ip ||
      "unknown"
    );
  }
}
