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
import { Namespace, Server, Socket } from "socket.io";
import { Interval } from "@nestjs/schedule";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { resolveJwtSecret } from "../auth/jwt-secret";
import { DatabaseService } from "../database/database.service";
import { sessionIsCurrent, tokenSessionVersion } from "../auth/session-version";
import {
  houseMembersInRoles,
  type HouseRoleName,
} from "../common/tenant/live-membership";
import { safeActionPath } from "../notifications/safe-action-path";

/**
 * The room for one person's sockets in one house (fix/websocket-role-gate,
 * 2026-09-28). A socket joins it at connect only when its house passed the
 * membership check. Owner/manager-only content is addressed to these rooms
 * after a role read at send time (`emitToHouseRoles`), never to
 * `restaurant:<id>`, which staff also join.
 *
 * It sits outside the `restaurant:` prefix on purpose. `subscribe:restaurant`
 * builds its room as `restaurant:${restaurantId}` and needs an exact match
 * with the connect-verified id, so no client-supplied value can name a member
 * room, even if that check is loosened later.
 */
export function memberRoom(restaurantId: string, userId: string): string {
  return `member:${restaurantId}:${userId}`;
}

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
  /**
   * The session version of the token the socket connected with (ADR 0225),
   * or null for a non-production socket that presented no token.
   */
  sessionVersion: number | null;
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
  /**
   * At runtime this is the "/ws" Namespace, not the root Server (see
   * `socketOnNamespace`). Everything called on it outside this class is
   * `.to(...)` or `.in(...)`, which a Namespace has. `getStats` and
   * `cleanupIdleConnections` still read the root-Server shape, so they count
   * 0 rooms and throw once any socket has been idle for 5 minutes. They are
   * not fixed in this lane, because a working idle sweep would start
   * disconnecting mobile sockets, which never send `ping`
   * (apps/mobile/src/lib/socket.ts). See v3.0-TECH-DEBT.md, 2026-09-28.
   */
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
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

  async handleConnection(client: Socket): Promise<void> {
    const { userId, restaurantId: claimedRestaurantId, sessionVersion } =
      this.extractAuthContext(client);
    if (!userId) {
      client.emit("error", "Unauthorized");
      client.disconnect(true);
      return;
    }

    // ADR 0225: a token from a session a password reset or change signed out
    // opens no socket, even inside its 15 minutes. A read that fails refuses
    // too: the client reconnects, and "could not check" is never "yes".
    if (sessionVersion !== null) {
      let current: boolean;
      try {
        current = await this.sessionStillCurrent(userId, sessionVersion);
      } catch (error) {
        this.logger.error(
          `⚠️ Connect could not read ${userId}'s session version, refusing: ${error?.message || error}`,
        );
        current = false;
      }
      if (!current) {
        client.emit("error", "Unauthorized");
        client.disconnect(true);
        return;
      }
    }

    // The token names a house; only seat the socket in that house's room if
    // an active `user_restaurant_access` row still says so. A removed member
    // keeps a token naming the old house until it expires — the token alone
    // must never be enough to read that house's live channel again. A failed
    // read refuses the house (does not admit it); it does not drop the whole
    // socket, since `user:${userId}` (DMs, notifications) does not depend on
    // any one house.
    let restaurantId: string | null = null;
    if (claimedRestaurantId) {
      try {
        restaurantId = (await this.isActiveMember(userId, claimedRestaurantId))
          ? claimedRestaurantId
          : null;
        if (restaurantId === null) {
          this.logger.warn(
            `⚠️ Connect refused house ${claimedRestaurantId} for ${userId}: no active membership`,
          );
        }
      } catch (error) {
        this.logger.error(
          `⚠️ Connect could not verify ${userId}'s membership in ${claimedRestaurantId}, refusing the house: ${error?.message || error}`,
        );
        restaurantId = null;
      }
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
      sessionVersion,
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
    // `manager:${userId}` was joined here until 2026-09-28. Every socket
    // joined its own, so it was never a managers room, and only the dead
    // `emitNotification` addressed it. Owner/manager content now goes through
    // `emitToHouseRoles`.
    if (restaurantId) {
      client.join(`restaurant:${restaurantId}`);
      client.join(memberRoom(restaurantId, userId));
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
  // SESSIONS (ADR 0225)
  // =========================================================================

  /**
   * Whether a token minted under `sessionVersion` still belongs to a live
   * session of `userId`. Throws on a read failure so the caller refuses.
   */
  private async sessionStillCurrent(
    userId: string,
    sessionVersion: number,
  ): Promise<boolean> {
    const { data, error } = await this.databaseService.supabase
      .from("users")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      throw new Error(`users read failed: ${error.message}`);
    }
    if (!data) return false;
    return sessionIsCurrent({ sv: sessionVersion }, data);
  }

  /**
   * Called by `AuthService` once a password reset or change has moved the
   * person's session version to `currentVersion`: every socket of theirs that
   * connected under an older version is told why and closed. That includes
   * the socket of the session that made a change; its client reconnects with
   * the new pair it was just given (web: `lib/sessionRenewed.ts`). Returns how
   * many were closed.
   *
   * This instance's sockets only. A socket held by another gateway instance
   * stays open until it reconnects or idles out; it can read nothing new that
   * needs a request, and its handshake is refused when it tries again.
   */
  endStaleSessions(userId: string, currentVersion: number): number {
    let closed = 0;
    for (const [clientId, metadata] of this.clients.entries()) {
      if (metadata.userId !== userId) continue;
      if (
        metadata.sessionVersion === null ||
        metadata.sessionVersion >= currentVersion
      ) {
        continue;
      }
      const socket = this.socketOnNamespace(clientId);
      if (socket) {
        socket.emit("session:ended", { reason: "password_changed" });
        socket.disconnect(true);
        closed++;
      }
    }
    if (closed > 0) {
      this.logger.log(
        `🔒 Closed ${closed} socket(s) of ${userId}: session version moved to ${currentVersion}`,
      );
    }
    return closed;
  }

  /**
   * The socket with this id on this gateway's namespace, or undefined.
   *
   * With `namespace: "/ws"` above, `@WebSocketServer()` injects the Namespace,
   * not the root Server: @nestjs/websockets 10.4.21
   * `socket-server-provider.js` `decorateWithNamespace` calls
   * @nestjs/platform-socket.io `io-adapter.js` `create`, which returns
   * `server.of(namespace)`. A Namespace's `sockets` is itself the id-to-Socket
   * Map (socket.io 4.8.3 `namespace.d.ts`). So the root-Server path
   * `server.sockets.sockets` is always undefined here. Until 2026-09-28,
   * `endStaleSessions` read that path and closed nothing (ADR 0225).
   */
  private socketOnNamespace(clientId: string): Socket | undefined {
    const sockets = (this.server as unknown as Namespace | undefined)?.sockets;
    return sockets instanceof Map ? sockets.get(clientId) : undefined;
  }

  // =========================================================================
  // MEMBERSHIP (ADR 0164's websocket sibling)
  // =========================================================================

  /**
   * Whether `userId` currently holds an active `user_restaurant_access` row
   * in `restaurantId`. Throws on a read failure so the caller can refuse
   * rather than admit (never treat "could not check" as "yes").
   */
  private async isActiveMember(
    userId: string,
    restaurantId: string,
  ): Promise<boolean> {
    const { data, error } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .select("id")
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .limit(1);
    if (error) {
      throw new Error(
        `user_restaurant_access read failed: ${error.message}`,
      );
    }
    return (data?.length ?? 0) > 0;
  }

  /**
   * Called by removal paths (`MembersService.removeMember`,
   * `TeamService.deleteMember`, `AuthService.leaveRestaurant`, and
   * `AuthService.deleteAccount`, once per house it removes — wired
   * 2026-09-19, round 3, P9; it was the only one of the four not wired at
   * first) once a membership row is gone. Takes every socket this user has
   * open out of that house's room immediately, and forgets the house in our
   * own metadata too — otherwise a later `subscribe:restaurant` for the same
   * id would pass (metadata still named it) even though the socket.io room
   * membership was just revoked.
   */
  evictFromHouse(userId: string, restaurantId: string): void {
    const room = `restaurant:${restaurantId}`;
    this.server?.in(`user:${userId}`).socketsLeave(room);
    // The member room goes too. Owner/manager emits would already skip this
    // person, because `emitToHouseRoles` reads roles at send time and the
    // membership row is gone. Leaving the room also stops the per-member
    // addressing from reaching a socket that no longer belongs to the house.
    this.server
      ?.in(`user:${userId}`)
      .socketsLeave(memberRoom(restaurantId, userId));

    for (const metadata of this.clients.values()) {
      if (metadata.userId === userId && metadata.restaurantId === restaurantId) {
        metadata.restaurantId = null;
        metadata.subscribedRooms.delete(room);
      }
    }

    this.logger.log(`🚪 Evicted ${userId} from ${room} (membership ended)`);
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

    // Enforce tenant scope. A socket whose token names no house (or whose
    // claimed house failed its connect-time membership check) has
    // `metadata.restaurantId === null` and is refused outright — it must
    // never be let in just because the request supplies a restaurantId
    // itself. This is the one check that stood between any signed-in socket
    // and any restaurant's live room (44.1r's websocket sibling).
    if (!metadata.restaurantId || metadata.restaurantId !== data.restaurantId) {
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
   * Emit to the members of `restaurantId` who hold one of `roles` now, and to
   * nobody else (fix/websocket-role-gate, 2026-09-28).
   *
   * The audience is read at send time (`houseMembersInRoles`), and the emit
   * goes to each person's member room. So a demotion or a removal takes effect
   * at the next event, on every instance, with no hook on the role writers,
   * and a staff member promoted to manager receives at once. A read that fails
   * emits nothing and logs why, because "could not check" is never "yes".
   * Returns how many people it was addressed to.
   *
   * Use this for owner/manager-only content, never `restaurant:<id>`, which
   * every member's socket joins.
   */
  async emitToHouseRoles(
    restaurantId: string,
    roles: readonly HouseRoleName[],
    event: string,
    payload: unknown,
  ): Promise<number> {
    let ids: string[];
    try {
      ids = await houseMembersInRoles(
        this.databaseService.supabase,
        restaurantId,
        roles,
      );
    } catch (error) {
      this.logger.error(
        `⚠️ ${event} → ${restaurantId} [${roles.join(",")}] NOT sent: the role read failed: ${error?.message || error}`,
      );
      return 0;
    }
    if (ids.length === 0 || !this.server) return 0;
    this.server
      .to(ids.map((id) => memberRoom(restaurantId, id)))
      .emit(event, payload);
    this.totalMessagesSent++;
    this.logger.log(
      `🔔 ${event} → ${restaurantId} [${roles.join(",")}] (${ids.length})`,
    );
    return ids.length;
  }

  /**
   * `notification:new`, in the same envelope as `emitRestaurantNotification`,
   * to the house's members in `roles` only. See `emitToHouseRoles`.
   */
  emitRoleNotification(
    restaurantId: string,
    roles: readonly HouseRoleName[],
    data: NotificationPayload,
  ): Promise<number> {
    return this.emitToHouseRoles(restaurantId, roles, "notification:new", {
      event: "NewNotification",
      data: this.withSafeActionUrl(data),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit a notification to every member of the restaurant, staff included.
   * Content that only owners or managers may read goes through
   * `emitRoleNotification` instead.
   */
  emitRestaurantNotification(
    restaurantId: string,
    data: NotificationPayload,
  ): void {
    const room = `restaurant:${restaurantId}`;
    const payload = {
      event: "NewNotification",
      data: this.withSafeActionUrl(data),
      timestamp: new Date().toISOString(),
    };

    this.emitToRoom(room, "notification:new", payload);
    this.logger.log(`🔔 notification:new → ${room}`);
  }

  /**
   * The View button runs `window.location.href = action_url` (web
   * `lib/websocket.tsx`), so a link that is not a path inside the app is
   * dropped here rather than sent. See `safeActionPath`.
   */
  private withSafeActionUrl(data: NotificationPayload): NotificationPayload {
    if (data.action_url === undefined) return data;
    const safe = safeActionPath(data.action_url);
    return { ...data, action_url: safe ?? undefined };
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
    sessionVersion: number | null;
  } {
    const token = this.extractAuthToken(client);
    if (token) {
      try {
        const payload = this.jwtService.verify(token, {
          secret: resolveJwtSecret(
            this.configService.get<string>("JWT_SECRET"),
          ),
        }) as { sub?: string; restaurantId?: string; sv?: number };

        return {
          userId: payload?.sub || null,
          restaurantId: payload?.restaurantId || null,
          sessionVersion: tokenSessionVersion(payload),
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
      return {
        userId: fallbackUserId,
        restaurantId: null,
        sessionVersion: null,
      };
    }

    return { userId: null, restaurantId: null, sessionVersion: null };
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
