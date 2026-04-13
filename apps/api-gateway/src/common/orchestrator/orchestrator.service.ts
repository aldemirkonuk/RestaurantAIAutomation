import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as amqplib from 'amqplib';

@Injectable()
export class OrchestratorService implements OnModuleDestroy {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly httpClient: AxiosInstance;
  private rabbitConnection: amqplib.Connection | null = null;
  private rabbitChannel: amqplib.Channel | null = null;

  constructor(private readonly configService: ConfigService) {
    const baseUrl = this.configService.get<string>(
      'AGENT_ORCHESTRATOR_URL',
      'http://localhost:8000',
    );
    this.httpClient = axios.create({ baseURL: baseUrl, timeout: 15000 });
  }

  async callAgent(agentName: string, action: string, payload: any): Promise<any> {
    const response = await this.httpClient.post('/api/v1/agents/execute', {
      agent: agentName,
      action,
      payload,
    });
    return response.data;
  }

  async publishEvent(exchange: string, routingKey: string, event: any): Promise<void> {
    const channel = await this.getChannel();
    await channel.assertExchange(exchange, 'topic', { durable: true });
    channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      contentType: 'application/json',
    });
  }

  async getAgentHealth(): Promise<any> {
    const response = await this.httpClient.get('/api/v1/health');
    return response.data;
  }

  private getAdminHeaders(): Record<string, string> {
    const key = this.configService.get<string>('ADMIN_API_KEY', '');
    return { 'X-Admin-Key': key };
  }

  async getAgentHealthAll(): Promise<any> {
    const response = await this.httpClient.get('/api/v1/health/agents', {
      headers: this.getAdminHeaders(),
    });
    return response.data;
  }

  async getAgentHealthByName(name: string): Promise<any> {
    const response = await this.httpClient.get(`/api/v1/health/agents/${name}`, {
      headers: this.getAdminHeaders(),
    });
    return response.data;
  }

  async getSystemMetrics(): Promise<any> {
    const response = await this.httpClient.get('/api/v1/metrics', {
      headers: this.getAdminHeaders(),
    });
    return response.data;
  }

  async onModuleDestroy() {
    if (this.rabbitChannel) {
      await this.rabbitChannel.close();
    }
    if (this.rabbitConnection) {
      await this.rabbitConnection.close();
    }
  }

  private async getChannel(): Promise<amqplib.Channel> {
    if (this.rabbitChannel) {
      return this.rabbitChannel;
    }

    const rabbitUrl = this.configService.get<string>(
      'RABBITMQ_URL',
      'amqp://localhost:5672',
    );
    this.rabbitConnection = await amqplib.connect(rabbitUrl);
    this.rabbitChannel = await this.rabbitConnection.createChannel();
    this.logger.log('✅ RabbitMQ channel ready for orchestrator bridge');
    return this.rabbitChannel;
  }
}
