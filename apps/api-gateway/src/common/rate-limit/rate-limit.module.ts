import { Module, Global } from "@nestjs/common";
import { RateLimitGuard } from "./rate-limit.guard";

/**
 * Rate Limit Module
 *
 * Provides rate limiting for API endpoints:
 * - Per-IP rate limiting
 * - Per-user rate limiting
 * - Per-restaurant rate limiting
 * - Custom limits per endpoint
 */
@Global()
@Module({
  providers: [RateLimitGuard],
  exports: [RateLimitGuard],
})
export class RateLimitModule {}
