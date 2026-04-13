import { Module, forwardRef } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { WebsocketModule } from '../websocket/websocket.module';
import { CommunicationsModule } from '../communications/communications.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [WebsocketModule, forwardRef(() => CommunicationsModule), DatabaseModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
