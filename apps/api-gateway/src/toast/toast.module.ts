import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CacheModule } from "../common/cache/cache.module";
import { DatabaseModule } from "../database/database.module";
import { ToastController } from "./toast.controller";
import { ToastService } from "./toast.service";
import { ToastAuthService } from "./toast-auth.service";
import { NotificationsModule } from "../notifications/notifications.module";

/**
 * Toast API Module
 *
 * Provides proxy endpoints for Toast POS API:
 * - Handles OAuth token management
 * - Proxies requests to FastAPI agent-orchestrator
 * - Provides mock data fallback
 * - Implements retry logic and error handling
 * - Receives webhooks with signature verification
 *
 * This module solves the "Middleman Architecture" requirement:
 * Frontend -> NestJS API Gateway -> FastAPI Agent Orchestrator -> Toast API
 *
 * Webhook flow:
 * Toast POS -> POST /toast/webhook -> Verify signature -> Store event -> Forward to orchestrator
 */
@Module({
  // AuthModule is NOT @Global — JwtAuthGuard resolves in the importing
  // module's context, and omitting this import kills the whole app at boot.
  imports: [
    AuthModule,
    CacheModule,
    DatabaseModule,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [ToastController],
  providers: [ToastService, ToastAuthService],
  exports: [ToastService, ToastAuthService],
})
export class ToastModule {}
