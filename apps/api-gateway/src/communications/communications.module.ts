import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { GmailService } from "./gmail.service";
import { SmsService } from "./sms.service";
import { CommunicationsService } from "./communications.service";
import { CommunicationsController } from "./communications.controller";
import { ScheduledTasksService } from "./scheduled-tasks.service";
import { GmailWatchService } from "./gmail-watch.service";
import { RecipientResolverService } from "./recipient-resolver.service";
import { ScheduledTenantsService } from "./scheduled-tenants.service";
import { GmailPushAuthService } from "./gmail-push-auth.service";
import { NonProductionGuard } from "./guards/non-production.guard";
import { WebsocketModule } from "../websocket/websocket.module";
import { DatabaseModule } from "../database/database.module";
import { CacheModule } from "../common/cache/cache.module";
import { OrchestratorModule } from "../common/orchestrator/orchestrator.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [
    // forwardRef: AuthModule already imports CommunicationsModule, so a plain
    // import here is a cycle and the app dies at load with
    // "Cannot access 'AuthModule' before initialization". OD-20 added the
    // guard; check_gateway_boots.sh caught the cycle before merge.
    forwardRef(() => AuthModule),
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
    // ADR 0022 / OD-87 — enumerates which restaurants the crons serve.
    ScheduledTenantsService,
    // ADR 0019 D3 — Google Pub/Sub OIDC verification for the Gmail push webhook.
    GmailPushAuthService,
    // ADR 0019 D2 — route-level production kill-switch for the test/* routes.
    // Registered explicitly so the enhancer resolves from this module's injector.
    NonProductionGuard,
  ],
  exports: [
    GmailService,
    SmsService,
    CommunicationsService,
    ScheduledTasksService,
    GmailWatchService,
    RecipientResolverService,
    ScheduledTenantsService,
  ],
})
export class CommunicationsModule {}
