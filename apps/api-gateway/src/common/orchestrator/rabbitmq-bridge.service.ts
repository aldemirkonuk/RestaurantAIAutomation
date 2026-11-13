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
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as amqplib from "amqplib";
import { WebsocketGateway } from "../../websocket/websocket.gateway";
import { DatabaseService } from "../../database/database.service";
import { InboundResponderService } from "./inbound-responder.service";
import { deriveTransportSignals, looksPromotional } from "./email-triage";
import {
  decodeEncodedWords,
  displayLabel,
  parseSender,
  likeExactly,
} from "../../communications/inbound-headers";
import { senderUnconfirmed } from "../../communications/sender-authentication";
import { createHash, randomUUID } from "crypto";
import { PromotionExtractorService } from "./promotion-extractor.service";
import { ProspectsService } from "./prospects.service";
import {
  answeredMessageIds,
  bareMessageId,
  storedMessageIdShapes,
} from "./answered-message-ids";
import { MailIntakeService, type IntakeOutcome } from "./mail-intake.service";
import { OWNER_AND_MANAGER } from "../tenant/live-membership";

/** Mapping of RabbitMQ routing keys to handler methods */
interface RouteHandler {
  exchange: string;
  routingKey: string;
  /**
   * `deliveredKey` is the key the message was PUBLISHED with
   * (`msg.fields.routingKey`), not the binding pattern: under
   * `notification.#` it is `notification.promo_alert`, and so on.
   */
  handler: (msg: any, deliveredKey?: string) => void | Promise<void>;
}

/**
 * Who may see a `notification.*` event the orchestrator publishes, keyed by
 * its routing key (fix/websocket-role-gate, 2026-09-28).
 *
 * "house" goes to `restaurant:<id>`, which every member joins, as every key did
 * before this table. "owner_manager" goes only to the house's owners and
 * managers, after a role read at send time (`emitRoleNotification`). The
 * gateway decides this, not the publisher: one table, reviewed in one place.
 *
 * Every `notification.*` routing-key literal in services/agent-orchestrator
 * must be listed here. CLAIMS `SEC-2026-09-28-WEBSOCKET-ROLE-GATE` fails the
 * build otherwise, so a new publisher has to be classified before it ships.
 * An unlisted key falls back to "house", because defaulting to owner_manager
 * would silently drop the low-stock and inventory notices staff rely on.
 *
 * Only `promo_alert` is owner/manager today. It carries a vendor's promotion
 * from `provider_promotions`, the rows GET /promotions refuses staff (ADR
 * 0124:357-362). The negotiation keys (counter offer, order approval,
 * rejection, voice negotiation, rfq winner) stay "house" until the founder
 * answers OD-180 fork 1, because the HTTP reads they mirror are open to staff
 * today.
 */
export const NOTIFICATION_AUDIENCE_BY_KEY: Readonly<
  Record<string, "house" | "owner_manager">
> = {
  "notification.promo_alert": "owner_manager",

  "notification.alert": "house",
  "notification.approval_request": "house",
  "notification.email_received": "house",
  "notification.info": "house",
  "notification.inventory_discrepancy": "house",
  "notification.inventory_surplus": "house",
  "notification.invariant_violation": "house",
  "notification.low_stock_one_tap": "house",
  "notification.order_approval": "house",
  "notification.order_confirmed": "house",
  "notification.procurement_counter_offer": "house",
  "notification.procurement_oos": "house",
  "notification.procurement_rejected": "house",
  "notification.procurement_reorder_proposed": "house",
  "notification.provider_contradiction": "house",
  "notification.push.sent": "house",
  "notification.relationship_health_alert": "house",
  "notification.review_required": "house",
  "notification.rfq_solicitation_proposed": "house",
  "notification.rfq_winner": "house",
  "notification.scarcity_auto_hold": "house",
  "notification.send": "house",
  "notification.vintage_conflict": "house",
  "notification.vintage_mismatch": "house",
  "notification.voice_negotiation_complete": "house",
  "notification.voice_review_needed": "house",
  "notification.weekly_report": "house",
  "notification.wine_type_mismatch": "house",
};

export function notificationAudience(
  deliveredKey: string | undefined,
): "house" | "owner_manager" {
  return (
    (deliveredKey && NOTIFICATION_AUDIENCE_BY_KEY[deliveredKey]) || "house"
  );
}

/**
 * Where a notice about a stranger or a held letter opens: /communications
 * with "Who is writing" open (`?senders=open`, read by WhoIsWriting.tsx). Since
 * r21 the same key also selects the Mail tab, where the register now lives;
 * no `tab=` is named, so the link works whichever of the two lands first. The
 * bare "/communications" opened Letters with the register folded at the foot.
 */
export const WHO_IS_WRITING_URL = "/communications?senders=open";

/** A vendor's letter in Mail: `?with=vendor:<id>`, and `&thread=` when known. */
export function mailThreadUrl(
  providerId: string,
  threadKey: string | null,
): string {
  const q = new URLSearchParams({ tab: "mail", with: `vendor:${providerId}` });
  if (threadKey && threadKey.trim()) q.set("thread", threadKey.trim());
  return `/communications?${q.toString()}`;
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
    private readonly inboundResponder: InboundResponderService,
    private readonly promotionExtractor: PromotionExtractorService,
    private readonly prospects: ProspectsService,
    // The durable record every inbound door writes first (gap G2). Optional
    // only so the specs that build the bridge by hand keep compiling; Nest
    // always provides it.
    @Optional() private readonly mailIntake?: MailIntakeService,
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
      "RABBITMQ_URL",
      "amqp://localhost:5672",
    );

    this.logger.log("Connecting RabbitMQ bridge to consume agent events...");

    this.connection = await amqplib.connect(rabbitUrl);
    this.channel = await this.connection.createChannel();
    await this.channel.prefetch(50);

    // Handle connection errors for auto-reconnect
    this.connection.on("error", (err) => {
      this.logger.error(`RabbitMQ bridge connection error: ${err?.message}`);
      this.isConnected = false;
      this.scheduleReconnect();
    });

    this.connection.on("close", () => {
      if (this.isConnected) {
        this.logger.warn("RabbitMQ bridge connection closed unexpectedly");
        this.isConnected = false;
        this.scheduleReconnect();
      }
    });

    // Setup all subscriptions
    await this.setupSubscriptions();

    this.isConnected = true;
    this.logger.log(
      "RabbitMQ bridge connected - agent events will now propagate to frontend",
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
    this.logger.log("RabbitMQ bridge disconnected");
  }

  // ===========================================================================
  // SUBSCRIPTION SETUP
  // ===========================================================================

  private async setupSubscriptions(): Promise<void> {
    const routes: RouteHandler[] = [
      // --- Stock events ---
      {
        exchange: "stock.events",
        routingKey: "stock.state.changed",
        handler: (msg) => this.handleStockStateChanged(msg),
      },
      {
        exchange: "stock.events",
        routingKey: "stock.threshold.breached",
        handler: (msg) => this.handleStockThresholdBreached(msg),
      },
      {
        exchange: "stock.events",
        routingKey: "stock.increased",
        handler: (msg) => this.handleStockIncreased(msg),
      },
      {
        exchange: "stock.events",
        routingKey: "stock.manually_corrected",
        handler: (msg) => this.handleStockManuallyCorrected(msg),
      },
      {
        exchange: "stock.events",
        routingKey: "stock.evaluated",
        handler: (msg) => this.handleStockEvaluated(msg),
      },

      // --- Procurement events ---
      {
        exchange: "procurement.events",
        routingKey: "procurement.order.created",
        handler: (msg) => this.handleOrderCreated(msg),
      },
      {
        exchange: "procurement.events",
        routingKey: "procurement.order.delivered",
        handler: (msg) => this.handleOrderDelivered(msg),
      },
      {
        exchange: "procurement.events",
        routingKey: "procurement.order.approved",
        handler: (msg) => this.handleOrderStatusChanged(msg, "APPROVED"),
      },

      // --- Notification events ---
      {
        exchange: "notification.events",
        routingKey: "notification.#",
        handler: (msg, deliveredKey) =>
          this.handleNotificationEvent(msg, deliveredKey),
      },

      // --- Report events ---
      {
        exchange: "report.events",
        routingKey: "report.generated",
        handler: (msg) => this.handleReportGenerated(msg),
      },

      // --- Menu events ---
      {
        exchange: "menu.events",
        routingKey: "menu.scan_complete",
        handler: (msg) => this.handleMenuScanComplete(msg),
      },

      // --- Verification events ---
      {
        exchange: "notification.events",
        routingKey: "notification.invariant_violation",
        handler: (msg) => this.handleInvariantViolation(msg),
      },

      // --- Additional procurement lifecycle events ---
      {
        exchange: "procurement.events",
        routingKey: "procurement.order.confirmed",
        handler: (msg) => this.handleOrderStatusChanged(msg, "CONFIRMED"),
      },
      {
        exchange: "procurement.events",
        routingKey: "procurement.order.completed",
        handler: (msg) => this.handleOrderStatusChanged(msg, "COMPLETED"),
      },

      // --- Inbound email events ---
      {
        exchange: "email.events",
        routingKey: "email.inbound.received",
        handler: (msg) => this.fileInboundEmail(msg),
      },

      // --- Vendor / conversation events ---
      {
        exchange: "procurement.events",
        routingKey: "procurement.vendor_response",
        handler: (msg) => this.handleConversationUpdated(msg),
      },
      {
        exchange: "conversation.events",
        routingKey: "conversation.summary.updated",
        handler: (msg) => this.handleConversationSummaryUpdated(msg),
      },

      // --- Recurring order events ---
      {
        exchange: "recurring.events",
        routingKey: "recurring.order.reminder",
        handler: (msg) => this.handleRecurringOrderReminder(msg),
      },
      {
        exchange: "recurring.events",
        routingKey: "recurring.order.executed",
        handler: (msg) => this.handleOrderCreated(msg),
      },

      // --- Calendar events ---
      {
        exchange: "calendar.events",
        routingKey: "calendar.event.created",
        handler: (msg) => this.handleCalendarEventCreated(msg),
      },
      {
        exchange: "calendar.events",
        routingKey: "calendar.event.updated",
        handler: (msg) => this.handleCalendarEventUpdated(msg),
      },

      // --- Invoice events ---
      {
        exchange: "invoice.events",
        routingKey: "invoice.processed",
        handler: (msg, deliveredKey) =>
          this.handleNotificationEvent(msg, deliveredKey),
      },
    ];

    for (const route of routes) {
      try {
        // Assert exchange exists (topic type, durable)
        await this.channel.assertExchange(route.exchange, "topic", {
          durable: true,
        });

        // Create a unique queue for this bridge consumer
        const queueName = `bridge.nestjs.${route.exchange}.${route.routingKey.replace(/[.#*]/g, "_")}`;
        const { queue } = await this.channel.assertQueue(queueName, {
          durable: true,
          arguments: {
            "x-message-ttl": 300000, // 5 min TTL - bridge events are ephemeral
            "x-max-length": 1000, // Cap queue size
          },
        });

        await this.channel.bindQueue(queue, route.exchange, route.routingKey);

        // Start consuming
        await this.channel.consume(
          queue,
          (msg) => {
            if (!msg) return;
            // Acked once the handler has SETTLED, never before (gap G2): an
            // async handler used to be called without await and acked at
            // once, so a gateway that stopped mid-insert lost the letter.
            // A handler that fails is still acked: the inbound-mail handler
            // records its own failure in `mail_intake` (re-driven from
            // there), and the other routes are notices that a requeue would
            // only repeat.
            const channel = this.channel;
            Promise.resolve()
              .then(() => {
                const body = JSON.parse(msg.content.toString());
                return route.handler(body, msg.fields?.routingKey);
              })
              .catch((err) =>
                this.logger.warn(
                  `Failed to process bridge message from ${route.exchange}/${route.routingKey}: ${err?.message}`,
                ),
              )
              .finally(() => channel?.ack(msg));
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
      wine_name: payload.wine_name || "Unknown",
      stock_before: payload.stock_before ?? payload.previous_stock ?? 0,
      stock_after: payload.stock_after ?? payload.current_stock ?? 0,
    });

    // Also emit as a generic event:new so RealtimeContext picks it up
    this.emitGenericEvent(restaurantId, "inventory_change", payload);
  }

  private handleStockThresholdBreached(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitLowStockAlert(restaurantId, {
      inventory_id: payload.inventory_id,
      restaurant_id: restaurantId,
      wine_name: payload.wine_name || "Unknown",
      stock_after: payload.stock_after ?? 0,
      threshold: payload.threshold ?? 3,
      urgency: payload.urgency || "medium",
      estimated_stockout_days: payload.estimated_stockout_days ?? 999,
    });

    this.emitGenericEvent(restaurantId, "inventory_change", payload);
  }

  private handleStockIncreased(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitStockUpdate(restaurantId, {
      inventory_id: payload.inventory_id,
      restaurant_id: restaurantId,
      wine_name: payload.wine_name || "Unknown",
      stock_before: payload.stock_before ?? 0,
      stock_after: payload.stock_after ?? 0,
    });

    this.emitGenericEvent(restaurantId, "inventory_change", payload);
  }

  private handleStockManuallyCorrected(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitStockUpdate(restaurantId, {
      inventory_id: payload.inventory_id,
      restaurant_id: restaurantId,
      wine_name: payload.wine_name || "Unknown",
      stock_before: payload.stock_before ?? 0,
      stock_after: payload.corrected_stock ?? payload.stock_after ?? 0,
    });

    this.emitGenericEvent(restaurantId, "inventory_change", payload);
  }

  private handleStockEvaluated(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitStockUpdate(restaurantId, {
      inventory_id: payload.inventory_id,
      restaurant_id: restaurantId,
      wine_name: payload.wine_name || "Unknown",
      stock_before: payload.stock_before ?? 0,
      stock_after: payload.stock_after ?? 0,
    });

    this.emitGenericEvent(restaurantId, "inventory_change", payload);
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
      status: "NEGOTIATING",
    });

    this.emitGenericEvent(restaurantId, "order_change", payload);
  }

  private handleOrderDelivered(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitOrderStatusChanged(restaurantId, {
      order_id: payload.order_id,
      wine_name: payload.wine_name,
      quantity: payload.quantity_delivered,
      status: "DELIVERED",
      previous_status: "IN_TRANSIT",
    });

    this.emitGenericEvent(restaurantId, "order_change", payload);
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

    this.emitGenericEvent(restaurantId, "order_change", payload);
  }

  private handleNotificationEvent(msg: any, deliveredKey?: string): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    const notification = {
      id: payload.notification_id || payload.event_id || "",
      title: payload.title || payload.event_type || "Notification",
      message: payload.message || payload.body || "",
      type: this.mapNotificationType(payload.urgency || payload.type),
      action_url: payload.action_url,
    };
    // The audience comes from the routing key, via the gateway's own table,
    // never from the body the publisher wrote (NOTIFICATION_AUDIENCE_BY_KEY).
    if (notificationAudience(deliveredKey) === "owner_manager") {
      void this.websocketGateway.emitRoleNotification(
        restaurantId,
        OWNER_AND_MANAGER,
        notification,
      );
    } else {
      this.websocketGateway.emitRestaurantNotification(
        restaurantId,
        notification,
      );
    }

    // For inbound vendor emails, also push a conversation:updated event so the
    // CommsThreadDrawer refetches the thread without requiring a manual refresh.
    if (
      payload.type === "vendor_email" &&
      (payload.order_id || payload.provider_id)
    ) {
      this.websocketGateway.emitConversationUpdated(restaurantId, {
        order_id: payload.order_id,
        provider_id: payload.provider_id,
        direction: "inbound",
        channel: "email",
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
      download_url: payload.download_url || "",
    });

    this.emitGenericEvent(restaurantId, "report_event", payload);
  }

  private handleMenuScanComplete(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    this.emitGenericEvent(restaurantId, "wine_update", msg?.payload || msg);
  }

  private handleInvariantViolation(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitRestaurantNotification(restaurantId, {
      id: payload.event_id || "",
      title: "System Invariant Violation",
      message:
        payload.message ||
        payload.violation_type ||
        "Data integrity issue detected",
      type: "error",
    });
  }

  /**
   * The vendor a letter is from: a vendor of the receiving house, not
   * removed, that lists the sender's address (r28 mail audit, gaps 5 and 7).
   *
   * The house reader reads mail from every address in the vendor book
   * (`HouseLettersService.book`: `contact_email`, `primary_contact.email`
   * and `provider_contacts.email`), but this lookup matched `contact_email`
   * alone. A letter from a vendor's accounts address was read and then filed
   * as a stranger's, or not kept. It also read removed vendors: the house's
   * unique address index holds among live rows only, so after a vendor was
   * removed and added again with the same address, `.limit(1)` could file
   * the letter under the removed one.
   *
   * The addresses are read in the book's order of strength, and the first
   * that names a vendor decides: `contact_email` (unique among a house's
   * live vendors), then `primary_contact.email`, then a contact row. An
   * address that two live vendors list at the same strength names neither:
   * the letter goes the way an unknown sender's does, as before, rather than
   * under a vendor it may not be from. Exact, never a pattern: a From of
   * `%@%` must not reach a vendor.
   *
   * A failed read THROWS: an unreadable book is not "nobody", and the intake
   * row is marked failed and the letter offered again (gap G2), where before
   * the letter was taken for a stranger's.
   */
  private async findSenderVendor(
    restaurantId: string,
    senderEmail: string,
  ): Promise<{ id: string; restaurant_id: string; name: string } | null> {
    const db = this.databaseService.supabase;
    const exact = likeExactly(senderEmail);
    const one = (rows: any[] | null, where: string) => {
      const ids = [...new Set((rows ?? []).map((r) => r.id))];
      if (ids.length > 1) {
        this.logger.warn(
          `handleInboundEmail: ${ids.length} vendors of house ${restaurantId} list the sender in ${where}; filed under none`,
        );
        return "ambiguous" as const;
      }
      return rows?.[0] ?? null;
    };

    for (const column of ["contact_email", "primary_contact->>email"]) {
      const { data, error } = await db
        .from("providers")
        .select("id, restaurant_id, name")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .ilike(column, exact)
        .limit(2);
      if (error) {
        throw new Error(
          `the vendor book could not be read (${error.message})`,
        );
      }
      const hit = one(data, column);
      if (hit === "ambiguous") return null;
      if (hit) return hit;
    }

    const { data: contacts, error: contactError } = await db
      .from("provider_contacts")
      .select("provider_id")
      .ilike("email", exact)
      .limit(50);
    if (contactError) {
      throw new Error(
        `the vendor book's contact list could not be read (${contactError.message})`,
      );
    }
    const contactVendorIds = [
      ...new Set((contacts ?? []).map((c: any) => c.provider_id).filter(Boolean)),
    ];
    if (!contactVendorIds.length) return null;
    const { data: listed, error: listedError } = await db
      .from("providers")
      .select("id, restaurant_id, name")
      .in("id", contactVendorIds)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .limit(2);
    if (listedError) {
      throw new Error(
        `the vendor book could not be read (${listedError.message})`,
      );
    }
    const hit = one(listed, "provider_contacts");
    return hit === "ambiguous" ? null : hit;
  }

  // ===========================================================================
  // INBOUND EMAIL HANDLER (NestJS fallback — stores to DB without Python agent)
  // ===========================================================================

  /**
   * The inbound-mail route (gap G2): file the letter, then tell its
   * `mail_intake` row what became of it. A letter that could not be stored
   * is marked `failed` and published again by the re-drive tick; nothing is
   * only logged any more.
   */
  private async fileInboundEmail(msg: any): Promise<void> {
    const payload = msg?.payload || msg;
    const intakeId: string | null =
      typeof payload?.intake_id === "string" ? payload.intake_id : null;
    try {
      const outcome = await this.handleInboundEmail(msg);
      if (intakeId && this.mailIntake) {
        await this.mailIntake.settle(intakeId, outcome);
      }
    } catch (err: any) {
      const reason = err?.message ?? String(err);
      if (intakeId && this.mailIntake) {
        await this.mailIntake.fail(intakeId, reason);
        this.logger.error(
          `handleInboundEmail: a letter was not stored (${reason}); intake ${intakeId} will be tried again`,
        );
      } else {
        this.logger.error(
          `handleInboundEmail: a letter was not stored (${reason}) and its event carried no intake record`,
        );
      }
    }
  }

  /**
   * File one inbound letter. Returns what became of it; THROWS when the
   * letter could not be stored, so the caller can keep it for another try.
   */
  private async handleInboundEmail(msg: any): Promise<IntakeOutcome> {
    const payload = msg?.payload || msg;
    const intakeId: string | null =
      typeof payload.intake_id === "string" ? payload.intake_id : null;
    // The Python email agents put correlation_id on the message envelope
    // (base_agent.py:660-662) and it was being dropped here — the ONLY flow
    // where a gateway NF/decision_log row can truthfully join the Python
    // decision_log chain. Mint one if absent, matching base_agent.py:549-550
    // (`message.get("correlation_id") or uuid4()`).
    const correlationId: string =
      msg?.correlation_id || payload.correlation_id || randomUUID();
    const from: string = payload.from || "";
    // RFC 2047 (QA round 6 N-2): `=?UTF-8?B?…?=` / Q / windows-1254 subjects
    // were stored and notified verbatim. Decoded here, the one choke point every
    // ingest path (shared mailbox, house inbox, webhook) publishes through.
    const subject: string = decodeEncodedWords(payload.subject || "");
    const body: string = payload.body || "";
    const attachments: Array<{
      filename: string;
      mime_type: string;
      data: string;
    }> = Array.isArray(payload.attachments) ? payload.attachments : [];
    const gmailThreadId: string = payload.gmail_thread_id || "";
    const gmailMessageId: string = payload.gmail_message_id || "";
    const messageIdHeader: string = payload.message_id_header || "";
    const inReplyTo: string = payload.in_reply_to || "";
    const references: string = payload.references || "";
    const receivedAt: string = payload.received_at || new Date().toISOString();
    // Transport/auth signals (bulk, list, auto-submitted, SPF/DKIM/DMARC) derived from the
    // full header map the ingestion path already publishes on payload.headers. Captured now
    // for triage classification + sender verification — nothing gates on them yet (shadow phase).
    const rawHeaders =
      payload.headers && typeof payload.headers === "object"
        ? payload.headers
        : {};
    const transportSignals = deriveTransportSignals(rawHeaders, from);

    // The sender is the addr-spec a real RFC 5322 parser finds, never "the
    // first <...>" (QA round 6 N-1): `"Sales <sales@bigdist.com>"
    // <attacker@evil.example>` is attacker@evil.example, and a From that names
    // no single unambiguous mailbox is attributed to nobody
    // (`inbound-headers.ts`, which records the rule).
    const sender = parseSender(from);
    const senderEmail = sender?.address;

    // The house the letter was written to, stamped by every publisher: the
    // house inbox (the grant's house), the dedicated-domain webhook (the
    // recipient address) and the shared mailbox (`shared-mailbox-house.ts`).
    // Every read below is scoped to it. An event without one is refused
    // attribution (QA round 25): looking the sender up across every house and
    // taking the first row filed a letter to house A under house B's vendor
    // and order when both houses list the same vendor address. The letter is
    // kept for the operator, unattributed, never dropped and never guessed.
    const restaurantIdFromEvent: string | null =
      typeof payload.restaurant_id === "string" && payload.restaurant_id.trim()
        ? payload.restaurant_id.trim()
        : null;
    // ADR 0118 (retention) — which reading grant mirrored this message out of a
    // person's private mailbox, or null for the shared mailbox and the
    // dedicated-domain webhook, neither of which any personal grant covers.
    // Carried onto the row so a revocation can delete exactly the mail that
    // grant produced and nothing else. Published by
    // `HouseInboxService.readOneGrant`.
    const mirroredByGrantId: string | null =
      payload.mirrored_by_grant_id || null;

    // A From that names nobody (QA round 24, item 3) is not attributed to
    // anyone, and it is not dropped either: the letter is held in the
    // receiving house's "Who is writing" list, or for the operator when no
    // house is known, as one whose sender could not be read. The raw From
    // goes with it as the label, so a person can tell who it might be.
    if (!senderEmail) {
      this.logger.warn(
        "handleInboundEmail: From names no single unambiguous address; held, not attributed",
      );
      await this.holdLetter({
        restaurantId: restaurantIdFromEvent,
        heldReason: "sender_unreadable",
        senderEmail: null,
        senderName: rawFromLabel(from),
        subject,
        body,
        attachments,
        gmailMessageId,
        gmailThreadId,
      });
      return "held";
    }

    if (!restaurantIdFromEvent) {
      await this.holdUnattributed({
        senderEmail,
        senderName: displayLabel(sender),
        subject,
        body,
        attachments,
        gmailMessageId,
        gmailThreadId,
        why: payload.house_resolution || "no_house",
      });
      return "held";
    }
    const restaurantId: string = restaurantIdFromEvent;

    try {
      // 1. Find the vendor by any of its addresses, in the receiving house
      //    only, among vendors not removed (`findSenderVendor`).
      const provider = await this.findSenderVendor(restaurantId, senderEmail);
      if (!provider) {
        // What became of the letter, for its intake row. A sender outside the
        // book whose letter is not outreach is read and deliberately not kept
        // (the house's people outside the book are gap G4, not built here).
        let keptAs: IntakeOutcome = "not_kept";
        // D1 — cold email from an unknown sender. Capture GENUINE vendor outreach (a personal
        // intro / catalogue / wine offer, usually with an attachment) as a digest-only Prospect;
        // drop mass marketing blasts (bulk/list transport) so this never becomes a spam magnet.
        const isBulkBlast =
          transportSignals.bulk ||
          transportSignals.listMail ||
          transportSignals.autoSubmitted;
        const promotional = looksPromotional(subject, body);
        const looksOutreach = attachments.length > 0 || promotional;
        if (looksOutreach && !isBulkBlast) {
          // A display name carrying an address other than the sender's own
          // never becomes the prospect's label (QA round 6 N-1).
          const senderName = displayLabel(sender);
          // Provenance the manager can see: WHY this was captured.
          const captureReason =
            [
              attachments.length > 0 ? "attachment" : null,
              promotional ? "promotional" : null,
            ]
              .filter(Boolean)
              .join("+") || null;
          // Make the attachment chip real: persist bytes + keep refs on the prospect row.
          const persistedRefs = await this.persistProspectAttachments(
            this.prospects.domainOf(senderEmail),
            attachments,
          );
          const result = await this.prospects.captureFromColdEmail({
            senderEmail,
            senderName,
            subject,
            body,
            hasAttachments: attachments.length > 0,
            captureReason,
            attachments: persistedRefs,
            gmailMessageId: gmailMessageId || null,
            gmailThreadId: gmailThreadId || null,
            bodyPreview: body,
            // The receiving house, always set here (an event without one
            // was held above), so captureFromColdEmail never guesses one.
            restaurantId,
          });
          keptAs = result.captured
            ? "prospect"
            : result.duplicate
              ? "duplicate"
              : "not_kept";
          // Digest/notify parity with promotions — only for a NEW, attributed prospect. Triage
          // rows belong to no tenant, so there is no one to notify (they are logged instead).
          if (
            result.captured &&
            result.isNew &&
            !result.isTriage &&
            result.restaurantId
          ) {
            const label = senderName || this.prospects.domainOf(senderEmail);
            // Prospects (the "Strangers" of sketch 113) moved to
            // /communications under "Who is writing", and /promotions holds
            // offers only (ADR 0160, Open item 3, answered 2026-09-18 and
            // built 2026-09-19). The old link, /promotions?tab=prospects, pointed
            // at a tab that no longer exists, on a page staff are refused.
            // The audience is unchanged: GET /prospects is open to any member
            // (prospects.controller.ts).
            const message = `${label} reached out${attachments.length ? " with an attachment" : ""}. Review it in Communications, on the Mail tab under Who is writing.`;
            this.websocketGateway.emitRestaurantNotification(
              result.restaurantId,
              {
                id: `prospect-${result.restaurantId}-${Date.now()}`,
                title: `New vendor prospect: ${label}`,
                message,
                type: "info",
                action_url: WHO_IS_WRITING_URL,
              },
            );
            void this.inboundResponder.persistManagerNotification(
              result.restaurantId,
              {
                type: "prospect",
                title: `New vendor prospect: ${label}`,
                message,
                priority: "low",
                actionUrl: WHO_IS_WRITING_URL,
                metadata: { kind: "prospect", domain: result.domain },
              },
            );
          }
        } else {
          this.logger.warn(
            `handleInboundEmail: no provider found for ${senderEmail} (not leaded)`,
          );
        }
        return keptAs;
      }

      // 1b. The receiving server said this letter did not come from the
      //     vendor's domain (QA round 24, item 2). It is held in this house,
      //     never filed as the vendor's: a forged invoice must not reach the
      //     order it names. Verdict: `sender-authentication.ts`.
      if (
        senderUnconfirmed(payload.ingress_authentication_results, senderEmail)
      ) {
        this.logger.warn(
          `handleInboundEmail: the receiving server could not confirm ${senderEmail} sent this; held in house ${restaurantId}, not filed under vendor ${provider.id}`,
        );
        await this.holdLetter({
          restaurantId,
          heldReason: "sender_unconfirmed",
          senderEmail,
          senderName: displayLabel(sender),
          subject,
          body,
          attachments,
          gmailMessageId,
          gmailThreadId,
        });
        return "held";
      }

      // 2. Match order via the reply's gmail_thread_id, read from the thread's
      //    EARLIEST stored row (its origin).
      //
      // `orderId` takes the origin's order, so the reply's text joins the
      // order the thread is stored under; when that is none, 2b below guesses.
      //
      // `threadOrderId` is the order the thread NAMES, and only the attachment
      // refs take it. A thread names an order only when its origin is an
      // outbound row with no `email_headers.in_reply_to`: a row the house sent
      // first, not a reply. Two kinds of row can be that:
      // - a staged row (an order letter, or a staff letter held for release),
      //   stored before it is sent and given its gmail_thread_id only at send
      //   (procurement.service.ts approveDraft and the auto-send sweep);
      // - a manual reply or deal confirmation sent when its order has no
      //   inbound message to answer, stored after the send with the id
      //   already set. Its order is the one the staff sent on. Nothing makes
      //   the store land before a vendor reply into the new thread does; in
      //   practice the round trip orders them.
      // In a thread the vendor opened, the origin is the vendor's own inbound
      // row, whose order may be the 2b guess. Every row that later copies that
      // order into the thread (a responder draft, scheduled, approved or
      // auto-sent; a staff reply; a deal confirmation) is stored after it and
      // so cannot be the origin. A reply that opens a NEW Gmail thread is that
      // thread's origin, and its in_reply_to refuses it. A reply row stored
      // with no in_reply_to (a deal confirmation written before confirmDeal
      // recorded it, or any reply, a deal confirmation included, to an inbound
      // message that had no Message-ID) that opens a new thread still names
      // its order there. Rows written in one transaction share created_at; a
      // tie then breaks on id, a random UUID: arbitrary, but the same on every
      // read. Direction is compared lower-cased (stage_order_letter takes any).
      let orderId: string | null = null;
      let threadOrderId: string | null = null;
      let threadId: string | null = null;
      // A FAILED thread read is not "no thread" (ADR 0067). supabase-js
      // resolves a failed read with { data: null, error }, and reading that as
      // an empty thread would hand the reply to 2b, which guesses the vendor's
      // newest open order: the reply, the notice and the responder (which can
      // stage an AUTO_SEND_SCHEDULED reply on the order it is handed) would
      // all follow the guess, even when the thread names another order. So 2b
      // does not run, and the reply is stored with no order and marked
      // `email_headers.order_match: "thread_read_failed"`, so the row says the
      // match could not be read rather than that nothing matched. It is still
      // stored: the consumer acks before this handler settles and the
      // producers advance their cursors once the publish resolves, so a
      // return here would lose the mail. The row still joins its thread in
      // the house's view, which groups on thread_key ("gm:" + gmail_thread_id,
      // set by the insert trigger), not on thread_id.
      let threadReadFailed = false;

      if (gmailThreadId) {
        const { data: thread, error: threadError } =
          await this.databaseService.supabase
            .from("procurement_conversations")
            .select(
              "id, order_id, thread_id, restaurant_id, direction, email_headers",
            )
            .eq("gmail_thread_id", gmailThreadId)
            .eq("restaurant_id", restaurantId)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .limit(1);
        if (threadError) {
          threadReadFailed = true;
          this.logger.error(
            `handleInboundEmail: thread read failed for gmail_thread_id=${gmailThreadId} — ${threadError.message}; storing the reply with no order and not guessing one`,
          );
        }
        const origin = thread?.[0];
        if (origin) {
          orderId = origin.order_id;
          threadOrderId =
            String(origin.direction).toLowerCase() === "outbound" &&
            !origin.email_headers?.in_reply_to
              ? origin.order_id
              : null;
          threadId = origin.thread_id;
        }
      }

      // 2a. Match order via the letter it answers (r28 mail audit, gap 2).
      //     Order letters set Reply-To to the house's Mudavym address, and a
      //     letter that arrives there carries no Gmail thread, so step 2
      //     never ran for it and 2b filed it on the vendor's NEWEST open
      //     order: with two open orders, a price answer to order A landed on
      //     order B. Its In-Reply-To and References name the Message-IDs of
      //     the letters it answers, which the send stored on their rows
      //     (procurement.service.ts approveDraft and the auto-send sweep).
      //     The nearest answered letter of THIS house that carries an order
      //     gives the order, read the way step 2 reads its thread: `orderId`
      //     takes that letter's order (the text, the notice, the responder);
      //     `threadOrderId`, which the attachment refs take, only when that
      //     letter is one the house sent first (outbound, no in_reply_to of
      //     its own), since a reply's order may itself be the 2b guess. Also
      //     runs for a Gmail-door letter whose Gmail thread names no order.
      //     A failed read is not "nothing answered": as in step 2, 2b does
      //     not run and the row says so (`order_match: "answer_read_failed"`).
      let answerReadFailed = false;
      if (!orderId && !threadReadFailed) {
        const answered = answeredMessageIds(inReplyTo, references);
        if (answered.length) {
          const { data: named, error: namedError } =
            await this.databaseService.supabase
              .from("procurement_conversations")
              .select(
                "id, order_id, thread_id, direction, email_headers, message_id",
              )
              .eq("restaurant_id", restaurantId)
              .in("message_id", storedMessageIdShapes(answered))
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .limit(100);
          if (namedError) {
            answerReadFailed = true;
            this.logger.error(
              `handleInboundEmail: answered-letter read failed (${namedError.message}); storing the reply with no order and not guessing one`,
            );
          } else {
            const rows = (named ?? []) as Array<Record<string, any>>;
            for (const id of answered) {
              const hit = rows.find(
                (r) => r.order_id && bareMessageId(r.message_id) === id,
              );
              if (!hit) continue;
              orderId = hit.order_id;
              threadId = threadId ?? hit.thread_id ?? null;
              threadOrderId =
                String(hit.direction).toLowerCase() === "outbound" &&
                !hit.email_headers?.in_reply_to
                  ? hit.order_id
                  : null;
              this.logger.log(
                `handleInboundEmail: matched order ${orderId} by the letter it answers`,
              );
              break;
            }
          }
        }
      }

      // 2b. Fallback — vendors often reply in a fresh thread/subject rather than
      // hitting "reply", so the exact gmail_thread_id match above can miss even
      // though this is clearly a continuation of an active negotiation. Without
      // this, the reply's price update has no order to attach to, and the only
      // way forward looks like creating a brand-new order — producing a
      // duplicate for what is really the same negotiation. Fall back to the
      // most recent still-open order for this vendor+restaurant. Never after a
      // failed thread read (above): a failed read must not become a guess.
      if (!orderId && !threadReadFailed && !answerReadFailed) {
        const TERMINAL_ORDER_STATUSES = [
          "CONFIRMED",
          "IN_TRANSIT",
          "DELIVERED",
          "COMPLETED",
          "CANCELLED",
          "REJECTED",
          "FAILED",
        ];
        const { data: openOrders } = await this.databaseService.supabase
          .from("procurement_orders")
          .select("id, restaurant_id")
          .eq("provider_id", provider.id)
          .eq("restaurant_id", restaurantId)
          .not("status", "in", `(${TERMINAL_ORDER_STATUSES.join(",")})`)
          .order("requested_at", { ascending: false })
          .limit(1);
        if (openOrders?.[0]) {
          orderId = openOrders[0].id;
          this.logger.log(
            `handleInboundEmail: fallback-matched order ${orderId} for provider ${provider.id} (no gmail_thread_id hit)`,
          );
        }
      }

      // 3. Deduplicate — skip if same gmail_message_id already stored
      if (gmailMessageId) {
        const { data: existing } = await this.databaseService.supabase
          .from("procurement_conversations")
          .select("id")
          .eq("gmail_message_id", gmailMessageId)
          .limit(1);
        if (existing?.length) {
          this.logger.log(
            `handleInboundEmail: already stored gmail_message_id=${gmailMessageId}, skipping`,
          );
          return "duplicate";
        }
      }
      // 3b. A letter offered again (its intake row never heard back, gap G2)
      //     may already be stored: the first try can have stored it and then
      //     failed to say so. Its own intake id, written on the row below, is
      //     the key that holds for every door, including the inbound address
      //     whose events carry no Gmail id. Checked on EVERY try, not only
      //     when intake_attempt > 1: a house's "Read again" resets attempts
      //     to 0, so the claim publishes it as attempt 1, and a repeat
      //     delivery of an unsettled row is published as attempt 1 too.
      if (intakeId) {
        const { data: stored, error: storedError } =
          await this.databaseService.supabase
            .from("procurement_conversations")
            .select("id")
            .eq("restaurant_id", restaurantId)
            .eq("email_headers->>intake_id", intakeId)
            .limit(1);
        if (storedError) {
          throw new Error(
            `could not check whether intake ${intakeId} was already stored (${storedError.message})`,
          );
        }
        if (stored?.length) return "duplicate";
      }

      // 4. Store inbound row
      const { data: inserted, error } = await this.databaseService.supabase
        .from("procurement_conversations")
        .insert({
          order_id: orderId,
          restaurant_id: restaurantId,
          provider_id: provider.id,
          direction: "inbound",
          channel: "email",
          message_text: `Subject: ${subject}\n\n${body}`,
          ai_generated: false,
          received_at: receivedAt,
          delivery_status: "delivered",
          thread_id: threadId,
          gmail_thread_id: gmailThreadId || null,
          gmail_message_id: gmailMessageId || null,
          message_id: messageIdHeader || null,
          email_headers: {
            from,
            subject,
            message_id: messageIdHeader,
            in_reply_to: inReplyTo,
            references,
            ...(intakeId ? { intake_id: intakeId } : {}),
            gmail_thread_id: gmailThreadId,
            transport: transportSignals,
            ...(threadReadFailed ? { order_match: "thread_read_failed" } : {}),
            ...(answerReadFailed ? { order_match: "answer_read_failed" } : {}),
          },
          confidence_score: orderId ? 1.0 : null,
          mirrored_by_grant_id: mirroredByGrantId,
        })
        .select("id, thread_key")
        .single();

      if (error) {
        // Thrown, not only logged (gap G2): the intake row is marked failed
        // and the letter is offered again.
        throw new Error(`DB insert failed — ${error.message}`);
      }

      this.logger.log(
        `handleInboundEmail: stored inbound row ${inserted.id} (order=${orderId}, thread=${gmailThreadId})`,
      );

      // Persist attachment bytes to Storage + refs (D2) — best-effort, fire-and-forget.
      //
      // The attachment row takes `threadOrderId`, the order step 2 found this
      // reply's Gmail thread names, and never `orderId`. `orderId` may be the
      // 2b fallback's guess (this vendor's newest order whose status is not
      // terminal), or that guess read back from the inbound row an earlier
      // message in the same thread stored. `DocumentIntakeService
      // .sweepUningestedAttachments` hands `conversation_attachments.order_id`
      // to `ingest`, and `linkAndMatch` files a document that arrives with an
      // order as link_method "manual", confidence 1, and skips the PO-number
      // check, so a guess here would file an invoice against an order it may
      // not bill. With no order on the row, intake runs `autoLink`, which
      // links only when the PO number the document cites equals one of this
      // house's order numbers. The reply's text still carries `orderId` (the
      // row above, the notice and the responder below).
      void this.persistAttachments(
        inserted.id,
        threadOrderId,
        restaurantId,
        provider.id,
        attachments,
      );

      // Promotions lane (D3) — deterministic extract → provider_promotions + notify. Runs
      // for every provider-matched inbound; self-gates cheaply via the promo pre-filter.
      void this.promotionExtractor.extractAndStore({
        conversationId: inserted.id,
        restaurantId,
        providerId: provider.id,
        providerName: (provider as any).name ?? null,
        subject,
        body,
        transport: transportSignals,
      });

      // 5. Notify frontend
      this.websocketGateway.emitRestaurantNotification(restaurantId, {
        id: inserted.id,
        title: `New vendor email: ${subject.substring(0, 60)}`,
        message: `Reply received from ${senderEmail}`,
        type: "info",
        // A reply on an order opens the order, as before. A reply on no
        // order used to carry no link at all; it now opens the letter's
        // thread in Mail (r21), or the vendor's threads when the row has no
        // thread key.
        action_url: orderId
          ? `/orders?order=${orderId}`
          : mailThreadUrl(provider.id, (inserted as any).thread_key ?? null),
      });

      if (orderId) {
        this.websocketGateway.emitConversationUpdated(restaurantId, {
          conversation_id: inserted.id,
          order_id: orderId,
          provider_id: provider.id,
          direction: "inbound",
          channel: "email",
        });

        // 6. Hand off to the autonomous responder: understand the reply, decide
        //    the next move, and stage a one-tap-approve draft. Fire-and-forget —
        //    the responder swallows its own errors so inbound storage is never
        //    blocked by LLM latency or failures.
        void this.inboundResponder.analyzeAndDraftReply({
          inboundConversationId: inserted.id,
          orderId,
          restaurantId,
          providerId: provider.id,
          gmailThreadId: gmailThreadId || null,
          inboundRfc822MessageId: messageIdHeader || null,
          inboundReferences: references || null,
          inboundSubject: subject || null,
          inboundAttachments: attachments,
          transportSignals,
          correlationId,
        });
      }
      return "filed";
    } catch (err: any) {
      // Rethrown (gap G2): an error before the row was stored is a letter
      // without a home, and the caller keeps it for another try.
      this.logger.error(
        `handleInboundEmail: unexpected error — ${err?.message}`,
      );
      throw err;
    }
  }

  /**
   * D2 — persist inbound image/PDF attachments to the private `vendor-attachments`
   * Storage bucket and record refs in `conversation_attachments`. The vision flow still
   * uses the in-event base64; this runs alongside it so the manager can view what the AI
   * read and we keep a durable, deduped copy. Best-effort — never throws, never blocks.
   */
  private async persistAttachments(
    conversationId: string,
    orderId: string | null,
    restaurantId: string,
    providerId: string | null,
    attachments: Array<{ filename: string; mime_type: string; data: string }>,
  ): Promise<void> {
    if (!Array.isArray(attachments) || !attachments.length) return;
    for (const a of attachments) {
      try {
        if (!a?.data) continue;
        const buffer = Buffer.from(a.data, "base64");
        if (!buffer.length) continue;
        const sha256 = createHash("sha256").update(buffer).digest("hex");
        const safeName = (a.filename || "attachment")
          .replace(/[^\w.-]+/g, "_")
          .slice(0, 120);
        const path = `${restaurantId}/${conversationId}/${sha256.slice(0, 16)}-${safeName}`;
        const { error: upErr } = await this.databaseService.supabase.storage
          .from("vendor-attachments")
          .upload(path, buffer, {
            contentType: a.mime_type || "application/octet-stream",
            upsert: true,
          });
        if (upErr) {
          this.logger.warn(
            `persistAttachments: upload failed for ${safeName} — ${upErr.message}`,
          );
          continue;
        }
        await this.databaseService.supabase
          .from("conversation_attachments")
          .insert({
            conversation_id: conversationId,
            order_id: orderId,
            restaurant_id: restaurantId,
            provider_id: providerId,
            filename: a.filename || safeName,
            mime_type: a.mime_type || null,
            size_bytes: buffer.length,
            storage_path: path,
            sha256,
          });
      } catch (e: any) {
        this.logger.warn(
          `persistAttachments: failed for ${a?.filename} — ${e?.message}`,
        );
      }
    }
  }

  /**
   * A letter whose event names no receiving house (QA round 25): kept for
   * the operator in the unattributed bucket (email_prospects with no house,
   * listed by ProspectsService.listUnattributed for platform operators only),
   * whoever wrote it. No vendor, order, notice or responder: nothing is
   * filed against any house on its strength. Not gated on "looks like
   * outreach": a vendor's real letter must not vanish because it was plain.
   */
  private async holdUnattributed(letter: {
    senderEmail: string;
    senderName: string | null;
    subject: string;
    body: string;
    attachments: Array<{ filename: string; mime_type: string; data: string }>;
    gmailMessageId: string;
    gmailThreadId: string;
    why: string;
  }): Promise<void> {
    try {
      const refs = await this.persistProspectAttachments(
        this.prospects.domainOf(letter.senderEmail),
        letter.attachments,
      );
      const held = await this.prospects.holdUnattributed({
        senderEmail: letter.senderEmail,
        senderName: letter.senderName,
        subject: letter.subject,
        body: letter.body,
        hasAttachments: letter.attachments.length > 0,
        attachments: refs,
        gmailMessageId: letter.gmailMessageId || null,
        gmailThreadId: letter.gmailThreadId || null,
        why: letter.why,
      });
      this.logger.warn(
        `handleInboundEmail: no receiving house (${letter.why}); ${held.captured || held.duplicate ? "held unattributed for the operator" : "NOT held, see the prospects log"}, not filed under any house`,
      );
      if (!held.captured && !held.duplicate) {
        throw new Error("a letter with no receiving house could not be held");
      }
    } catch (err: any) {
      this.logger.error(
        `handleInboundEmail: no receiving house (${letter.why}) and holding the letter failed — ${err?.message}`,
      );
      // Thrown (gap G2): a letter that could not be held is offered again.
      throw err;
    }
  }

  /**
   * A letter kept for a person and filed under no vendor (QA round 24): its
   * sender could not be read, or the receiving server could not confirm it.
   * One row per letter in the house's "Who is writing" list (or the
   * operator's, with no house), with a notice to the house. Never an order,
   * a thread, an attachment for the books or a responder.
   */
  private async holdLetter(letter: {
    restaurantId: string | null;
    heldReason: "sender_unreadable" | "sender_unconfirmed";
    senderEmail: string | null;
    senderName: string | null;
    subject: string;
    body: string;
    attachments: Array<{ filename: string; mime_type: string; data: string }>;
    gmailMessageId: string;
    gmailThreadId: string;
  }): Promise<void> {
    try {
      const domain = letter.senderEmail
        ? this.prospects.domainOf(letter.senderEmail)
        : "";
      const refs = await this.persistProspectAttachments(
        domain,
        letter.attachments,
      );
      const held = await this.prospects.holdLetter({
        restaurantId: letter.restaurantId,
        heldReason: letter.heldReason,
        senderEmail: letter.senderEmail,
        senderName: letter.senderName,
        subject: letter.subject,
        body: letter.body,
        attachments: refs,
        gmailMessageId: letter.gmailMessageId || null,
        gmailThreadId: letter.gmailThreadId || null,
      });
      // Not kept and not already kept: the row was refused (gap G2). Thrown
      // so the letter is offered again rather than only logged.
      if (!held.captured && !held.duplicate) {
        throw new Error(`a ${letter.heldReason} letter could not be held`);
      }
      if (!held.captured || !held.isNew || !letter.restaurantId) return;
      const title =
        letter.heldReason === "sender_unconfirmed"
          ? `Could not confirm a letter came from ${letter.senderEmail}`
          : "A letter whose sender could not be read";
      const message =
        letter.heldReason === "sender_unconfirmed"
          ? `The receiving mail server could not confirm ${letter.senderEmail} sent "${letter.subject.slice(0, 80)}". It was not filed with that vendor. Review it in Communications, on the Mail tab under Who is writing.`
          : `"${letter.subject.slice(0, 80)}" arrived with a From that names no single address. It was not filed with any vendor. Review it in Communications, on the Mail tab under Who is writing.`;
      this.websocketGateway.emitRestaurantNotification(letter.restaurantId, {
        id: `held-${letter.restaurantId}-${Date.now()}`,
        title,
        message,
        type: "warning",
        action_url: WHO_IS_WRITING_URL,
      });
      void this.inboundResponder.persistManagerNotification(
        letter.restaurantId,
        {
          type: "prospect",
          title,
          message,
          priority:
            letter.heldReason === "sender_unconfirmed" ? "high" : "low",
          actionUrl: WHO_IS_WRITING_URL,
          metadata: { kind: "held_letter", held_reason: letter.heldReason },
        },
      );
    } catch (err: any) {
      this.logger.error(
        `handleInboundEmail: holding a letter (${letter.heldReason}) failed — ${err?.message}`,
      );
      throw err;
    }
  }

  /**
   * Persist cold-email (prospect) attachments to the private vendor-attachments bucket and
   * return refs to store on the prospect row. No conversation exists yet, so these live under a
   * `prospects/<domain>/` prefix, deduped by content hash. Best-effort — never throws.
   */
  private async persistProspectAttachments(
    domain: string,
    attachments: Array<{ filename: string; mime_type: string; data: string }>,
  ): Promise<
    Array<{
      filename: string;
      mime_type: string | null;
      size_bytes: number;
      storage_path: string;
      sha256: string;
    }>
  > {
    const out: Array<{
      filename: string;
      mime_type: string | null;
      size_bytes: number;
      storage_path: string;
      sha256: string;
    }> = [];
    if (!Array.isArray(attachments) || !attachments.length) return out;
    const safeDomain = (domain || "unknown")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 80);
    for (const a of attachments) {
      try {
        if (!a?.data) continue;
        const buffer = Buffer.from(a.data, "base64");
        if (!buffer.length) continue;
        const sha256 = createHash("sha256").update(buffer).digest("hex");
        const safeName = (a.filename || "attachment")
          .replace(/[^\w.-]+/g, "_")
          .slice(0, 120);
        const path = `prospects/${safeDomain}/${sha256.slice(0, 16)}-${safeName}`;
        const { error: upErr } = await this.databaseService.supabase.storage
          .from("vendor-attachments")
          .upload(path, buffer, {
            contentType: a.mime_type || "application/octet-stream",
            upsert: true,
          });
        if (upErr) {
          this.logger.warn(
            `persistProspectAttachments: upload failed for ${safeName} — ${upErr.message}`,
          );
          continue;
        }
        out.push({
          filename: a.filename || safeName,
          mime_type: a.mime_type || null,
          size_bytes: buffer.length,
          storage_path: path,
          sha256,
        });
      } catch (e: any) {
        this.logger.warn(
          `persistProspectAttachments: failed for ${a?.filename} — ${e?.message}`,
        );
      }
    }
    return out;
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
      direction: payload.direction || "inbound",
      channel: payload.channel || "email",
    });

    this.emitGenericEvent(restaurantId, "conversation_update", payload);
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

    this.emitGenericEvent(restaurantId, "conversation_update", payload);
  }

  private handleRecurringOrderReminder(msg: any): void {
    const restaurantId = msg?.restaurant_id || msg?.payload?.restaurant_id;
    if (!restaurantId) return;

    const payload = msg?.payload || msg;
    this.websocketGateway.emitRestaurantNotification(restaurantId, {
      id: payload.event_id || `recurring-${Date.now()}`,
      title: "Recurring Order Reminder",
      message:
        payload.message ||
        `Recurring order due in ${payload.days_until || 2} days`,
      type: "info",
      action_url: payload.action_url || "/orders?filter=recurring",
    });

    this.emitGenericEvent(restaurantId, "order_change", payload);
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

    this.emitGenericEvent(restaurantId, "calendar_change", payload);
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

    this.emitGenericEvent(restaurantId, "calendar_change", payload);
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
    this.websocketGateway.server?.to(room).emit("event:new", {
      id: payload?.event_id || `bridge-${Date.now()}`,
      eventType,
      sourcePage: "agent",
      restaurantId,
      payload,
      createdAt: new Date().toISOString(),
    });
  }

  private mapNotificationType(
    urgency: string,
  ): "info" | "success" | "warning" | "error" {
    switch (urgency?.toLowerCase()) {
      case "critical":
      case "error":
        return "error";
      case "high":
      case "warning":
        return "warning";
      case "success":
        return "success";
      default:
        return "info";
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

/**
 * A From that names nobody, as a label a person can read: control characters
 * out, whitespace folded, at most 200 characters. Shown only beside "could
 * not read who sent it", never as a sender.
 */
function rawFromLabel(from: string): string | null {
  const s = (from || "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s ? s.slice(0, 200) : null;
}
