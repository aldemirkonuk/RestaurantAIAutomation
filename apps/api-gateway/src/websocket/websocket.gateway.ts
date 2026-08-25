/**
 * State-of-the-Art WebSocket Gateway
 * ===================================
 * Production-grade real-time communication hub with:
 * - Rate limiting per client
 * - Connection health monitoring with heartbeat
 * - Room-based pub/sub for restaurants
 * - Typed events with validation
 * - Metrics and observability
 * - Graceful degradation
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
  WsException,
} from "@nestjs/websockets";
import { Logger, Injectable, UseGuards } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { Interval } from "@nestjs/schedule";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { resolveJwtSecret } from "../auth/jwt-secret";

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

/** Client connection metadata */
interface ClientMetadata {
  userId: string;
  restaurantId: string | null;
  connectedAt: Date;
  lastActivity: Date;
  subscribedRooms: Set<string>;
  messageCount: number;
  rateLimitTokens: number;
}

/** Server event types */
interface StockUpdatePayload {
  inventory_id: string;
  restaurant_id: string;
  wine_name: string;
  stock_before: number;
  stock_after: number;
}

interface LowStockAlertPayload {
  inventory_id: string;
  restaurant_id: string;
  wine_name: string;
  stock_after: number;
  threshold: number;
  urgency: "low" | "medium" | "high" | "critical";
  estimated_stockout_days: number;
}

interface OrderPayload {
  order_id: string;
  wine_name?: string;
  quantity?: number;
  provider_name?: string;
  target_price?: number;
  status?: string;
  previous_status?: string;
}

interface NotificationPayload {
  id: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  action_url?: string;
}

interface ReportPayload {
  report_id: string;
  report_type: string;
  download_url: string;
}

/** Gateway metrics */
interface GatewayMetrics {
  totalConnections: number;
  activeConnections: number;
  totalMessagesReceived: number;
  totalMessagesSent: number;
  rateLimitedRequests: number;
  roomCount: number;
  uptimeSeconds: number;
}

// =============================================================================
// RATE LIMITER
// =============================================================================

class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number = 100,
    private readonly refillRate: number = 10, // tokens per second
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  consume(tokens: number = 1): boolean {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const refillAmount = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + refillAmount);
    this.lastRefill = now;
  }

  get availableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

// =============================================================================
// WEBSOCKET GATEWAY
// =============================================================================

@WebSocketGateway({
  cors: {
    origin: [
      // Vercel production + all preview deployments
      /^https:\/\/.*\.vercel\.app$/,
      // Explicit production URL as a string fallback
      "https://restaurant-ai-automation-web.vercel.app",
      // Allow FRONTEND_URL env var if set (supports custom domains)
      ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(",") : []),
      // Local dev
      "http://localhost:3000",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ],
    credentials: true,
  },
  namespace: "/ws",
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 60000,
})
@Injectable()
export class WebsocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // Client management
  private clients: Map<string, ClientMetadata> = new Map();
  private rateLimiters: Map<string, TokenBucketRateLimiter> = new Map();

  // Metrics
  private startTime: Date = new Date();
  private totalMessagesReceived: number = 0;
  private totalMessagesSent: number = 0;
  private rateLimitedRequests: number = 0;

  // Configuration
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly IDLE_TIMEOUT = 300000; // 5 minutes
  private readonly MAX_ROOMS_PER_CLIENT = 10;
  private readonly RATE_LIMIT_TOKENS = 100;
  private readonly RATE_LIMIT_REFILL = 10;

  // =========================================================================
  // LIFECYCLE HOOKS
  // =========================================================================

  afterInit(server: Server): void {
    this.logger.log("🚀 WebSocket Gateway initialized");
    // Adapter error handling can be added here if needed for distributed deployments
  }

  handleConnection(client: Socket): void {
    const { userId, restaurantId } = this.extractAuthContext(client);
    if (!userId) {
      client.emit("error", "Unauthorized");
      client.disconnect(true);
      return;
    }

    // Initialize client metadata
    this.clients.set(client.id, {
      userId,
      restaurantId,
      connectedAt: new Date(),
      lastActivity: new Date(),
      subscribedRooms: new Set(),
      messageCount: 0,
      rateLimitTokens: this.RATE_LIMIT_TOKENS,
    });

    // Initialize rate limiter
    this.rateLimiters.set(
      client.id,
      new TokenBucketRateLimiter(
        this.RATE_LIMIT_TOKENS,
        this.RATE_LIMIT_REFILL,
      ),
    );

    this.logger.log(
      `✅ Client connected: ${userId} (${client.id}) [Total: ${this.clients.size}]`,
    );

    // Send welcome message
    client.emit("connection:success", {
      message: "Connected to WineOps AI",
      clientId: client.id,
      serverTime: new Date().toISOString(),
      config: {
        heartbeatInterval: this.HEARTBEAT_INTERVAL,
        maxRooms: this.MAX_ROOMS_PER_CLIENT,
      },
    });

    client.join(`user:${userId}`);
    client.join(`manager:${userId}`);
    if (restaurantId) {
      client.join(`restaurant:${restaurantId}`);
    }
  }

  handleDisconnect(client: Socket): void {
    const metadata = this.clients.get(client.id);
    const userId = metadata?.userId || "unknown";

    // Cleanup
    this.clients.delete(client.id);
    this.rateLimiters.delete(client.id);

    this.logger.log(
      `❌ Client disconnected: ${userId} (${client.id}) [Total: ${this.clients.size}]`,
    );
  }

  // =========================================================================
  // SUBSCRIPTION HANDLERS
  // =========================================================================

  @SubscribeMessage("subscribe:restaurant")
  handleSubscribeRestaurant(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { restaurantId: string },
  ): { success: boolean; room?: string; error?: string } {
    // Rate limiting
    if (!this.checkRateLimit(client.id)) {
      return { success: false, error: "Rate limit exceeded" };
    }

    // Validate
    if (!data?.restaurantId) {
      return { success: false, error: "Restaurant ID required" };
    }

    const metadata = this.clients.get(client.id);
    if (!metadata) {
      return { success: false, error: "Client not registered" };
    }

    // Enforce tenant scope
    if (metadata.restaurantId && metadata.restaurantId !== data.restaurantId) {
      return { success: false, error: "Unauthorized restaurant subscription" };
    }

    // Check room limit
    if (metadata.subscribedRooms.size >= this.MAX_ROOMS_PER_CLIENT) {
      return { success: false, error: "Maximum room subscriptions reached" };
    }

    const room = `restaurant:${data.restaurantId}`;

    // Subscribe
    client.join(room);
    metadata.subscribedRooms.add(room);
    metadata.lastActivity = new Date();

    this.logger.log(`📡 ${metadata.userId} subscribed to ${room}`);

    return { success: true, room };
  }

  @SubscribeMessage("unsubscribe:restaurant")
  handleUnsubscribeRestaurant(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { restaurantId: string },
  ): { success: boolean; room?: string } {
    if (!this.checkRateLimit(client.id)) {
      throw new WsException("Rate limit exceeded");
    }

    const metadata = this.clients.get(client.id);
    if (!metadata) {
      return { success: false };
    }

    const room = `restaurant:${data.restaurantId}`;

    client.leave(room);
    metadata.subscribedRooms.delete(room);
    metadata.lastActivity = new Date();

    this.logger.log(`📡 ${metadata.userId} unsubscribed from ${room}`);

    return { success: true, room };
  }

  @SubscribeMessage("ping")
  handlePing(@ConnectedSocket() client: Socket): void {
    const metadata = this.clients.get(client.id);
    if (metadata) {
      metadata.lastActivity = new Date();
    }

    client.emit("heartbeat", { timestamp: new Date().toISOString() });
  }

  // =========================================================================
  // EMIT METHODS (Called by services to push updates)
  // =========================================================================

  /**
   * Emit stock update to restaurant subscribers
   */
  emitStockUpdate(restaurantId: string, data: StockUpdatePayload): void {
    const room = `restaurant:${restaurantId}`;
    const payload = {
      event: "StockUpdated",
      data,
      timestamp: new Date().toISOString(),
    };

    this.emitToRoom(room, "stock:updated", payload);
    this.logger.debug(`📤 stock:updated → ${room}`);
  }

  /**
   * Emit low stock alert (high priority)
   */
  emitLowStockAlert(restaurantId: string, data: LowStockAlertPayload): void {
    const room = `restaurant:${restaurantId}`;
    const payload = {
      event: "LowStockAlert",
      data,
      timestamp: new Date().toISOString(),
    };

    this.emitToRoom(room, "stock:low", payload);
    this.logger.warn(`🚨 stock:low → ${room} (${data.wine_name})`);
  }

  /**
   * Emit order created event
   */
  emitOrderCreated(restaurantId: string, data: OrderPayload): void {
    const room = `restaurant:${restaurantId}`;
    const payload = {
      event: "OrderCreated",
      data,
      timestamp: new Date().toISOString(),
    };

    this.emitToRoom(room, "order:created", payload);
    this.logger.log(`📋 order:created → ${room}`);
  }

  /**
   * Emit order status change
   */
  emitOrderStatusChanged(restaurantId: string, data: OrderPayload): void {
    const room = `restaurant:${restaurantId}`;
    const payload = {
      event: "OrderStatusChanged",
      data,
      timestamp: new Date().toISOString(),
    };

    this.emitToRoom(room, "order:status_changed", payload);
    this.logger.log(`📋 order:status_changed → ${room} (${data.status})`);
  }

  /**
   * Emit notification to specific manager
   */
  emitNotification(managerId: string, data: NotificationPayload): void {
    const room = `manager:${managerId}`;
    const payload = {
      event: "NewNotification",
      data,
      timestamp: new Date().toISOString(),
    };

    this.emitToRoom(room, "notification:new", payload);
    this.logger.log(`🔔 notification:new → ${room}`);
  }

  /**
   * Emit notification to restaurant (all managers)
   */
  emitRestaurantNotification(
    restaurantId: string,
    data: NotificationPayload,
  ): void {
    const room = `restaurant:${restaurantId}`;
    const payload = {
      event: "NewNotification",
      data,
      timestamp: new Date().toISOString(),
    };

    this.emitToRoom(room, "notification:new", payload);
    this.logger.log(`🔔 notification:new → ${room}`);
  }

  /**
   * Emit report ready notification
   */
  emitReportReady(restaurantId: string, data: ReportPayload): void {
    const room = `restaurant:${restaurantId}`;
    const payload = {
      event: "ReportReady",
      data,
      timestamp: new Date().toISOString(),
    };

    this.emitToRoom(room, "report:ready", payload);
    this.logger.log(`📊 report:ready → ${room}`);
  }

  /**
   * Emit calendar event created
   */
  emitCalendarEventCreated(restaurantId: string, data: any): void {
    const room = `restaurant:${restaurantId}`;
    const payload = {
      event: "CalendarEventCreated",
      data,
      timestamp: new Date().toISOString(),
    };

    this.emitToRoom(room, "calendar:event_created", payload);
    this.logger.debug(`📅 calendar:event_created → ${room}`);
  }

  /**
   * Emit calendar event updated
   */
  emitCalendarEventUpdated(restaurantId: string, data: any): void {
    const room = `restaurant:${restaurantId}`;
    const payload = {
      event: "CalendarEventUpdated",
      data,
      timestamp: new Date().toISOString(),
    };

    this.emitToRoom(room, "calendar:event_updated", payload);
    this.logger.debug(`📅 calendar:event_updated → ${room}`);
  }

  /**
   * Emit conversation updated (new message from vendor)
   */
  emitConversationUpdated(restaurantId: string, data: any): void {
    const room = `restaurant:${restaurantId}`;
    const payload = {
      event: "ConversationUpdated",
      data,
      timestamp: new Date().toISOString(),
    };

    this.emitToRoom(room, "conversation:updated", payload);
    this.logger.debug(`💬 conversation:updated → ${room}`);
  }

  /**
   * Emit conversation summary updated (AI summarization complete)
   */
  emitConversationSummaryUpdated(restaurantId: string, data: any): void {
    const room = `restaurant:${restaurantId}`;
    const payload = {
      event: "ConversationSummaryUpdated",
      data,
      timestamp: new Date().toISOString(),
    };

    this.emitToRoom(room, "conversation:summary_updated", payload);
    this.logger.debug(`💬 conversation:summary_updated → ${room}`);
  }

  /**
   * Broadcast system-wide message
   */
  broadcastSystemMessage(
    message: string,
    level: "info" | "warning" | "error" = "info",
  ): void {
    const payload = {
      message,
      level,
      timestamp: new Date().toISOString(),
    };

    this.server.emit("system:message", payload);
    this.totalMessagesSent++;

    this.logger.log(`📢 System broadcast: ${message} (${level})`);
  }

  // =========================================================================
  // HEALTH & METRICS
  // =========================================================================

  /**
   * Get gateway statistics
   */
  getStats(): GatewayMetrics {
    const rooms = this.server?.sockets?.adapter?.rooms;
    const roomCount = rooms
      ? Array.from(rooms.keys()).filter((r) => r.startsWith("restaurant:"))
          .length
      : 0;

    return {
      totalConnections: this.clients.size,
      activeConnections: this.getActiveConnectionCount(),
      totalMessagesReceived: this.totalMessagesReceived,
      totalMessagesSent: this.totalMessagesSent,
      rateLimitedRequests: this.rateLimitedRequests,
      roomCount,
      uptimeSeconds: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
    };
  }

  /**
   * Get detailed connection info
   */
  getConnectionDetails(): Array<{
    clientId: string;
    userId: string;
    connectedAt: Date;
    lastActivity: Date;
    rooms: string[];
    messageCount: number;
  }> {
    return Array.from(this.clients.entries()).map(([clientId, metadata]) => ({
      clientId,
      userId: metadata.userId,
      connectedAt: metadata.connectedAt,
      lastActivity: metadata.lastActivity,
      rooms: Array.from(metadata.subscribedRooms),
      messageCount: metadata.messageCount,
    }));
  }

  /**
   * Health check
   */
  healthCheck(): { status: string; connections: number; uptime: number } {
    return {
      status: "healthy",
      connections: this.clients.size,
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
    };
  }

  // =========================================================================
  // SCHEDULED TASKS
  // =========================================================================

  /**
   * Cleanup idle connections (runs every minute)
   */
  @Interval(60000)
  cleanupIdleConnections(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [clientId, metadata] of this.clients.entries()) {
      const idleTime = now - metadata.lastActivity.getTime();

      if (idleTime > this.IDLE_TIMEOUT) {
        const socket = this.server.sockets.sockets.get(clientId);
        if (socket) {
          socket.disconnect(true);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      this.logger.log(`🧹 Cleaned ${cleaned} idle connections`);
    }
  }

  /**
   * Log metrics (runs every 5 minutes)
   */
  @Interval(300000)
  logMetrics(): void {
    const stats = this.getStats();
    this.logger.log(
      `📊 Metrics: ${stats.activeConnections} active, ${stats.totalMessagesSent} sent, ${stats.rateLimitedRequests} rate-limited`,
    );
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  private extractUserId(client: Socket): string {
    const metadata = this.clients.get(client.id);
    return metadata?.userId || client.id;
  }

  private extractAuthContext(client: Socket): {
    userId: string | null;
    restaurantId: string | null;
  } {
    const token = this.extractAuthToken(client);
    if (token) {
      try {
        const payload = this.jwtService.verify(token, {
          secret: resolveJwtSecret(
            this.configService.get<string>("JWT_SECRET"),
          ),
        }) as { sub?: string; restaurantId?: string };

        return {
          userId: payload?.sub || null,
          restaurantId: payload?.restaurantId || null,
        };
      } catch (error) {
        this.logger.warn(
          `⚠️ Invalid WebSocket token: ${error?.message || error}`,
        );
      }
    }

    if (process.env.NODE_ENV !== "production") {
      const fallbackUserId =
        client.handshake.auth?.userId ||
        client.handshake.query?.userId?.toString() ||
        client.id;
      return { userId: fallbackUserId, restaurantId: null };
    }

    return { userId: null, restaurantId: null };
  }

  private extractAuthToken(client: Socket): string | null {
    const token = client.handshake.auth?.token;
    if (token) return token;
    const header = client.handshake.headers?.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice(7);
    }
    return null;
  }

  private checkRateLimit(clientId: string): boolean {
    const limiter = this.rateLimiters.get(clientId);
    if (!limiter) return true;

    const allowed = limiter.consume();
    if (!allowed) {
      this.rateLimitedRequests++;
      this.logger.warn(`⚠️ Rate limited: ${clientId}`);
    }

    this.totalMessagesReceived++;

    const metadata = this.clients.get(clientId);
    if (metadata) {
      metadata.messageCount++;
    }

    return allowed;
  }

  private emitToRoom(room: string, event: string, payload: any): void {
    this.server.to(room).emit(event, payload);
    this.totalMessagesSent++;
  }

  private getActiveConnectionCount(): number {
    const now = Date.now();
    const activeThreshold = 60000; // 1 minute

    return Array.from(this.clients.values()).filter(
      (m) => now - m.lastActivity.getTime() < activeThreshold,
    ).length;
  }
}
