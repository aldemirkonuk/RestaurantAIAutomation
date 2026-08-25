import { Module } from "@nestjs/common";
import { OneTapActionsController } from "./one-tap-actions.controller";
import { OneTapActionsService } from "./one-tap-actions.service";
import { DatabaseModule } from "../database/database.module";
import { WebsocketModule } from "../websocket/websocket.module";
import { AuthModule } from "../auth/auth.module";

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
 */
@Module({
  imports: [DatabaseModule, WebsocketModule, AuthModule],
  controllers: [OneTapActionsController],
  providers: [OneTapActionsService],
  exports: [OneTapActionsService],
})
export class OneTapActionsModule {}
