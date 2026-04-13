import { Module } from '@nestjs/common';
import { OneTapActionsController } from './one-tap-actions.controller';
import { OneTapActionsService } from './one-tap-actions.service';
import { DatabaseModule } from '../database/database.module';
import { WebsocketModule } from '../websocket/websocket.module';

/**
 * One-Tap Actions Module
 * 
 * Provides backend persistence and real-time sync for one-tap actions:
 * - Database CRUD operations
 * - WebSocket events for real-time updates
 * - Integration with backend workflows
 */
@Module({
  imports: [DatabaseModule, WebsocketModule],
  controllers: [OneTapActionsController],
  providers: [OneTapActionsService],
  exports: [OneTapActionsService],
})
export class OneTapActionsModule {}
