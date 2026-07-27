import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
  forwardRef,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import { InboundResponderService } from "../common/orchestrator/inbound-responder.service";
import { InboundAddressService } from "../common/orchestrator/inbound-address.service";
import { GmailService } from "../communications/gmail.service";
import { WebsocketGateway } from "../websocket/websocket.gateway";
import { NotificationsService } from "../notifications/notifications.service";
import { EventType, SourcePage } from "../events/dto/event.dto";
import {
  CreateOrderDto,
  OrderFilterDto,
  OrderListResponseDto,
  OrderResponseDto,
  ProcurementOrderStatus,
  UpdateOrderDto,
  VerifyReceiptDto,
} from "./dto/procurement.dto";
import { computeMatch, isDiscrepancy } from "./invoice-match";
import { ApproveDraftDto } from "./dto/approve-draft.dto";

interface ProcurementOrderRow {
  id: string;
  order_number: string;
  restaurant_id: string;
  inventory_id: string;
  provider_id: string;
  quantity: number;
  unit_type: string | null;
  bottles_total: number | null;
  quoted_price: number | null;
  negotiated_price: number | null;
  final_price: number | null;
  total_cost: number | null;
  status: string;
  requested_at: string | null;
  approved_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  is_emergency: boolean | null;
  priority_level: number | null;
  wine_name?: string | null;
}

@Injectable()
export class ProcurementService {
  private readonly logger = new Logger(ProcurementService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventsService: EventsService,
    private readonly inventoryLedgerService: InventoryLedgerService,
    @Optional() private readonly orchestratorService?: OrchestratorService,
    @Optional() private readonly gmailService?: GmailService,
    @Optional() private readonly inboundResponder?: InboundResponderService,
    @Optional() private readonly websocketGateway?: WebsocketGateway,
    @Optional() private readonly inboundAddress?: InboundAddressService,
    @Optional()
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService?: NotificationsService,
  ) {}

  /**
   * Manually (re)run the autonomous responder for an order's most recent inbound
   * vendor reply: understand it, decide the next move, and stage a one-tap-approve
   * draft. Used to process replies that arrived before this feature existed and
   * to recover any that slipped through the live pipeline.
   */
  async generateAiReply(
    restaurantId: string,
    orderId: string,
    opts?: { instruction?: string; regenerate?: boolean; force?: boolean },
  ): Promise<{
    triggered: boolean;
    draftId?: string;
    needsApproval?: boolean;
    autoSendScheduled?: boolean;
    reason?: string;
  }> {
    if (!this.inboundResponder) {
      return { triggered: false, reason: "Responder service unavailable" };
    }

    // Confirm the order belongs to this restaurant.
    const { data: order } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("id, provider_id")
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .single();
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    // Regenerate: clear any waiting/scheduled draft so the responder writes a fresh one.
    if (opts?.regenerate) {
      await this.databaseService.supabase
        .from("procurement_conversations")
        .update({ status: "DISCARDED", scheduled_send_at: null })
        .eq("restaurant_id", restaurantId)
        .eq("order_id", orderId)
        .in("status", ["PENDING_APPROVAL", "AUTO_SEND_SCHEDULED"]);
    }

    // Find the most recent inbound vendor reply for this order.
    const { data: inbound } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select("id, provider_id, gmail_thread_id, message_id, email_headers")
      .eq("order_id", orderId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!inbound) {
      return {
        triggered: false,
        reason: "No inbound vendor reply found for this order",
      };
    }

    const row = inbound as any;
    const headers = (row.email_headers ?? {}) as Record<string, any>;
    // A7 — the live pipeline discarded attachment bytes after the first vision pass, so a
    // manual (re)generate used to lose all vision context. They're persisted now (D2), so
    // re-hydrate them from Storage and feed them back to the responder.
    const inboundAttachments = await this.loadPersistedAttachmentsForVision(
      restaurantId,
      row.id,
    );
    const result = await this.inboundResponder.analyzeAndDraftReply({
      inboundConversationId: row.id,
      orderId,
      restaurantId,
      providerId: row.provider_id || (order as any).provider_id,
      gmailThreadId: row.gmail_thread_id || null,
      inboundRfc822MessageId: row.message_id || headers.message_id || null,
      inboundReferences: headers.references || null,
      inboundSubject: headers.subject || null,
      inboundAttachments: inboundAttachments.length
        ? inboundAttachments
        : undefined,
      instruction: opts?.instruction,
      forceReply: opts?.force,
    });

    return {
      triggered: result.drafted,
      draftId: result.draftId,
      needsApproval: result.needsApproval,
      autoSendScheduled: result.autoSendScheduled,
      reason: result.reason,
    };
  }

  /**
   * Emit order_change event for cross-page sync
   */
  private async emitOrderChangeEvent(
    restaurantId: string,
    userId: string,
    order: OrderResponseDto,
    changeType:
      | "created"
      | "updated"
      | "approved"
      | "delivered"
      | "completed"
      | "cancelled",
  ): Promise<void> {
    try {
      await this.eventsService.createEvent(restaurantId, userId, {
        eventType: EventType.ORDER_CHANGE,
        sourcePage: SourcePage.ORDERS,
        payload: {
          type: changeType,
          orderId: order.id,
          orderNumber: order.orderNumber,
          inventoryId: order.inventoryId,
          providerId: order.providerId,
          quantity: order.quantity,
          status: order.status,
          totalCost: order.totalCost,
        },
      });
      this.logger.log("Order change event emitted", {
        orderId: order.id,
        type: changeType,
      });
    } catch (error) {
      this.logger.warn("Failed to emit order change event", {
        error: error.message,
      });
      // Don't fail the operation if event emission fails
    }
  }

  async createOrder(
    restaurantId: string,
    userId: string,
    dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    // Guard: restaurant must have at least one active provider before placing orders
    const { count: providerCount, error: countError } =
      await this.databaseService.supabase
        .from("providers")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true);

    if (countError) {
      this.logger.error("Failed to count active providers", {
        restaurantId,
        error: countError.message,
      });
      throw new InternalServerErrorException(
        "Could not verify vendor availability. Please try again.",
      );
    }
    if (providerCount === 0) {
      throw new ForbiddenException({
        reason: "no_vendors",
        message: "You must add at least one vendor before placing orders.",
        redirect: "/providers",
      });
    }

    const finalPrice = dto.finalPrice ?? dto.quotedPrice ?? 0;
    const totalCost = dto.totalCost ?? finalPrice * dto.quantity;
    const bottlesTotal = dto.quantity;

    // Dedup guard: a price/quantity change for the same wine+vendor should
    // update the existing open order, not spawn a second one. Match on
    // restaurant + inventory + provider, excluding orders already past
    // negotiation (confirmed/delivered/cancelled/rejected/failed).
    const TERMINAL_STATUSES = [
      ProcurementOrderStatus.CONFIRMED,
      ProcurementOrderStatus.IN_TRANSIT,
      ProcurementOrderStatus.DELIVERED,
      ProcurementOrderStatus.COMPLETED,
      ProcurementOrderStatus.CANCELLED,
      ProcurementOrderStatus.REJECTED,
      ProcurementOrderStatus.FAILED,
    ];

    const { data: existingRows, error: existingError } =
      await this.databaseService.supabase
        .from("procurement_orders")
        .select("*, inventory:inventory_id(wine_name)")
        .eq("restaurant_id", restaurantId)
        .eq("inventory_id", dto.inventoryId)
        .eq("provider_id", dto.providerId ?? "")
        .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
        .order("requested_at", { ascending: false })
        .limit(1);

    if (existingError) {
      this.logger.warn("Dedup lookup for procurement order failed", {
        restaurantId,
        error: existingError.message,
      });
    }

    const existing = existingRows?.[0] as any | undefined;

    if (existing && dto.providerId) {
      const { data: updated, error: updateError } =
        await this.databaseService.supabase
          .from("procurement_orders")
          .update({
            quantity: dto.quantity,
            unit_type: dto.unitType ?? "bottles",
            bottles_total: bottlesTotal,
            quoted_price: dto.quotedPrice ?? existing.quoted_price ?? null,
            negotiated_price:
              dto.negotiatedPrice ?? existing.negotiated_price ?? null,
            final_price: finalPrice,
            total_cost: totalCost,
            is_emergency: dto.isEmergency ?? existing.is_emergency,
            priority_level: dto.priorityLevel ?? existing.priority_level,
            manager_notes: dto.managerNotes ?? existing.manager_notes,
            expected_delivery_date:
              dto.expectedDeliveryDate ?? existing.expected_delivery_date,
          })
          .eq("id", existing.id)
          .select("*, inventory:inventory_id(wine_name)")
          .single();

      if (updateError) {
        this.logger.error("Failed to update existing procurement order", {
          restaurantId,
          orderId: existing.id,
          error: updateError.message,
        });
        throw updateError;
      }

      this.logger.log("Merged order request into existing open order", {
        restaurantId,
        orderId: existing.id,
        inventoryId: dto.inventoryId,
        providerId: dto.providerId,
      });

      const updatedRow = updated as any;
      const mergedRow: ProcurementOrderRow = {
        ...updatedRow,
        wine_name:
          updatedRow.inventory?.wine_name ||
          (updatedRow.inventory as any)?.wine?.name ||
          null,
      };
      const mergedOrder = this.mapOrderRow(mergedRow);
      await this.emitOrderChangeEvent(
        restaurantId,
        userId,
        mergedOrder,
        "updated",
      );
      return mergedOrder;
    }

    const orderNumber = this.generateOrderNumber();

    const payload = {
      order_number: orderNumber,
      restaurant_id: restaurantId,
      inventory_id: dto.inventoryId,
      provider_id: dto.providerId,
      quantity: dto.quantity,
      unit_type: dto.unitType ?? "bottles",
      bottles_total: bottlesTotal,
      quoted_price: dto.quotedPrice ?? null,
      negotiated_price: dto.negotiatedPrice ?? null,
      final_price: finalPrice,
      total_cost: totalCost,
      status: ProcurementOrderStatus.PENDING,
      requested_at: new Date().toISOString(),
      is_emergency: dto.isEmergency ?? false,
      priority_level: dto.priorityLevel ?? 5,
      manager_notes: dto.managerNotes ?? null,
      expected_delivery_date: dto.expectedDeliveryDate ?? null,
    };

    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .insert(payload)
      .select("*, inventory:inventory_id(wine_name)")
      .single();

    if (error) {
      this.logger.error("Failed to create procurement order", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name:
        row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    };

    const order = this.mapOrderRow(orderRow);

    // Emit order_change event for cross-page sync
    await this.emitOrderChangeEvent(restaurantId, userId, order, "created");

    // Phase 32: Trigger silent AI draft pre-computation when provider_id is set (D-32-01)
    if (dto.providerId && this.orchestratorService) {
      // Resolve provider name and restaurant name in parallel.
      let resolvedProviderName = "";
      let resolvedRestaurantName = "";
      try {
        const [provResult, restResult] = await Promise.all([
          this.databaseService.supabase
            .from("providers")
            .select("name")
            .eq("id", dto.providerId)
            .eq("restaurant_id", restaurantId)
            .single(),
          this.databaseService.supabase
            .from("restaurants")
            .select("name")
            .eq("id", restaurantId)
            .single(),
        ]);
        resolvedProviderName = (provResult.data as any)?.name || "";
        resolvedRestaurantName = (restResult.data as any)?.name || "";
      } catch {
        /* non-fatal */
      }

      const draftPayload = {
        order_id: order.id,
        order_number: order.orderNumber || "",
        restaurant_id: restaurantId,
        provider_id: dto.providerId,
        provider_name: resolvedProviderName,
        wine_name: order.wineName || "",
        quantity: order.quantity,
        target_price_per_bottle: dto.quotedPrice ?? null,
        urgency: dto.isEmergency ? "urgent" : "normal",
        restaurant_name: resolvedRestaurantName,
      };

      // Primary path: direct HTTP POST to the Python orchestrator.
      // This is the only path that gives guaranteed delivery — RabbitMQ publish
      // succeeds even when no consumer is listening, so relying on it as the
      // sole trigger silently drops drafts.
      try {
        await this.orchestratorService.triggerDraftHttp(draftPayload);
        this.logger.log(`AI draft triggered via HTTP for order ${order.id}`);
      } catch (httpErr: any) {
        this.logger.error(
          `[createOrder] HTTP draft trigger failed for order ${order.id} ` +
            `(restaurant ${restaurantId}). Error: ${httpErr?.message}. ` +
            `Ensure AGENT_ORCHESTRATOR_URL and ADMIN_API_KEY are set in Railway env vars.`,
        );
      }

      // Secondary: also publish to RabbitMQ for any async consumers (best-effort).
      try {
        await this.orchestratorService.publishEvent(
          "procurement.events",
          "procurement.order.created",
          draftPayload,
        );
      } catch {
        /* non-fatal — RabbitMQ is optional */
      }
    }

    return order;
  }

  async listOrders(
    restaurantId: string,
    query: OrderFilterDto,
  ): Promise<OrderListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const fromIndex = (page - 1) * limit;
    const toIndex = fromIndex + limit - 1;

    let supabaseQuery = this.databaseService.supabase
      .from("procurement_orders")
      .select("*, inventory:inventory_id(wine_name)", { count: "exact" })
      .eq("restaurant_id", restaurantId);

    if (query.status) {
      supabaseQuery = supabaseQuery.eq("status", query.status);
    }

    if (query.providerId) {
      supabaseQuery = supabaseQuery.eq("provider_id", query.providerId);
    }

    if (query.dateFrom) {
      supabaseQuery = supabaseQuery.gte("created_at", query.dateFrom);
    }

    if (query.dateTo) {
      supabaseQuery = supabaseQuery.lte("created_at", query.dateTo);
    }

    const { data, error, count } = await supabaseQuery
      .order("created_at", { ascending: false })
      .range(fromIndex, toIndex);

    if (error) {
      this.logger.error("Failed to list procurement orders", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    const orders = (data || []).map((row: any) => {
      const orderRow: ProcurementOrderRow = {
        ...row,
        wine_name:
          row.inventory?.wine_name ||
          (row.inventory as any)?.wine?.name ||
          null,
      };
      return this.mapOrderRow(orderRow);
    });
    const total = count ?? orders.length;

    return {
      orders,
      total,
      page,
      limit,
      hasMore: fromIndex + orders.length < total,
    };
  }

  async getOrder(
    restaurantId: string,
    orderId: string,
  ): Promise<OrderResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("*, inventory:inventory_id(wine_name)")
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .single();

    if (error) {
      this.logger.error("Failed to fetch procurement order", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name:
        row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    };

    return this.mapOrderRow(orderRow);
  }

  async updateOrder(
    restaurantId: string,
    orderId: string,
    dto: UpdateOrderDto,
  ): Promise<OrderResponseDto> {
    // D-06: Block location assignment while order is in a pending state.
    if (dto.locationId !== undefined) {
      const BLOCKED_STATUSES = [
        ProcurementOrderStatus.PENDING,
        ProcurementOrderStatus.APPROVAL_NEEDED,
        ProcurementOrderStatus.NEGOTIATING,
      ];
      const { data: existing, error: fetchError } =
        await this.databaseService.supabase
          .from("procurement_orders")
          .select("status")
          .eq("restaurant_id", restaurantId)
          .eq("id", orderId)
          .single();

      if (
        !fetchError &&
        existing &&
        BLOCKED_STATUSES.includes((existing as any).status)
      ) {
        throw new UnprocessableEntityException({
          reason: "order_not_approved",
          message: "Location can only be assigned after the order is approved.",
        });
      }
    }

    const updatePayload: Record<string, any> = {
      status: dto.status ?? undefined,
      quoted_price: dto.quotedPrice ?? undefined,
      negotiated_price: dto.negotiatedPrice ?? undefined,
      final_price: dto.finalPrice ?? undefined,
      total_cost: dto.totalCost ?? undefined,
      manager_notes: dto.managerNotes ?? undefined,
      rejection_reason: dto.rejectionReason ?? undefined,
      delivery_notes: dto.deliveryNotes ?? undefined,
      tracking_number: dto.trackingNumber ?? undefined,
      quantity_received: dto.quantityReceived ?? undefined,
      price_verified: dto.priceVerified ?? undefined,
      invoice_image_url: dto.invoiceImageUrl ?? undefined,
      discrepancy_notes: dto.discrepancyNotes ?? undefined,
      location_id: dto.locationId ?? undefined,
    };

    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update(updatePayload)
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .select("*, inventory:inventory_id(wine_name)")
      .single();

    if (error) {
      this.logger.error("Failed to update procurement order", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name:
        row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    };

    return this.mapOrderRow(orderRow);
  }

  async cancelOrder(
    restaurantId: string,
    orderId: string,
    userId: string,
    reason?: string,
  ): Promise<OrderResponseDto> {
    // Capture current order state BEFORE cancelling so we can decide
    // whether to release shadow stock (only if order was in an active state).
    const { data: preCancelRow } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("status, inventory_id, quantity")
      .eq("id", orderId)
      .single();

    const order = await this.updateOrder(restaurantId, orderId, {
      status: ProcurementOrderStatus.CANCELLED,
      rejectionReason: reason,
    });

    // D-10: Cascade PENDING_APPROVAL conversations to CANCELLED so they don't
    // appear in the active conversations panel after order cancellation.
    try {
      await this.databaseService.supabase
        .from("procurement_conversations")
        .update({ status: "CANCELLED" })
        .eq("restaurant_id", restaurantId)
        .eq("order_id", orderId)
        .eq("status", "PENDING_APPROVAL");
      this.logger.log(
        `Cascaded PENDING_APPROVAL conversations to CANCELLED for order ${orderId}`,
      );
    } catch (cascadeError: any) {
      this.logger.warn(
        `cancelOrder conversation cascade failed (non-fatal): ${cascadeError?.message}`,
      );
    }

    // Cancel any pending calendar delivery event linked to this order.
    await this.cancelCalendarEventForOrder(restaurantId, orderId);

    // Release shadow stock if the order had already been approved/sent and
    // inventory was reserved (shadow_stock was incremented for this order).
    const preStatus = (preCancelRow as any)?.status ?? "";
    const RESERVED_STATUSES = [
      ProcurementOrderStatus.APPROVED,
      ProcurementOrderStatus.CONFIRMED,
      ProcurementOrderStatus.IN_TRANSIT,
    ];
    if (
      order.inventoryId &&
      order.quantity &&
      RESERVED_STATUSES.includes(preStatus as ProcurementOrderStatus)
    ) {
      await this.releaseOrderShadowStock(
        restaurantId,
        order.inventoryId,
        order.quantity,
      );
    }

    // Emit order_change event for cross-page sync
    await this.emitOrderChangeEvent(restaurantId, userId, order, "cancelled");

    return order;
  }

  /** Cancel the calendar delivery event tagged with orderId (non-fatal). */
  private async cancelCalendarEventForOrder(
    restaurantId: string,
    orderId: string,
  ): Promise<void> {
    try {
      const { data: events } = await this.databaseService.supabase
        .from("calendar_events")
        .select("id, tags")
        .eq("restaurant_id", restaurantId)
        .eq("event_type", "delivery")
        .not("status", "in", '("COMPLETED","CANCELLED")');

      const match = (events || []).find((e) => {
        try {
          const tags = typeof e.tags === "string" ? JSON.parse(e.tags) : e.tags;
          return tags?.order_id === orderId;
        } catch {
          return false;
        }
      });

      if (match) {
        await this.databaseService.supabase
          .from("calendar_events")
          .update({
            status: "CANCELLED",
            description: `Order ${orderId} was cancelled.`,
          })
          .eq("id", (match as any).id);
        this.logger.log(`Calendar event cancelled for order ${orderId}`);
      }
    } catch (e: any) {
      this.logger.warn(`cancelCalendarEventForOrder failed: ${e?.message}`);
    }
  }

  /** Subtract order quantity from shadow_stock + in_transit_quantity, flooring at 0. Non-fatal. */
  private async releaseOrderShadowStock(
    restaurantId: string,
    inventoryId: string,
    quantity: number,
  ): Promise<void> {
    try {
      // Shadow stock is a projection of inventory_lots — release via the ledger RPC, clamped
      // to what is actually on-order (floor at 0). in_transit_quantity is a separate display counter.
      const { data: inv } = await this.databaseService.supabase
        .from("restaurant_inventory")
        .select("shadow_stock, in_transit_quantity")
        .eq("restaurant_id", restaurantId)
        .eq("id", inventoryId)
        .single();

      if (inv) {
        const currentShadow = (inv as any).shadow_stock ?? 0;
        const currentInTransit = (inv as any).in_transit_quantity ?? 0;
        const release = Math.min(quantity, currentShadow);
        if (release > 0) {
          const { error } = await this.databaseService.supabase.rpc(
            "apply_stock_movement",
            {
              p_inventory_id: inventoryId,
              p_stock_state: "shadow",
              p_delta: -release,
              p_transaction_type: "adjustment",
              p_source: "order",
              p_reason: "released on order close",
            },
          );
          if (error) throw new Error(error.message);
        }
        await this.databaseService.supabase
          .from("restaurant_inventory")
          .update({
            in_transit_quantity: Math.max(0, currentInTransit - quantity),
          })
          .eq("restaurant_id", restaurantId)
          .eq("id", inventoryId);
        this.logger.log(
          `Released ${quantity} shadow/in-transit stock for inventory ${inventoryId}`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`releaseOrderShadowStock failed: ${e?.message}`);
    }
  }

  /** Add order quantity to shadow_stock + in_transit_quantity (marks stock as "on order"). Non-fatal. */
  private async reserveOrderShadowStock(
    restaurantId: string,
    inventoryId: string,
    quantity: number,
  ): Promise<void> {
    try {
      // Shadow stock is a projection of inventory_lots — reserve via the ledger RPC (creates a
      // shadow lot). in_transit_quantity is a separate denormalized display counter.
      const { error } = await this.databaseService.supabase.rpc(
        "apply_stock_movement",
        {
          p_inventory_id: inventoryId,
          p_stock_state: "shadow",
          p_delta: quantity,
          p_transaction_type: "purchase",
          p_source: "order",
          p_reason: "reserved on order placement",
        },
      );
      if (error) throw new Error(error.message);

      const { data: inv } = await this.databaseService.supabase
        .from("restaurant_inventory")
        .select("in_transit_quantity")
        .eq("restaurant_id", restaurantId)
        .eq("id", inventoryId)
        .single();
      await this.databaseService.supabase
        .from("restaurant_inventory")
        .update({
          in_transit_quantity:
            ((inv as any)?.in_transit_quantity ?? 0) + quantity,
        })
        .eq("restaurant_id", restaurantId)
        .eq("id", inventoryId);
      this.logger.log(
        `Reserved ${quantity} shadow/in-transit stock for inventory ${inventoryId}`,
      );
    } catch (e: any) {
      this.logger.warn(`reserveOrderShadowStock failed: ${e?.message}`);
    }
  }

  async approveOrder(
    restaurantId: string,
    orderId: string,
    userId: string,
  ): Promise<OrderResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update({
        status: ProcurementOrderStatus.APPROVED,
        approved_at: new Date().toISOString(),
        approved_by: userId,
      })
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .select("*, inventory:inventory_id(wine_name)")
      .single();

    if (error) {
      this.logger.error("Failed to approve procurement order", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name:
        row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    };

    const order = this.mapOrderRow(orderRow);

    // Reserve shadow stock so managers can see "X bottles on order" before delivery.
    if (order.inventoryId && order.quantity) {
      await this.reserveOrderShadowStock(
        restaurantId,
        order.inventoryId,
        order.quantity,
      );
    }

    // NOTE: Calendar event is intentionally NOT created here.
    // It is created in approveDraft(), only after the manager reviews and approves
    // the outbound email to the provider — ensuring the calendar reflects
    // confirmed provider communication, not just internal approval.

    // Emit order_change event for cross-page sync
    await this.emitOrderChangeEvent(restaurantId, userId, order, "approved");

    // Trigger AI to draft vendor email via ProviderConversationAgent
    if (this.orchestratorService) {
      try {
        await this.orchestratorService.publishEvent(
          "procurement.events",
          "procurement.conversation_request",
          {
            intent_type: "order_inquiry",
            order_id: orderId,
            provider_id: (data as ProcurementOrderRow).provider_id,
            restaurant_id: restaurantId,
            wine_name: order.wineName || "",
            quantity: order.quantity,
            target_price: order.negotiatedPrice || order.quotedPrice || 0,
            max_acceptable_price:
              (order.negotiatedPrice || order.quotedPrice || 0) * 1.1,
            urgency: order.isEmergency ? "high" : "normal",
            channel_preference: "email",
          },
        );
        this.logger.log(`Conversation intent published for order ${orderId}`);
      } catch (err: any) {
        this.logger.error(
          `Failed to publish conversation intent: ${err?.message}`,
        );
      }
    }

    return order;
  }

  async markDelivered(
    restaurantId: string,
    orderId: string,
    userId: string,
    quantityReceived?: number,
  ): Promise<OrderResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update({
        status: ProcurementOrderStatus.DELIVERED,
        delivered_at: new Date().toISOString(),
        received_by: userId,
        quantity_received: quantityReceived ?? null,
      })
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .select("*, inventory:inventory_id(wine_name)")
      .single();

    if (error) {
      this.logger.error("Failed to mark procurement order delivered", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name:
        row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    };

    const order = this.mapOrderRow(orderRow);

    const resolvedQuantity = quantityReceived ?? order.quantity ?? 0;

    if (!order.inventoryId) {
      this.logger.warn(
        `markDelivered: order ${orderId} has no inventoryId — stock update skipped`,
      );
    } else if (resolvedQuantity <= 0) {
      this.logger.warn(
        `markDelivered: order ${orderId} resolved quantity is ${resolvedQuantity} — stock update skipped`,
      );
    }

    if (order.inventoryId && resolvedQuantity > 0) {
      const idempotencyKey = `order-delivered:${orderId}`;
      const { data: existingEvent } = await this.databaseService.supabase
        .from("inventory_events")
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (!existingEvent) {
        try {
          const { data: inventoryRow, error: inventoryError } =
            await this.databaseService.supabase
              .from("restaurant_inventory")
              .select("master_wine_id")
              .eq("restaurant_id", restaurantId)
              .eq("id", order.inventoryId)
              .single();

          const masterWineId = inventoryError
            ? null
            : inventoryRow?.master_wine_id;

          if (masterWineId) {
            // Move shadow -> live through the ledger RPC (lots = source of truth). Two idempotent
            // movements: release the reserved shadow, then receive the physical lot at cost.
            const { data: currentStock } = await this.databaseService.supabase
              .from("restaurant_inventory")
              .select("shadow_stock, in_transit_quantity")
              .eq("restaurant_id", restaurantId)
              .eq("id", order.inventoryId)
              .single();

            const currentShadow = currentStock?.shadow_stock ?? 0;
            const currentInTransit = currentStock?.in_transit_quantity ?? 0;
            const shadowRelease = Math.min(resolvedQuantity, currentShadow);
            const unitCost = row.final_price ?? row.suggested_price ?? null;

            if (shadowRelease > 0) {
              await this.databaseService.supabase.rpc("apply_stock_movement", {
                p_inventory_id: order.inventoryId,
                p_stock_state: "shadow",
                p_delta: -shadowRelease,
                p_transaction_type: "adjustment",
                p_source: "order",
                p_reason: "shadow released on delivery",
                p_order_id: orderId,
                p_idempotency_key: `order-delivered-shadow:${orderId}`,
              });
            }
            await this.databaseService.supabase.rpc("apply_stock_movement", {
              p_inventory_id: order.inventoryId,
              p_stock_state: "live",
              p_delta: resolvedQuantity,
              p_transaction_type: "purchase",
              p_source: "order",
              p_reason: "order delivered — physical receipt",
              p_unit_cost: unitCost,
              p_order_id: orderId,
              p_idempotency_key: `order-delivered-live:${orderId}`,
            });

            // in_transit_quantity is a separate denormalized display counter.
            await this.databaseService.supabase
              .from("restaurant_inventory")
              .update({
                in_transit_quantity: Math.max(
                  0,
                  currentInTransit - resolvedQuantity,
                ),
              })
              .eq("restaurant_id", restaurantId)
              .eq("id", order.inventoryId);
          }

          await this.databaseService.supabase.from("inventory_events").insert({
            restaurant_id: restaurantId,
            inventory_id: order.inventoryId,
            master_wine_id: masterWineId ?? null,
            event_type: "order_delivered",
            quantity_change: resolvedQuantity,
            source: "procurement",
            idempotency_key: idempotencyKey,
            metadata: {
              orderId,
              deliveredAt: order.deliveredAt,
            },
          });
        } catch (eventError) {
          this.logger.warn(
            "Failed to record inventory event for delivered order",
            {
              orderId,
              error: eventError?.message ?? eventError,
            },
          );
        }
      }
    }

    // Update calendar event to COMPLETED on delivery
    await this.updateCalendarEventForDelivery(restaurantId, orderId, order);

    // Emit order_change event for cross-page sync (triggers inventory update)
    await this.emitOrderChangeEvent(restaurantId, userId, order, "delivered");

    // Pinned receipt-verification task: stock is already in (above), but a human
    // must confirm the physical count against the vendor's digital invoice.
    // Critical priority keeps it at the top of the inbox until verified; the
    // group key lets verifyReceipt() resolve it for every member at once.
    if (this.notificationsService) {
      await this.notificationsService.persistForRestaurant(
        restaurantId,
        {
          type: "invoice_received",
          title: `Verify delivery: ${order.wineName || order.orderNumber || "order"}`,
          message: `${resolvedQuantity} bottles stocked in. Confirm the physical count against the vendor invoice.`,
          priority: "critical",
          actionUrl: `/inventory?verify=${orderId}`,
          actionLabel: "Verify receipt",
          groupKey: `receipt_verify:${orderId}`,
          metadata: {
            orderId,
            inventoryId: order.inventoryId,
            wineName: order.wineName,
            quantity: resolvedQuantity,
            providerId: order.providerId,
          },
        },
        { dedupeWithinMinutes: 24 * 60 },
      );
    }

    return order;
  }

  /**
   * Apply one signed correction to live stock through the ledger.
   * The idempotency key is per (order, inventory) so a replayed request — the mobile
   * outbox retries — can never double-count.
   */
  /**
   * @param unitCost What the bottle VERIFIABLY cost, from the invoice — landed,
   *   including allocated freight and fees. Passing it is the difference between
   *   a match that means something and a match that is decoration: without it
   *   apply_stock_movement writes cost_provenance='estimated' and the lot keeps
   *   the price we hoped for at ordering time, so catching a $2 overcharge
   *   changes a badge on a screen and leaves inventory valuation, WAC, pour cost
   *   and COGS all still quoting the old number.
   */
  private async applyReceiptAdjustment(
    orderId: string,
    inventoryId: string,
    delta: number,
    reason: string,
    unitCost?: number | null,
  ): Promise<void> {
    const { error } = await this.databaseService.supabase.rpc(
      "apply_stock_movement",
      {
        p_inventory_id: inventoryId,
        p_stock_state: "live",
        p_delta: delta,
        p_transaction_type: "adjustment",
        p_source: "receiving",
        p_reason: reason,
        p_unit_cost: unitCost ?? null,
        p_order_id: orderId,
        p_idempotency_key: `receipt-verify:${orderId}:${inventoryId}`,
      },
    );
    if (error) {
      this.logger.error(
        `verifyReceipt adjustment failed for ${inventoryId}: ${error.message}`,
      );
      throw new UnprocessableEntityException(
        `Adjustment failed for item ${inventoryId}: ${error.message}`,
      );
    }
  }

  /**
   * RECEIPT VERIFICATION — three-way match (PO <-> Invoice <-> Receipt).
   *
   * Delivery already stocked bottles in at invoice quantity; this is the audit layer that
   * reconciles what we ordered, what the vendor billed, and what physically arrived.
   * computeMatch() decides the verdict server-side — the client never dictates the outcome.
   *
   * Two payload shapes are supported on purpose:
   *  - Legacy `{ adjustments }` only: the mobile receive screen queues requests in an
   *    offline outbox, so payloads composed before this shipped can still arrive. They keep
   *    exactly the old behavior (apply deltas, complete the order).
   *  - Match payload: quantities/prices are reconciled, the order completes or stays open
   *    as PARTIALLY_RECEIVED with a backorder, and any discrepancy alerts the manager.
   */
  async verifyReceipt(
    restaurantId: string,
    orderId: string,
    userId: string,
    body: VerifyReceiptDto,
  ): Promise<OrderResponseDto> {
    const adjustments = (body.adjustments || []).filter(
      (a) => a.inventoryId && Number.isFinite(a.delta) && a.delta !== 0,
    );

    const hasMatchFields =
      body.acceptedQuantity != null ||
      body.invoiceQuantity != null ||
      body.invoiceUnitPrice != null ||
      body.rejectedQuantity != null;

    const { data: orderRow, error: fetchError } =
      await this.databaseService.supabase
        .from("procurement_orders")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("id", orderId)
        .single();

    if (fetchError || !orderRow) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    // What markDelivered already pushed into the ledger; corrections are relative to it.
    const stockedQty =
      (orderRow as any).quantity_received ?? (orderRow as any).quantity ?? 0;
    const orderedQty = (orderRow as any).quantity ?? 0;
    const poUnitPrice =
      (orderRow as any).final_price ??
      (orderRow as any).negotiated_price ??
      (orderRow as any).quoted_price ??
      null;

    // Silence is NOT agreement. An unstated invoice used to be inferred from the
    // PO, which had two consequences: physical_vs_bill compared a number to
    // itself and always passed, and price_verified=true was written for a
    // delivery where nobody had looked at a document. That is a manufactured
    // audit assertion in a column a customer will lean on in a vendor dispute.
    // Absent now means absent, and the verdict comes back `unmatched`.
    const match = hasMatchFields
      ? computeMatch({
          orderedQty,
          poUnitPrice,
          shippedQty: body.shippedQuantity ?? null,
          invoiceQty: body.invoiceQuantity ?? null,
          invoiceUnitPrice: body.invoiceUnitPrice ?? null,
          acceptedQty: body.acceptedQuantity ?? stockedQty,
          rejectedQty: body.rejectedQuantity ?? 0,
          freeGoodsQty: body.freeGoodsQuantity ?? 0,
          allocatedCharges: body.allocatedCharges ?? 0,
          priceOverrideReason: body.priceOverrideReason ?? null,
          stockedQty,
        })
      : null;
    const hasInvoice = body.invoiceQuantity != null;

    // A price that differs from the agreed one is never accepted silently (D-B).
    if (match?.requiresOverride) {
      throw new UnprocessableEntityException(
        `${match.summary} Accept the price difference with a reason, or correct the invoice price.`,
      );
    }

    // Correct the ordered line to the accepted count, then apply any unlisted extras.
    if (match && match.ledgerDelta !== 0 && (orderRow as any).inventory_id) {
      await this.applyReceiptAdjustment(
        orderId,
        (orderRow as any).inventory_id,
        match.ledgerDelta,
        `receipt verification for order ${orderId}: ${match.summary}`,
        // Verified landed cost, so the corrected lot carries what the bottle
        // really cost rather than what we expected it to.
        match.effectiveUnitCost,
      );
    }

    for (const adj of adjustments) {
      // Skip the ordered line when the match already corrected it.
      if (match && adj.inventoryId === (orderRow as any).inventory_id) continue;
      await this.applyReceiptAdjustment(
        orderId,
        adj.inventoryId,
        adj.delta,
        adj.reason ||
          `receipt verification for order ${orderId}${body.note ? `: ${body.note}` : ""}`,
      );
    }

    // Accepting less than was ordered keeps the order open, so the outstanding bottles stay
    // visible as a backorder instead of stranding phantom shadow stock (D17).
    // An order also stays open when no invoice has arrived. Many distributors
    // bill weekly in arrears — the paper at the door is a packing slip with no
    // prices — so closing on the goods alone would mark the delivery finished
    // before anyone could check what was charged for it, and reconciling late
    // is exactly where the recoverable money lives.
    const awaitingInvoice = match?.verdict === "unmatched";
    const status =
      match && (match.backorderQty > 0 || awaitingInvoice)
        ? ProcurementOrderStatus.PARTIALLY_RECEIVED
        : ProcurementOrderStatus.COMPLETED;

    const update: Record<string, any> = {
      status,
      notes: body.note ?? undefined,
    };

    if (match) {
      const acceptedQty = body.acceptedQuantity ?? stockedQty;
      const rejectedQty = body.rejectedQuantity ?? 0;
      Object.assign(update, {
        quantity_received: acceptedQty + rejectedQty,
        accepted_quantity: acceptedQty,
        rejected_quantity: rejectedQty,
        rejected_reason: body.rejectedReason ?? null,
        invoice_quantity: body.invoiceQuantity ?? null,
        invoice_unit_price: body.invoiceUnitPrice ?? null,
        backorder_quantity: match.backorderQty,
        match_status: match.verdict,
        // NULL, not false, when there was no invoice to verify against: "we
        // checked and it did not match" and "nobody has checked" are different
        // facts, and only one of them is an accusation.
        price_verified: hasInvoice ? match.priceVerified : null,
        price_override_reason: body.priceOverrideReason ?? null,
        discrepancy_notes: isDiscrepancy(match.verdict) ? match.summary : null,
        match_verified_at: new Date().toISOString(),
        match_verified_by: userId,
      });
    }

    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update(update)
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .select("*, inventory:inventory_id(wine_name)")
      .single();

    if (error) {
      this.logger.error(`verifyReceipt status update failed: ${error.message}`);
      throw error;
    }

    // Resolve the pinned notification for every member.
    await this.databaseService.supabase
      .from("notifications")
      .update({ status: "read", read_at: new Date().toISOString() })
      .eq("restaurant_id", restaurantId)
      .eq("group_key", `receipt_verify:${orderId}`)
      .eq("status", "unread");

    const row = data as any;
    const order = this.mapOrderRow({
      ...row,
      wine_name:
        row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    });

    // The manager hears about a bad delivery immediately, as its own task — the verify
    // task above has just been resolved, so the discrepancy needs its own thread (D-E).
    if (match && isDiscrepancy(match.verdict) && this.notificationsService) {
      await this.notificationsService.persistForRestaurant(
        restaurantId,
        {
          type: "invoice_received",
          title: `Delivery discrepancy: ${order.wineName || order.orderNumber || "order"}`,
          message: match.summary,
          priority: "critical",
          actionUrl: `/inventory?verify=${orderId}`,
          actionLabel: "Review match",
          groupKey: `receipt_discrepancy:${orderId}`,
          metadata: {
            orderId,
            inventoryId: (orderRow as any).inventory_id,
            matchStatus: match.verdict,
            backorderQty: match.backorderQty,
            creditDue: match.creditDue,
            effectiveUnitCost: match.effectiveUnitCost,
            providerId: (orderRow as any).provider_id,
          },
        },
        { dedupeWithinMinutes: 24 * 60 },
      );
    }

    await this.emitOrderChangeEvent(
      restaurantId,
      userId,
      order,
      status === ProcurementOrderStatus.COMPLETED ? "completed" : "updated",
    );

    this.logger.log(
      `Receipt verified for order ${orderId}: verdict=${match?.verdict ?? "legacy"}, ` +
        `status=${status}, adjustments=${adjustments.length}`,
    );
    return order;
  }

  /**
   * Create a calendar event when an order is approved (expected delivery date)
   */
  private async createCalendarEventForOrder(
    restaurantId: string,
    order: OrderResponseDto,
    trigger: "approved" | "created",
  ): Promise<void> {
    try {
      // Calculate expected delivery date (7 days from now if not specified)
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + 7);
      const eventDate = expectedDate.toISOString().split("T")[0];

      const { error } = await this.databaseService.supabase
        .from("calendar_events")
        .insert({
          restaurant_id: restaurantId,
          title: `Delivery: ${order.orderNumber}`,
          description: `Expected delivery for order ${order.orderNumber} (${order.quantity} bottles)`,
          event_type: "delivery",
          event_date: eventDate,
          event_time: "10:00",
          all_day: false,
          status: "SCHEDULED",
          priority: order.isEmergency ? "HIGH" : "MEDIUM",
          tags: JSON.stringify({
            order_id: order.id,
            order_number: order.orderNumber,
            provider_id: order.providerId,
            quantity: order.quantity,
            trigger,
          }),
          reminder_enabled: true,
          reminder_days_before: 1,
        });

      if (error) {
        this.logger.warn(
          `Failed to create calendar event for order ${order.id}: ${error.message}`,
        );
      } else {
        this.logger.log(
          `Calendar event created for order ${order.orderNumber} delivery`,
        );
      }
    } catch (e) {
      this.logger.warn(`Calendar event creation failed: ${e?.message}`);
    }
  }

  /**
   * Update calendar event when order is delivered
   */
  private async updateCalendarEventForDelivery(
    restaurantId: string,
    orderId: string,
    order: OrderResponseDto,
  ): Promise<void> {
    try {
      // Find the calendar event for this order using tags
      const { data: events } = await this.databaseService.supabase
        .from("calendar_events")
        .select("id, tags")
        .eq("restaurant_id", restaurantId)
        .eq("event_type", "delivery")
        .neq("status", "COMPLETED");

      // Find the event that references this order
      const matchingEvent = (events || []).find((e) => {
        try {
          const tags = typeof e.tags === "string" ? JSON.parse(e.tags) : e.tags;
          return tags?.order_id === orderId;
        } catch {
          return false;
        }
      });

      if (matchingEvent) {
        await this.databaseService.supabase
          .from("calendar_events")
          .update({
            status: "COMPLETED",
            description: `Delivered: ${order.orderNumber} (${order.quantity} bottles). Actual delivery: ${order.deliveredAt}`,
          })
          .eq("id", matchingEvent.id);

        this.logger.log(
          `Calendar event updated to COMPLETED for order ${order.orderNumber}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `Calendar event update on delivery failed: ${e?.message}`,
      );
    }
  }

  async listPendingOrders(restaurantId: string): Promise<OrderResponseDto[]> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("*, inventory:inventory_id(wine_name)")
      .eq("restaurant_id", restaurantId)
      .in("status", [
        ProcurementOrderStatus.PENDING,
        ProcurementOrderStatus.APPROVAL_NEEDED,
      ])
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error("Failed to list pending orders", {
        restaurantId,
        error: error.message,
      });
      return [];
    }

    return (data || []).map((row: any) => {
      const orderRow: ProcurementOrderRow = {
        ...row,
        wine_name:
          row.inventory?.wine_name ||
          (row.inventory as any)?.wine?.name ||
          null,
      };
      return this.mapOrderRow(orderRow);
    });
  }

  private mapOrderRow(row: ProcurementOrderRow): OrderResponseDto {
    return {
      id: row.id,
      orderNumber: row.order_number,
      restaurantId: row.restaurant_id,
      inventoryId: row.inventory_id,
      providerId: row.provider_id,
      quantity: row.quantity,
      unitType: row.unit_type || undefined,
      bottlesTotal: row.bottles_total ?? undefined,
      quotedPrice: row.quoted_price ?? undefined,
      negotiatedPrice: row.negotiated_price ?? undefined,
      finalPrice: row.final_price ?? undefined,
      totalCost: row.total_cost ?? undefined,
      status: row.status as ProcurementOrderStatus,
      requestedAt: row.requested_at ?? undefined,
      approvedAt: row.approved_at ?? undefined,
      deliveredAt: row.delivered_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      isEmergency: row.is_emergency ?? undefined,
      priorityLevel: row.priority_level ?? undefined,
      wineName: row.wine_name ?? undefined,
    };
  }

  private generateOrderNumber(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const suffix = Math.floor(Math.random() * 100000)
      .toString()
      .padStart(5, "0");
    return `ORD-${year}-${suffix}`;
  }

  // =========================================================================
  // PHASE 32: DRAFT MANAGEMENT
  // =========================================================================

  async approveDraft(
    restaurantId: string,
    orderId: string,
    dto: ApproveDraftDto,
  ): Promise<{ conversationId: string; sentAt: string }> {
    // Fetch conversation + provider email before updating
    const { data: conv, error: fetchError } =
      await this.databaseService.supabase
        .from("procurement_conversations")
        .select(
          "id, content, created_at, gmail_thread_id, message_id, email_headers, providers!left(name, contact_email, contact_first_name, primary_contact), procurement_orders!inner(inventory:inventory_id(wine_name))",
        )
        .eq("restaurant_id", restaurantId)
        .eq("order_id", orderId)
        .eq("status", "PENDING_APPROVAL")
        .single();

    if (fetchError || !conv) {
      this.logger.error("approveDraft fetch failed", {
        restaurantId,
        orderId,
        fetchError: fetchError?.message,
      });
      throw new NotFoundException("No pending draft found for this order");
    }

    // Gate: don't send a draft that's stale because a newer vendor reply just
    // arrived and is still being analyzed.
    if (
      await this.newerReplyStillAnalyzing(orderId, (conv as any).created_at)
    ) {
      throw new BadRequestException(
        "A newer vendor reply just arrived and the AI is still reading it. Please wait a moment and review the updated draft before sending.",
      );
    }

    const rawEmailBody = dto.modifiedContent ?? (conv as any).content ?? "";
    const providerEmail = (conv as any).providers?.contact_email ?? null;
    const rawOrder = (conv as any).procurement_orders;
    const wineName =
      rawOrder?.inventory?.wine_name ?? rawOrder?.wine_name ?? "Wine Order";

    // Reply-threading metadata. AI-generated replies (and any draft created as a
    // reply to an inbound vendor email) carry the original Gmail thread id plus
    // the RFC822 In-Reply-To / References so the approved email lands in the same
    // thread instead of starting a new one. Initial outbound drafts have none of
    // these, so the email is sent fresh exactly as before.
    const emailHeaders = ((conv as any).email_headers ?? {}) as Record<
      string,
      any
    >;
    const subject =
      emailHeaders.subject ||
      (conv as any).subject ||
      `Order Request: ${wineName}`;
    const replyThreadId = (conv as any).gmail_thread_id || undefined;
    const replyInReplyTo = emailHeaders.in_reply_to || undefined;
    const replyReferences = emailHeaders.references || undefined;

    // Send the email BEFORE committing SENT status — if delivery fails the
    // conversation stays PENDING_APPROVAL and the manager can retry.
    if (!providerEmail) {
      throw new BadRequestException(
        `Provider has no email address — cannot send order email for order ${orderId}`,
      );
    }

    const emailHtml = this.buildEmailHtml(rawEmailBody);
    const { gmailMessageId, gmailThreadId, rfc822MessageId } =
      await this.sendProviderEmail({
        to: providerEmail,
        cc: dto.ccEmails,
        subject,
        html: emailHtml,
        restaurantId,
        threadId: replyThreadId,
        inReplyTo: replyInReplyTo,
        references: replyReferences,
        recipientFirstName: this.resolveFirstName((conv as any).providers),
        senderName: await this.resolveSenderName(restaurantId),
      });
    if (gmailThreadId) {
      this.logger.log(
        `Provider email sent to ${providerEmail} for order ${orderId} — threadId: ${gmailThreadId}`,
      );
    }

    const sentAt = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      sent_at: sentAt,
      status: "SENT",
      ...(gmailMessageId && { gmail_message_id: gmailMessageId }),
      ...(gmailThreadId && { gmail_thread_id: gmailThreadId }),
      ...(rfc822MessageId && { message_id: rfc822MessageId }),
    };
    if (dto.modifiedContent) {
      updatePayload.content = dto.modifiedContent;
    }

    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .update(updatePayload)
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("status", "PENDING_APPROVAL")
      .select("id, sent_at")
      .single();

    if (error) {
      this.logger.error("approveDraft DB update failed after email sent", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    // Create calendar delivery event NOW — only after manager approves the draft email.
    // This means we've actually communicated with the provider, so the expected
    // delivery window is meaningful.
    try {
      const { data: orderRow } = await this.databaseService.supabase
        .from("procurement_orders")
        .select("*, inventory:inventory_id(wine_name)")
        .eq("id", orderId)
        .eq("restaurant_id", restaurantId)
        .single();
      if (orderRow) {
        const raw = orderRow as any;
        const mappedRow: ProcurementOrderRow = {
          ...raw,
          wine_name: raw.inventory?.wine_name || null,
        };
        await this.createCalendarEventForOrder(
          restaurantId,
          this.mapOrderRow(mappedRow),
          "approved",
        );
      }
    } catch (e: any) {
      this.logger.warn(
        `Calendar creation after draft approval failed: ${e?.message}`,
      );
    }

    return { conversationId: (data as any).id, sentAt: (data as any).sent_at };
  }

  // =========================================================================
  // SHARED EMAIL DELIVERY
  // =========================================================================

  /** Convert plain-text body to simple HTML (paragraph/line breaks); pass HTML through. */
  private buildEmailHtml(rawBody: string): string {
    const body = rawBody ?? "";
    const isHtml = /<[a-z][\s\S]*>/i.test(body);
    return isHtml
      ? body
      : body
          .split(/\n\n+/)
          .map(
            (p) =>
              `<p style="margin:0 0 1em 0">${p.replace(/\n/g, "<br>")}</p>`,
          )
          .join("");
  }

  /** Provider first name: contact_first_name → primary_contact.name → company name. */
  private resolveFirstName(provider: any): string {
    if (!provider) return "";
    const direct = (provider.contact_first_name || "").toString().trim();
    if (direct) return direct.split(/\s+/)[0];
    const pc = provider.primary_contact;
    const pcName = (pc && typeof pc === "object" ? (pc as any).name : "") || "";
    if (String(pcName).trim()) return String(pcName).trim().split(/\s+/)[0];
    const company = (provider.name || "").toString().trim();
    if (company) return company.split(/\s+/)[0];
    return "";
  }

  /** Rewrite a leading generic greeting ("Hi there,", "Hello,", "Hi Acme,") to use the first name. */
  private personalizeGreeting(html: string, firstName?: string): string {
    if (!html || !firstName || !firstName.trim()) return html;
    const name = firstName.trim();
    return html.replace(
      /(^|>)(\s*)(hi|hello|hey|dear)\b[^,<]*,/i,
      `$1$2Hi ${name},`,
    );
  }

  /**
   * Final polish applied to every outbound email at send time: personalize the
   * greeting AND replace unfilled signature placeholders ("[Manager Name]",
   * "[Your Name]", etc.) with the real sender name. This is the safety net that
   * cleans up whatever the draft generator (Python agent or LLM) produced.
   */
  private applyEmailPlaceholders(
    html: string,
    firstName?: string,
    senderName?: string,
  ): string {
    let out = this.personalizeGreeting(html, firstName);
    const sig = (senderName || "").trim();
    // Replace any leftover [Manager Name] / [Your Name] / [Name] / [Signature] placeholder.
    out = out.replace(
      /\[\s*(manager\s*name|your\s*name|name|signature|manager)\s*\]/gi,
      sig,
    );
    return out;
  }

  /**
   * Resolve the outbound sender/signature name for a restaurant. Precedence:
   * a configured 'sender_identity' template (manager-set) → branding display name
   * → restaurant name. Drives the [Manager Name] signature substitution.
   */
  private async resolveSenderName(restaurantId: string): Promise<string> {
    try {
      const { data: t } = await this.databaseService.supabase
        .from("communication_templates")
        .select("body")
        .eq("restaurant_id", restaurantId)
        .eq("type", "sender_identity")
        .eq("is_active", true)
        .maybeSingle();
      const configured = String((t as any)?.body || "").trim();
      if (configured) return configured.split("\n")[0].trim();

      const { data: b } = await this.databaseService.supabase
        .from("restaurant_branding")
        .select("display_name")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if ((b as any)?.display_name && String((b as any).display_name).trim()) {
        return String((b as any).display_name).trim();
      }
      const { data: r } = await this.databaseService.supabase
        .from("restaurants")
        .select("name")
        .eq("id", restaurantId)
        .maybeSingle();
      return String((r as any)?.name || "").trim();
    } catch {
      return "";
    }
  }

  /** Send a provider email (threaded when reply metadata is supplied). Throws on failure. */
  private async sendProviderEmail(params: {
    to: string;
    cc?: string[];
    subject: string;
    html: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
    recipientFirstName?: string;
    senderName?: string;
    restaurantId?: string;
  }): Promise<{
    gmailMessageId?: string;
    gmailThreadId?: string;
    rfc822MessageId?: string;
  }> {
    if (!this.gmailService) return {};
    // Phase 3 — outbound unification (interim). When the restaurant has a dedicated inbound
    // address (INBOUND_EMAIL_DOMAIN configured), set Reply-To to it so vendor replies come back
    // to a per-restaurant address and attribute deterministically via the inbound webhook.
    // No-op until the domain is provisioned, so the shared-Gmail path is unaffected.
    const replyTo =
      params.restaurantId && this.inboundAddress
        ? (await this.inboundAddress.addressFor(params.restaurantId)) ||
          undefined
        : undefined;
    const result = await this.gmailService.sendEmail({
      to: [params.to],
      cc: params.cc && params.cc.length > 0 ? params.cc : undefined,
      subject: params.subject,
      html: this.applyEmailPlaceholders(
        params.html,
        params.recipientFirstName,
        params.senderName,
      ),
      threadId: params.threadId,
      inReplyTo: params.inReplyTo,
      references: params.references,
      replyTo,
    });
    if (!result.success) {
      throw new BadRequestException(
        `Email could not be delivered to ${params.to}: ${result.error ?? "unknown error"}. ` +
          "Check Gmail credentials (GMAIL_REFRESH_TOKEN may be expired — run scripts/gmail-reauth.js).",
      );
    }
    return {
      gmailMessageId: result.messageId,
      gmailThreadId: result.threadId,
      rfc822MessageId: result.rfc822MessageId,
    };
  }

  private emitConvUpdate(
    restaurantId: string,
    orderId: string,
    providerId: string | null,
    conversationId: string,
  ): void {
    try {
      this.websocketGateway?.emitConversationUpdated(restaurantId, {
        conversation_id: conversationId,
        order_id: orderId,
        provider_id: providerId || undefined,
        direction: "outbound",
        channel: "email",
      });
    } catch {
      /* best-effort */
    }
  }

  // =========================================================================
  // AUTONOMOUS AUTO-SEND (2-minute undo window)
  // =========================================================================

  /**
   * Every 30s, deliver AI replies whose 2-minute undo window has elapsed. Claims
   * each row atomically (so cancels and overlapping ticks can't double-send), and
   * on any failure reverts the reply to a normal one-tap-approval draft.
   */
  @Interval(30000)
  async processScheduledAutoSends(): Promise<void> {
    if (!this.gmailService) return;
    let due: any[] = [];
    try {
      const { data } = await this.databaseService.supabase
        .from("procurement_conversations")
        .select(
          "id, order_id, restaurant_id, provider_id, content, message_text, gmail_thread_id, email_headers, created_at",
        )
        .eq("status", "AUTO_SEND_SCHEDULED")
        .lte("scheduled_send_at", new Date().toISOString())
        .limit(20);
      due = (data as any[]) || [];
    } catch (e: any) {
      this.logger.warn(`processScheduledAutoSends query failed: ${e?.message}`);
      return;
    }
    if (!due.length) return;

    for (const row of due) {
      // Atomic claim — only one worker wins; a cancel (which flips status) loses the race.
      const { data: claimed } = await this.databaseService.supabase
        .from("procurement_conversations")
        .update({ status: "AUTO_SENDING" })
        .eq("id", row.id)
        .eq("status", "AUTO_SEND_SCHEDULED")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      try {
        const { data: order } = await this.databaseService.supabase
          .from("procurement_orders")
          .select(
            "id, ai_autonomy_paused, providers!left(contact_email, name, contact_first_name, primary_contact), restaurant_inventory:inventory_id(wine_name)",
          )
          .eq("id", row.order_id)
          .single();
        const providerEmail = (order as any)?.providers?.contact_email ?? null;
        const wineName =
          (order as any)?.restaurant_inventory?.wine_name ?? "Wine Order";

        // Respect a late pause, and never send without a recipient.
        if ((order as any)?.ai_autonomy_paused === true || !providerEmail) {
          await this.revertScheduledToDraft(
            row.id,
            !providerEmail ? "no provider email" : "order paused",
          );
          continue;
        }

        // A17 — stale-send guard: a newer vendor reply arrived after this draft was
        // staged, so the reply is now potentially answering the wrong message. Revert
        // to a one-tap approval draft and let the manager review against the latest reply
        // (the responder will re-draft against it). Never auto-send a stale reply.
        if (await this.newerInboundSince(row.order_id, row.created_at)) {
          await this.revertScheduledToDraft(
            row.id,
            "newer vendor reply arrived",
          );
          try {
            this.websocketGateway?.emitRestaurantNotification(
              row.restaurant_id,
              {
                id: row.id,
                title: "AI held a reply — a newer vendor email arrived",
                message:
                  "The scheduled auto-send was paused because the vendor replied again. Review the updated draft before sending.",
                type: "warning",
                action_url: `/orders?order=${row.order_id}`,
              },
            );
            void this.inboundResponder?.persistManagerNotification(
              row.restaurant_id,
              {
                type: "vendor_reply",
                title: "AI held a reply — a newer vendor email arrived",
                message:
                  "The scheduled auto-send was paused because the vendor replied again. Review the updated draft before sending.",
                priority: "high",
                actionUrl: `/orders?order=${row.order_id}`,
                metadata: {
                  order_id: row.order_id,
                  draft_id: row.id,
                  provider_id: row.provider_id,
                  reason: "newer_inbound_pending",
                },
              },
            );
          } catch {
            /* best-effort */
          }
          this.emitConvUpdate(
            row.restaurant_id,
            row.order_id,
            row.provider_id,
            row.id,
          );
          continue;
        }

        const headers = (row.email_headers ?? {}) as Record<string, any>;
        const ids = await this.sendProviderEmail({
          to: providerEmail,
          subject: headers.subject || `Re: Order Request: ${wineName}`,
          html: this.buildEmailHtml(row.content ?? row.message_text ?? ""),
          restaurantId: row.restaurant_id,
          threadId: row.gmail_thread_id || undefined,
          inReplyTo: headers.in_reply_to || undefined,
          references: headers.references || undefined,
          recipientFirstName: this.resolveFirstName((order as any)?.providers),
          senderName: await this.resolveSenderName(row.restaurant_id),
        });

        await this.databaseService.supabase
          .from("procurement_conversations")
          .update({
            status: "AUTO_SENT",
            sent_at: new Date().toISOString(),
            scheduled_send_at: null,
            ...(ids.gmailMessageId && { gmail_message_id: ids.gmailMessageId }),
            ...(ids.gmailThreadId && { gmail_thread_id: ids.gmailThreadId }),
            ...(ids.rfc822MessageId && { message_id: ids.rfc822MessageId }),
          })
          .eq("id", row.id);

        this.logger.log(
          `Auto-sent reply ${row.id} for order ${row.order_id} to ${providerEmail}`,
        );
        try {
          this.websocketGateway?.emitRestaurantNotification(row.restaurant_id, {
            id: row.id,
            title: "AI auto-sent a vendor reply",
            message: `Reply sent to ${providerEmail}.`,
            type: "success",
            action_url: `/orders?order=${row.order_id}`,
          });
          void this.inboundResponder?.persistManagerNotification(
            row.restaurant_id,
            {
              type: "vendor_reply",
              title: "AI auto-sent a vendor reply",
              message: `Reply sent to ${providerEmail}.`,
              priority: "medium",
              actionUrl: `/orders?order=${row.order_id}`,
              metadata: {
                order_id: row.order_id,
                draft_id: row.id,
                provider_id: row.provider_id,
              },
            },
          );
        } catch {
          /* best-effort */
        }
        this.emitConvUpdate(
          row.restaurant_id,
          row.order_id,
          row.provider_id,
          row.id,
        );
      } catch (e: any) {
        this.logger.error(
          `Auto-send failed for ${row.id} (order ${row.order_id}): ${e?.message}`,
        );
        await this.revertScheduledToDraft(row.id, "send failed");
        try {
          this.websocketGateway?.emitRestaurantNotification(row.restaurant_id, {
            id: row.id,
            title: "AI auto-send failed — needs your approval",
            message:
              "The scheduled reply could not be sent automatically. It is back in your queue for one-tap approval.",
            type: "warning",
            action_url: `/orders?order=${row.order_id}`,
          });
          void this.inboundResponder?.persistManagerNotification(
            row.restaurant_id,
            {
              type: "vendor_reply",
              title: "AI auto-send failed — needs your approval",
              message:
                "The scheduled reply could not be sent automatically. It is back in your queue for one-tap approval.",
              priority: "high",
              actionUrl: `/orders?order=${row.order_id}`,
              metadata: {
                order_id: row.order_id,
                draft_id: row.id,
                provider_id: row.provider_id,
              },
            },
          );
        } catch {
          /* best-effort */
        }
      }
    }
  }

  private async revertScheduledToDraft(
    conversationId: string,
    reason: string,
  ): Promise<void> {
    await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ status: "PENDING_APPROVAL", scheduled_send_at: null })
      .eq("id", conversationId);
    this.logger.log(
      `Auto-send reverted to PENDING_APPROVAL for ${conversationId} (${reason}).`,
    );
  }

  /** Undo a scheduled auto-send: revert it to a normal draft for one-tap approval. */
  async cancelScheduledSend(
    restaurantId: string,
    orderId: string,
  ): Promise<{ cancelled: boolean }> {
    const { data } = await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ status: "PENDING_APPROVAL", scheduled_send_at: null })
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("status", "AUTO_SEND_SCHEDULED")
      .select("id");
    const cancelled = !!(data && (data as any[]).length);
    if (cancelled)
      this.logger.log(
        `Manager cancelled scheduled auto-send for order ${orderId}.`,
      );
    return { cancelled };
  }

  // =========================================================================
  // MANUAL REPLY + AI PAUSE
  // =========================================================================

  /** Manager writes and sends their own threaded reply (bypasses the AI draft). */
  async manualReply(
    restaurantId: string,
    orderId: string,
    content: string,
    ccEmails?: string[],
  ): Promise<{ conversationId: string; sentAt: string }> {
    if (!content || !content.trim()) {
      throw new BadRequestException("Reply content cannot be empty");
    }

    const { data: order } = await this.databaseService.supabase
      .from("procurement_orders")
      .select(
        "id, provider_id, providers!left(contact_email), restaurant_inventory:inventory_id(wine_name)",
      )
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .single();
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    const providerEmail = (order as any)?.providers?.contact_email ?? null;
    const wineName =
      (order as any)?.restaurant_inventory?.wine_name ?? "Wine Order";
    if (!providerEmail) {
      throw new BadRequestException(
        "Provider has no email address — cannot send reply",
      );
    }

    // Thread to the vendor's latest inbound message if there is one.
    const { data: lastInbound } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select("gmail_thread_id, message_id, email_headers")
      .eq("order_id", orderId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const inHeaders = ((lastInbound as any)?.email_headers ?? {}) as Record<
      string,
      any
    >;
    const subject = inHeaders.subject || `Re: Order Request: ${wineName}`;
    const threadId = (lastInbound as any)?.gmail_thread_id || undefined;
    const inReplyTo =
      (lastInbound as any)?.message_id || inHeaders.message_id || undefined;
    const references = inHeaders.references || undefined;

    const ids = await this.sendProviderEmail({
      to: providerEmail,
      cc: ccEmails,
      subject,
      html: this.buildEmailHtml(content),
      restaurantId,
      threadId,
      inReplyTo,
      references,
    });

    const sentAt = new Date().toISOString();
    const { data: inserted, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .insert({
        order_id: orderId,
        restaurant_id: restaurantId,
        provider_id: (order as any).provider_id,
        direction: "outbound",
        channel: "email",
        content,
        message_text: content,
        ai_generated: false,
        status: "SENT",
        sent_at: sentAt,
        outbound_email_type: "MANUAL_REPLY",
        gmail_thread_id: ids.gmailThreadId || threadId || null,
        gmail_message_id: ids.gmailMessageId || null,
        message_id: ids.rfc822MessageId || null,
        email_headers: {
          subject,
          in_reply_to: inReplyTo || null,
          references: references || null,
        },
      })
      .select("id, sent_at")
      .single();
    if (error) {
      this.logger.error(
        `manualReply insert failed for order ${orderId}: ${error.message}`,
      );
      throw error;
    }

    // A manual reply supersedes any waiting AI draft for this order.
    await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ status: "DISCARDED", scheduled_send_at: null })
      .eq("order_id", orderId)
      .in("status", ["PENDING_APPROVAL", "AUTO_SEND_SCHEDULED"]);

    this.emitConvUpdate(
      restaurantId,
      orderId,
      (order as any).provider_id,
      (inserted as any).id,
    );
    return {
      conversationId: (inserted as any).id,
      sentAt: (inserted as any).sent_at,
    };
  }

  /** Pause or resume AI autonomy for a single order (manager grabs the wheel). */
  async setOrderAiPaused(
    restaurantId: string,
    orderId: string,
    paused: boolean,
  ): Promise<{ paused: boolean }> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update({ ai_autonomy_paused: paused })
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .select("id");
    if (error) throw error;
    if (!data || (data as any[]).length === 0)
      throw new NotFoundException(`Order ${orderId} not found`);
    this.logger.log(
      `AI autonomy ${paused ? "paused" : "resumed"} for order ${orderId}.`,
    );
    return { paused };
  }

  // =========================================================================
  // DEAL APPROVAL (AI-detected offer / verification → one-tap confirm)
  // =========================================================================

  /**
   * Per-vendor earned trust. Manager decides every deal until a vendor's
   * relationship health (rating + completed-order history) crosses a threshold;
   * then clean deals may auto-confirm for that vendor. New vendors are never eligible.
   */
  async getVendorTrust(
    restaurantId: string,
    providerId: string,
  ): Promise<{ score: number; eligible: boolean; completedOrders: number }> {
    try {
      const { data: provider } = await this.databaseService.supabase
        .from("providers")
        .select("rating")
        .eq("id", providerId)
        .maybeSingle();
      const { count } = await this.databaseService.supabase
        .from("procurement_orders")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .eq("provider_id", providerId)
        .in("status", ["CONFIRMED", "DELIVERED", "COMPLETED"]);
      const completedOrders = count ?? 0;
      const ratingScore = Math.min(
        1,
        Number((provider as any)?.rating ?? 0) / 5,
      );
      const historyScore = Math.min(1, completedOrders / 5);
      const score =
        Math.round((ratingScore * 0.5 + historyScore * 0.5) * 100) / 100;
      const eligible = completedOrders >= 3 && score >= 0.7;
      return { score, eligible, completedOrders };
    } catch {
      return { score: 0, eligible: false, completedOrders: 0 };
    }
  }

  /**
   * Approve-gating guard: true if a vendor reply newer than `draftCreatedAt` exists
   * but the AI hasn't analyzed it yet (detected_intent null) AND it arrived within the
   * last 10 minutes. Blocks acting on a now-stale draft/deal while the AI is still
   * reading the latest reply — but won't lock forever if analysis permanently failed.
   */
  private async newerReplyStillAnalyzing(
    orderId: string,
    draftCreatedAt?: string | null,
  ): Promise<boolean> {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    let q = this.databaseService.supabase
      .from("procurement_conversations")
      .select("id")
      .eq("order_id", orderId)
      .eq("direction", "inbound")
      .is("detected_intent", null)
      .gt("created_at", tenMinAgo);
    if (draftCreatedAt) q = q.gt("created_at", draftCreatedAt);
    const { data } = await q.limit(1);
    return !!(data && (data as any[]).length);
  }

  /**
   * A7 — re-hydrate an inbound message's persisted attachments (D2) into the base64 shape
   * the responder's vision pass expects. Downloads image/PDF bytes from the private
   * vendor-attachments bucket. Best-effort and capped: a missing/oversized object is skipped
   * so a manual regenerate degrades gracefully rather than failing.
   */
  private async loadPersistedAttachmentsForVision(
    restaurantId: string,
    conversationId: string,
  ): Promise<Array<{ filename: string; mime_type: string; data: string }>> {
    const MAX_FILES = 3;
    const MAX_BYTES = 5 * 1024 * 1024; // mirror the ingestion cap
    const out: Array<{ filename: string; mime_type: string; data: string }> =
      [];
    try {
      const { data: rows } = await this.databaseService.supabase
        .from("conversation_attachments")
        .select("filename, mime_type, size_bytes, storage_path")
        .eq("restaurant_id", restaurantId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(MAX_FILES);
      for (const r of (rows as any[]) || []) {
        const mime = (r.mime_type ?? "").toString();
        const isVisionable =
          mime.startsWith("image/") || mime === "application/pdf";
        if (!isVisionable || !r.storage_path) continue;
        if (r.size_bytes != null && r.size_bytes > MAX_BYTES) continue;
        try {
          const { data: blob } = await this.databaseService.supabase.storage
            .from("vendor-attachments")
            .download(r.storage_path);
          if (!blob) continue;
          const buf = Buffer.from(await (blob as any).arrayBuffer());
          if (buf.byteLength > MAX_BYTES) continue;
          out.push({
            filename: r.filename ?? "attachment",
            mime_type: mime,
            data: buf.toString("base64"),
          });
        } catch {
          /* best-effort — skip an object we can't fetch */
        }
      }
    } catch (e: any) {
      this.logger.warn(
        `loadPersistedAttachmentsForVision failed for ${conversationId}: ${e?.message}`,
      );
    }
    return out;
  }

  /**
   * A17 — true if any inbound vendor reply arrived after `sinceIso` (the draft's staging
   * time). Unlike newerReplyStillAnalyzing, this fires whether or not the AI has analyzed
   * the new reply: a scheduled auto-send should never fire once the vendor has spoken again.
   */
  private async newerInboundSince(
    orderId: string,
    sinceIso?: string | null,
  ): Promise<boolean> {
    if (!sinceIso) return false;
    const { data } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select("id")
      .eq("order_id", orderId)
      .eq("direction", "inbound")
      .gt("created_at", sinceIso)
      .limit(1);
    return !!(data && (data as any[]).length);
  }

  /** Latest unresolved AI deal proposal for an order (drives the approval modal). */
  async getDealProposal(
    restaurantId: string,
    orderId: string,
  ): Promise<Record<string, any> | null> {
    const { data: order } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("id, status, provider_id, providers!left(name)")
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!order) return null;
    const terminal = [
      "CONFIRMED",
      "APPROVED",
      "IN_TRANSIT",
      "DELIVERED",
      "COMPLETED",
      "CANCELLED",
      "REJECTED",
      "FAILED",
    ];
    if (terminal.includes(String((order as any).status || "").toUpperCase()))
      return null;

    const { data: rows } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select("id, conversation_context, rolling_summary, created_at")
      .eq("order_id", orderId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(6);

    const row = (rows || []).find(
      (r: any) =>
        r.conversation_context?.deal_proposal &&
        !r.conversation_context?.deal_resolved_at,
    );
    if (!row) return null;

    const proposal = (row as any).conversation_context.deal_proposal;
    const trust = await this.getVendorTrust(
      restaurantId,
      (order as any).provider_id,
    );
    return {
      orderId,
      conversationId: (row as any).id,
      providerName:
        proposal.providerName || (order as any).providers?.name || "Provider",
      wineName: proposal.wineName,
      quantity: proposal.quantity,
      proposedPrice: proposal.proposedPrice,
      finalPrice: proposal.finalPrice,
      deliveryEstimate: proposal.deliveryEstimate,
      conditions: proposal.conditions,
      specialConditions: proposal.specialConditions || [],
      commercialTerms: proposal.commercialTerms ?? null,
      sourceQuote: proposal.sourceQuote,
      conversationSummary:
        proposal.summary || (row as any).rolling_summary || "",
      dealKind: proposal.dealKind,
      urgency: proposal.urgency,
      confidence: proposal.confidence,
      timestamp: proposal.detectedAt || (row as any).created_at,
      trust,
    };
  }

  /** Mark the latest deal proposal on an order resolved so the modal stops showing it. */
  private async resolveLatestDealProposal(
    orderId: string,
    resolution: string,
  ): Promise<void> {
    const { data: rows } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select("id, conversation_context")
      .eq("order_id", orderId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(6);
    const row = (rows || []).find(
      (r: any) =>
        r.conversation_context?.deal_proposal &&
        !r.conversation_context?.deal_resolved_at,
    );
    if (!row) return;
    const ctx = { ...((row as any).conversation_context || {}) };
    ctx.deal_resolved_at = new Date().toISOString();
    ctx.deal_resolution = resolution;
    await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ conversation_context: ctx })
      .eq("id", (row as any).id);
  }

  /**
   * Manager confirms an AI-detected deal: commit the order to CONFIRMED at the
   * (possibly edited) terms and, by default, send the vendor a confirmation email.
   */
  async confirmDeal(
    restaurantId: string,
    orderId: string,
    opts: {
      finalPrice?: number;
      quantity?: number;
      sendConfirmation?: boolean;
    },
  ): Promise<{ confirmed: boolean; sentConfirmation: boolean }> {
    const { data: order } = await this.databaseService.supabase
      .from("procurement_orders")
      .select(
        "id, provider_id, quantity, providers!left(name, contact_email, contact_first_name, primary_contact), restaurant_inventory:inventory_id(wine_name)",
      )
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .single();
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    // Gate: don't commit terms while a newer reply is still being analyzed.
    if (await this.newerReplyStillAnalyzing(orderId, null)) {
      throw new BadRequestException(
        "A newer vendor reply just arrived and the AI is still reading it. Please review the updated terms before confirming.",
      );
    }

    const providerEmail = (order as any)?.providers?.contact_email ?? null;
    const greetName =
      this.resolveFirstName((order as any)?.providers) || "there";
    const wineName =
      (order as any)?.restaurant_inventory?.wine_name ?? "the wine";
    const quantity = opts.quantity ?? (order as any).quantity;
    const finalPrice = opts.finalPrice ?? null;

    // "Confirmed by us" = we accepted the deal and are emailing the vendor to
    // confirm. That lands the order in APPROVED — NOT ORDERED. It only advances to
    // ORDERED (CONFIRMED) once the vendor sends back a receipt/order-confirmation
    // whose terms match ours (handled in InboundResponder.syncOrderState), or the
    // manager clicks "Mark as Ordered".
    const update: Record<string, any> = {
      status: ProcurementOrderStatus.APPROVED,
      approved_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
    };
    if (finalPrice != null) {
      update.negotiated_price = finalPrice;
      update.final_price = finalPrice;
    }
    if (opts.quantity != null) update.quantity = opts.quantity;

    const { error: upErr } = await this.databaseService.supabase
      .from("procurement_orders")
      .update(update)
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId);
    if (upErr) throw upErr;

    // Send the vendor a confirmation (manager-authorized, so commitment language is fine).
    let sentConfirmation = false;
    if (opts.sendConfirmation !== false && providerEmail) {
      try {
        const { data: lastInbound } = await this.databaseService.supabase
          .from("procurement_conversations")
          .select("gmail_thread_id, message_id, email_headers")
          .eq("order_id", orderId)
          .eq("direction", "inbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const inHeaders = ((lastInbound as any)?.email_headers ?? {}) as Record<
          string,
          any
        >;
        const subject =
          inHeaders.subject || `Re: Order Confirmation: ${wineName}`;
        const priceLine =
          finalPrice != null
            ? ` at $${Number(finalPrice).toFixed(2)} per bottle`
            : "";
        const body =
          `Hi ${greetName},\n\n` +
          `We'd like to confirm our order: ${quantity} bottles of ${wineName}${priceLine}. ` +
          `Please send an order confirmation along with the expected delivery date.\n\n` +
          `Thank you!`;
        const ids = await this.sendProviderEmail({
          to: providerEmail,
          subject,
          html: this.buildEmailHtml(body),
          restaurantId,
          threadId: (lastInbound as any)?.gmail_thread_id || undefined,
          inReplyTo:
            (lastInbound as any)?.message_id ||
            inHeaders.message_id ||
            undefined,
          references: inHeaders.references || undefined,
          senderName: await this.resolveSenderName(restaurantId),
        });
        await this.databaseService.supabase
          .from("procurement_conversations")
          .insert({
            order_id: orderId,
            restaurant_id: restaurantId,
            provider_id: (order as any).provider_id,
            direction: "outbound",
            channel: "email",
            content: body,
            message_text: body,
            ai_generated: false,
            status: "SENT",
            sent_at: new Date().toISOString(),
            outbound_email_type: "ORDER_CONFIRMATION",
            gmail_thread_id:
              ids.gmailThreadId ||
              (lastInbound as any)?.gmail_thread_id ||
              null,
            gmail_message_id: ids.gmailMessageId || null,
            message_id: ids.rfc822MessageId || null,
            email_headers: { subject },
          });
        sentConfirmation = true;
      } catch (e: any) {
        this.logger.warn(
          `confirmDeal: confirmation email failed for order ${orderId}: ${e?.message}`,
        );
      }
    }

    // Resolve the proposal + clear any waiting drafts; the deal is done.
    await this.resolveLatestDealProposal(orderId, "confirmed");
    await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ status: "DISCARDED", scheduled_send_at: null })
      .eq("order_id", orderId)
      .in("status", ["PENDING_APPROVAL", "AUTO_SEND_SCHEDULED"]);

    this.emitConvUpdate(
      restaurantId,
      orderId,
      (order as any).provider_id,
      orderId,
    );
    this.logger.log(
      `Deal confirmed for order ${orderId} (price=${finalPrice ?? "unchanged"}, qty=${quantity}, emailed=${sentConfirmation}).`,
    );
    return { confirmed: true, sentConfirmation };
  }

  /** Decline an AI-detected deal without committing — order stays in negotiation. */
  async dismissDeal(
    restaurantId: string,
    orderId: string,
  ): Promise<{ dismissed: boolean }> {
    const { data: order } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("id")
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    await this.resolveLatestDealProposal(orderId, "dismissed");
    this.emitConvUpdate(restaurantId, orderId, null, orderId);
    return { dismissed: true };
  }

  async discardDraft(
    restaurantId: string,
    orderId: string,
  ): Promise<{ success: boolean }> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ status: "DISCARDED" })
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("status", "PENDING_APPROVAL")
      .select("id");

    if (error) {
      this.logger.error("discardDraft failed", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    if (!data || (data as any[]).length === 0) {
      throw new NotFoundException(
        `No PENDING_APPROVAL draft found for order ${orderId}`,
      );
    }

    if (this.orchestratorService) {
      await this.orchestratorService.publishEvent(
        "provider.events",
        "provider.draft.discarded",
        { order_id: orderId, restaurant_id: restaurantId },
      );
    }

    return { success: true };
  }

  async editDraft(
    restaurantId: string,
    orderId: string,
    newContent: string,
  ): Promise<{ success: boolean }> {
    if (!newContent || newContent.trim().length === 0) {
      throw new BadRequestException("Draft content cannot be empty");
    }

    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ content: newContent })
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("status", "PENDING_APPROVAL")
      .select("id");

    if (error) {
      this.logger.error("editDraft failed", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    if (!data || (data as any[]).length === 0) {
      throw new NotFoundException(
        `No PENDING_APPROVAL draft found for order ${orderId}`,
      );
    }

    return { success: true };
  }

  async getPendingDraft(
    restaurantId: string,
    orderId: string,
  ): Promise<Record<string, any> | null> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select(
        `
        id, content, message_text, outbound_email_type, constraint_flags, round_count, created_at,
        providers!left(name, contact_email),
        procurement_orders!inner(
          order_number,
          inventory:inventory_id(wine_name)
        )
      `,
      )
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("status", "PENDING_APPROVAL")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error) return null;
    if (!data) return null;
    const row = data as any;
    return {
      ...row,
      content: row.content ?? row.message_text ?? null,
      provider_name: row.providers?.name ?? null,
      provider_email: row.providers?.contact_email ?? null,
      wine_name: row.procurement_orders?.inventory?.wine_name ?? null,
      order_number: row.procurement_orders?.order_number ?? null,
    };
  }

  // =========================================================================
  // PHASE 34: CONVERSATION READ ENDPOINTS
  // =========================================================================

  /**
   * Returns all PENDING_APPROVAL conversations for the restaurant, joined with
   * order (wine name, quantity) and provider (name) data.
   * D-08: Used by the Active Conversations panel on /orders.
   */
  async getActiveConversations(restaurantId: string): Promise<any[]> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select(
        `
        id,
        order_id,
        provider_id,
        outbound_email_type,
        round_count,
        created_at,
        constraint_flags,
        content,
        message_text,
        procurement_orders!inner(
          id, order_number, quantity, quoted_price,
          inventory:inventory_id(wine_name)
        ),
        providers!left(name, contact_email)
      `,
      )
      .eq("restaurant_id", restaurantId)
      .eq("status", "PENDING_APPROVAL")
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error("getActiveConversations failed", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      orderId: row.order_id,
      providerId: row.provider_id,
      emailType: row.outbound_email_type,
      roundCount: row.round_count,
      createdAt: row.created_at,
      constraintFlags: row.constraint_flags,
      draftContent: row.content ?? row.message_text ?? null,
      orderNumber: row.procurement_orders?.order_number ?? null,
      quantity: row.procurement_orders?.quantity ?? null,
      quotedPrice: row.procurement_orders?.quoted_price ?? null,
      wineName: row.procurement_orders?.inventory?.wine_name ?? null,
      providerName: row.providers?.name ?? null,
      providerEmail: row.providers?.contact_email ?? null,
    }));
  }

  /**
   * Returns completed/sent procurement conversations for send history.
   * D-03: Used by the Procurement Emails tab on /communications.
   */
  async getConversationHistory(restaurantId: string): Promise<any[]> {
    const HISTORY_STATUSES = [
      "AUTO_SENT",
      "APPROVED",
      "SENT",
      "COMPLETED",
      "CLOSED",
    ];

    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select(
        `
        id,
        order_id,
        provider_id,
        outbound_email_type,
        round_count,
        created_at,
        sent_at,
        status,
        content,
        constraint_flags,
        rolling_summary,
        procurement_orders!inner(
          id, order_number, quantity,
          inventory:inventory_id(wine_name)
        ),
        providers!left(name)
      `,
      )
      .eq("restaurant_id", restaurantId)
      .in("status", HISTORY_STATUSES)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      this.logger.error("getConversationHistory failed", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      orderId: row.order_id,
      providerId: row.provider_id,
      emailType: row.outbound_email_type,
      status: row.status,
      roundCount: row.round_count,
      createdAt: row.created_at,
      sentAt: row.sent_at ?? row.created_at,
      draftContent: row.content,
      constraintFlags: row.constraint_flags,
      rollingSummary: row.rolling_summary,
      orderNumber: row.procurement_orders?.order_number ?? null,
      quantity: row.procurement_orders?.quantity ?? null,
      wineName: row.procurement_orders?.inventory?.wine_name ?? null,
      providerName: row.providers?.name ?? null,
    }));
  }

  async getOrderConversations(
    restaurantId: string,
    orderId: string,
  ): Promise<any[]> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select(
        `
        id,
        order_id,
        provider_id,
        outbound_email_type,
        round_count,
        created_at,
        sent_at,
        status,
        direction,
        content,
        message_text,
        rolling_summary,
        constraint_flags,
        scheduled_send_at,
        detected_intent,
        detected_sentiment,
        ai_generated,
        conversation_context,
        email_headers,
        procurement_orders!inner(
          id, order_number, quantity, quoted_price, status, ai_autonomy_paused,
          inventory:inventory_id(wine_name)
        ),
        providers!left(name, contact_email)
      `,
      )
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (error) {
      this.logger.error("getOrderConversations failed", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      orderId: row.order_id,
      status: row.status,
      // DB stores direction lowercase ('inbound'/'outbound'); the UI compares
      // against uppercase, so normalize here or inbound replies render as rounds.
      direction: String(row.direction ?? "outbound").toUpperCase() as
        | "OUTBOUND"
        | "INBOUND",
      emailType: row.outbound_email_type,
      roundCount: row.round_count,
      createdAt: row.created_at,
      sentAt: row.sent_at ?? null,
      scheduledSendAt: row.scheduled_send_at ?? null,
      draftContent: row.content ?? row.message_text ?? null,
      rollingSummary: row.rolling_summary ?? null,
      constraintFlags: row.constraint_flags ?? null,
      detectedIntent: row.detected_intent ?? null,
      detectedSentiment: row.detected_sentiment ?? null,
      aiGenerated: row.ai_generated ?? null,
      specialConditions:
        row.conversation_context?.analysis?.special_conditions ?? [],
      // Triage classification (P6 card): email_class, is_automated, requires_reply,
      // injection_suspected, confidence, transport. Null on outbound / pre-triage rows.
      classification: row.conversation_context?.classification ?? null,
      orderNumber: row.procurement_orders?.order_number ?? null,
      quantity: row.procurement_orders?.quantity ?? null,
      quotedPrice: row.procurement_orders?.quoted_price ?? null,
      orderStatus: row.procurement_orders?.status ?? null,
      aiPaused: row.procurement_orders?.ai_autonomy_paused ?? false,
      wineName: row.procurement_orders?.inventory?.wine_name ?? null,
      providerName: row.providers?.name ?? null,
      providerEmail: row.providers?.contact_email ?? null,
      // Sender authentication (DKIM/DMARC) captured on inbound rows in Phase 0; null on
      // outbound rows and on inbound rows that predate transport capture.
      senderVerified: row.email_headers?.transport?.senderVerified ?? null,
    }));
  }

  /** D2 — list an order's persisted email attachments with short-lived signed URLs. */
  async getOrderAttachments(
    restaurantId: string,
    orderId: string,
  ): Promise<any[]> {
    const { data, error } = await this.databaseService.supabase
      .from("conversation_attachments")
      .select(
        "id, conversation_id, filename, mime_type, size_bytes, storage_path, created_at",
      )
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (error) {
      this.logger.error("getOrderAttachments failed", {
        restaurantId,
        orderId,
        error: error.message,
      });
      return [];
    }
    const out: any[] = [];
    for (const row of (data as any[]) || []) {
      let url: string | null = null;
      try {
        const { data: signed } = await this.databaseService.supabase.storage
          .from("vendor-attachments")
          .createSignedUrl(row.storage_path, 3600);
        url = signed?.signedUrl ?? null;
      } catch {
        /* best-effort — a missing object just yields no url */
      }
      out.push({
        id: row.id,
        conversationId: row.conversation_id,
        filename: row.filename,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        createdAt: row.created_at,
        url,
      });
    }
    return out;
  }
}
