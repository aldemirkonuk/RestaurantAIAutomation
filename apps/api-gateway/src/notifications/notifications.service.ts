import {
  Injectable,
  Logger,
  Inject,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WebsocketGateway } from "../websocket/websocket.gateway";
import { CommunicationsService } from "../communications/communications.service";
import { GmailService } from "../communications/gmail.service";
import { DatabaseService } from "../database/database.service";
import { ExpoPushService } from "../push/expo-push.service";

export interface NotificationPayload {
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  requireInteraction?: boolean;
  actions?: Array<{ action: string; title: string }>;
}

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private webPush: any = null;

  constructor(
    private readonly websocketGateway: WebsocketGateway,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => CommunicationsService))
    private readonly communicationsService?: CommunicationsService,
    @Optional()
    @Inject(forwardRef(() => GmailService))
    private readonly gmailService?: GmailService,
    @Optional()
    private readonly expoPushService?: ExpoPushService,
  ) {
    this.initWebPush();
  }

  /**
   * Initialize web-push with VAPID keys
   */
  private initWebPush(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const webPush = require("web-push");

      const vapidPublicKey = this.configService.get<string>("VAPID_PUBLIC_KEY");
      const vapidPrivateKey =
        this.configService.get<string>("VAPID_PRIVATE_KEY");
      const vapidSubject = this.configService.get<string>(
        "VAPID_SUBJECT",
        "mailto:admin@wineops.ai",
      );

      if (vapidPublicKey && vapidPrivateKey) {
        webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
        this.webPush = webPush;
        this.logger.log("Web Push initialized with VAPID keys");
      } else {
        this.logger.warn(
          "VAPID keys not configured - Web Push notifications disabled",
        );
      }
    } catch (err) {
      this.logger.warn(
        `Web Push initialization failed (web-push may not be installed): ${err?.message}`,
      );
    }
  }

  /**
   * Send notification to specific user
   */
  async sendToUser(
    userId: string,
    payload: NotificationPayload,
  ): Promise<void> {
    this.logger.log(`Sending notification to user ${userId}: ${payload.title}`);

    // Send via WebSocket (for real-time delivery)
    this.websocketGateway.server
      .to(`user:${userId}`)
      .emit("notification:new", payload);

    // Also send via Web Push API if user has subscription
    await this.sendWebPush(userId, payload);

    // And to the user's mobile devices (Expo push)
    if (this.expoPushService) {
      await this.expoPushService.sendToUsers([userId], {
        title: payload.title,
        body: payload.body,
        data: { type: payload.type, ...(payload.data ?? {}) },
      });
    }
  }

  /**
   * Send Web Push notification to a user's registered push subscriptions
   */
  async sendWebPush(
    userId: string,
    payload: NotificationPayload,
  ): Promise<void> {
    if (!this.webPush) {
      return; // Web Push not configured
    }

    try {
      // Fetch push subscriptions for this user from DB
      const { data: subscriptions, error } = await this.databaseService.supabase
        .from("notification_preferences")
        .select("push_subscription")
        .eq("user_id", userId)
        .not("push_subscription", "is", null);

      if (error || !subscriptions || subscriptions.length === 0) {
        return; // No subscriptions found
      }

      const pushPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: "/icons/wineops-192.png",
        badge: "/icons/wineops-badge.png",
        data: payload.data,
        requireInteraction: payload.requireInteraction,
        actions: payload.actions,
      });

      for (const row of subscriptions) {
        const sub = row.push_subscription as PushSubscription;
        if (!sub?.endpoint) continue;

        try {
          await this.webPush.sendNotification(sub, pushPayload);
          this.logger.debug(
            `Web push sent to ${sub.endpoint.substring(0, 50)}...`,
          );
        } catch (pushErr: any) {
          if (pushErr?.statusCode === 410 || pushErr?.statusCode === 404) {
            // Subscription expired or invalid - clean up
            this.logger.warn(
              `Push subscription expired for user ${userId}, cleaning up`,
            );
            await this.databaseService.supabase
              .from("notification_preferences")
              .update({ push_subscription: null })
              .eq("user_id", userId)
              .eq("push_subscription->>endpoint", sub.endpoint);
          } else {
            this.logger.warn(`Web push failed: ${pushErr?.message}`);
          }
        }
      }
    } catch (err) {
      this.logger.warn(`sendWebPush error: ${err?.message}`);
    }
  }

  /**
   * Register a push subscription for a user
   */
  async registerPushSubscription(
    userId: string,
    subscription: PushSubscription,
  ): Promise<{ success: boolean }> {
    try {
      const { error } = await this.databaseService.supabase
        .from("notification_preferences")
        .upsert(
          {
            user_id: userId,
            push_subscription: subscription,
            push_enabled: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );

      if (error) {
        this.logger.error(
          `Failed to register push subscription: ${error.message}`,
        );
        return { success: false };
      }

      this.logger.log(`Push subscription registered for user ${userId}`);
      return { success: true };
    } catch (err) {
      this.logger.error(`registerPushSubscription error: ${err?.message}`);
      return { success: false };
    }
  }

  /**
   * Send notification to all users in a restaurant
   */
  async sendToRestaurant(
    restaurantId: string,
    payload: NotificationPayload,
  ): Promise<void> {
    this.logger.log(
      `Sending notification to restaurant ${restaurantId}: ${payload.title}`,
    );

    this.websocketGateway.server
      .to(`restaurant:${restaurantId}`)
      .emit("notification:new", payload);
  }

  /**
   * Send order approval notification
   */
  async sendOrderApprovalNotification(data: {
    userId: string;
    orderId: string;
    wineName: string;
    quantity: number;
    providerName: string;
    price?: number;
  }): Promise<void> {
    const payload: NotificationPayload = {
      type: "order_approval",
      title: "🍷 New Order Awaiting Approval",
      body: `${data.quantity} bottles of ${data.wineName} from ${data.providerName}${
        data.price ? ` ($${data.price.toFixed(2)}/bottle)` : ""
      }`,
      data: {
        orderId: data.orderId,
        wineName: data.wineName,
        quantity: data.quantity,
        providerName: data.providerName,
        price: data.price,
      },
      requireInteraction: true,
      actions: [
        { action: "approve", title: "✅ Approve" },
        { action: "view", title: "👁️ View Details" },
      ],
    };

    await this.sendToUser(data.userId, payload);
  }

  /**
   * Send low stock alert
   * Now also sends email and SMS via CommunicationsService
   */
  async sendLowStockAlert(data: {
    restaurantId: string;
    wineId: string;
    wineName: string;
    currentStock: number;
    threshold: number;
    managerEmail?: string;
    managerPhone?: string;
  }): Promise<void> {
    const severity =
      data.currentStock <= data.threshold * 0.5 ? "Critical" : "Low Stock";
    const emoji = data.currentStock <= data.threshold * 0.5 ? "🚨" : "⚠️";

    const payload: NotificationPayload = {
      type: "low_stock",
      title: `${emoji} ${severity}: ${data.wineName}`,
      body: `Only ${data.currentStock} bottles remaining (threshold: ${data.threshold})`,
      data: {
        wineId: data.wineId,
        wineName: data.wineName,
        currentStock: data.currentStock,
        threshold: data.threshold,
        restaurantId: data.restaurantId,
      },
      requireInteraction: data.currentStock <= data.threshold * 0.5,
      actions: [
        { action: "reorder", title: "🛒 Reorder Now" },
        { action: "view", title: "📊 View Inventory" },
      ],
    };

    // Send WebSocket notification to restaurant
    await this.sendToRestaurant(data.restaurantId, payload);

    // Sync to the in-app inbox. Deduped by wine so the automatic low-stock
    // engine and a manual trigger can't produce two rows for the same wine.
    await this.persistForRestaurant(
      data.restaurantId,
      {
        type: "inventory_low_stock",
        title: `${emoji} ${severity}: ${data.wineName}`,
        message: `Only ${data.currentStock} bottles remaining (threshold: ${data.threshold})`,
        priority: data.currentStock <= data.threshold * 0.5 ? "critical" : "high",
        actionUrl: "/inventory?filter=low-stock",
        actionLabel: "View Inventory",
        groupKey: `low_stock:${data.wineId}`,
        metadata: {
          wineId: data.wineId,
          wineName: data.wineName,
          currentStock: data.currentStock,
          threshold: data.threshold,
        },
      },
      { dedupeWithinMinutes: 60 },
    );

    // Also send email/SMS if CommunicationsService is available and email is provided
    if (this.communicationsService && data.managerEmail) {
      try {
        await this.communicationsService.sendLowStockAlert(
          {
            wineName: data.wineName,
            wineId: data.wineId,
            currentStock: data.currentStock,
            threshold: data.threshold,
            restaurantId: data.restaurantId,
          },
          {
            emails: [data.managerEmail],
            phones: data.managerPhone ? [data.managerPhone] : undefined,
          },
        );
        this.logger.log(`Email/SMS low stock alert sent for: ${data.wineName}`);
      } catch (error) {
        this.logger.error(`Failed to send email/SMS low stock alert: ${error}`);
      }
    }
  }

  /**
   * Send delivery notification
   */
  async sendDeliveryNotification(data: {
    restaurantId: string;
    orderId: string;
    wineName: string;
    quantity: number;
    providerName: string;
  }): Promise<void> {
    const payload: NotificationPayload = {
      type: "delivery",
      title: "📦 Delivery Arrived",
      body: `${data.quantity} bottles of ${data.wineName} from ${data.providerName}`,
      data: {
        orderId: data.orderId,
        wineName: data.wineName,
        quantity: data.quantity,
        providerName: data.providerName,
      },
      requireInteraction: true,
      actions: [
        { action: "confirm", title: "✅ Confirm Receipt" },
        { action: "view", title: "👁️ View Order" },
      ],
    };

    await this.sendToRestaurant(data.restaurantId, payload);

    // Sync to the in-app inbox so the signal survives past the live toast.
    await this.persistForRestaurant(data.restaurantId, {
      type: "order_delivered",
      title: `📦 Delivery arrived: ${data.wineName}`,
      message: `${data.quantity} bottles of ${data.wineName} from ${data.providerName}`,
      priority: "medium",
      actionUrl: "/orders",
      actionLabel: "View Order",
      metadata: {
        orderId: data.orderId,
        wineName: data.wineName,
        quantity: data.quantity,
        provider: data.providerName,
      },
    });
  }

  /**
   * Send price negotiation notification
   */
  async sendPriceNegotiationNotification(data: {
    userId: string;
    orderId: string;
    wineName: string;
    currentPrice: number;
    proposedPrice: number;
    providerName: string;
  }): Promise<void> {
    const priceDiff = data.currentPrice - data.proposedPrice;
    const percentage = ((priceDiff / data.currentPrice) * 100).toFixed(1);
    const direction = priceDiff > 0 ? "lower" : "higher";

    const payload: NotificationPayload = {
      type: "price_negotiation",
      title: "💰 New Price Offer",
      body: `${data.providerName} offered $${data.proposedPrice.toFixed(2)}/bottle for ${
        data.wineName
      } (${Math.abs(Number(percentage))}% ${direction})`,
      data: {
        orderId: data.orderId,
        wineName: data.wineName,
        currentPrice: data.currentPrice,
        proposedPrice: data.proposedPrice,
        providerName: data.providerName,
      },
      requireInteraction: true,
      actions: [
        { action: "accept", title: "✅ Accept" },
        { action: "negotiate", title: "↔️ Counter" },
      ],
    };

    await this.sendToUser(data.userId, payload);
  }

  /**
   * Send system alert
   */
  async sendSystemAlert(data: {
    restaurantId: string;
    title: string;
    message: string;
    severity: "info" | "warning" | "error";
  }): Promise<void> {
    const emoji = {
      info: "ℹ️",
      warning: "⚠️",
      error: "🚨",
    }[data.severity];

    const payload: NotificationPayload = {
      type: "system_alert",
      title: `${emoji} ${data.title}`,
      body: data.message,
      data: {
        severity: data.severity,
      },
      requireInteraction: data.severity === "error",
      actions: [{ action: "view", title: "👁️ View Details" }],
    };

    await this.sendToRestaurant(data.restaurantId, payload);

    await this.persistForRestaurant(data.restaurantId, {
      type: "system",
      title: `${emoji} ${data.title}`,
      message: data.message,
      priority: data.severity === "error" ? "high" : "medium",
      metadata: { severity: data.severity },
    });
  }

  /**
   * Send email via GmailService (OAuth2).
   * Falls back to a logged mock when GmailService is not injected (e.g. isolated unit tests).
   */
  async sendEmail(data: {
    to: string[];
    subject: string;
    bodyHtml: string;
    bodyText?: string;
    cc?: string[];
    bcc?: string[];
  }): Promise<{ success: boolean; messageId: string }> {
    this.logger.log(
      `📧 Sending email to: ${data.to.join(", ")} — ${data.subject}`,
    );

    if (this.gmailService) {
      const result = await this.gmailService.sendEmail({
        to: data.to,
        subject: data.subject,
        html: data.bodyHtml,
        text: data.bodyText,
        cc: data.cc,
        bcc: data.bcc,
      });
      this.logger.log(
        `✅ Email ${result.success ? "sent" : "failed"} — MessageID: ${result.messageId}`,
      );
      return {
        success: result.success,
        messageId: result.messageId ?? `err-${Date.now()}`,
      };
    }

    // Fallback mock (no GmailService available)
    const messageId = `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.logger.warn(
      `⚠ GmailService not available — email mocked. MessageID: ${messageId}`,
    );
    return { success: true, messageId };
  }

  /**
   * Create a persistent notification row in the notifications table.
   * Called by the frontend reminder-scheduler and backend cron jobs so the
   * notification appears in the in-app notification center.
   */
  async createNotification(data: {
    userId: string;
    restaurantId: string;
    type: string;
    title: string;
    message: string;
    priority?: "low" | "medium" | "high" | "critical";
    actionUrl?: string;
    actionLabel?: string;
    metadata?: Record<string, any>;
  }) {
    const { data: row, error } = await this.databaseService.supabase
      .from("notifications")
      .insert({
        user_id: data.userId,
        // Legacy NOT-NULL columns still present on the live notifications table
        // (recipient_id / notification_type / channels). Populate them so the
        // insert doesn't violate the constraints; the app reads user_id / type.
        recipient_id: data.userId,
        notification_type: data.type,
        channels: ["in_app"],
        restaurant_id: data.restaurantId,
        type: data.type,
        title: data.title,
        message: data.message,
        priority: data.priority ?? "medium",
        status: "unread",
        action_url: data.actionUrl,
        action_label: data.actionLabel,
        metadata: data.metadata ?? {},
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`createNotification DB error: ${error.message}`);
      throw error;
    }

    this.logger.log(`Notification created: ${row.id} for user ${data.userId}`);

    // Emit real-time event so the frontend inbox updates instantly
    this.websocketGateway.server
      .to(`user:${data.userId}`)
      .emit("notification:new", {
        type: data.type,
        title: data.title,
        body: data.message,
        data: data.metadata,
      });

    return this.mapNotificationRow(row);
  }

  // =========================================================================
  // UNIFIED PERSISTENCE — every cross-page signal lands in the inbox
  // =========================================================================

  /**
   * Persist a restaurant-scoped notification to EVERY active member of the
   * restaurant and broadcast it once over WebSocket. This is the single funnel
   * that keeps the Notifications page in sync with signals other pages emit
   * (orders, deliveries, payments, low-stock, reports, …). Generalises the
   * inbound-responder's `persistManagerNotification`.
   *
   * Best-effort: never throws, so a persistence hiccup can't break the caller's
   * primary action (placing an order, sending an email, recording a pour).
   *
   * @returns number of inbox rows inserted.
   */
  async persistForRestaurant(
    restaurantId: string,
    payload: {
      type: string;
      title: string;
      message: string;
      priority?: "low" | "medium" | "high" | "critical";
      actionUrl?: string;
      actionLabel?: string;
      metadata?: Record<string, any>;
      groupKey?: string;
    },
    opts: { broadcast?: boolean; dedupeWithinMinutes?: number } = {},
  ): Promise<{ inserted: number }> {
    const { broadcast = true, dedupeWithinMinutes } = opts;
    try {
      const userIds = await this.resolveRestaurantMemberIds(restaurantId);
      if (!userIds.length) return { inserted: 0 };

      // Optional dedupe: skip if an identical group_key was already written for
      // this restaurant inside the window (prevents a re-alert on every sweep).
      if (payload.groupKey && dedupeWithinMinutes && dedupeWithinMinutes > 0) {
        const since = new Date(
          Date.now() - dedupeWithinMinutes * 60_000,
        ).toISOString();
        const { data: existing } = await this.databaseService.supabase
          .from("notifications")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .eq("group_key", payload.groupKey)
          .gte("created_at", since)
          .limit(1);
        if (existing && existing.length > 0) {
          return { inserted: 0 };
        }
      }

      const now = new Date().toISOString();
      const rows = userIds.map((userId) => ({
        user_id: userId,
        // Legacy NOT-NULL columns still on the live table — see createNotification.
        recipient_id: userId,
        notification_type: payload.type,
        channels: ["in_app"],
        restaurant_id: restaurantId,
        type: payload.type,
        title: payload.title.slice(0, 500),
        message: payload.message,
        priority: payload.priority ?? "medium",
        status: "unread",
        action_url: payload.actionUrl ?? null,
        action_label: payload.actionLabel ?? null,
        group_key: payload.groupKey ?? null,
        metadata: payload.metadata ?? {},
        created_at: now,
      }));

      const { error } = await this.databaseService.supabase
        .from("notifications")
        .insert(rows);
      if (error) {
        this.logger.warn(`persistForRestaurant insert failed: ${error.message}`);
        return { inserted: 0 };
      }

      if (broadcast) {
        this.websocketGateway.server
          .to(`restaurant:${restaurantId}`)
          .emit("notification:new", {
            type: payload.type,
            title: payload.title,
            message: payload.message,
            body: payload.message,
            action_url: payload.actionUrl,
            data: payload.metadata,
          });
      }

      // Mobile fan-out: whatever lands in the notification center lands on
      // members' phones too, except low priority which stays in-app only.
      // Batching happens upstream of this funnel, so a digest is one push.
      if (this.expoPushService && (payload.priority ?? "medium") !== "low") {
        await this.expoPushService.sendToUsers(userIds, {
          title: payload.title,
          body: payload.message,
          priority: payload.priority === "critical" ? "high" : "default",
          data: {
            type: payload.type,
            actionUrl: payload.actionUrl ?? null,
            ...(payload.metadata ?? {}),
          },
        });
      }

      return { inserted: rows.length };
    } catch (e: any) {
      this.logger.warn(
        `persistForRestaurant failed for restaurant ${restaurantId}: ${e?.message}`,
      );
      return { inserted: 0 };
    }
  }

  /**
   * Active member user_ids for a restaurant. Delegates to the shared data-layer
   * resolver so every notification funnel fans out to the same audience.
   */
  private async resolveRestaurantMemberIds(
    restaurantId: string,
  ): Promise<string[]> {
    return this.databaseService.getRestaurantMemberIds(restaurantId);
  }

  // =========================================================================
  // NOTIFICATION CRUD OPERATIONS
  // =========================================================================

  private mapNotificationRow(row: any) {
    return {
      id: row.id,
      userId: row.user_id,
      restaurantId: row.restaurant_id,
      type: row.type,
      title: row.title,
      message: row.message,
      priority: row.priority,
      status: row.status,
      actionUrl: row.action_url,
      actionLabel: row.action_label,
      metadata: row.metadata,
      readAt: row.read_at,
      timestamp: row.created_at,
      createdAt: row.created_at,
    };
  }

  async getNotifications(params: {
    userId: string;
    restaurantId?: string;
    type?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;

    let query = this.databaseService.supabase
      .from("notifications")
      .select("*", { count: "exact" })
      .eq("user_id", params.userId);

    if (params.restaurantId) {
      query = query.eq("restaurant_id", params.restaurantId);
    }
    if (params.type) {
      query = query.eq("type", params.type);
    }
    if (params.status) {
      query = query.eq("status", params.status);
    }
    if (params.dateFrom) {
      query = query.gte("created_at", params.dateFrom);
    }
    if (params.dateTo) {
      query = query.lte("created_at", params.dateTo);
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      this.logger.error(`getNotifications error: ${error.message}`);
      throw error;
    }

    return {
      data: (data || []).map(this.mapNotificationRow),
      total: count || 0,
      page,
      limit,
      hasMore: (count || 0) > offset + limit,
    };
  }

  async getUnreadNotifications(params: {
    userId: string;
    restaurantId?: string;
    limit?: number;
  }) {
    const limit = params.limit || 50;

    let query = this.databaseService.supabase
      .from("notifications")
      .select("*")
      .eq("user_id", params.userId)
      .eq("status", "unread");

    if (params.restaurantId) {
      query = query.eq("restaurant_id", params.restaurantId);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error(`getUnreadNotifications error: ${error.message}`);
      throw error;
    }

    return (data || []).map(this.mapNotificationRow);
  }

  async getUnreadCount(params: {
    userId: string;
    restaurantId?: string;
  }): Promise<number> {
    let query = this.databaseService.supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", params.userId)
      .eq("status", "unread");

    if (params.restaurantId) {
      query = query.eq("restaurant_id", params.restaurantId);
    }

    const { count, error } = await query;

    if (error) {
      this.logger.error(`getUnreadCount error: ${error.message}`);
      throw error;
    }

    return count || 0;
  }

  async markAsRead(id: string) {
    const now = new Date().toISOString();
    const { data, error } = await this.databaseService.supabase
      .from("notifications")
      .update({ status: "read", read_at: now })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      this.logger.error(`markAsRead error: ${error.message}`);
      throw error;
    }

    return this.mapNotificationRow(data);
  }

  /**
   * Inverse of markAsRead (UX path NEW-474). Clears read_at so the unread
   * count and the "unread" filter both agree with the row's status again.
   */
  async markAsUnread(id: string) {
    const { data, error } = await this.databaseService.supabase
      .from("notifications")
      .update({ status: "unread", read_at: null })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      this.logger.error(`markAsUnread error: ${error.message}`);
      throw error;
    }

    return this.mapNotificationRow(data);
  }

  async markBulkAsRead(ids: string[]): Promise<number> {
    const now = new Date().toISOString();
    const { data, error } = await this.databaseService.supabase
      .from("notifications")
      .update({ status: "read", read_at: now })
      .in("id", ids)
      .select("id");

    if (error) {
      this.logger.error(`markBulkAsRead error: ${error.message}`);
      throw error;
    }

    return data?.length || 0;
  }

  async markAllAsRead(params: {
    userId: string;
    restaurantId?: string;
  }): Promise<number> {
    const now = new Date().toISOString();

    let query = this.databaseService.supabase
      .from("notifications")
      .update({ status: "read", read_at: now })
      .eq("user_id", params.userId)
      .eq("status", "unread");

    if (params.restaurantId) {
      query = query.eq("restaurant_id", params.restaurantId);
    }

    const { data, error } = await query.select("id");

    if (error) {
      this.logger.error(`markAllAsRead error: ${error.message}`);
      throw error;
    }

    return data?.length || 0;
  }

  async archiveNotification(id: string) {
    const now = new Date().toISOString();
    const { data, error } = await this.databaseService.supabase
      .from("notifications")
      .update({ status: "archived", archived_at: now })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      this.logger.error(`archiveNotification error: ${error.message}`);
      throw error;
    }

    return this.mapNotificationRow(data);
  }

  async deleteNotification(id: string): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("notifications")
      .delete()
      .eq("id", id);

    if (error) {
      this.logger.error(`deleteNotification error: ${error.message}`);
      throw error;
    }
  }

  async deleteBulk(ids: string[]): Promise<number> {
    const { data, error } = await this.databaseService.supabase
      .from("notifications")
      .delete()
      .in("id", ids)
      .select("id");

    if (error) {
      this.logger.error(`deleteBulk error: ${error.message}`);
      throw error;
    }

    return data?.length || 0;
  }

  async deleteAllRead(userId: string): Promise<number> {
    const { data, error } = await this.databaseService.supabase
      .from("notifications")
      .delete()
      .eq("user_id", userId)
      .eq("status", "read")
      .select("id");

    if (error) {
      this.logger.error(`deleteAllRead error: ${error.message}`);
      throw error;
    }

    return data?.length || 0;
  }

  async getNotificationHistory(userId: string, days: number = 30) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const { data, error } = await this.databaseService.supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", sinceDate.toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error(`getNotificationHistory error: ${error.message}`);
      throw error;
    }

    return (data || []).map(this.mapNotificationRow);
  }

  // =========================================================================
  // NOTIFICATION PREFERENCES
  // =========================================================================

  private mapPreferencesRow(row: any) {
    const categories = row.categories || {
      inventory: true,
      orders: true,
      calendar: true,
      system: true,
      ai: true,
    };

    return {
      userId: row.user_id,
      email: row.email_enabled ?? true,
      push: row.push_enabled ?? true,
      sms: row.sms_enabled ?? false,
      categories,
      quietHours: {
        enabled: row.quiet_hours_enabled ?? false,
        startTime: row.quiet_hours_start || "22:00",
        endTime: row.quiet_hours_end || "08:00",
      },
      lowStock: {
        enabled: row.low_stock_enabled ?? true,
        instantFirstAlert: row.instant_first_alert ?? true,
        criticalImmediate: row.critical_immediate ?? true,
        digestFrequency: row.digest_frequency || "daily",
        digestTime: row.digest_time || "12:00",
      },
      ordersMode: row.orders_mode || "both",
      reportsMode: row.reports_mode || "both",
      updatedAt: row.updated_at,
    };
  }

  async getPreferences(userId: string) {
    const { data, error } = await this.databaseService.supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      this.logger.error(`getPreferences error: ${error.message}`);
      throw error;
    }

    if (!data) {
      return {
        userId,
        email: true,
        push: true,
        sms: false,
        categories: {
          inventory: true,
          orders: true,
          calendar: true,
          system: true,
          ai: true,
        },
        quietHours: {
          enabled: false,
          startTime: "22:00",
          endTime: "08:00",
        },
        lowStock: {
          enabled: true,
          instantFirstAlert: true,
          criticalImmediate: true,
          digestFrequency: "daily",
          digestTime: "12:00",
        },
        ordersMode: "both",
        reportsMode: "both",
        updatedAt: null,
      };
    }

    return this.mapPreferencesRow(data);
  }

  async updatePreferences(params: {
    userId: string;
    email?: boolean;
    push?: boolean;
    sms?: boolean;
    categories?: Record<string, boolean>;
    quietHours?: { enabled?: boolean; startTime?: string; endTime?: string };
    lowStock?: {
      enabled?: boolean;
      instantFirstAlert?: boolean;
      criticalImmediate?: boolean;
      digestFrequency?: string;
      digestTime?: string;
    };
    ordersMode?: string;
    reportsMode?: string;
  }) {
    const updateData: Record<string, any> = {
      user_id: params.userId,
      updated_at: new Date().toISOString(),
    };

    if (params.email !== undefined) updateData.email_enabled = params.email;
    if (params.push !== undefined) updateData.push_enabled = params.push;
    if (params.sms !== undefined) updateData.sms_enabled = params.sms;
    if (params.categories !== undefined)
      updateData.categories = params.categories;
    if (params.quietHours?.enabled !== undefined)
      updateData.quiet_hours_enabled = params.quietHours.enabled;
    if (params.quietHours?.startTime !== undefined)
      updateData.quiet_hours_start = params.quietHours.startTime;
    if (params.quietHours?.endTime !== undefined)
      updateData.quiet_hours_end = params.quietHours.endTime;
    if (params.lowStock?.enabled !== undefined)
      updateData.low_stock_enabled = params.lowStock.enabled;
    if (params.lowStock?.instantFirstAlert !== undefined)
      updateData.instant_first_alert = params.lowStock.instantFirstAlert;
    if (params.lowStock?.criticalImmediate !== undefined)
      updateData.critical_immediate = params.lowStock.criticalImmediate;
    if (params.lowStock?.digestFrequency !== undefined)
      updateData.digest_frequency = params.lowStock.digestFrequency;
    if (params.lowStock?.digestTime !== undefined)
      updateData.digest_time = params.lowStock.digestTime;
    if (params.ordersMode !== undefined)
      updateData.orders_mode = params.ordersMode;
    if (params.reportsMode !== undefined)
      updateData.reports_mode = params.reportsMode;

    const { data, error } = await this.databaseService.supabase
      .from("notification_preferences")
      .upsert(updateData, { onConflict: "user_id" })
      .select()
      .single();

    if (error) {
      this.logger.error(`updatePreferences error: ${error.message}`);
      throw error;
    }

    return this.mapPreferencesRow(data);
  }

  // =========================================================================
  // PUSH SUBSCRIPTION MANAGEMENT
  // =========================================================================

  async unregisterPushSubscription(
    userId: string,
  ): Promise<{ success: boolean }> {
    try {
      const { error } = await this.databaseService.supabase
        .from("notification_preferences")
        .update({
          push_subscription: null,
          push_enabled: false,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) {
        this.logger.error(
          `Failed to unregister push subscription: ${error.message}`,
        );
        return { success: false };
      }

      this.logger.log(`Push subscription removed for user ${userId}`);
      return { success: true };
    } catch (err) {
      this.logger.error(`unregisterPushSubscription error: ${err?.message}`);
      return { success: false };
    }
  }
}
