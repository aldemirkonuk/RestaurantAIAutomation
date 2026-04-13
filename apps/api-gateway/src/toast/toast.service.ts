import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios, { AxiosInstance } from 'axios';
import { CacheService } from '../common/cache/cache.service';
import { DatabaseService } from '../database/database.service';
import {
  ToastMenuDto,
  ToastMenuListResponseDto,
} from './dto/toast-menu.dto';
import {
  CreateToastOrderDto,
  ToastOrderResponseDto,
  ToastSalesResponseDto,
  ToastSalesDataDto,
  ToastOrderStatus,
} from './dto/toast-order.dto';
import {
  ToastWebhookDto,
  ToastWebhookResponseDto,
  ToastWebhookEventType,
} from './dto/toast-webhook.dto';

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
  ) {
    this.agentOrchestratorUrl = this.configService.get<string>(
      'AGENT_ORCHESTRATOR_URL',
      'http://localhost:8000',
    );
    
    this.mockMode = this.configService.get<boolean>('TOAST_MOCK_MODE', true);
    this.cacheTtlSeconds = this.configService.get<number>('TOAST_CACHE_TTL_SECONDS', 300);
    this.webhookSecret = this.configService.get<string>('TOAST_WEBHOOK_SECRET', null);
    
    this.httpClient = axios.create({
      baseURL: this.agentOrchestratorUrl,
      timeout: 30000,
    });
    
    this.logger.log(`Toast service initialized (mock mode: ${this.mockMode})`);
    
    if (!this.webhookSecret) {
      this.logger.warn('TOAST_WEBHOOK_SECRET not configured - webhook signature verification disabled');
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
  verifyWebhookSignature(
    payload: string,
    signature: string,
    timestamp: string,
  ): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('Webhook signature verification skipped - no secret configured');
      return true; // Allow in development/testing
    }

    try {
      // Toast signature format: v1=<signature>
      const signatureParts = signature.split('=');
      if (signatureParts.length !== 2 || signatureParts[0] !== 'v1') {
        this.logger.error('Invalid signature format');
        return false;
      }

      const receivedSignature = signatureParts[1];

      // Build the signed payload: timestamp.payload
      const signedPayload = `${timestamp}.${payload}`;

      // Compute expected signature
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(signedPayload)
        .digest('hex');

      // Constant-time comparison to prevent timing attacks
      const isValid = crypto.timingSafeEqual(
        Buffer.from(receivedSignature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      );

      if (!isValid) {
        this.logger.error({
          message: 'Webhook signature verification failed',
          timestamp,
        });
      }

      return isValid;
    } catch (error) {
      this.logger.error({
        message: 'Webhook signature verification error',
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
      message: 'Toast webhook received',
      eventId: webhookDto.eventId,
      eventType: webhookDto.eventType,
      restaurantGuid: webhookDto.restaurantGuid,
      timestamp: webhookDto.timestamp,
    });

    try {
      // Verify signature if provided
      if (signature && timestamp) {
        const isValid = this.verifyWebhookSignature(rawBody, signature, timestamp);
        if (!isValid) {
          this.webhookMetrics.errors++;
          throw new HttpException('Invalid webhook signature', HttpStatus.UNAUTHORIZED);
        }
      } else if (this.webhookSecret && !this.mockMode) {
        // In production with secret configured, require signature
        this.webhookMetrics.errors++;
        throw new HttpException('Missing webhook signature', HttpStatus.UNAUTHORIZED);
      }

      // Find internal restaurant ID from Toast GUID
      const restaurantId = await this.resolveRestaurantId(webhookDto.restaurantGuid);

      // Route to appropriate handler
      let internalEventId: string | undefined;

      switch (webhookDto.eventType) {
        case ToastWebhookEventType.ORDER_CREATED:
        case ToastWebhookEventType.ORDER_UPDATED:
        case ToastWebhookEventType.ORDER_CLOSED:
        case ToastWebhookEventType.ORDER_PAID:
        case ToastWebhookEventType.ORDER_VOIDED:
          internalEventId = await this.handleOrderWebhook(restaurantId, webhookDto);
          break;

        case ToastWebhookEventType.STOCK_UPDATED:
        case ToastWebhookEventType.STOCK_OUT:
        case ToastWebhookEventType.STOCK_LOW:
          internalEventId = await this.handleStockWebhook(restaurantId, webhookDto);
          break;

        case ToastWebhookEventType.MENU_UPDATED:
        case ToastWebhookEventType.MENU_ITEM_CREATED:
        case ToastWebhookEventType.MENU_ITEM_UPDATED:
        case ToastWebhookEventType.MENU_ITEM_DELETED:
          internalEventId = await this.handleMenuWebhook(restaurantId, webhookDto);
          break;

        case ToastWebhookEventType.WEBHOOK_VERIFICATION:
          // Toast sends this to verify the webhook endpoint is working
          this.logger.log('Toast webhook verification received');
          break;

        default:
          this.logger.warn({
            message: 'Unknown webhook event type',
            eventType: webhookDto.eventType,
            eventId: webhookDto.eventId,
          });
      }

      this.webhookMetrics.processed++;

      const response: ToastWebhookResponseDto = {
        status: 'processed',
        eventId: webhookDto.eventId,
        internalEventId,
        processedAt: new Date().toISOString(),
      };

      this.logger.log({
        message: 'Toast webhook processed',
        eventId: webhookDto.eventId,
        eventType: webhookDto.eventType,
        internalEventId,
        durationMs: Date.now() - startTime,
      });

      return response;
    } catch (error) {
      this.webhookMetrics.errors++;

      this.logger.error({
        message: 'Toast webhook processing failed',
        eventId: webhookDto.eventId,
        eventType: webhookDto.eventType,
        error: error.message,
        durationMs: Date.now() - startTime,
      });

      if (error instanceof HttpException) {
        throw error;
      }

      return {
        status: 'error',
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
      .from('restaurants')
      .select('id')
      .eq('toast_restaurant_guid', toastGuid)
      .single();

    if (error || !data) {
      this.logger.warn({
        message: 'Restaurant not found for Toast GUID',
        toastGuid,
      });
      // Return a default/system restaurant ID for unmapped webhooks
      // In production, this should throw or queue for manual review
      return 'system';
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
      this.logger.warn('Order webhook missing order payload');
      return undefined;
    }

    // Map Toast event type to internal event type
    const eventTypeMap: Record<string, string> = {
      [ToastWebhookEventType.ORDER_CREATED]: 'pos_order_created',
      [ToastWebhookEventType.ORDER_UPDATED]: 'pos_order_updated',
      [ToastWebhookEventType.ORDER_CLOSED]: 'pos_order_closed',
      [ToastWebhookEventType.ORDER_PAID]: 'pos_order_paid',
      [ToastWebhookEventType.ORDER_VOIDED]: 'pos_order_voided',
    };

    const eventPayload = {
      toast_event_id: webhookDto.eventId,
      toast_order_guid: webhookDto.order.guid,
      order_number: webhookDto.order.orderNumber,
      table_name: webhookDto.order.tableName,
      server_name: webhookDto.order.serverName,
      items: webhookDto.order.items?.map(item => ({
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
      .from('events')
      .insert({
        restaurant_id: restaurantId,
        event_type: eventTypeMap[webhookDto.eventType] || 'pos_event',
        source_page: 'toast_webhook',
        payload: eventPayload,
        schema_version: 1,
        idempotency_key: `toast_${webhookDto.eventId}`,
        trace_id: webhookDto.eventId,
      })
      .select('id')
      .single();

    if (error) {
      // Check for duplicate (idempotency)
      if (error.code === '23505') {
        this.logger.log({
          message: 'Duplicate webhook event (idempotent)',
          eventId: webhookDto.eventId,
        });
        return undefined;
      }
      throw error;
    }

    // Forward to agent orchestrator for processing
    await this.forwardToOrchestrator('order', webhookDto);

    return data?.id;
  }

  /**
   * Handle stock/inventory webhooks
   */
  private async handleStockWebhook(
    restaurantId: string,
    webhookDto: ToastWebhookDto,
  ): Promise<string | undefined> {
    if (!webhookDto.stock) {
      this.logger.warn('Stock webhook missing stock payload');
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
      .from('events')
      .insert({
        restaurant_id: restaurantId,
        event_type: `pos_stock_${webhookDto.eventType.split('.')[1]}`,
        source_page: 'toast_webhook',
        payload: eventPayload,
        schema_version: 1,
        idempotency_key: `toast_${webhookDto.eventId}`,
        trace_id: webhookDto.eventId,
      })
      .select('id')
      .single();

    if (error && error.code !== '23505') {
      throw error;
    }

    // Invalidate menu cache since stock changed
    await this.cacheService.invalidateByPattern('toast:menu*');

    // Forward to agent orchestrator
    await this.forwardToOrchestrator('stock', webhookDto);

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
      await this.cacheService.del(this.getMenuCacheKey(webhookDto.menu.menuGuid));
    }
    await this.cacheService.invalidateByPattern('toast:menus:*');

    const eventPayload = {
      toast_event_id: webhookDto.eventId,
      menu_guid: webhookDto.menu?.menuGuid,
      menu_name: webhookDto.menu?.menuName,
      changed_items: webhookDto.menu?.changedItems,
    };

    // Insert into events table
    const { data, error } = await this.databaseService.supabase
      .from('events')
      .insert({
        restaurant_id: restaurantId,
        event_type: webhookDto.eventType.replace('.', '_'),
        source_page: 'toast_webhook',
        payload: eventPayload,
        schema_version: 1,
        idempotency_key: `toast_${webhookDto.eventId}`,
        trace_id: webhookDto.eventId,
      })
      .select('id')
      .single();

    if (error && error.code !== '23505') {
      throw error;
    }

    return data?.id;
  }

  /**
   * Forward webhook to agent orchestrator for processing
   */
  private async forwardToOrchestrator(
    type: 'order' | 'stock' | 'menu',
    webhookDto: ToastWebhookDto,
  ): Promise<void> {
    try {
      await this.httpClient.post(`/api/v1/toast/webhooks/${type}`, {
        event_id: webhookDto.eventId,
        event_type: webhookDto.eventType,
        restaurant_guid: webhookDto.restaurantGuid,
        timestamp: webhookDto.timestamp,
        payload: webhookDto.order || webhookDto.stock || webhookDto.menu || webhookDto.data,
      });
    } catch (error) {
      // Log but don't fail - the event is already persisted
      this.logger.warn({
        message: 'Failed to forward webhook to orchestrator',
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
    const cached = await this.cacheService.get<ToastMenuListResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.httpClient.get('/api/v1/toast/menus', {
        params: { restaurant_id: restaurantId },
      });
      await this.cacheService.set(cacheKey, response.data, this.cacheTtlSeconds);
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
    this.logger.log(`Fetching menu: ${menuId}`);
    
    if (this.mockMode) {
      const menus = this.getMockMenus();
      const menu = menus.menus.find(m => m.guid === menuId);
      if (!menu) {
        throw new HttpException('Menu not found', HttpStatus.NOT_FOUND);
      }
      return menu;
    }

    const cacheKey = this.getMenuCacheKey(menuId);
    const cached = await this.cacheService.get<ToastMenuDto>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.httpClient.get(`/api/v1/toast/menus/${menuId}`);
      await this.cacheService.set(cacheKey, response.data, this.cacheTtlSeconds);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch menu: ${error.message}`);
      throw new HttpException(
        error.response?.data?.message || 'Failed to fetch menu',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async refreshMenuCache(restaurantId?: string, menuId?: string): Promise<number> {
    if (menuId) {
      await this.cacheService.del(this.getMenuCacheKey(menuId));
      return 1;
    }

    if (restaurantId) {
      await this.cacheService.del(this.getMenusCacheKey(restaurantId));
      return 1;
    }

    return this.cacheService.invalidateByPattern('toast:menus:*');
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
      const response = await this.httpClient.post('/api/v1/toast/orders', {
        restaurant_id: restaurantId,
        ...dto,
      });
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to create order: ${error.message}`);
      throw new HttpException(
        error.response?.data?.message || 'Failed to create order',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get order by ID
   */
  async getOrder(orderId: string): Promise<ToastOrderResponseDto> {
    this.logger.log(`Fetching order: ${orderId}`);
    
    if (this.mockMode) {
      return this.getMockOrder(orderId);
    }

    try {
      const response = await this.httpClient.get(`/api/v1/toast/orders/${orderId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch order: ${error.message}`);
      throw new HttpException(
        error.response?.data?.message || 'Failed to fetch order',
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
      const response = await this.httpClient.get('/api/v1/toast/sales', {
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
      const response = await this.httpClient.get('/api/v1/toast/statistics');
      return response.data;
    } catch (error) {
      return {
        mode: this.mockMode ? 'mock' : 'real',
        status: 'unknown',
        error: error.message,
      };
    }
  }

  // ==================== Mock Data Methods ====================

  private getMockMenus(): ToastMenuListResponseDto {
    const menus: ToastMenuDto[] = [
      {
        guid: 'menu-wine-001',
        name: 'Wine List',
        description: 'Our curated selection of fine wines',
        isActive: true,
        groups: [
          {
            guid: 'group-red-001',
            name: 'Red Wines',
            description: 'Full-bodied red wines',
            items: [
              {
                guid: 'item-001',
                name: 'Opus One 2019',
                description: 'Napa Valley Bordeaux blend',
                price: 4500,
                category: 'Red',
                isAvailable: true,
              },
              {
                guid: 'item-002',
                name: 'Caymus Cabernet 2020',
                description: 'Napa Valley Cabernet Sauvignon',
                price: 2400,
                category: 'Red',
                isAvailable: true,
              },
              {
                guid: 'item-003',
                name: 'Silver Oak Cabernet',
                description: 'Alexander Valley Cabernet',
                price: 3800,
                category: 'Red',
                isAvailable: true,
              },
            ],
          },
          {
            guid: 'group-white-001',
            name: 'White Wines',
            description: 'Crisp and refreshing whites',
            items: [
              {
                guid: 'item-004',
                name: 'Cloudy Bay Sauvignon Blanc',
                description: 'New Zealand Sauvignon Blanc',
                price: 1800,
                category: 'White',
                isAvailable: true,
              },
              {
                guid: 'item-005',
                name: 'Rombauer Chardonnay',
                description: 'Carneros Chardonnay',
                price: 2800,
                category: 'White',
                isAvailable: true,
              },
            ],
          },
          {
            guid: 'group-sparkling-001',
            name: 'Sparkling',
            description: 'Champagne and sparkling wines',
            items: [
              {
                guid: 'item-006',
                name: 'Dom Pérignon 2012',
                description: 'Vintage Champagne',
                price: 8500,
                category: 'Sparkling',
                isAvailable: true,
              },
              {
                guid: 'item-007',
                name: 'Veuve Clicquot Brut',
                description: 'Yellow Label Champagne',
                price: 5500,
                category: 'Sparkling',
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
      tableName: 'Table 5',
      serverName: 'Alex',
      items: [
        {
          itemGuid: 'item-001',
          name: 'Opus One 2019',
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

  private getMockSalesData(startTime: Date, endTime: Date): ToastSalesResponseDto {
    const mockWines = [
      { name: 'Opus One 2019', type: 'red', price: 45.00 },
      { name: 'Caymus Cabernet 2020', type: 'red', price: 24.00 },
      { name: 'Whispering Angel Rosé', type: 'rosé', price: 16.00 },
      { name: 'Cloudy Bay Sauvignon Blanc', type: 'white', price: 18.00 },
      { name: 'Dom Pérignon 2012', type: 'sparkling', price: 85.00 },
    ];

    const sales: ToastSalesDataDto[] = [];
    const hours = Math.ceil((endTime.getTime() - startTime.getTime()) / 3600000);
    
    // Generate ~2-5 sales per hour
    for (let h = 0; h < hours; h++) {
      const numSales = Math.floor(Math.random() * 4) + 2;
      
      for (let i = 0; i < numSales; i++) {
        const wine = mockWines[Math.floor(Math.random() * mockWines.length)];
        const quantity = Math.random() > 0.7 ? 2 : 1;
        const saleTime = new Date(startTime.getTime() + h * 3600000 + Math.random() * 3600000);
        
        sales.push({
          id: `sale-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          orderGuid: `order-${Math.random().toString(36).substr(2, 9)}`,
          itemName: wine.name,
          wineType: wine.type,
          quantity,
          unitPrice: wine.price,
          totalPrice: wine.price * quantity,
          timestamp: saleTime.toISOString(),
          serverName: ['Alex', 'Jordan', 'Sam', 'Taylor'][Math.floor(Math.random() * 4)],
          tableName: `Table ${Math.floor(Math.random() * 20) + 1}`,
          source: 'mock',
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
