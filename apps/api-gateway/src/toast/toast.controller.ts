import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  Req,
  RawBodyRequest,
  HttpException,
  HttpStatus,
  Logger,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Public } from "../auth/decorators/public.decorator";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiHeader,
} from "@nestjs/swagger";
import { Request } from "express";
import { ToastService } from "./toast.service";
import { ToastMenuDto, ToastMenuListResponseDto } from "./dto/toast-menu.dto";
import {
  CreateToastOrderDto,
  ToastOrderResponseDto,
  ToastSalesResponseDto,
} from "./dto/toast-order.dto";
import { ToastCacheRefreshDto } from "./dto/toast-cache.dto";
import {
  ToastWebhookDto,
  ToastWebhookResponseDto,
} from "./dto/toast-webhook.dto";

/**
 * Toast API Controller
 *
 * Proxy endpoints for Toast POS API:
 * - Menu management
 * - Order creation and retrieval
 * - Sales data fetching
 *
 * This controller acts as a secure proxy, handling:
 * - OAuth token management
 * - CORS issues (frontend can't call Toast directly)
 * - Error handling and retry logic
 * - Mock data fallback
 */
@ApiTags("toast")
// Guarded at class level, same shape as PosHubController. Only the Toast
// webhook is @Public() — it authenticates by HMAC signature instead. Before
// this, GET /toast/menus and GET /toast/sales took restaurantId as a QUERY
// PARAMETER with no guard of any kind, so an anonymous caller could read any
// restaurant's menus and sales (verified 200 in production, 2026-08-25), and
// POST /toast/orders could write one. The global TenantGuard fails open by
// design and never covered this. Found by the ENDPOINTS.md re-verification —
// this controller predates the auth sweep in #60 and was missed by it.
@UseGuards(JwtAuthGuard)
@Controller("toast")
export class ToastController {
  private readonly logger = new Logger(ToastController.name);

  constructor(private readonly toastService: ToastService) {}

  /**
   * Toast Webhook Endpoint
   *
   * Receives webhooks from Toast POS for:
   * - Order events (created, updated, closed, paid, voided)
   * - Stock events (updated, out, low)
   * - Menu events (updated, item created/updated/deleted)
   *
   * Verifies signature using HMAC-SHA256 with TOAST_WEBHOOK_SECRET
   */
  @Public() // authenticated by HMAC signature, not JWT — Toast cannot send a bearer token
  @Post("webhook")
  @ApiOperation({
    summary: "Receive Toast POS webhooks",
    description:
      "Endpoint for Toast POS to send real-time event notifications. Verifies HMAC-SHA256 signature.",
  })
  @ApiHeader({
    name: "Toast-Signature",
    description: "HMAC-SHA256 signature in format v1=<signature>",
    required: false,
  })
  @ApiHeader({
    name: "Toast-Timestamp",
    description: "Unix timestamp when webhook was sent",
    required: false,
  })
  @ApiResponse({
    status: 200,
    type: ToastWebhookResponseDto,
    description: "Webhook received and processed",
  })
  @ApiResponse({
    status: 401,
    description: "Invalid or missing webhook signature",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid webhook payload",
  })
  async handleWebhook(
    @Body() webhookDto: ToastWebhookDto,
    @Headers("toast-signature") signature: string | undefined,
    @Headers("toast-timestamp") timestamp: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<ToastWebhookResponseDto> {
    this.logger.log({
      message: "Webhook received",
      eventId: webhookDto.eventId,
      eventType: webhookDto.eventType,
      hasSignature: !!signature,
    });

    try {
      // Get raw body for signature verification
      const rawBody = request.rawBody?.toString() || JSON.stringify(webhookDto);

      return await this.toastService.processWebhook(
        webhookDto,
        rawBody,
        signature || null,
        timestamp || null,
      );
    } catch (error) {
      this.logger.error({
        message: "Webhook processing error",
        eventId: webhookDto.eventId,
        error: error.message,
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        error.message || "Webhook processing failed",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get webhook processing metrics
   */
  @Get("webhook/metrics")
  @ApiOperation({ summary: "Get Toast webhook metrics" })
  @ApiResponse({
    status: 200,
    description: "Returns webhook processing statistics",
  })
  async getWebhookMetrics() {
    return this.toastService.getWebhookMetrics();
  }

  /**
   * Get all menus for a restaurant
   */
  @Get("menus")
  @ApiOperation({ summary: "Get all Toast menus" })
  @ApiQuery({
    name: "restaurantId",
    description: "Restaurant UUID",
    required: true,
  })
  @ApiResponse({ status: 200, type: ToastMenuListResponseDto })
  async getMenus(
    @Query("restaurantId") restaurantId: string,
  ): Promise<ToastMenuListResponseDto> {
    try {
      return await this.toastService.getMenus(restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch menus",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Refresh Toast menu cache
   */
  @Post("cache/refresh")
  @ApiOperation({ summary: "Invalidate Toast menu cache" })
  async refreshCache(
    @Body() body: ToastCacheRefreshDto,
  ): Promise<{ cleared: number }> {
    const cleared = await this.toastService.refreshMenuCache(
      body.restaurantId,
      body.menuId,
    );
    return { cleared };
  }

  /**
   * Get a single menu by ID
   */
  @Get("menus/:menuId")
  @ApiOperation({ summary: "Get a single Toast menu" })
  @ApiParam({ name: "menuId", description: "Menu GUID" })
  @ApiResponse({ status: 200, type: ToastMenuDto })
  @ApiResponse({ status: 404, description: "Menu not found" })
  async getMenu(@Param("menuId") menuId: string): Promise<ToastMenuDto> {
    try {
      return await this.toastService.getMenu(menuId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch menu",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Create a new order
   */
  @Post("orders")
  @ApiOperation({ summary: "Create a new Toast order" })
  @ApiQuery({
    name: "restaurantId",
    description: "Restaurant UUID",
    required: true,
  })
  @ApiResponse({ status: 201, type: ToastOrderResponseDto })
  async createOrder(
    @Query("restaurantId") restaurantId: string,
    @Body() dto: CreateToastOrderDto,
  ): Promise<ToastOrderResponseDto> {
    try {
      return await this.toastService.createOrder(restaurantId, dto);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to create order",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get order by ID
   */
  @Get("orders/:orderId")
  @ApiOperation({ summary: "Get a Toast order by ID" })
  @ApiParam({ name: "orderId", description: "Order GUID" })
  @ApiResponse({ status: 200, type: ToastOrderResponseDto })
  @ApiResponse({ status: 404, description: "Order not found" })
  async getOrder(
    @Param("orderId") orderId: string,
  ): Promise<ToastOrderResponseDto> {
    try {
      return await this.toastService.getOrder(orderId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch order",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get sales data for a time range
   */
  @Get("sales")
  @ApiOperation({ summary: "Get Toast sales data" })
  @ApiQuery({
    name: "restaurantId",
    description: "Restaurant UUID",
    required: true,
  })
  @ApiQuery({
    name: "startTime",
    description: "Start time (ISO 8601)",
    required: true,
  })
  @ApiQuery({
    name: "endTime",
    description: "End time (ISO 8601)",
    required: true,
  })
  @ApiResponse({ status: 200, type: ToastSalesResponseDto })
  async getSalesData(
    @Query("restaurantId") restaurantId: string,
    @Query("startTime") startTime: string,
    @Query("endTime") endTime: string,
  ): Promise<ToastSalesResponseDto> {
    try {
      const start = new Date(startTime);
      const end = new Date(endTime);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new HttpException("Invalid date format", HttpStatus.BAD_REQUEST);
      }

      return await this.toastService.getSalesData(restaurantId, start, end);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch sales data",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get Toast API statistics.
   *
   * The upstream route this depends on has never been implemented — see
   * `toast.service.ts#getStatistics` for the evidence — so the service now
   * answers 501 rather than a 200 that reports a dead route as reachable.
   *
   * The catch below used to hardcode 500 and drop `error.status`, alone among
   * the handlers in this file (compare `getMenus`, `getMenu`, `createOrder`,
   * `getOrder`, `getSalesData`, which all forward it). That flattened the 501
   * into a generic 500 and destroyed the one distinction that matters to a
   * caller: "this was never built" versus "this just broke".
   */
  @Get("statistics")
  @ApiOperation({ summary: "Get Toast API statistics" })
  @ApiResponse({
    status: 501,
    description:
      "Not implemented upstream — the orchestrator has no /api/v1/toast/statistics route",
  })
  async getStatistics() {
    try {
      return await this.toastService.getStatistics();
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch statistics",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Health check endpoint
   */
  @Get("health")
  @ApiOperation({ summary: "Toast API health check" })
  @ApiResponse({ status: 200, description: "Service is healthy" })
  async healthCheck() {
    return {
      status: "healthy",
      service: "toast",
      timestamp: new Date().toISOString(),
    };
  }
}
