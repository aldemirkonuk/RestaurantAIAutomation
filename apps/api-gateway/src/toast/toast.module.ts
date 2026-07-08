import { Module } from "@nestjs/common";
import { CacheModule } from "../common/cache/cache.module";
import { DatabaseModule } from "../database/database.module";
import { ToastController } from "./toast.controller";
import { ToastService } from "./toast.service";
import { ToastAuthService } from "./toast-auth.service";

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
  imports: [CacheModule, DatabaseModule],
  controllers: [ToastController],
  providers: [ToastService, ToastAuthService],
  exports: [ToastService, ToastAuthService],
})
export class ToastModule {}
