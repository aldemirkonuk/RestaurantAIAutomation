import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { GmailService } from "./gmail.service";
import { SmsService } from "./sms.service";
import { CommunicationsService } from "./communications.service";
import { CommunicationsController } from "./communications.controller";
import { ScheduledTasksService } from "./scheduled-tasks.service";
import { GmailWatchService } from "./gmail-watch.service";
import { RecipientResolverService } from "./recipient-resolver.service";
import { WebsocketModule } from "../websocket/websocket.module";
import { DatabaseModule } from "../database/database.module";
import { CacheModule } from "../common/cache/cache.module";
import { OrchestratorModule } from "../common/orchestrator/orchestrator.module";

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => WebsocketModule),
    DatabaseModule,
    CacheModule,
    OrchestratorModule,
  ],
  controllers: [CommunicationsController],
  providers: [
    GmailService,
    SmsService,
    CommunicationsService,
    ScheduledTasksService,
    GmailWatchService,
    RecipientResolverService,
  ],
  exports: [
    GmailService,
    SmsService,
    CommunicationsService,
    ScheduledTasksService,
    GmailWatchService,
    RecipientResolverService,
  ],
})
export class CommunicationsModule {}
