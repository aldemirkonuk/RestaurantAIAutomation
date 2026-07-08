import { Module, Global } from "@nestjs/common";
import { SentryService } from "./sentry.service";

/**
 * Error Tracking Module
 *
 * Global module for centralized error tracking:
 * - Sentry integration
 * - Error capture and reporting
 * - User context tracking
 * - Performance monitoring
 */
@Global()
@Module({
  providers: [SentryService],
  exports: [SentryService],
})
export class ErrorTrackingModule {}
