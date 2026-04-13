import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { RabbitMqBridgeService } from './rabbitmq-bridge.service';
import { WebsocketModule } from '../../websocket/websocket.module';
import { AuthModule } from '../../auth/auth.module';
import { HealthProxyController, MetricsProxyController } from './health-proxy.controller';

@Module({
  imports: [WebsocketModule, AuthModule],
  controllers: [HealthProxyController, MetricsProxyController],
  providers: [OrchestratorService, RabbitMqBridgeService],
  exports: [OrchestratorService, RabbitMqBridgeService],
})
export class OrchestratorModule {}
