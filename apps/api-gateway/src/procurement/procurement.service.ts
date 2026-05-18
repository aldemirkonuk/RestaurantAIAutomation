import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException, Optional, UnprocessableEntityException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EventsService } from '../events/events.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { OrchestratorService } from '../common/orchestrator/orchestrator.service';
import {
  StockType,
  TransactionSource,
  TransactionType,
} from '../inventory-ledger/dto/inventory-ledger.dto';
import { EventType, SourcePage } from '../events/dto/event.dto';
import {
  CreateOrderDto,
  OrderFilterDto,
  OrderListResponseDto,
  OrderResponseDto,
  ProcurementOrderStatus,
  UpdateOrderDto,
} from './dto/procurement.dto';
import { ApproveDraftDto } from './dto/approve-draft.dto';

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
  ) {}

  /**
   * Emit order_change event for cross-page sync
   */
  private async emitOrderChangeEvent(
    restaurantId: string,
    userId: string,
    order: OrderResponseDto,
    changeType: 'created' | 'approved' | 'delivered' | 'cancelled',
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
      this.logger.log('Order change event emitted', { orderId: order.id, type: changeType });
    } catch (error) {
      this.logger.warn('Failed to emit order change event', { error: error.message });
      // Don't fail the operation if event emission fails
    }
  }

  async createOrder(
    restaurantId: string,
    userId: string,
    dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    // Guard: restaurant must have at least one active provider before placing orders
    const { count: providerCount, error: countError } = await this.databaseService.supabase
      .from('providers')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true);

    if (countError) {
      this.logger.error('Failed to count active providers', { restaurantId, error: countError.message });
      throw new InternalServerErrorException('Could not verify vendor availability. Please try again.');
    }
    if (providerCount === 0) {
      throw new ForbiddenException({
        reason: 'no_vendors',
        message: 'You must add at least one vendor before placing orders.',
        redirect: '/providers',
      });
    }

    const orderNumber = this.generateOrderNumber();
    const finalPrice = dto.finalPrice ?? dto.quotedPrice ?? 0;
    const totalCost = dto.totalCost ?? finalPrice * dto.quantity;
    const bottlesTotal = dto.quantity;

    const payload = {
      order_number: orderNumber,
      restaurant_id: restaurantId,
      inventory_id: dto.inventoryId,
      provider_id: dto.providerId,
      quantity: dto.quantity,
      unit_type: dto.unitType ?? 'bottles',
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
      .from('procurement_orders')
      .insert(payload)
      .select('*, inventory:inventory_id(wine_name)')
      .single();

    if (error) {
      this.logger.error('Failed to create procurement order', {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name: row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    };

    const order = this.mapOrderRow(orderRow);

    // Emit order_change event for cross-page sync
    await this.emitOrderChangeEvent(restaurantId, userId, order, 'created');

    // Phase 32: Trigger silent AI draft pre-computation when provider_id is set (D-32-01)
    if (dto.providerId && this.orchestratorService) {
      // Resolve provider name so the agent can use it in the notification title.
      let resolvedProviderName = '';
      try {
        const { data: prov } = await this.databaseService.supabase
          .from('providers')
          .select('name')
          .eq('id', dto.providerId)
          .eq('restaurant_id', restaurantId)
          .single();
        resolvedProviderName = (prov as any)?.name || '';
      } catch { /* non-fatal */ }

      const draftPayload = {
        order_id: order.id,
        order_number: order.orderNumber || '',
        restaurant_id: restaurantId,
        provider_id: dto.providerId,
        provider_name: resolvedProviderName,
        wine_name: order.wineName || '',
        quantity: order.quantity,
        target_price_per_bottle: dto.quotedPrice ?? null,
        urgency: dto.isEmergency ? 'urgent' : 'normal',
        restaurant_name: '',
      };

      // Primary path: publish via RabbitMQ so the Python agent picks it up.
      let rabbitOk = false;
      try {
        await this.orchestratorService.publishEvent(
          'procurement.events',
          'procurement.order.created',
          draftPayload,
        );
        rabbitOk = true;
        this.logger.log(`AI draft pre-computation triggered via RabbitMQ for order ${order.id}`);
      } catch (err: any) {
        this.logger.warn(`RabbitMQ unavailable (${err?.message}) — trying HTTP fallback`);
      }

      // HTTP fallback: direct POST to the Python orchestrator when RabbitMQ is not deployed.
      if (!rabbitOk) {
        try {
          await this.orchestratorService.triggerDraftHttp(draftPayload);
          this.logger.log(`AI draft pre-computation triggered via HTTP fallback for order ${order.id}`);
        } catch (httpErr: any) {
          this.logger.error(
            `[createOrder] All draft generation paths failed for order ${order.id} ` +
            `(restaurant ${restaurantId}). HTTP error: ${httpErr?.message}. ` +
            `Ensure AGENT_ORCHESTRATOR_URL and RABBITMQ_URL are set in Railway env vars.`,
          );
        }
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
      .from('procurement_orders')
      .select('*, inventory:inventory_id(wine_name)', { count: 'exact' })
      .eq('restaurant_id', restaurantId);

    if (query.status) {
      supabaseQuery = supabaseQuery.eq('status', query.status);
    }

    if (query.providerId) {
      supabaseQuery = supabaseQuery.eq('provider_id', query.providerId);
    }

    if (query.dateFrom) {
      supabaseQuery = supabaseQuery.gte('created_at', query.dateFrom);
    }

    if (query.dateTo) {
      supabaseQuery = supabaseQuery.lte('created_at', query.dateTo);
    }

    const { data, error, count } = await supabaseQuery
      .order('created_at', { ascending: false })
      .range(fromIndex, toIndex);

    if (error) {
      this.logger.error('Failed to list procurement orders', {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    const orders = (data || []).map((row: any) => {
      const orderRow: ProcurementOrderRow = {
        ...row,
        wine_name: row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
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
      .from('procurement_orders')
      .select('*, inventory:inventory_id(wine_name)')
      .eq('restaurant_id', restaurantId)
      .eq('id', orderId)
      .single();

    if (error) {
      this.logger.error('Failed to fetch procurement order', {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name: row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
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
      const { data: existing, error: fetchError } = await this.databaseService.supabase
        .from('procurement_orders')
        .select('status')
        .eq('restaurant_id', restaurantId)
        .eq('id', orderId)
        .single();

      if (!fetchError && existing && BLOCKED_STATUSES.includes((existing as any).status)) {
        throw new UnprocessableEntityException({
          reason: 'order_not_approved',
          message: 'Location can only be assigned after the order is approved.',
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
      .from('procurement_orders')
      .update(updatePayload)
      .eq('restaurant_id', restaurantId)
      .eq('id', orderId)
      .select('*, inventory:inventory_id(wine_name)')
      .single();

    if (error) {
      this.logger.error('Failed to update procurement order', {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name: row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
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
      .from('procurement_orders')
      .select('status, inventory_id, quantity')
      .eq('id', orderId)
      .single();

    const order = await this.updateOrder(restaurantId, orderId, {
      status: ProcurementOrderStatus.CANCELLED,
      rejectionReason: reason,
    });

    // D-10: Cascade PENDING_APPROVAL conversations to CANCELLED so they don't
    // appear in the active conversations panel after order cancellation.
    try {
      await this.databaseService.supabase
        .from('procurement_conversations')
        .update({ status: 'CANCELLED' })
        .eq('restaurant_id', restaurantId)
        .eq('order_id', orderId)
        .eq('status', 'PENDING_APPROVAL');
      this.logger.log(`Cascaded PENDING_APPROVAL conversations to CANCELLED for order ${orderId}`);
    } catch (cascadeError: any) {
      this.logger.warn(`cancelOrder conversation cascade failed (non-fatal): ${cascadeError?.message}`);
    }

    // Cancel any pending calendar delivery event linked to this order.
    await this.cancelCalendarEventForOrder(restaurantId, orderId);

    // Release shadow stock if the order had already been approved/sent and
    // inventory was reserved (shadow_stock was incremented for this order).
    const preStatus = (preCancelRow as any)?.status ?? '';
    const RESERVED_STATUSES = ['APPROVED', 'ORDERED', 'CONFIRMED', 'PENDING_APPROVAL'];
    if (order.inventoryId && order.quantity && RESERVED_STATUSES.includes(preStatus)) {
      await this.releaseOrderShadowStock(restaurantId, order.inventoryId, order.quantity);
    }

    // Emit order_change event for cross-page sync
    await this.emitOrderChangeEvent(restaurantId, userId, order, 'cancelled');

    return order;
  }

  /** Cancel the calendar delivery event tagged with orderId (non-fatal). */
  private async cancelCalendarEventForOrder(restaurantId: string, orderId: string): Promise<void> {
    try {
      const { data: events } = await this.databaseService.supabase
        .from('calendar_events')
        .select('id, tags')
        .eq('restaurant_id', restaurantId)
        .eq('event_type', 'delivery')
        .not('status', 'in', '("COMPLETED","CANCELLED")');

      const match = (events || []).find(e => {
        try {
          const tags = typeof e.tags === 'string' ? JSON.parse(e.tags) : e.tags;
          return tags?.order_id === orderId;
        } catch { return false; }
      });

      if (match) {
        await this.databaseService.supabase
          .from('calendar_events')
          .update({ status: 'CANCELLED', description: `Order ${orderId} was cancelled.` })
          .eq('id', (match as any).id);
        this.logger.log(`Calendar event cancelled for order ${orderId}`);
      }
    } catch (e: any) {
      this.logger.warn(`cancelCalendarEventForOrder failed: ${e?.message}`);
    }
  }

  /** Subtract order quantity from shadow_stock, flooring at 0. Non-fatal. */
  private async releaseOrderShadowStock(
    restaurantId: string,
    inventoryId: string,
    quantity: number,
  ): Promise<void> {
    try {
      const { data: inv } = await this.databaseService.supabase
        .from('restaurant_inventory')
        .select('shadow_stock')
        .eq('restaurant_id', restaurantId)
        .eq('id', inventoryId)
        .single();

      if (inv) {
        const current = (inv as any).shadow_stock ?? 0;
        const released = Math.max(0, current - quantity);
        await this.databaseService.supabase
          .from('restaurant_inventory')
          .update({ shadow_stock: released })
          .eq('restaurant_id', restaurantId)
          .eq('id', inventoryId);
        this.logger.log(`Released ${quantity} shadow stock for inventory ${inventoryId} (${current} → ${released})`);
      }
    } catch (e: any) {
      this.logger.warn(`releaseOrderShadowStock failed: ${e?.message}`);
    }
  }

  async approveOrder(
    restaurantId: string,
    orderId: string,
    userId: string,
  ): Promise<OrderResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from('procurement_orders')
      .update({
        status: ProcurementOrderStatus.APPROVED,
        approved_at: new Date().toISOString(),
        approved_by: userId,
      })
      .eq('restaurant_id', restaurantId)
      .eq('id', orderId)
      .select('*, inventory:inventory_id(wine_name)')
      .single();

    if (error) {
      this.logger.error('Failed to approve procurement order', {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name: row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    };

    const order = this.mapOrderRow(orderRow);

    // NOTE: Calendar event is intentionally NOT created here.
    // It is created in approveDraft(), only after the manager reviews and approves
    // the outbound email to the provider — ensuring the calendar reflects
    // confirmed provider communication, not just internal approval.

    // Emit order_change event for cross-page sync
    await this.emitOrderChangeEvent(restaurantId, userId, order, 'approved');

    // Trigger AI to draft vendor email via ProviderConversationAgent
    if (this.orchestratorService) {
      try {
        await this.orchestratorService.publishEvent(
          'procurement.events',
          'procurement.conversation_request',
          {
            intent_type: 'order_inquiry',
            order_id: orderId,
            provider_id: (data as ProcurementOrderRow).provider_id,
            restaurant_id: restaurantId,
            wine_name: order.wineName || '',
            quantity: order.quantity,
            target_price: order.negotiatedPrice || order.quotedPrice || 0,
            max_acceptable_price: (order.negotiatedPrice || order.quotedPrice || 0) * 1.1,
            urgency: order.isEmergency ? 'high' : 'normal',
            channel_preference: 'email',
          },
        );
        this.logger.log(`Conversation intent published for order ${orderId}`);
      } catch (err: any) {
        this.logger.error(`Failed to publish conversation intent: ${err?.message}`);
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
      .from('procurement_orders')
      .update({
        status: ProcurementOrderStatus.DELIVERED,
        delivered_at: new Date().toISOString(),
        received_by: userId,
        quantity_received: quantityReceived ?? null,
      })
      .eq('restaurant_id', restaurantId)
      .eq('id', orderId)
      .select('*, inventory:inventory_id(wine_name)')
      .single();

    if (error) {
      this.logger.error('Failed to mark procurement order delivered', {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name: row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    };

    const order = this.mapOrderRow(orderRow);

    const resolvedQuantity = quantityReceived ?? order.quantity ?? 0;

    if (order.inventoryId && resolvedQuantity > 0) {
      const idempotencyKey = `order-delivered:${orderId}`;
      const { data: existingEvent } = await this.databaseService.supabase
        .from('inventory_events')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (!existingEvent) {
        try {
          const { data: inventoryRow, error: inventoryError } = await this.databaseService.supabase
            .from('restaurant_inventory')
            .select('master_wine_id')
            .eq('restaurant_id', restaurantId)
            .eq('id', order.inventoryId)
            .single();

          const masterWineId = inventoryError ? null : inventoryRow?.master_wine_id;

          if (masterWineId) {
            const { data: currentStock } = await this.databaseService.supabase
              .from('restaurant_inventory')
              .select('shadow_stock, stock_live')
              .eq('restaurant_id', restaurantId)
              .eq('id', order.inventoryId)
              .single();

            const currentShadow = currentStock?.shadow_stock ?? 0;
            const currentLive = currentStock?.stock_live ?? 0;

            await this.databaseService.supabase
              .from('restaurant_inventory')
              .update({
                shadow_stock: Math.max(0, currentShadow - resolvedQuantity),
                stock_live: currentLive + resolvedQuantity,
              })
              .eq('restaurant_id', restaurantId)
              .eq('id', order.inventoryId);

            await this.inventoryLedgerService.createTransaction(restaurantId, userId, {
              inventoryId: order.inventoryId,
              wineId: masterWineId,
              transactionType: TransactionType.PURCHASE,
              source: TransactionSource.ORDER,
              quantityChange: resolvedQuantity,
              stockType: StockType.LIVE,
              orderId,
              referenceType: 'order',
              referenceId: orderId,
              reason: 'Order delivered — shadow to physical conversion',
            });
          }

          await this.databaseService.supabase.from('inventory_events').insert({
            restaurant_id: restaurantId,
            inventory_id: order.inventoryId,
            master_wine_id: masterWineId ?? null,
            event_type: 'order_delivered',
            quantity_change: resolvedQuantity,
            source: 'procurement',
            idempotency_key: idempotencyKey,
            metadata: {
              orderId,
              deliveredAt: order.deliveredAt,
            },
          });
        } catch (eventError) {
          this.logger.warn('Failed to record inventory event for delivered order', {
            orderId,
            error: eventError?.message ?? eventError,
          });
        }
      }
    }

    // Update calendar event to COMPLETED on delivery
    await this.updateCalendarEventForDelivery(restaurantId, orderId, order);

    // Emit order_change event for cross-page sync (triggers inventory update)
    await this.emitOrderChangeEvent(restaurantId, userId, order, 'delivered');

    return order;
  }

  /**
   * Create a calendar event when an order is approved (expected delivery date)
   */
  private async createCalendarEventForOrder(
    restaurantId: string,
    order: OrderResponseDto,
    trigger: 'approved' | 'created',
  ): Promise<void> {
    try {
      // Calculate expected delivery date (7 days from now if not specified)
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + 7);
      const eventDate = expectedDate.toISOString().split('T')[0];

      const { error } = await this.databaseService.supabase
        .from('calendar_events')
        .insert({
          restaurant_id: restaurantId,
          title: `Delivery: ${order.orderNumber}`,
          description: `Expected delivery for order ${order.orderNumber} (${order.quantity} bottles)`,
          event_type: 'delivery',
          event_date: eventDate,
          event_time: '10:00',
          all_day: false,
          status: 'SCHEDULED',
          priority: order.isEmergency ? 'HIGH' : 'MEDIUM',
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
        this.logger.warn(`Failed to create calendar event for order ${order.id}: ${error.message}`);
      } else {
        this.logger.log(`Calendar event created for order ${order.orderNumber} delivery`);
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
        .from('calendar_events')
        .select('id, tags')
        .eq('restaurant_id', restaurantId)
        .eq('event_type', 'delivery')
        .neq('status', 'COMPLETED');

      // Find the event that references this order
      const matchingEvent = (events || []).find(e => {
        try {
          const tags = typeof e.tags === 'string' ? JSON.parse(e.tags) : e.tags;
          return tags?.order_id === orderId;
        } catch {
          return false;
        }
      });

      if (matchingEvent) {
        await this.databaseService.supabase
          .from('calendar_events')
          .update({
            status: 'COMPLETED',
            description: `Delivered: ${order.orderNumber} (${order.quantity} bottles). Actual delivery: ${order.deliveredAt}`,
          })
          .eq('id', matchingEvent.id);

        this.logger.log(`Calendar event updated to COMPLETED for order ${order.orderNumber}`);
      }
    } catch (e) {
      this.logger.warn(`Calendar event update on delivery failed: ${e?.message}`);
    }
  }

  async listPendingOrders(
    restaurantId: string,
  ): Promise<OrderResponseDto[]> {
    const { data, error } = await this.databaseService.supabase
      .from('procurement_orders')
      .select('*, inventory:inventory_id(wine_name)')
      .eq('restaurant_id', restaurantId)
      .in('status', [
        ProcurementOrderStatus.PENDING,
        ProcurementOrderStatus.APPROVAL_NEEDED,
      ])
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to list pending orders', {
        restaurantId,
        error: error.message,
      });
      return [];
    }

    return (data || []).map((row: any) => {
      const orderRow: ProcurementOrderRow = {
        ...row,
        wine_name: row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
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
      .padStart(5, '0');
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
    const updatePayload: Record<string, any> = {
      status: 'APPROVED',
      sent_at: new Date().toISOString(),
    };
    if (dto.modifiedContent) {
      updatePayload.content = dto.modifiedContent;
    }

    const { data, error } = await this.databaseService.supabase
      .from('procurement_conversations')
      .update(updatePayload)
      .eq('restaurant_id', restaurantId)
      .eq('order_id', orderId)
      .eq('status', 'PENDING_APPROVAL')
      .select('id, sent_at')
      .single();

    if (error) {
      this.logger.error('approveDraft failed', { restaurantId, orderId, error: error.message });
      throw error;
    }

    if (this.orchestratorService) {
      await this.orchestratorService.publishEvent(
        'provider.events',
        'provider.draft.approved',
        {
          conversation_id: (data as any).id,
          order_id: orderId,
          restaurant_id: restaurantId,
          modified_content: dto.modifiedContent ?? null,
          manager_notes: dto.managerNotes ?? null,
        },
      );
    }

    // Create calendar delivery event NOW — only after manager approves the draft email.
    // This means we've actually communicated with the provider, so the expected
    // delivery window is meaningful.
    try {
      const { data: orderRow } = await this.databaseService.supabase
        .from('procurement_orders')
        .select('*, inventory:inventory_id(wine_name)')
        .eq('id', orderId)
        .eq('restaurant_id', restaurantId)
        .single();
      if (orderRow) {
        const raw = orderRow as any;
        const mappedRow: ProcurementOrderRow = {
          ...raw,
          wine_name: raw.inventory?.wine_name || null,
        };
        await this.createCalendarEventForOrder(restaurantId, this.mapOrderRow(mappedRow), 'approved');
      }
    } catch (e: any) {
      this.logger.warn(`Calendar creation after draft approval failed: ${e?.message}`);
    }

    return { conversationId: (data as any).id, sentAt: (data as any).sent_at };
  }

  async discardDraft(
    restaurantId: string,
    orderId: string,
  ): Promise<{ success: boolean }> {
    const { data, error } = await this.databaseService.supabase
      .from('procurement_conversations')
      .update({ status: 'DISCARDED' })
      .eq('restaurant_id', restaurantId)
      .eq('order_id', orderId)
      .eq('status', 'PENDING_APPROVAL')
      .select('id');

    if (error) {
      this.logger.error('discardDraft failed', { restaurantId, orderId, error: error.message });
      throw error;
    }

    if (!data || (data as any[]).length === 0) {
      throw new NotFoundException(
        `No PENDING_APPROVAL draft found for order ${orderId}`,
      );
    }

    if (this.orchestratorService) {
      await this.orchestratorService.publishEvent(
        'provider.events',
        'provider.draft.discarded',
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
      throw new BadRequestException('Draft content cannot be empty');
    }

    const { data, error } = await this.databaseService.supabase
      .from('procurement_conversations')
      .update({ content: newContent })
      .eq('restaurant_id', restaurantId)
      .eq('order_id', orderId)
      .eq('status', 'PENDING_APPROVAL')
      .select('id');

    if (error) {
      this.logger.error('editDraft failed', { restaurantId, orderId, error: error.message });
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
      .from('procurement_conversations')
      .select('id, content, message_text, outbound_email_type, constraint_flags, round_count, created_at')
      .eq('restaurant_id', restaurantId)
      .eq('order_id', orderId)
      .eq('status', 'PENDING_APPROVAL')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) return null;
    if (!data) return null;
    // Normalise: prefer the newer `content` column; fall back to the original `message_text`
    return { ...data, content: data.content ?? (data as any).message_text ?? null };
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
      .from('procurement_conversations')
      .select(`
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
        providers!left(name)
      `)
      .eq('restaurant_id', restaurantId)
      .eq('status', 'PENDING_APPROVAL')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('getActiveConversations failed', { restaurantId, error: error.message });
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
    }));
  }

  /**
   * Returns completed/sent procurement conversations for send history.
   * D-03: Used by the Procurement Emails tab on /communications.
   */
  async getConversationHistory(restaurantId: string): Promise<any[]> {
    const HISTORY_STATUSES = ['AUTO_SENT', 'APPROVED', 'SENT', 'COMPLETED', 'CLOSED'];

    const { data, error } = await this.databaseService.supabase
      .from('procurement_conversations')
      .select(`
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
      `)
      .eq('restaurant_id', restaurantId)
      .in('status', HISTORY_STATUSES)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      this.logger.error('getConversationHistory failed', { restaurantId, error: error.message });
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
}
