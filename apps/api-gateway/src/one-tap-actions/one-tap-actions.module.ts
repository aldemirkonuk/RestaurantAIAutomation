import { Module } from "@nestjs/common";
import { OneTapActionsController } from "./one-tap-actions.controller";
import { OneTapActionsService } from "./one-tap-actions.service";
import { DatabaseModule } from "../database/database.module";
import { WebsocketModule } from "../websocket/websocket.module";
import { AuthModule } from "../auth/auth.module";
import { ProcurementModule } from "../procurement/procurement.module";
import { SealModule } from "../common/seal/seal.module";

/**
 * One-Tap Actions Module
 *
 * Provides backend persistence and real-time sync for one-tap actions:
 * - Database CRUD operations
 * - WebSocket events for real-time updates
 * - Integration with backend workflows
 *
 * AuthModule is required, not optional: the controller is guarded by JwtAuthGuard,
 * which injects TokenBlacklistService, and a guard resolves in the context of the
 * module declaring the controller. Omitting this import does not fail the guarded
 * route — it fails the ENTIRE application boot with "Nest can't resolve
 * dependencies of the JwtAuthGuard", which is how the ux-optimizer change broke
 * the server for nine hours earlier in this milestone.
 *
 * ProcurementModule and SealModule arrived 2026-09-05, when the first one-tap
 * workflow stopped being a `// TODO` log: confirming a delivery IS
 * `ProcurementService.markDelivered`, and it is redeemed rather than asserted.
 * Neither import is circular — nothing in the repository imports
 * OneTapActionsModule except `app.module.ts`, and SealModule imports
 * DatabaseModule and nothing else — so no forwardRef is needed and Nest
 * resolves both at build time rather than injecting `undefined` at runtime,
 * which is how a seal check would vanish silently. The first draft of this file
 * added the two IMPORT LINES and left this array alone; `check_gateway_boots.sh`
 * caught it as a crash loop, which is what that guard is for.
 */
@Module({
  imports: [
    DatabaseModule,
    WebsocketModule,
    AuthModule,
    ProcurementModule,
    SealModule,
  ],
  controllers: [OneTapActionsController],
  providers: [OneTapActionsService],
  exports: [OneTapActionsService],
})
export class OneTapActionsModule {}
