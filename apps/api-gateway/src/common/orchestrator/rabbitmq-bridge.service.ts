/**
 * RabbitMQ → WebSocket Bridge Service
 * ====================================
 * Consumes key events from RabbitMQ (published by Python agents)
 * and re-emits them to connected frontend clients via WebSocket.
 *
 * This is the CRITICAL missing piece that bridges the agent world
 * (Python/FastAPI + RabbitMQ) to the frontend world (React + Socket.IO).
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqplib from 'amqplib';
import { WebsocketGateway } from '../../websocket/websocket.gateway';
import { DatabaseService } from '../../database/database.service';

/** Mapping of RabbitMQ routing keys to handler methods */
interface RouteHandler {
  exchange: string;
  routingKey: string;
  handler: (msg: any) => void;
}

@Injectable()
export class RabbitMqBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqBridgeService.name);
  private connection: amqplib.Connection | null = null;
  private channel: amqplib.Channel | null = null;
  private isConnected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly RECONNECT_DELAY_MS = 5000;

  constructor(
    private readonly configService: ConfigService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly databaseService: DatabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Non-blocking: attempt connection but don't crash the server if RabbitMQ is unavailable
    this.connectWithRetry();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    await this.disconnect();
  }

  // ===========================================================================
  // CONNECTION MANAGEMENT
  // ===========================================================================

  private async connectWithRetry(): Promise<void> {
    try {
      await this.connect();
    } catch (err) {
      this.logger.warn(
        `RabbitMQ bridge connection failed, retrying in ${this.RECONNECT_DELAY_MS}ms: ${err?.message || err}`,
      );
      this.scheduleReconnect();
    }
  }

  private async connect(): Promise<void> {
    const rabbitUrl = this.configService.get<string>(
      'RABBITMQ_URL',
      'amqp://localhost:5672',
    );

    this.logger.log('Connecting RabbitMQ bridge to consume agent events...');

    this.connection = await amqplib.connect(rabbitUrl);
    this.channel = await this.connection.createChannel();
    await this.channel.prefetch(50);

    // Handle connection errors for auto-reconnect
    this.connection.on('error', (err) => {
      this.logger.error(`RabbitMQ bridge connection error: ${err?.message}`);
      this.isConnected = false;
      this.scheduleReconnect();
    });

    this.connection.on('close', () => {
      if (this.isConnected) {
        this.logger.warn('RabbitMQ bridge connection closed unexpectedly');
        this.isConnected = false;
        this.scheduleReconnect();
      }
    });

    // Setup all subscriptions
    await this.setupSubscriptions();

    this.isConnected = true;
    this.logger.log(
      'RabbitMQ bridge connected - agent events will now propagate to frontend',
    );
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.connectWithRetry();
    }, this.RECONNECT_DELAY_MS);
  }

  private async disconnect(): Promise<void> {
    this.isConnected = false;
    try {
      if (this.channel) await this.channel.close().catch(() => {});
      if (this.connection) await this.connection.close().catch(() => {});
    } catch {
      // Ignore cleanup errors
    }
    this.logger.log('RabbitMQ bridge disconnected');
  }

  // ===========================================================================
  // SUBSCRIPTION SETUP
  // ===========================================================================

  private async setupSubscriptions(): Promise<void> {
    const routes: RouteHandler[] = [
      // --- Stock events ---
      {
        exchange: 'stock.events',
        routingKey: 'stock.state.changed',
        handler: (msg) => this.handleStockStateChanged(msg),
      },
      {
        exchange: 'stock.events',
        routingKey: 'stock.threshold.breached',
        handler: (msg) => this.handleStockThresholdBreached(msg),
      },
      {
        exchange: 'stock.events',
        routingKey: 'stock.increased',
        handler: (msg) => this.handleStockIncreased(msg),
      },
      {
        exchange: 'stock.events',
        routingKey: 'stock.manually_corrected',
        handler: (msg) => this.handleStockManuallyCorrected(msg),
      },
      {
        exchange: 'stock.events',
        routingKey: 'stock.evaluated',
        handler: (msg) => this.handleStockEvaluated(msg),
      },

      // --- Procurement events ---
      {
        exchange: 'procurement.events',
        routingKey: 'procurement.order.created',
        handler: (msg) => this.handleOrderCreated(msg),
      },
      {
        exchange: 'procurement.events',
        routingKey: 'procurement.order.delivered',
        handler: (msg) => this.handleOrderDelivered(msg),
      },
      {
        exchange: 'procurement.events',
        routingKey: 'procurement.order.approved',
        handler: (msg) => this.handleOrderStatusChanged(msg, 'APPROVED'),
      },

      // --- Notification events ---
      {
        exchange: 'notification.events',
        routingKey: 'notification.#',
        handler: (msg) => this.handleNotificationEvent(msg),
      },

      // --- Report events ---
      {
        exchange: 'report.events',
        routingKey: 'report.generated',
        handler: (msg) => this.handleReportGenerated(msg),
      },

      // --- Menu events ---
      {
        exchange: 'menu.events',
        routingKey: 'menu.scan_complete',
        handler: (msg) => this.handleMenuScanComplete(msg),
      },

      // --- Verification events ---
      {
        exchange: 'notification.events',
        routingKey: 'notification.invariant_violation',
        handler: (msg) => this.handleInvariantViolation(msg),
      },

      // --- Additional procurement lifecycle events ---
      {
        exchange: 'procurement.events',
        routingKey: 'procurement.order.confirmed',
        handler: (msg) => this.handleOrderStatusChanged(msg, 'CONFIRMED'),
      },
      {
        exchange: 'procurement.events',
        routingKey: 'procurement.order.completed',
        handler: (msg) => this.handleOrderStatusChanged(msg, 'COMPLETED'),
      },

      // --- Inbound email events ---
      {
        exchange: 'email.events',
        routingKey: 'email.inbound.received',
        handler: (msg) => this.handleInboundEmail(msg),
      },

      // --- Vendor / conversation events ---
      {
        exchange: 'procurement.events',
        routingKey: 'procurement.vendor_response',
        handler: (msg) => this.handleConversationUpdated(msg),
      },
      {
        exchange: 'conversation.events',
        routingKey: 'conversation.summary.updated',
        handler: (msg) => this.handleConversationSummaryUpdated(msg),
      },

      // --- Recurring order events ---
      {
        exchange: 'recurring.events',
        routingKey: 'recurring.order.reminder',
        handler: (msg) => this.handleRecurringOrderReminder(msg),
      },
      {
        exchange: 'recurring.events',
        routingKey: 'recurring.order.executed',
        handler: (msg) => this.handleOrderCreated(msg),
      },

      // --- Calendar events ---
      {
        exchange: 'calendar.events',
        routingKey: 'calendar.event.created',
        handler: (msg) => this.handleCalendarEventCreated(msg),
      },
      {
        exchange: 'calendar.events',
        routingKey: 'calendar.event.updated',
        handler: (msg) => this.handleCalendarEventUpdated(msg),
      },

      // --- Invoice events ---
      {
        exchange: 'invoice.events',
        routingKey: 'invoice.processed',
        handler: (msg) => this.handleNotificationEvent(msg),
      },
    ];

    for (const route of routes) {
      try {
        // Assert exchange exists (topic type, durable)
        await this.channel.assertExchange(route.exchange, 'topic', {
          durable: true,
        });

        // Create a unique queue for this bridge consumer
        const queueName = `bridge.nestjs.${route.exchange}.${route.routingKey.replace(/[.#*]/g, '_')}`;
        const { queue } = await this.channel.assertQueue(queueName, {
          durable: true,
          arguments: {
            'x-message-ttl': 300000, // 5 min TTL - bridge events are ephemeral
            'x-max-length': 1000, // Cap queue size
          },
        });

        await this.channel.bindQueue(queue, route.exchange, route.routingKey);

        // Start consuming
        await this.channel.consume(
          queue,
          (msg) => {
            if (!msg) return;
            try {
              const body = JSON.parse(msg.content.toString());
              route.handler(body);
              this.channel?.ack(msg);
            } catch (err) {
              this.logger.warn(
                `Failed to process bridge message from ${route.exchange}/${route.routingKey}: ${err?.message}`,
              );
              this.channel?.ack(msg); // Ack even on error - bridge messages are ephemeral
            }
          },
          { noAck: false },
        );

        this.logger.debug(
          `Bridge subscription: ${route.exchange}/${route.routingKey} -> ${queueName}`,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to setup bridge subscription ${route.exchange}/${route.routingKey}: ${err?.message}`,
        );
      }
    }
  }

  // ===========================================================================
  // EVENT HANDLERS -> WebSocket Emissions
  // ===========================================================================

  private handleStockStateChanged(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitStockUpdate(restaurantId, {
      inventory_id: payload.inventory_id,
      restaurant_id: restaurantId,
      wine_name: payload.wine_name || 'Unknown',
      stock_before: payload.stock_before ?? payload.previous_stock ?? 0,
      stock_after: payload.stock_after ?? payload.current_stock ?? 0,
    });

    // Also emit as a generic event:new so RealtimeContext picks it up
    this.emitGenericEvent(restaurantId, 'inventory_change', payload);
  }

  private handleStockThresholdBreached(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitLowStockAlert(restaurantId, {
      inventory_id: payload.inventory_id,
      restaurant_id: restaurantId,
      wine_name: payload.wine_name || 'Unknown',
      stock_after: payload.stock_after ?? 0,
      threshold: payload.threshold ?? 3,
      urgency: payload.urgency || 'medium',
      estimated_stockout_days: payload.estimated_stockout_days ?? 999,
    });

    this.emitGenericEvent(restaurantId, 'inventory_change', payload);
  }

  private handleStockIncreased(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitStockUpdate(restaurantId, {
      inventory_id: payload.inventory_id,
      restaurant_id: restaurantId,
      wine_name: payload.wine_name || 'Unknown',
      stock_before: payload.stock_before ?? 0,
      stock_after: payload.stock_after ?? 0,
    });

    this.emitGenericEvent(restaurantId, 'inventory_change', payload);
  }

  private handleStockManuallyCorrected(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitStockUpdate(restaurantId, {
      inventory_id: payload.inventory_id,
      restaurant_id: restaurantId,
      wine_name: payload.wine_name || 'Unknown',
      stock_before: payload.stock_before ?? 0,
      stock_after: payload.corrected_stock ?? payload.stock_after ?? 0,
    });

    this.emitGenericEvent(restaurantId, 'inventory_change', payload);
  }

  private handleStockEvaluated(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitStockUpdate(restaurantId, {
      inventory_id: payload.inventory_id,
      restaurant_id: restaurantId,
      wine_name: payload.wine_name || 'Unknown',
      stock_before: payload.stock_before ?? 0,
      stock_after: payload.stock_after ?? 0,
    });

    this.emitGenericEvent(restaurantId, 'inventory_change', payload);
  }

  private handleOrderCreated(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitOrderCreated(restaurantId, {
      order_id: payload.order_id,
      wine_name: payload.wine_name,
      quantity: payload.quantity,
      provider_name: payload.provider_name,
      target_price: payload.target_price,
      status: 'NEGOTIATING',
    });

    this.emitGenericEvent(restaurantId, 'order_change', payload);
  }

  private handleOrderDelivered(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitOrderStatusChanged(restaurantId, {
      order_id: payload.order_id,
      wine_name: payload.wine_name,
      quantity: payload.quantity_delivered,
      status: 'DELIVERED',
      previous_status: 'IN_TRANSIT',
    });

    this.emitGenericEvent(restaurantId, 'order_change', payload);
  }

  private handleOrderStatusChanged(msg: any, newStatus: string): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitOrderStatusChanged(restaurantId, {
      order_id: payload.order_id,
      wine_name: payload.wine_name,
      status: newStatus,
      previous_status: payload.previous_status,
    });

    this.emitGenericEvent(restaurantId, 'order_change', payload);
  }

  private handleNotificationEvent(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitRestaurantNotification(restaurantId, {
      id: payload.notification_id || payload.event_id || '',
      title: payload.title || payload.event_type || 'Notification',
      message: payload.message || payload.body || '',
      type: this.mapNotificationType(payload.urgency || payload.type),
      action_url: payload.action_url,
    });

    // For inbound vendor emails, also push a conversation:updated event so the
    // CommsThreadDrawer refetches the thread without requiring a manual refresh.
    if (payload.type === 'vendor_email' && (payload.order_id || payload.provider_id)) {
      this.websocketGateway.emitConversationUpdated(restaurantId, {
        order_id: payload.order_id,
        provider_id: payload.provider_id,
        direction: 'inbound',
        channel: 'email',
      });
    }
  }

  private handleReportGenerated(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitReportReady(restaurantId, {
      report_id: payload.report_id,
      report_type: payload.report_type,
      download_url: payload.download_url || '',
    });

    this.emitGenericEvent(restaurantId, 'report_event', payload);
  }

  private handleMenuScanComplete(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    this.emitGenericEvent(
      restaurantId,
      'wine_update',
      msg?.payload || msg,
    );
  }

  private handleInvariantViolation(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitRestaurantNotification(restaurantId, {
      id: payload.event_id || '',
      title: 'System Invariant Violation',
      message: payload.message || payload.violation_type || 'Data integrity issue detected',
      type: 'error',
    });
  }

  // ===========================================================================
  // INBOUND EMAIL HANDLER (NestJS fallback — stores to DB without Python agent)
  // ===========================================================================

  private async handleInboundEmail(msg: any): Promise<void> {
    const payload = msg?.payload || msg;
    const from: string = payload.from || '';
    const subject: string = payload.subject || '';
    const body: string = payload.body || '';
    const gmailThreadId: string = payload.gmail_thread_id || '';
    const gmailMessageId: string = payload.gmail_message_id || '';
    const messageIdHeader: string = payload.message_id_header || '';
    const inReplyTo: string = payload.in_reply_to || '';
    const references: string = payload.references || '';
    const receivedAt: string = payload.received_at || new Date().toISOString();

    const emailMatch = from.match(/<([^>]+)>/) || [null, from.trim()];
    const senderEmail = emailMatch[1]?.toLowerCase();
    if (!senderEmail) return;

    try {
      // 1. Find provider by email
      const { data: providers } = await this.databaseService.supabase
        .from('providers')
        .select('id, restaurant_id')
        .ilike('contact_email', senderEmail)
        .limit(1);
      const provider = providers?.[0];
      if (!provider) {
        this.logger.warn(`handleInboundEmail: no provider found for ${senderEmail}`);
        return;
      }

      // 2. Match order via gmail_thread_id on existing outbound conversation
      let orderId: string | null = null;
      let threadId: string | null = null;
      let restaurantId: string = provider.restaurant_id;

      if (gmailThreadId) {
        const { data: outbound } = await this.databaseService.supabase
          .from('procurement_conversations')
          .select('id, order_id, thread_id, restaurant_id')
          .eq('gmail_thread_id', gmailThreadId)
          .limit(1);
        if (outbound?.[0]) {
          orderId = outbound[0].order_id;
          threadId = outbound[0].thread_id;
          restaurantId = outbound[0].restaurant_id || restaurantId;
        }
      }

      if (!restaurantId) {
        this.logger.warn('handleInboundEmail: could not determine restaurant_id');
        return;
      }

      // 3. Deduplicate — skip if same gmail_message_id already stored
      if (gmailMessageId) {
        const { data: existing } = await this.databaseService.supabase
          .from('procurement_conversations')
          .select('id')
          .eq('gmail_message_id', gmailMessageId)
          .limit(1);
        if (existing?.length) {
          this.logger.log(`handleInboundEmail: already stored gmail_message_id=${gmailMessageId}, skipping`);
          return;
        }
      }

      // 4. Store inbound row
      const { data: inserted, error } = await this.databaseService.supabase
        .from('procurement_conversations')
        .insert({
          order_id: orderId,
          restaurant_id: restaurantId,
          provider_id: provider.id,
          direction: 'inbound',
          channel: 'email',
          message_text: `Subject: ${subject}\n\n${body}`,
          ai_generated: false,
          received_at: receivedAt,
          delivery_status: 'delivered',
          thread_id: threadId,
          gmail_thread_id: gmailThreadId || null,
          gmail_message_id: gmailMessageId || null,
          message_id: messageIdHeader || null,
          email_headers: { from, subject, message_id: messageIdHeader, in_reply_to: inReplyTo, references, gmail_thread_id: gmailThreadId },
          confidence_score: orderId ? 1.0 : null,
        })
        .select('id')
        .single();

      if (error) {
        this.logger.error(`handleInboundEmail: DB insert failed — ${error.message}`);
        return;
      }

      this.logger.log(`handleInboundEmail: stored inbound row ${inserted.id} (order=${orderId}, thread=${gmailThreadId})`);

      // 5. Notify frontend
      this.websocketGateway.emitRestaurantNotification(restaurantId, {
        id: inserted.id,
        title: `New vendor email: ${subject.substring(0, 60)}`,
        message: `Reply received from ${senderEmail}`,
        type: 'info',
        action_url: orderId ? `/orders?order=${orderId}` : undefined,
      });

      if (orderId) {
        this.websocketGateway.emitConversationUpdated(restaurantId, {
          conversation_id: inserted.id,
          order_id: orderId,
          provider_id: provider.id,
          direction: 'inbound',
          channel: 'email',
        });
      }
    } catch (err: any) {
      this.logger.error(`handleInboundEmail: unexpected error — ${err?.message}`);
    }
  }

  // ===========================================================================
  // CONVERSATION & CALENDAR HANDLERS
  // ===========================================================================

  private handleConversationUpdated(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitConversationUpdated(restaurantId, {
      conversation_id: payload.conversation_id || payload.id,
      order_id: payload.order_id,
      provider_id: payload.provider_id,
      direction: payload.direction || 'inbound',
      channel: payload.channel || 'email',
    });

    this.emitGenericEvent(restaurantId, 'conversation_update', payload);
  }

  private handleConversationSummaryUpdated(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitConversationSummaryUpdated(restaurantId, {
      thread_id: payload.thread_id || payload.order_id,
      summary: payload.summary,
      message_count: payload.message_count,
    });

    this.emitGenericEvent(restaurantId, 'conversation_update', payload);
  }

  private handleRecurringOrderReminder(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitRestaurantNotification(restaurantId, {
      id: payload.event_id || `recurring-${Date.now()}`,
      title: 'Recurring Order Reminder',
      message: payload.message || `Recurring order due in ${payload.days_until || 2} days`,
      type: 'info',
      action_url: payload.action_url || '/orders?filter=recurring',
    });

    this.emitGenericEvent(restaurantId, 'order_change', payload);
  }

  private handleCalendarEventCreated(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitCalendarEventCreated(restaurantId, {
      event_id: payload.event_id || payload.id,
      title: payload.title,
      event_type: payload.event_type,
      event_date: payload.event_date,
      order_id: payload.order_id,
      provider_id: payload.provider_id,
    });

    this.emitGenericEvent(restaurantId, 'calendar_change', payload);
  }

  private handleCalendarEventUpdated(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitCalendarEventUpdated(restaurantId, {
      event_id: payload.event_id || payload.id,
      title: payload.title,
      event_type: payload.event_type,
      event_date: payload.event_date,
      status: payload.status,
    });

    this.emitGenericEvent(restaurantId, 'calendar_change', payload);
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Emit a generic event:new that the RealtimeContext in React will pick up.
   * This uses the same shape the frontend expects from POST /events.
   */
  private emitGenericEvent(
    restaurantId: string,
    eventType: string,
    payload: any,
  ): void {
    const room = `restaurant:${restaurantId}`;
    this.websocketGateway.server?.to(room).emit('event:new', {
      id: payload?.event_id || `bridge-${Date.now()}`,
      eventType,
      sourcePage: 'agent',
      restaurantId,
      payload,
      createdAt: new Date().toISOString(),
    });
  }

  private mapNotificationType(
    urgency: string,
  ): 'info' | 'success' | 'warning' | 'error' {
    switch (urgency?.toLowerCase()) {
      case 'critical':
      case 'error':
        return 'error';
      case 'high':
      case 'warning':
        return 'warning';
      case 'success':
        return 'success';
      default:
        return 'info';
    }
  }

  // ===========================================================================
  // HEALTH CHECK
  // ===========================================================================

  getHealth(): { connected: boolean; subscriptions: number } {
    return {
      connected: this.isConnected,
      subscriptions: this.isConnected ? 21 : 0, // number of route handlers
    };
  }
}
