import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { RabbitMqBridgeService } from './rabbitmq-bridge.service';
import { WebsocketModule } from '../../websocket/websocket.module';
import { HealthProxyController, MetricsProxyController } from './health-proxy.controller';

@Module({
  imports: [WebsocketModule],
  controllers: [HealthProxyController, MetricsProxyController],
  providers: [OrchestratorService, RabbitMqBridgeService],
  exports: [OrchestratorService, RabbitMqBridgeService],
})
export class OrchestratorModule {}
