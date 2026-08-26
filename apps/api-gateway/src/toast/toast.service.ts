import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  Optional,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import axios, { AxiosInstance } from "axios";
import { isSafePathSegment } from "../common/http/safe-path";
import { CacheService } from "../common/cache/cache.service";
import { DatabaseService } from "../database/database.service";
import { LowStockAlertsService } from "../notifications/low-stock-alerts.service";
import { ToastMenuDto, ToastMenuListResponseDto } from "./dto/toast-menu.dto";
import {
  CreateToastOrderDto,
  ToastOrderResponseDto,
  ToastSalesResponseDto,
  ToastSalesDataDto,
  ToastOrderStatus,
} from "./dto/toast-order.dto";
import {
  ToastWebhookDto,
  ToastWebhookResponseDto,
  ToastWebhookEventType,
} from "./dto/toast-webhook.dto";

/**
 * Toast API Service
 *
 * Provides proxy endpoints for Toast POS API:
 * - Handles OAuth token management
 * - Proxies requests to FastAPI agent-orchestrator
 * - Provides mock data fallback
 * - Implements retry logic and error handling
 */
@Injectable()
export class ToastService {
  private readonly logger = new Logger(ToastService.name);
  private readonly agentOrchestratorUrl: string;
  private readonly httpClient: AxiosInstance;
  private readonly cacheTtlSeconds: number;
  private readonly webhookSecret: string | null;

  // Mock mode flag
  private readonly mockMode: boolean;

  // Webhook metrics
  private webhookMetrics = {
    received: 0,
    processed: 0,
    errors: 0,
    byType: {} as Record<string, number>,
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly databaseService: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => LowStockAlertsService))
    private readonly lowStockAlerts?: LowStockAlertsService,
  ) {
    this.agentOrchestratorUrl = this.configService.get<string>(
      "AGENT_ORCHESTRATOR_URL",
      "http://localhost:8000",
    );

    this.mockMode = this.configService.get<boolean>("TOAST_MOCK_MODE", true);
    this.cacheTtlSeconds = this.configService.get<number>(
      "TOAST_CACHE_TTL_SECONDS",
      300,
    );
    this.webhookSecret = this.configService.get<string>(
      "TOAST_WEBHOOK_SECRET",
      null,
    );

    this.httpClient = axios.create({
      baseURL: this.agentOrchestratorUrl,
      timeout: 30000,
    });

    this.logger.log(`Toast service initialized (mock mode: ${this.mockMode})`);

    if (!this.webhookSecret) {
      this.logger.warn(
        "TOAST_WEBHOOK_SECRET not configured - webhook signature verification disabled",
      );
    }
  }

  // ==================== Webhook Methods ====================

  /**
   * Verify Toast webhook signature
   * Toast uses HMAC-SHA256 to sign webhook payloads
   *
   * @param payload Raw request body
   * @param signature Signature from Toast-Signature header
   * @param timestamp Timestamp from Toast-Timestamp header
   * @returns true if signature is valid
   */
  /**
   * Whether an UNSIGNED webhook must be rejected.
   *
   * Mock mode may accept unsigned webhooks in dev/test only. In production the
   * escape is closed unconditionally: TOAST_MOCK_MODE defaults to TRUE
   * (constructor above), so any deploy that never set the variable would
   * otherwise accept unsigned stock mutations from anyone on the internet —
   * found 2026-08-25 by the external-connections verification. Same posture as
   * pos-hub, which has no mock escape at all.
   */
  private enforceSignature(): boolean {
    return !this.mockMode || process.env.NODE_ENV === "production";
  }

  verifyWebhookSignature(
    payload: string,
    signature: string,
    timestamp: string,
  ): boolean {
    if (!this.webhookSecret) {
      // SimPOS testbed plan (decision B16): fail closed. A missing
      // TOAST_WEBHOOK_SECRET must reject every signed request, not wave
      // everything through — mock mode (this.mockMode, checked by callers)
      // is the intended way to run without a real secret.
      this.logger.error(
        "Webhook signature verification failed - no secret configured (fail closed)",
      );
      return false;
    }

    try {
      // Toast signature format: v1=<signature>
      const signatureParts = signature.split("=");
      if (signatureParts.length !== 2 || signatureParts[0] !== "v1") {
        this.logger.error("Invalid signature format");
        return false;
      }

      const receivedSignature = signatureParts[1];

      // Build the signed payload: timestamp.payload
      const signedPayload = `${timestamp}.${payload}`;

      // Compute expected signature
      const expectedSignature = crypto
        .createHmac("sha256", this.webhookSecret)
        .update(signedPayload)
        .digest("hex");

      // Constant-time comparison to prevent timing attacks
      const isValid = crypto.timingSafeEqual(
        Buffer.from(receivedSignature, "hex"),
        Buffer.from(expectedSignature, "hex"),
      );

      if (!isValid) {
        this.logger.error({
          message: "Webhook signature verification failed",
          timestamp,
        });
      }

      return isValid;
    } catch (error) {
      this.logger.error({
        message: "Webhook signature verification error",
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Process incoming Toast webhook
   * Routes to appropriate handler based on event type
   */
  async processWebhook(
    webhookDto: ToastWebhookDto,
    rawBody: string,
    signature: string | null,
    timestamp: string | null,
  ): Promise<ToastWebhookResponseDto> {
    const startTime = Date.now();
    this.webhookMetrics.received++;
    this.webhookMetrics.byType[webhookDto.eventType] =
      (this.webhookMetrics.byType[webhookDto.eventType] || 0) + 1;

    this.logger.log({
      message: "Toast webhook received",
      eventId: webhookDto.eventId,
      eventType: webhookDto.eventType,
      restaurantGuid: webhookDto.restaurantGuid,
      timestamp: webhookDto.timestamp,
    });

    try {
      // Verify signature if provided
      if (signature && timestamp) {
        const isValid = this.verifyWebhookSignature(
          rawBody,
          signature,
          timestamp,
        );
        if (!isValid) {
          this.webhookMetrics.errors++;
          throw new HttpException(
            "Invalid webhook signature",
            HttpStatus.UNAUTHORIZED,
          );
        }
      } else if (!this.webhookSecret && this.enforceSignature()) {
        // Secret not configured: previously this fell through and accepted an
        // unsigned webhook silently. Refuse instead — a POS ingress route
        // that mutates stock must never accept unverifiable input.
        this.webhookMetrics.errors++;
        throw new HttpException(
          "Toast webhook rejected: TOAST_WEBHOOK_SECRET is not configured",
          HttpStatus.UNAUTHORIZED,
        );
      } else if (this.webhookSecret && this.enforceSignature()) {
        // Secret configured but caller sent no signature — already fail-closed.
        this.webhookMetrics.errors++;
        throw new HttpException(
          "Missing webhook signature",
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Find internal restaurant ID from Toast GUID
      const restaurantId = await this.resolveRestaurantId(
        webhookDto.restaurantGuid,
      );

      // Route to appropriate handler
      let internalEventId: string | undefined;

      switch (webhookDto.eventType) {
        case ToastWebhookEventType.ORDER_CREATED:
        case ToastWebhookEventType.ORDER_UPDATED:
        case ToastWebhookEventType.ORDER_CLOSED:
        case ToastWebhookEventType.ORDER_PAID:
        case ToastWebhookEventType.ORDER_VOIDED:
          internalEventId = await this.handleOrderWebhook(
            restaurantId,
            webhookDto,
          );
          break;

        case ToastWebhookEventType.STOCK_UPDATED:
        case ToastWebhookEventType.STOCK_OUT:
        case ToastWebhookEventType.STOCK_LOW:
          internalEventId = await this.handleStockWebhook(
            restaurantId,
            webhookDto,
          );
          break;

        case ToastWebhookEventType.MENU_UPDATED:
        case ToastWebhookEventType.MENU_ITEM_CREATED:
        case ToastWebhookEventType.MENU_ITEM_UPDATED:
        case ToastWebhookEventType.MENU_ITEM_DELETED:
          internalEventId = await this.handleMenuWebhook(
            restaurantId,
            webhookDto,
          );
          break;

        case ToastWebhookEventType.WEBHOOK_VERIFICATION:
          // Toast sends this to verify the webhook endpoint is working
          this.logger.log("Toast webhook verification received");
          break;

        default:
          this.logger.warn({
            message: "Unknown webhook event type",
            eventType: webhookDto.eventType,
            eventId: webhookDto.eventId,
          });
      }

      this.webhookMetrics.processed++;

      const response: ToastWebhookResponseDto = {
        status: "processed",
        eventId: webhookDto.eventId,
        internalEventId,
        processedAt: new Date().toISOString(),
      };

      this.logger.log({
        message: "Toast webhook processed",
        eventId: webhookDto.eventId,
        eventType: webhookDto.eventType,
        internalEventId,
        durationMs: Date.now() - startTime,
      });

      return response;
    } catch (error) {
      this.webhookMetrics.errors++;

      this.logger.error({
        message: "Toast webhook processing failed",
        eventId: webhookDto.eventId,
        eventType: webhookDto.eventType,
        error: error.message,
        durationMs: Date.now() - startTime,
      });

      if (error instanceof HttpException) {
        throw error;
      }

      return {
        status: "error",
        eventId: webhookDto.eventId,
        message: error.message,
        processedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Resolve internal restaurant ID from Toast restaurant GUID
   */
  private async resolveRestaurantId(toastGuid: string): Promise<string> {
    // Try to find restaurant by toast_restaurant_guid
    const { data, error } = await this.databaseService.supabase
      .from("restaurants")
      .select("id")
      .eq("toast_restaurant_guid", toastGuid)
      .single();

    if (error || !data) {
      this.logger.warn({
        message: "Restaurant not found for Toast GUID",
        toastGuid,
      });
      // Return a default/system restaurant ID for unmapped webhooks
      // In production, this should throw or queue for manual review
      return "system";
    }

    return data.id;
  }

  /**
   * Handle order-related webhooks
   * Creates an event in the events table for real-time propagation
   */
  private async handleOrderWebhook(
    restaurantId: string,
    webhookDto: ToastWebhookDto,
  ): Promise<string | undefined> {
    if (!webhookDto.order) {
      this.logger.warn("Order webhook missing order payload");
      return undefined;
    }

    // Map Toast event type to internal event type
    const eventTypeMap: Record<string, string> = {
      [ToastWebhookEventType.ORDER_CREATED]: "pos_order_created",
      [ToastWebhookEventType.ORDER_UPDATED]: "pos_order_updated",
      [ToastWebhookEventType.ORDER_CLOSED]: "pos_order_closed",
      [ToastWebhookEventType.ORDER_PAID]: "pos_order_paid",
      [ToastWebhookEventType.ORDER_VOIDED]: "pos_order_voided",
    };

    const eventPayload = {
      toast_event_id: webhookDto.eventId,
      toast_order_guid: webhookDto.order.guid,
      order_number: webhookDto.order.orderNumber,
      table_name: webhookDto.order.tableName,
      server_name: webhookDto.order.serverName,
      items: webhookDto.order.items?.map((item) => ({
        toast_item_guid: item.guid,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        sku: item.sku,
        category: item.category,
      })),
      subtotal: webhookDto.order.subtotal,
      tax: webhookDto.order.tax,
      total: webhookDto.order.total,
      status: webhookDto.order.status,
      toast_created_at: webhookDto.order.createdAt,
      toast_closed_at: webhookDto.order.closedAt,
    };

    // Insert into events table for cross-page sync
    const { data, error } = await this.databaseService.supabase
      .from("events")
      .insert({
        restaurant_id: restaurantId,
        event_type: eventTypeMap[webhookDto.eventType] || "pos_event",
        source_page: "toast_webhook",
        payload: eventPayload,
        schema_version: 1,
        idempotency_key: `toast_${webhookDto.eventId}`,
        trace_id: webhookDto.eventId,
      })
      .select("id")
      .single();

    if (error) {
      // Check for duplicate (idempotency)
      if (error.code === "23505") {
        this.logger.log({
          message: "Duplicate webhook event (idempotent)",
          eventId: webhookDto.eventId,
        });
        return undefined;
      }
      throw error;
    }

    // Phase 2 POS→pour: a completed sale decrements inventory (glass → pour, bottle → movement).
    await this.applyOrderSaleEffects(restaurantId, webhookDto);

    // Forward to agent orchestrator for processing
    await this.forwardToOrchestrator("order", webhookDto);

    return data?.id;
  }

  /**
   * Phase 2 POS→pour: turn a completed Toast order into inventory movements.
   * order.paid / order.closed → decrement (glass sale = record_glass_pour, bottle sale =
   * apply_stock_movement). order.voided → reverse. Idempotent per (order, menu item), so
   * retries and closed-then-paid both apply exactly once.
   */
  private async applyOrderSaleEffects(
    restaurantId: string,
    webhookDto: ToastWebhookDto,
  ): Promise<void> {
    const et = webhookDto.eventType;
    const isSale =
      et === ToastWebhookEventType.ORDER_PAID ||
      et === ToastWebhookEventType.ORDER_CLOSED;
    const isVoid = et === ToastWebhookEventType.ORDER_VOIDED;
    if (!isSale && !isVoid) return; // created/updated aren't final — skip
    const order = webhookDto.order;
    const items = order?.items ?? [];
    if (!order || items.length === 0) return;

    const db = this.databaseService.supabase;
    const affectedInventoryIds = new Set<string>();

    for (const line of items) {
      const menuGuid = line.guid;
      const qty = Math.max(0, Math.round(line.quantity ?? 0));
      if (!menuGuid || qty <= 0) continue;

      // Mapping-table-first resolution (decision B21/B22): pos_item_mappings
      // is the provider-agnostic table (source='toast', external_item_id=
      // Toast's item guid). toast_item_mappings is retired — its extra
      // columns (sale_unit, sales rollups) were migrated onto
      // pos_item_mappings in the SimPOS testbed spine repair.
      const { data: mapping } = await db
        .from("pos_item_mappings")
        .select("inventory_id, sale_unit, item_name")
        .eq("restaurant_id", restaurantId)
        .in("source", ["toast", "*"])
        .eq("external_item_id", menuGuid)
        .maybeSingle();

      let inventoryId = mapping?.inventory_id as string | undefined;
      // B36: sale unit comes from the mapping row only — never inferred
      // from the item name. A wrong glass/bottle unit is a silent cost
      // error, so an unmapped sale unit falls back to "bottle" rather than
      // guessing from a name-regex.
      const saleUnit =
        (mapping?.sale_unit as "glass" | "bottle" | null) ?? null;

      // Fallback: single-guid mapping on restaurant_inventory.toast_item_guid
      // (pre-dates pos_item_mappings; still honoured for older data, sale
      // unit still resolved through the mapping table only).
      if (!inventoryId) {
        const { data: inv } = await db
          .from("restaurant_inventory")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .eq("toast_item_guid", menuGuid)
          .maybeSingle();
        inventoryId = inv?.id as string | undefined;
      }

      if (!inventoryId) {
        // B20: an unmapped POS line is queued for review, never silently
        // dropped. supabase-js resolves { error } rather than throwing on
        // the partial unique index, so a 23505 here just means it's
        // already queued and open.
        const { error: queueError } = await db
          .from("pos_unresolved_lines")
          .insert({
            restaurant_id: restaurantId,
            source: "toast",
            external_check_id: order.guid,
            external_item_id: menuGuid,
            item_name: line.name ?? mapping?.item_name ?? "unknown",
            qty,
            price: line.unitPrice ?? null,
            raw: line,
          });
        if (queueError && queueError.code !== "23505") {
          this.logger.warn(
            `Failed to queue unresolved Toast line ${line.name}: ${queueError.message}`,
          );
        }
        continue;
      }

      const unit: "glass" | "bottle" = saleUnit ?? "bottle";
      // B15-equivalent idempotency key for the Toast door specifically.
      const idem = `toast_${isVoid ? "void" : "sale"}_${order.guid}_${menuGuid}`;

      // supabase-js resolves RPC failures as { error } rather than
      // throwing — checked explicitly so a failed depletion never reports
      // success silently (the same class of bug the receiving-door fix
      // addressed).
      let rpcError: { message?: string } | null = null;
      try {
        if (unit === "glass") {
          if (isVoid) {
            // B19: voids reverse glasses as well as bottles.
            // record_glass_pour has no reversal mode, so a glass void is
            // booked as a live-stock return of the equivalent glass count —
            // previously this branch logged a warning and skipped entirely.
            ({ error: rpcError } = await db.rpc("apply_stock_movement", {
              p_inventory_id: inventoryId,
              p_stock_state: "live",
              p_delta: qty,
              p_transaction_type: "return",
              p_source: "pos",
              p_reason: `POS void (glass): ${line.name}`,
              p_idempotency_key: idem,
            }));
          } else {
            ({ error: rpcError } = await db.rpc("record_glass_pour", {
              p_inventory_id: inventoryId,
              p_pours: qty,
              p_pour_ml: null,
              p_location_id: null,
              p_source: "pos",
              p_reason: `POS sale: ${line.name}`,
              p_idempotency_key: idem,
            }));
          }
        } else {
          ({ error: rpcError } = await db.rpc("apply_stock_movement", {
            p_inventory_id: inventoryId,
            p_stock_state: "live",
            p_delta: isVoid ? qty : -qty,
            p_transaction_type: isVoid ? "return" : "sale",
            p_source: "pos",
            p_reason: `POS ${isVoid ? "void" : "sale"}: ${line.name}`,
            p_idempotency_key: idem,
          }));
        }
        if (rpcError) {
          this.logger.warn(
            `POS sale effect failed for ${line.name} (${unit}): ${rpcError.message}`,
          );
        } else {
          affectedInventoryIds.add(inventoryId);
        }
      } catch (err: any) {
        this.logger.warn(
          `POS sale effect threw for ${line.name} (${unit}): ${err?.message}`,
        );
      }
    }

    // Real-time low-stock edge check for every wine this order touched — one
    // grouped alert if any just crossed par. Fire-and-forget so POS ingestion
    // is never slowed or blocked by alerting.
    if (this.lowStockAlerts && affectedInventoryIds.size > 0) {
      void this.lowStockAlerts
        .evaluateInventoryItems(restaurantId, [...affectedInventoryIds])
        .catch(() => undefined);
    }
  }

  /**
   * Handle stock/inventory webhooks
   */
  private async handleStockWebhook(
    restaurantId: string,
    webhookDto: ToastWebhookDto,
  ): Promise<string | undefined> {
    if (!webhookDto.stock) {
      this.logger.warn("Stock webhook missing stock payload");
      return undefined;
    }

    const eventPayload = {
      toast_event_id: webhookDto.eventId,
      toast_item_guid: webhookDto.stock.itemGuid,
      item_name: webhookDto.stock.itemName,
      quantity: webhookDto.stock.quantity,
      previous_quantity: webhookDto.stock.previousQuantity,
      reason: webhookDto.stock.reason,
      status: webhookDto.stock.status,
    };

    // Insert into events table
    const { data, error } = await this.databaseService.supabase
      .from("events")
      .insert({
        restaurant_id: restaurantId,
        event_type: `pos_stock_${webhookDto.eventType.split(".")[1]}`,
        source_page: "toast_webhook",
        payload: eventPayload,
        schema_version: 1,
        idempotency_key: `toast_${webhookDto.eventId}`,
        trace_id: webhookDto.eventId,
      })
      .select("id")
      .single();

    if (error && error.code !== "23505") {
      throw error;
    }

    // Invalidate menu cache since stock changed
    await this.cacheService.invalidateByPattern("toast:menu*");

    // Forward to agent orchestrator
    await this.forwardToOrchestrator("stock", webhookDto);

    return data?.id;
  }

  /**
   * Handle menu-related webhooks
   */
  private async handleMenuWebhook(
    restaurantId: string,
    webhookDto: ToastWebhookDto,
  ): Promise<string | undefined> {
    // Invalidate menu cache immediately
    if (webhookDto.menu?.menuGuid) {
      await this.cacheService.del(
        this.getMenuCacheKey(webhookDto.menu.menuGuid),
      );
    }
    await this.cacheService.invalidateByPattern("toast:menus:*");

    const eventPayload = {
      toast_event_id: webhookDto.eventId,
      menu_guid: webhookDto.menu?.menuGuid,
      menu_name: webhookDto.menu?.menuName,
      changed_items: webhookDto.menu?.changedItems,
    };

    // Insert into events table
    const { data, error } = await this.databaseService.supabase
      .from("events")
      .insert({
        restaurant_id: restaurantId,
        event_type: webhookDto.eventType.replace(".", "_"),
        source_page: "toast_webhook",
        payload: eventPayload,
        schema_version: 1,
        idempotency_key: `toast_${webhookDto.eventId}`,
        trace_id: webhookDto.eventId,
      })
      .select("id")
      .single();

    if (error && error.code !== "23505") {
      throw error;
    }

    return data?.id;
  }

  /**
   * Forward webhook to agent orchestrator for processing
   */
  private async forwardToOrchestrator(
    type: "order" | "stock" | "menu",
    webhookDto: ToastWebhookDto,
  ): Promise<void> {
    try {
      await this.httpClient.post(`/api/v1/toast/webhooks/${type}`, {
        event_id: webhookDto.eventId,
        event_type: webhookDto.eventType,
        restaurant_guid: webhookDto.restaurantGuid,
        timestamp: webhookDto.timestamp,
        payload:
          webhookDto.order ||
          webhookDto.stock ||
          webhookDto.menu ||
          webhookDto.data,
      });
    } catch (error) {
      // Log but don't fail - the event is already persisted
      this.logger.warn({
        message: "Failed to forward webhook to orchestrator",
        eventId: webhookDto.eventId,
        error: error.message,
      });
    }
  }

  /**
   * Get webhook processing metrics
   */
  getWebhookMetrics() {
    return { ...this.webhookMetrics };
  }

  /**
   * Get all menus
   */
  async getMenus(restaurantId: string): Promise<ToastMenuListResponseDto> {
    this.logger.log(`Fetching menus for restaurant: ${restaurantId}`);

    if (this.mockMode) {
      return this.getMockMenus();
    }

    const cacheKey = this.getMenusCacheKey(restaurantId);
    const cached =
      await this.cacheService.get<ToastMenuListResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.httpClient.get("/api/v1/toast/menus", {
        params: { restaurant_id: restaurantId },
      });
      await this.cacheService.set(
        cacheKey,
        response.data,
        this.cacheTtlSeconds,
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch menus: ${error.message}`);
      // Fallback to mock data
      return this.getMockMenus();
    }
  }

  /**
   * Get a single menu by ID
   */
  async getMenu(menuId: string): Promise<ToastMenuDto> {
    // CodeQL js/request-forgery (open since 2026-07-08). menuId comes from
    // @Param("menuId") and is interpolated into the outbound URL below; Express decodes
    // params, so `%2f` becomes a real slash and `..%2f..%2f…` escapes the /toast/ prefix
    // into the internal orchestrator. Validated before it can reach the template — and
    // before the cache key, so a hostile id cannot poison the cache either.
    if (!isSafePathSegment(menuId)) {
      this.logger.warn(
        `Rejected menu lookup for unsafe id: ${JSON.stringify(menuId).slice(0, 200)}`,
      );
      throw new HttpException("Invalid menu id", HttpStatus.BAD_REQUEST);
    }
    this.logger.log(`Fetching menu: ${menuId}`);

    if (this.mockMode) {
      const menus = this.getMockMenus();
      const menu = menus.menus.find((m) => m.guid === menuId);
      if (!menu) {
        throw new HttpException("Menu not found", HttpStatus.NOT_FOUND);
      }
      return menu;
    }

    const cacheKey = this.getMenuCacheKey(menuId);
    const cached = await this.cacheService.get<ToastMenuDto>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.httpClient.get(
        `/api/v1/toast/menus/${menuId}`,
      );
      await this.cacheService.set(
        cacheKey,
        response.data,
        this.cacheTtlSeconds,
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch menu: ${error.message}`);
      throw new HttpException(
        error.response?.data?.message || "Failed to fetch menu",
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async refreshMenuCache(
    restaurantId?: string,
    menuId?: string,
  ): Promise<number> {
    if (menuId) {
      await this.cacheService.del(this.getMenuCacheKey(menuId));
      return 1;
    }

    if (restaurantId) {
      await this.cacheService.del(this.getMenusCacheKey(restaurantId));
      return 1;
    }

    return this.cacheService.invalidateByPattern("toast:menus:*");
  }

  private getMenusCacheKey(restaurantId: string): string {
    return `toast:menus:${restaurantId}`;
  }

  private getMenuCacheKey(menuId: string): string {
    return `toast:menu:${menuId}`;
  }

  /**
   * Create a new order
   */
  async createOrder(
    restaurantId: string,
    dto: CreateToastOrderDto,
  ): Promise<ToastOrderResponseDto> {
    this.logger.log(`Creating order for restaurant: ${restaurantId}`);

    if (this.mockMode) {
      return this.createMockOrder(dto);
    }

    try {
      const response = await this.httpClient.post("/api/v1/toast/orders", {
        restaurant_id: restaurantId,
        ...dto,
      });
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to create order: ${error.message}`);
      throw new HttpException(
        error.response?.data?.message || "Failed to create order",
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get order by ID
   */
  async getOrder(orderId: string): Promise<ToastOrderResponseDto> {
    // Same defect and same reasoning as getMenu above (CodeQL js/request-forgery).
    if (!isSafePathSegment(orderId)) {
      this.logger.warn(
        `Rejected order lookup for unsafe id: ${JSON.stringify(orderId).slice(0, 200)}`,
      );
      throw new HttpException("Invalid order id", HttpStatus.BAD_REQUEST);
    }
    this.logger.log(`Fetching order: ${orderId}`);

    if (this.mockMode) {
      return this.getMockOrder(orderId);
    }

    try {
      const response = await this.httpClient.get(
        `/api/v1/toast/orders/${orderId}`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch order: ${error.message}`);
      throw new HttpException(
        error.response?.data?.message || "Failed to fetch order",
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get sales data for a time range
   */
  async getSalesData(
    restaurantId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<ToastSalesResponseDto> {
    this.logger.log(`Fetching sales data for restaurant: ${restaurantId}`);

    if (this.mockMode) {
      return this.getMockSalesData(startTime, endTime);
    }

    try {
      const response = await this.httpClient.get("/api/v1/toast/sales", {
        params: {
          restaurant_id: restaurantId,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
        },
      });
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch sales data: ${error.message}`);
      // Fallback to mock data
      return this.getMockSalesData(startTime, endTime);
    }
  }

  /**
   * Get Toast API statistics
   */
  async getStatistics(): Promise<any> {
    try {
      const response = await this.httpClient.get("/api/v1/toast/statistics");
      return response.data;
    } catch (error) {
      return {
        mode: this.mockMode ? "mock" : "real",
        status: "unknown",
        error: error.message,
      };
    }
  }

  // ==================== Mock Data Methods ====================

  private getMockMenus(): ToastMenuListResponseDto {
    const menus: ToastMenuDto[] = [
      {
        guid: "menu-wine-001",
        name: "Wine List",
        description: "Our curated selection of fine wines",
        isActive: true,
        groups: [
          {
            guid: "group-red-001",
            name: "Red Wines",
            description: "Full-bodied red wines",
            items: [
              {
                guid: "item-001",
                name: "Opus One 2019",
                description: "Napa Valley Bordeaux blend",
                price: 4500,
                category: "Red",
                isAvailable: true,
              },
              {
                guid: "item-002",
                name: "Caymus Cabernet 2020",
                description: "Napa Valley Cabernet Sauvignon",
                price: 2400,
                category: "Red",
                isAvailable: true,
              },
              {
                guid: "item-003",
                name: "Silver Oak Cabernet",
                description: "Alexander Valley Cabernet",
                price: 3800,
                category: "Red",
                isAvailable: true,
              },
            ],
          },
          {
            guid: "group-white-001",
            name: "White Wines",
            description: "Crisp and refreshing whites",
            items: [
              {
                guid: "item-004",
                name: "Cloudy Bay Sauvignon Blanc",
                description: "New Zealand Sauvignon Blanc",
                price: 1800,
                category: "White",
                isAvailable: true,
              },
              {
                guid: "item-005",
                name: "Rombauer Chardonnay",
                description: "Carneros Chardonnay",
                price: 2800,
                category: "White",
                isAvailable: true,
              },
            ],
          },
          {
            guid: "group-sparkling-001",
            name: "Sparkling",
            description: "Champagne and sparkling wines",
            items: [
              {
                guid: "item-006",
                name: "Dom Pérignon 2012",
                description: "Vintage Champagne",
                price: 8500,
                category: "Sparkling",
                isAvailable: true,
              },
              {
                guid: "item-007",
                name: "Veuve Clicquot Brut",
                description: "Yellow Label Champagne",
                price: 5500,
                category: "Sparkling",
                isAvailable: true,
              },
            ],
          },
        ],
      },
    ];

    return {
      menus,
      total: menus.length,
    };
  }

  private createMockOrder(dto: CreateToastOrderDto): ToastOrderResponseDto {
    const subtotal = dto.items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    const tax = Math.round(subtotal * 0.0875); // 8.75% tax
    const total = subtotal + tax;

    return {
      guid: `mock-order-${Date.now()}`,
      orderNumber: `ORD-${Math.floor(Math.random() * 10000)}`,
      status: ToastOrderStatus.OPEN,
      tableName: dto.tableName,
      serverName: dto.serverName,
      items: dto.items,
      subtotal,
      tax,
      total,
      createdAt: new Date().toISOString(),
    };
  }

  private getMockOrder(orderId: string): ToastOrderResponseDto {
    return {
      guid: orderId,
      orderNumber: `ORD-${Math.floor(Math.random() * 10000)}`,
      status: ToastOrderStatus.CLOSED,
      tableName: "Table 5",
      serverName: "Alex",
      items: [
        {
          itemGuid: "item-001",
          name: "Opus One 2019",
          quantity: 1,
          unitPrice: 4500,
        },
      ],
      subtotal: 4500,
      tax: 394,
      total: 4894,
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      closedAt: new Date().toISOString(),
    };
  }

  private getMockSalesData(
    startTime: Date,
    endTime: Date,
  ): ToastSalesResponseDto {
    const mockWines = [
      { name: "Opus One 2019", type: "red", price: 45.0 },
      { name: "Caymus Cabernet 2020", type: "red", price: 24.0 },
      { name: "Whispering Angel Rosé", type: "rosé", price: 16.0 },
      { name: "Cloudy Bay Sauvignon Blanc", type: "white", price: 18.0 },
      { name: "Dom Pérignon 2012", type: "sparkling", price: 85.0 },
    ];

    const sales: ToastSalesDataDto[] = [];
    const hours = Math.ceil(
      (endTime.getTime() - startTime.getTime()) / 3600000,
    );

    // Generate ~2-5 sales per hour
    for (let h = 0; h < hours; h++) {
      const numSales = Math.floor(Math.random() * 4) + 2;

      for (let i = 0; i < numSales; i++) {
        const wine = mockWines[Math.floor(Math.random() * mockWines.length)];
        const quantity = Math.random() > 0.7 ? 2 : 1;
        const saleTime = new Date(
          startTime.getTime() + h * 3600000 + Math.random() * 3600000,
        );

        sales.push({
          id: `sale-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          orderGuid: `order-${Math.random().toString(36).substr(2, 9)}`,
          itemName: wine.name,
          wineType: wine.type,
          quantity,
          unitPrice: wine.price,
          totalPrice: wine.price * quantity,
          timestamp: saleTime.toISOString(),
          serverName: ["Alex", "Jordan", "Sam", "Taylor"][
            Math.floor(Math.random() * 4)
          ],
          tableName: `Table ${Math.floor(Math.random() * 20) + 1}`,
          source: "mock",
        });
      }
    }

    const totalRevenue = sales.reduce((sum, sale) => sum + sale.totalPrice, 0);

    return {
      sales,
      total: sales.length,
      totalRevenue,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };
  }
}
