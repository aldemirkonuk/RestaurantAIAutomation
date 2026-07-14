import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NotificationsService } from "./notifications.service";
import { LowStockAlertsService } from "./low-stock-alerts.service";
import { NotificationsController } from "./notifications.controller";
import { WebsocketModule } from "../websocket/websocket.module";
import { CommunicationsModule } from "../communications/communications.module";
import { DatabaseModule } from "../database/database.module";

@Module({
  imports: [
    ConfigModule,
    WebsocketModule,
    forwardRef(() => CommunicationsModule),
    DatabaseModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, LowStockAlertsService],
  exports: [NotificationsService, LowStockAlertsService],
})
export class NotificationsModule {}
