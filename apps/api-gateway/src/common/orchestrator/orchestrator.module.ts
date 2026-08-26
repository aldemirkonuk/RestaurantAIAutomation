import { Module, forwardRef } from "@nestjs/common";
import { OrchestratorService } from "./orchestrator.service";
import { RabbitMqBridgeService } from "./rabbitmq-bridge.service";
import { InboundResponderService } from "./inbound-responder.service";
import { PromotionExtractorService } from "./promotion-extractor.service";
import { SenderReputationService } from "./sender-reputation.service";
import { SenderTrustController } from "./sender-trust.controller";
import { ProspectsService } from "./prospects.service";
import { ProspectsController } from "./prospects.controller";
import { InboundAddressService } from "./inbound-address.service";
import { InboundEmailController } from "./inbound-email.controller";
import { WebsocketModule } from "../../websocket/websocket.module";
import { AuthModule } from "../../auth/auth.module";
import {
  HealthProxyController,
  MetricsProxyController,
} from "./health-proxy.controller";
import { StudioProxyController } from "./studio-proxy.controller";
import { StudioInviteController } from "./studio-invite.controller";
import { OnboardingProxyController } from "./onboarding-proxy.controller";
import { CommunicationsModule } from "../../communications/communications.module";

@Module({
  imports: [
    WebsocketModule,
    forwardRef(() => AuthModule),
    forwardRef(() => CommunicationsModule),
  ],
  controllers: [
    HealthProxyController,
    MetricsProxyController,
    // MUST precede StudioProxyController: that controller's @Post("*") on the same
    // `studio` prefix would otherwise swallow POST /studio/invite and skip the email.
    StudioInviteController,
    StudioProxyController,
    OnboardingProxyController,
    SenderTrustController,
    ProspectsController,
    InboundEmailController,
  ],
  providers: [
    OrchestratorService,
    RabbitMqBridgeService,
    InboundResponderService,
    PromotionExtractorService,
    SenderReputationService,
    ProspectsService,
    InboundAddressService,
  ],
  exports: [
    OrchestratorService,
    RabbitMqBridgeService,
    InboundResponderService,
    PromotionExtractorService,
    SenderReputationService,
    ProspectsService,
    InboundAddressService,
  ],
})
export class OrchestratorModule {}
