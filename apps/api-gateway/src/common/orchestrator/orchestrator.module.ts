import { Module, forwardRef } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { RabbitMqBridgeService } from './rabbitmq-bridge.service';
import { InboundResponderService } from './inbound-responder.service';
import { PromotionExtractorService } from './promotion-extractor.service';
import { SenderReputationService } from './sender-reputation.service';
import { SenderTrustController } from './sender-trust.controller';
import { ProspectsService } from './prospects.service';
import { ProspectsController } from './prospects.controller';
import { InboundAddressService } from './inbound-address.service';
import { InboundEmailController } from './inbound-email.controller';
import { WebsocketModule } from '../../websocket/websocket.module';
import { AuthModule } from '../../auth/auth.module';
import { HealthProxyController, MetricsProxyController } from './health-proxy.controller';

@Module({
  imports: [WebsocketModule, forwardRef(() => AuthModule)],
  controllers: [HealthProxyController, MetricsProxyController, SenderTrustController, ProspectsController, InboundEmailController],
  providers: [OrchestratorService, RabbitMqBridgeService, InboundResponderService, PromotionExtractorService, SenderReputationService, ProspectsService, InboundAddressService],
  exports: [OrchestratorService, RabbitMqBridgeService, InboundResponderService, PromotionExtractorService, SenderReputationService, ProspectsService, InboundAddressService],
})
export class OrchestratorModule {}
