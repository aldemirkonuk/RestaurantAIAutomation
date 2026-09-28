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
import { CryptoModule } from "../common/crypto/crypto.module";
// The SERVICE file, not `integrations.module`. See the note on the provider
// below — importing the module closes an ES-module load cycle that no
// `forwardRef` can open, because forwardRef defers Nest's DI graph and not
// Node's `require`.
import { IntegrationsOauthService } from "../integrations/integrations-oauth.service";
import { HouseLettersController } from "./letters/house-letters.controller";
import { HouseLettersService } from "./letters/house-letters.service";
import { HouseLettersCron } from "./letters/house-letters.cron";
import { HouseSenderService } from "./letters/house-sender.service";
import { HouseInboxService } from "./inbox/house-inbox.service";
import { HouseInboxCron } from "./inbox/house-inbox.cron";

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
    // For IntegrationsOauthService's own dependency; CryptoModule imports
    // ConfigModule and nothing else, so it adds no edge to the module graph.
    CryptoModule,
  ],
  controllers: [CommunicationsController, HouseLettersController],
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
    /**
     * ADR 0118 — the house composer sends through the HOUSE's own OAuth grant,
     * never through GmailService's deployment-wide refresh token, and a
     * manager's ADR-0114 revoke has to be able to stop it. `getAccessToken` is
     * the one door that enforces that, so this module needs that service.
     *
     * PROVIDED FROM ITS CLASS, NOT BY IMPORTING `IntegrationsModule`.
     * The first attempt imported the module behind a `forwardRef` and the app
     * would not boot:
     *
     *   ReferenceError: Cannot access 'AuthModule' before initialization
     *     at organizations.module.js:28
     *
     * `forwardRef` defers NEST's dependency graph. It does not defer NODE's
     * module loading, and the ring closes at load time:
     *   auth.module → communications.module → integrations.module →
     *   organizations.module → auth.module
     * `integrations.module` imports AuthModule and OrganizationsModule for its
     * own controller's guards; this module needs neither of those, only the
     * service. `integrations-oauth.service.ts` itself imports only
     * DatabaseService, ConfigService and TokenCryptoService, so requiring it
     * directly adds no edge at all.
     *
     * A second INSTANCE is the cost, and it is not a second door: the service
     * holds no state — every fact it works from is a row — so both instances
     * run the same `getAccessToken`, including the house-revocation check at
     * integrations-oauth.service.ts:926-938. `check_gateway_boots.sh` is what
     * proves this shape, and it is what caught the first one.
     */
    IntegrationsOauthService,
    // ADR 0118 — the house's own letters.
    HouseSenderService,
    HouseLettersService,
    HouseLettersCron,
    /**
     * ADR 0118, receive half — the house's own inbox reaches the book.
     *
     * Needs no new module edge: `OrchestratorModule` (for `publishEvent`) and
     * `DatabaseModule` are already imported above, `IntegrationsOauthService`
     * is already provided from its class for the letters dispatcher, and
     * `HouseLettersService` is where the vendor book comes from. That last one
     * is why the reader must not be injected into `HouseSenderService`: it
     * would close the ring sender -> inbox -> letters -> sender. The two share
     * `inbox/house-inbox-flag.ts` instead, which is a plain module and no edge.
     */
    HouseInboxService,
    HouseInboxCron,
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
