import { Module, forwardRef } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { RabbitMqBridgeService } from './rabbitmq-bridge.service';
import { InboundResponderService } from './inbound-responder.service';
import { PromotionExtractorService } from './promotion-extractor.service';
import { WebsocketModule } from '../../websocket/websocket.module';
import { AuthModule } from '../../auth/auth.module';
import { HealthProxyController, MetricsProxyController } from './health-proxy.controller';

@Module({
  imports: [WebsocketModule, forwardRef(() => AuthModule)],
  controllers: [HealthProxyController, MetricsProxyController],
  providers: [OrchestratorService, RabbitMqBridgeService, InboundResponderService, PromotionExtractorService],
  exports: [OrchestratorService, RabbitMqBridgeService, InboundResponderService, PromotionExtractorService],
})
export class OrchestratorModule {}
