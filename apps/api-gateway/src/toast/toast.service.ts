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
import {
  PosHubService,
  webhookTimestampIsFresh,
  WEBHOOK_FRESHNESS_MS,
} from "../pos-hub/pos-hub.service";
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
import { ToastUpstream, TOAST_UPSTREAM_ROUTES } from "./toast-upstream";

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

  /**
   * Derives the refusal for every failed `/api/v1/toast/*` call — 501 when the
   * orchestrator has no such route, 503 when it has one but could not serve it.
   * See `toast-upstream.ts` for why this is derived rather than written out at
   * each of the six call sites.
   */
  private readonly upstream: ToastUpstream;

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
    // F-642: a Toast order is a check, and goes where every other till's
    // checks go. The hub raises the low-stock alert this service raised.
    @Optional()
    @Inject(forwardRef(() => PosHubService))
    private readonly posHub?: PosHubService,
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
    // `string | null`, because the default IS null — the secret is genuinely
    // optional and `verifyWebhookSignature` already branches on its absence.
    // Typing it `string` while defaulting to null is how "the secret is set"
    // became unfalsifiable at the type level.
    this.webhookSecret = this.configService.get<string | null>(
      "TOAST_WEBHOOK_SECRET",
      null,
    );

    this.httpClient = axios.create({
      baseURL: this.agentOrchestratorUrl,
      timeout: 30000,
    });

    // The single place a failure status for /api/v1/toast/* is decided. Reads
    // `this.httpClient` through a closure rather than capturing it, because the
    // existing specs swap the instance after construction.
    this.upstream = new ToastUpstream(
      { get: (url, config) => this.httpClient.get(url, config) },
      {
        warn: (message) => this.logger.warn(message),
        error: (message) => this.logger.error(message),
      },
    );

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

  /**
   * Whether FABRICATED Toast data may be served.
   *
   * The reasoning above was applied to webhook signatures on 2026-08-25 and
   * never to the data paths, so five endpoints kept returning invented menus,
   * orders and sales figures gated on `this.mockMode` alone — and
   * TOAST_MOCK_MODE is not set in the production Railway environment, so the
   * TRUE default was live. `POST /toast/orders` was reporting an order placed
   * at a vendor that was never placed: a false success on an acting path,
   * which ADR 0020 (no fabricated answers, LOCKED) forbids outright.
   *
   * Closed the same way, and deliberately NOT by flipping the default to
   * false: the default only governs the unset case, whereas someone setting
   * TOAST_MOCK_MODE=true on the production service to debug would reopen the
   * exact hole. This close cannot be reopened by a variable at all, and
   * `apps/api-gateway/Dockerfile:42` bakes ENV NODE_ENV=production into the
   * deployed image, so it engages regardless of Railway's variable list.
   *
   * NODE_ENV is read per call rather than cached at construction, matching
   * `enforceSignature` above and `communications/guards/non-production.guard.ts:29`.
   */
  private mockDataAllowed(): boolean {
    return this.mockMode && process.env.NODE_ENV !== "production";
  }

  /**
   * The refusal served when mock data is suppressed. ADR 0020: a surface with
   * no data says so, and an error must never render as emptiness — so this is
   * a spoken 503, never an empty list and never a zero.
   */
  private toastNotConnected(detail: string): HttpException {
    this.logger.error(
      `Toast data requested in production with TOAST_MOCK_MODE on — refusing to fabricate (${detail})`,
    );
    return new HttpException(
      `Toast is not connected for this restaurant, so ${detail}. ` +
        `Mudavym does not show simulated POS data in production. ` +
        `Connect Toast to see real figures.`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
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

    // F-639: the signature covers the timestamp, and a timestamp more than
    // WEBHOOK_FRESHNESS_MS from now is refused, so a captured webhook cannot
    // be re-sent later to roll a check back.
    if (!webhookTimestampIsFresh(timestamp)) {
      this.logger.error({
        message: `Webhook refused: timestamp missing, unreadable, or more than ${WEBHOOK_FRESHNESS_MS / 60000} minutes from now`,
        timestamp,
      });
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
   * Resolve internal restaurant ID from Toast restaurant GUID.
   *
   * F-318. This read `restaurants.toast_restaurant_guid`, a column no
   * migration declares, so PostgREST failed the query on every webhook and
   * every Toast event landed on "system". The house's Toast GUID lives in
   * `pos_credentials->>restaurant_guid`, beside `pos_system` (the same mapping
   * pos_integration_agent.py `get_restaurant_id` reads). Only a house that has
   * Toast as its POS can claim the GUID; two houses claiming the same one is
   * an error from `.single()` and stays unmapped rather than picking one.
   */
  private async resolveRestaurantId(toastGuid: string): Promise<string> {
    const { data, error } = await this.databaseService.supabase
      .from("restaurants")
      .select("id")
      .eq("pos_system", "toast")
      .eq("pos_credentials->>restaurant_guid", toastGuid)
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

    // The Toast kind rides in the payload: `events.event_type` and
    // `events.source_page` are Postgres enums (baseline :107-119, :240-253)
    // with no POS members, so a `pos_order_*` / `toast_webhook` insert is
    // refused with 22P02 (F-554).
    const eventTypeMap: Record<string, string> = {
      [ToastWebhookEventType.ORDER_CREATED]: "pos_order_created",
      [ToastWebhookEventType.ORDER_UPDATED]: "pos_order_updated",
      [ToastWebhookEventType.ORDER_CLOSED]: "pos_order_closed",
      [ToastWebhookEventType.ORDER_PAID]: "pos_order_paid",
      [ToastWebhookEventType.ORDER_VOIDED]: "pos_order_voided",
    };

    const eventPayload = {
      pos_event: eventTypeMap[webhookDto.eventType] || "pos_event",
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
        event_type: "system_event",
        source_page: "system",
        payload: eventPayload,
        schema_version: 1,
        idempotency_key: `toast_${webhookDto.eventId}`,
        trace_id: webhookDto.eventId,
      })
      .select("id")
      .single();

    // F-1649: a duplicate is NOT a replay to skip. The log row is written
    // before the check is kept, so a first delivery refused at the door (409
    // disconnected, 503 unreadable) or not stored left the row behind, and
    // Toast's retry of the same eventId used to stop here: the order was
    // never kept. The hub is the idempotency for the sale (a copy it already
    // keeps is re-stored as itself and its stock ledger moves only the
    // difference), so the retry is handed over again below.
    const replayed = error?.code === "23505";
    if (error && !replayed) {
      // The event row is a log line, not the sale. A failed log must never
      // stop the sale taking stock off the shelf (F-554), so it is said
      // loudly and the effects below still run.
      this.logger.error(
        `Toast order event ${webhookDto.eventId} was not logged: ${error.message}`,
      );
    }
    if (replayed) {
      this.logger.log({
        message: "Toast order event delivered again; handing it to the hub",
        eventId: webhookDto.eventId,
      });
    }

    // F-642: the order goes through the POS hub as a Toast check: it is kept
    // in pos_checks (so it reaches takings), and its stock moves by the
    // check's ledger, which books a second glass of the same wine, returns
    // only what a sale took when the order is voided, and corrects an order
    // edited after it closed.
    await this.ingestOrderThroughHub(restaurantId, webhookDto);

    // NO forward to the orchestrator. Removed 2026-09-01 — see the block comment
    // above `getWebhookMetrics` for the evidence. Short version: the POST went to
    // `/api/v1/toast/webhooks/{type}`, a route the orchestrator has never
    // registered, and the 404 was swallowed by a `logger.warn`.

    return data?.id;
  }

  /**
   * F-642: hand a Toast order webhook to PosHubService.ingest as one Toast
   * check. Until this, the webhook moved stock on its own path: it wrote no
   * pos_checks row (no takings), keyed a sale per (order, menu item) so a
   * second line of the same wine was swallowed as a replay, returned stock on
   * a void whether or not a sale was booked, and ignored an order updated
   * after it closed.
   *
   * An order is closed when the event says so (closed, paid, voided) or when
   * it carries a closedAt (an update after close is then a correction). The
   * order's updatedAt, else the event's timestamp, is the copy's modified-at,
   * so a late retry of an earlier event is not imported (F-639).
   */
  private async ingestOrderThroughHub(
    restaurantId: string,
    webhookDto: ToastWebhookDto,
  ): Promise<void> {
    const order = webhookDto.order;
    if (!order?.guid) return;
    if (restaurantId === "system") {
      // F-318: no house claims this Toast GUID, so there is nowhere to keep
      // the check; it is logged above and moves nothing.
      this.logger.warn(
        `Toast order ${order.guid} names no restaurant here; nothing was kept or moved`,
      );
      return;
    }
    if (!this.posHub) {
      this.logger.error(
        `Toast order ${order.guid} was not kept: the POS hub is not available in this process`,
      );
      return;
    }
    const et = webhookDto.eventType;
    const isVoid = et === ToastWebhookEventType.ORDER_VOIDED;
    const final =
      isVoid ||
      et === ToastWebhookEventType.ORDER_PAID ||
      et === ToastWebhookEventType.ORDER_CLOSED;
    const closedDate = order.closedAt ?? (final ? webhookDto.timestamp : null);

    // A disconnected house refuses Toast as it refuses every till (F-643).
    await this.posHub.assertConnected(restaurantId, "toast");
    const result = await this.ingestToast(this.posHub, restaurantId, {
      checks: [
        {
          guid: order.guid,
          openedDate: order.createdAt ?? webhookDto.timestamp,
          closedDate,
          modifiedDate: order.updatedAt ?? webhookDto.timestamp,
          voided: isVoid,
          amount: order.subtotal ?? null,
          totalAmount: order.total ?? null,
          table: order.tableName ? { name: order.tableName } : undefined,
          server: order.serverName
            ? { firstName: order.serverName }
            : undefined,
          selections: (order.items ?? []).map((item) => ({
            displayName: item.name,
            item: { guid: item.guid },
            quantity: item.quantity,
            price: item.unitPrice,
            salesCategory: item.category ? { name: item.category } : undefined,
          })),
        },
      ],
    });
    // F-1649: a check the hub did not keep is not answered "processed".
    // Toast retries a non-2xx, and the retry is handed over again (above),
    // so the order is kept once the cause clears. A copy older than the one
    // kept, or one refused for an unreadable date (said on the bell, ADR
    // 0281), is handled: retrying it changes nothing.
    const notStored =
      (result.received ?? 0) -
      (result.upserted ?? 0) -
      (result.olderCopies ?? 0) -
      (result.refusedUnreadableDate ?? 0);
    if (notStored > 0) {
      this.logger.error(
        `Toast order ${order.guid} was not kept: ${result.errors.slice(0, 5).join("; ")}`,
      );
      throw new HttpException(
        `Toast order ${order.guid} was not kept; send it again`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (result.errors.length > 0) {
      this.logger.warn(
        `Toast order ${order.guid}: ${result.errors.slice(0, 5).join("; ")}`,
      );
    }
  }

  /**
   * F-1649: the hub's ingest, where a throw is a check not kept. processWebhook
   * answers any other throw with a 200 "error" body, which Toast never
   * retries, so it is turned into a 503 here.
   */
  private async ingestToast(
    hub: PosHubService,
    restaurantId: string,
    payload: { checks: Array<{ guid: string } & Record<string, unknown>> },
  ) {
    const orderGuid = payload.checks[0]?.guid;
    try {
      return await hub.ingest(restaurantId, "toast", payload);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `Toast order ${orderGuid} was not kept: ${err?.message ?? err}`,
      );
      throw new HttpException(
        `Toast order ${orderGuid} was not kept; send it again`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
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
      pos_event: `pos_stock_${webhookDto.eventType.split(".")[1]}`,
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
        // Valid enum members only (F-554); the Toast kind is in the payload.
        event_type: "inventory_change",
        source_page: "system",
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

    // NO forward to the orchestrator — same dead route as the order path above.

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
    // Every house's copy of this menu, since the key now names the house.
    if (webhookDto.menu?.menuGuid) {
      await this.cacheService.invalidateByPattern(
        `toast:menu:*:${webhookDto.menu.menuGuid}`,
      );
    }
    await this.cacheService.invalidateByPattern("toast:menus:*");

    const eventPayload = {
      pos_event: webhookDto.eventType.replace(".", "_"),
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
        // Valid enum members only (F-554); the Toast kind is in the payload.
        event_type: "system_event",
        source_page: "system",
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

  /*
   * REMOVED 2026-09-01 — `forwardToOrchestrator()`.
   *
   * It did:
   *     POST {AGENT_ORCHESTRATOR_URL}/api/v1/toast/webhooks/{order|stock|menu}
   *     catch → this.logger.warn("Failed to forward webhook to orchestrator")
   *
   * That route has never existed. The orchestrator registers exactly these
   * prefixes (`services/agent-orchestrator/main.py:151-186` + the `APIRouter`
   * declarations in `services/agent-orchestrator/api/`):
   *   /api/v1/{admin,analytics,collect,onboarding,pos,preview,procurement,
   *            quality,research,scan,studio}, /api/templates, and the
   *   unprefixed health/metrics routes.
   * There is no `/api/v1/toast` router, so every one of these POSTs returned
   * 404 and the catch turned a permanent misconfiguration into a warn line.
   *
   * DELETED rather than repointed. The obvious repoint target is
   * `POST /api/v1/pos/webhook/toast` (`api/pos_routes.py:35`), and it is wrong
   * on four independent counts:
   *   1. Signature — that route calls `ToastAdapter.verify_webhook(raw, sig)`
   *      (`adapters/toast_adapter.py:24-45`), which fails closed with no
   *      `Toast-Signature` header. This forward sends none → 401, always.
   *   2. Shape — `normalize_event` reads `eventType` and
   *      `order.checks[].selections` (`toast_adapter.py:47-89`); this forward
   *      sends a reshaped `{event_id, event_type, restaurant_guid, timestamp,
   *      payload}` envelope, so `items` would always come out empty.
   *   3. Semantics — the agent's handler map keys are `OrderCompleted`,
   *      `OrderItemVoided`, `OrderRefunded`, `MenuItemModified`
   *      (`agents/pos_integration_agent.py:268-273`). None of this gateway's
   *      event types (`order.paid`, `stock.updated`, …) match, so every event
   *      would return `{"status": "ignored"}`.
   *   4. Duplication — `/api/v1/pos/webhook/toast` is a *parallel ingress* that
   *      Toast calls directly, not a downstream of this handler. This method
   *      has already persisted the `events` row and applied the inventory
   *      effects by the time the forward ran; feeding the same order in again
   *      would risk double-counting the sale.
   *
   * So there is no consumer to fail loudly towards, and nothing is lost: the
   * event is persisted and the inventory effects are applied above. If a real
   * orchestrator-side consumer is ever built, wire it here and let it throw.
   */

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
      if (!this.mockDataAllowed()) {
        throw this.toastNotConnected("its menus are unavailable");
      }
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
      // ADR 0020: a failed fetch says it failed. This previously fell back to
      // getMockMenus(), which fabricated menus even when mock mode was
      // correctly OFF — a real Toast integration plus one network blip served
      // invented data with no marker. Mirrors getMenu's catch below.
      //
      // The STATUS is derived, not written here: 501 while the orchestrator has
      // no `/api/v1/toast` router, 503 or the upstream's own code once it does.
      throw await this.upstream.describe({
        route: TOAST_UPSTREAM_ROUTES.menus,
        summary: "Failed to fetch menus from Toast",
        error,
      });
    }
  }

  /**
   * Get a single menu by ID
   */
  async getMenu(restaurantId: string, menuId: string): Promise<ToastMenuDto> {
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
      if (!this.mockDataAllowed()) {
        throw this.toastNotConnected("this menu is unavailable");
      }
      const menus = this.getMockMenus();
      const menu = menus.menus.find((m) => m.guid === menuId);
      if (!menu) {
        throw new HttpException("Menu not found", HttpStatus.NOT_FOUND);
      }
      return menu;
    }

    await this.assertHouseHasToast(restaurantId, "menu");

    const cacheKey = this.getMenuCacheKey(restaurantId, menuId);
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
      // Id-addressed, so a bare 404 is ambiguous — "no such router" and "no such
      // menu" are different answers and used to collapse into the same one.
      // `describe` confirms which before it will say 501.
      throw await this.upstream.describe({
        route: TOAST_UPSTREAM_ROUTES.menu,
        summary: "Failed to fetch menu",
        error,
      });
    }
  }

  async refreshMenuCache(
    restaurantId?: string,
    menuId?: string,
  ): Promise<number> {
    if (menuId) {
      if (restaurantId) {
        await this.cacheService.del(this.getMenuCacheKey(restaurantId, menuId));
        return 1;
      }
      return this.cacheService.invalidateByPattern(`toast:menu:*:${menuId}`);
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

  // F-310. The house is in the key: a menu one house read must never be
  // answered from the cache to another.
  private getMenuCacheKey(restaurantId: string, menuId: string): string {
    return `toast:menu:${restaurantId}:${menuId}`;
  }

  /**
   * F-310. A by-id Toast read is answered only for a house that has Toast
   * connected: `pos_system` is toast and `pos_credentials` carries the Toast
   * `restaurant_guid` (the mapping the orchestrator resolves a house by,
   * pos_integration_agent.py `get_restaurant_id`; `pos_system` alone defaults
   * to toast on every house). The orchestrator answers every by-id read
   * with one Toast login, so without this any signed-in member of any house
   * could read the connected restaurant's menus and orders by id. A failed
   * read refuses rather than reading as a yes (ADR 0051).
   *
   * What this does NOT close: two houses that both have Toast connected
   * still share the orchestrator's single login. Scoping that needs a login
   * per house on the orchestrator side.
   */
  private async assertHouseHasToast(
    restaurantId: string,
    what: "menu" | "order",
  ): Promise<void> {
    const { data, error } = await this.databaseService.supabase
      .from("restaurants")
      .select("pos_system, toast_guid:pos_credentials->>restaurant_guid")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error(
        `Could not read whether restaurant ${restaurantId} has Toast connected: ${error.message}`,
      );
      throw new HttpException(
        `Could not confirm Toast is connected for this restaurant, so this ${what} was not shown. Please try again.`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const row = data as {
      pos_system?: string | null;
      toast_guid?: string | null;
    } | null;
    if (row?.pos_system !== "toast" || !row.toast_guid) {
      this.logger.warn(
        `Refused a Toast ${what} read for restaurant ${restaurantId}, which has no Toast connected`,
      );
      throw new HttpException(
        `Toast is not connected for this restaurant, so this ${what} is unavailable.`,
        HttpStatus.NOT_FOUND,
      );
    }
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
      if (!this.mockDataAllowed()) {
        // The worst of the five: this returned a fabricated order with a
        // real-looking guid and an OPEN status, reporting an order placed at a
        // vendor that was never placed. ADR 0020: an action that cannot
        // complete refuses out loud. The refusal must say NOTHING WAS PLACED,
        // because the caller's next question is whether to retry.
        this.logger.error(
          "Order creation attempted in production with TOAST_MOCK_MODE on — refusing to fabricate a placed order",
        );
        throw new HttpException(
          "Toast is not connected, so this order was NOT sent and nothing was placed. " +
            "Connect Toast before ordering through it.",
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
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
      // The acting path. Whatever the derived status turns out to be, the
      // message has to answer the caller's actual next question — was anything
      // placed? — the same way the mock-mode refusal above does.
      throw await this.upstream.describe({
        route: TOAST_UPSTREAM_ROUTES.createOrder,
        summary:
          "Failed to create order — it was NOT sent and nothing was placed",
        error,
      });
    }
  }

  /**
   * Get order by ID
   */
  async getOrder(
    restaurantId: string,
    orderId: string,
  ): Promise<ToastOrderResponseDto> {
    // Same defect and same reasoning as getMenu above (CodeQL js/request-forgery).
    if (!isSafePathSegment(orderId)) {
      this.logger.warn(
        `Rejected order lookup for unsafe id: ${JSON.stringify(orderId).slice(0, 200)}`,
      );
      throw new HttpException("Invalid order id", HttpStatus.BAD_REQUEST);
    }
    this.logger.log(`Fetching order: ${orderId}`);

    if (this.mockMode) {
      if (!this.mockDataAllowed()) {
        throw this.toastNotConnected("this order cannot be looked up");
      }
      return this.getMockOrder(orderId);
    }

    await this.assertHouseHasToast(restaurantId, "order");

    try {
      const response = await this.httpClient.get(
        `/api/v1/toast/orders/${orderId}`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch order: ${error.message}`);
      // Id-addressed — same ambiguity as getMenu above.
      throw await this.upstream.describe({
        route: TOAST_UPSTREAM_ROUTES.order,
        summary: "Failed to fetch order",
        error,
      });
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
      if (!this.mockDataAllowed()) {
        throw this.toastNotConnected("sales figures are unavailable");
      }
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
      // ADR 0020, and the sharpest case of it: analytics consumes sales. This
      // previously fell back to getMockSalesData() even with mock mode OFF, so
      // a transient orchestrator failure fed invented revenue into the engine
      // indistinguishably from real takings.
      throw await this.upstream.describe({
        route: TOAST_UPSTREAM_ROUTES.sales,
        summary: "Failed to fetch sales data from Toast",
        error,
      });
    }
  }

  /**
   * Get Toast API statistics.
   *
   * This calls `GET {AGENT_ORCHESTRATOR_URL}/api/v1/toast/statistics`, and that
   * route has never existed. The orchestrator registers exactly these prefixes
   * (`main.py:151-186` plus the `APIRouter(prefix=…)` declarations under
   * `services/agent-orchestrator/api/`):
   *   /api/v1/{admin,analytics,collect,onboarding,pos,preview,procurement,
   *            quality,research,scan,studio}, /api/templates, and the
   *   unprefixed health/metrics routes.
   * `git log --all -S"/api/v1/toast"` returns no orchestrator commit at all —
   * the router was not removed or renamed, it was never written. These calls
   * arrived in `91b75dd1` (2026-04-13), by which point the orchestrator already
   * shipped eight route modules, none of them Toast.
   *
   * Of the six dead calls this is the sharpest, because it is the only one with
   * no mock branch: it goes to the orchestrator in EVERY configuration, mock
   * mode on or off, dev or prod. It has therefore never once succeeded.
   *
   * What it used to do was half-right. The catch returned HTTP 200 with
   * `{mode, status: "unknown", error}` — honest about the VALUE, in that it
   * refused to invent a statistic, which satisfies the first half of ADR 0020
   * (no fabricated answers, LOCKED). But it was not honest about the SURFACE.
   * ADR 0020's other half is that an action which cannot complete refuses out
   * loud, and a 200 is not a refusal: every health-style caller read this
   * endpoint as reachable, every time, for as long as it has existed.
   *
   * 501, deliberately, and not the 503 used for the other five. "Toast is not
   * connected" is a condition the owner can change — connect Toast and those
   * calls work, so 503 and its retry-later meaning are true there. Neither is
   * true here: connecting Toast would not help, because the missing piece is an
   * orchestrator router nobody has written. A 503 would promise a future in
   * which this succeeds — a quieter version of the same fabrication — and would
   * invite a monitor to retry a route that cannot ever answer.
   *
   * That reasoning stands; what changed is that the 501 is no longer WRITTEN
   * here. A constant is true only while its condition holds, and the sibling
   * service change building `/api/v1/toast` will end this one — at which point a
   * hardcoded 501 becomes the fabrication it was added to prevent, and the fix
   * depends on somebody remembering six catch blocks. The status is now derived
   * from what the orchestrator actually answers (`toast-upstream.ts`), so this
   * call answers 501 for exactly as long as the route is missing and not one
   * deploy longer.
   *
   * Whether this endpoint should exist at all is a live question and NOT
   * settled here; see the PR that added this comment. Nothing in the product
   * renders it, but `apps/web/src/services/api/toast.ts:110` exports a client
   * for it and it is published in the OpenAPI spec, so retiring it is the
   * founder's call, not this change's.
   */
  async getStatistics(): Promise<any> {
    try {
      const response = await this.httpClient.get("/api/v1/toast/statistics");
      return response.data;
    } catch (error) {
      this.logger.error(
        `Toast statistics request failed upstream: ${error.message}`,
      );
      throw await this.upstream.describe({
        route: TOAST_UPSTREAM_ROUTES.statistics,
        summary: "Toast API statistics are unavailable",
        error,
      });
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
