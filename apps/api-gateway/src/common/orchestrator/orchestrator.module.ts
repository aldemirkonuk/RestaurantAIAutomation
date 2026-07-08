import { Module, forwardRef } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { RabbitMqBridgeService } from './rabbitmq-bridge.service';
import { InboundResponderService } from './inbound-responder.service';
import { PromotionExtractorService } from './promotion-extractor.service';
import { SenderReputationService } from './sender-reputation.service';
import { SenderTrustController } from './sender-trust.controller';
import { WebsocketModule } from '../../websocket/websocket.module';
import { AuthModule } from '../../auth/auth.module';
import { HealthProxyController, MetricsProxyController } from './health-proxy.controller';

@Module({
  imports: [WebsocketModule, forwardRef(() => AuthModule)],
  controllers: [HealthProxyController, MetricsProxyController, SenderTrustController],
  providers: [OrchestratorService, RabbitMqBridgeService, InboundResponderService, PromotionExtractorService, SenderReputationService],
  exports: [OrchestratorService, RabbitMqBridgeService, InboundResponderService, PromotionExtractorService, SenderReputationService],
})
export class OrchestratorModule {}
