import { Module, forwardRef } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { RabbitMqBridgeService } from './rabbitmq-bridge.service';
import { InboundResponderService } from './inbound-responder.service';
import { WebsocketModule } from '../../websocket/websocket.module';
import { AuthModule } from '../../auth/auth.module';
import { HealthProxyController, MetricsProxyController } from './health-proxy.controller';

@Module({
  imports: [WebsocketModule, forwardRef(() => AuthModule)],
  controllers: [HealthProxyController, MetricsProxyController],
  providers: [OrchestratorService, RabbitMqBridgeService, InboundResponderService],
  exports: [OrchestratorService, RabbitMqBridgeService, InboundResponderService],
})
export class OrchestratorModule {}
