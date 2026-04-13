import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsOptional,
  IsObject,
  ValidateNested,
  IsNumber,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Toast Webhook Event Types
 * See: https://doc.toasttab.com/apidocs/webhooks/
 */
export enum ToastWebhookEventType {
  // Order events
  ORDER_CREATED = 'order.created',
  ORDER_UPDATED = 'order.updated',
  ORDER_CLOSED = 'order.closed',
  ORDER_VOIDED = 'order.voided',
  ORDER_PAID = 'order.paid',

  // Menu events
  MENU_UPDATED = 'menu.updated',
  MENU_ITEM_UPDATED = 'menuItem.updated',
  MENU_ITEM_CREATED = 'menuItem.created',
  MENU_ITEM_DELETED = 'menuItem.deleted',

  // Stock/Inventory events
  STOCK_UPDATED = 'stock.updated',
  STOCK_OUT = 'stock.out',
  STOCK_LOW = 'stock.low',

  // Payment events
  PAYMENT_PROCESSED = 'payment.processed',
  PAYMENT_REFUNDED = 'payment.refunded',

  // Test/Verification
  WEBHOOK_VERIFICATION = 'webhook.verification',
}

/**
 * Order item in webhook payload
 */
export class WebhookOrderItemDto {
  @ApiProperty({ description: 'Menu item GUID from Toast' })
  @IsString()
  guid: string;

  @ApiProperty({ description: 'Item name' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Quantity ordered' })
  @IsNumber()
  quantity: number;

  @ApiProperty({ description: 'Unit price in cents' })
  @IsNumber()
  unitPrice: number;

  @ApiPropertyOptional({ description: 'SKU or external ID' })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiPropertyOptional({ description: 'Wine type category' })
  @IsString()
  @IsOptional()
  category?: string;
}

/**
 * Order payload in webhook
 */
export class WebhookOrderPayloadDto {
  @ApiProperty({ description: 'Order GUID from Toast' })
  @IsString()
  guid: string;

  @ApiPropertyOptional({ description: 'Order number' })
  @IsString()
  @IsOptional()
  orderNumber?: string;

  @ApiPropertyOptional({ description: 'Table name' })
  @IsString()
  @IsOptional()
  tableName?: string;

  @ApiPropertyOptional({ description: 'Server name' })
  @IsString()
  @IsOptional()
  serverName?: string;

  @ApiProperty({ description: 'Order items', type: [WebhookOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WebhookOrderItemDto)
  @IsOptional()
  items?: WebhookOrderItemDto[];

  @ApiPropertyOptional({ description: 'Order subtotal in cents' })
  @IsNumber()
  @IsOptional()
  subtotal?: number;

  @ApiPropertyOptional({ description: 'Tax amount in cents' })
  @IsNumber()
  @IsOptional()
  tax?: number;

  @ApiPropertyOptional({ description: 'Total amount in cents' })
  @IsNumber()
  @IsOptional()
  total?: number;

  @ApiPropertyOptional({ description: 'Order status' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: 'Created timestamp (ISO 8601)' })
  @IsString()
  @IsOptional()
  createdAt?: string;

  @ApiPropertyOptional({ description: 'Updated timestamp (ISO 8601)' })
  @IsString()
  @IsOptional()
  updatedAt?: string;

  @ApiPropertyOptional({ description: 'Closed timestamp (ISO 8601)' })
  @IsString()
  @IsOptional()
  closedAt?: string;
}

/**
 * Stock/Inventory payload in webhook
 */
export class WebhookStockPayloadDto {
  @ApiProperty({ description: 'Menu item GUID' })
  @IsString()
  itemGuid: string;

  @ApiPropertyOptional({ description: 'Item name' })
  @IsString()
  @IsOptional()
  itemName?: string;

  @ApiPropertyOptional({ description: 'New quantity' })
  @IsNumber()
  @IsOptional()
  quantity?: number;

  @ApiPropertyOptional({ description: 'Previous quantity' })
  @IsNumber()
  @IsOptional()
  previousQuantity?: number;

  @ApiPropertyOptional({ description: 'Reason for change' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({ description: 'Stock status (in_stock, low, out)' })
  @IsString()
  @IsOptional()
  status?: string;
}

/**
 * Menu update payload in webhook
 */
export class WebhookMenuPayloadDto {
  @ApiProperty({ description: 'Menu GUID' })
  @IsString()
  menuGuid: string;

  @ApiPropertyOptional({ description: 'Menu name' })
  @IsString()
  @IsOptional()
  menuName?: string;

  @ApiPropertyOptional({ description: 'Changed items GUIDs' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  changedItems?: string[];
}

/**
 * Main Toast Webhook Request DTO
 * 
 * This matches the Toast webhook payload structure:
 * https://doc.toasttab.com/apidocs/webhooks/
 */
export class ToastWebhookDto {
  @ApiProperty({
    description: 'Unique webhook event ID',
    example: 'evt_12345678-abcd-1234-efgh-567890ijklmn',
  })
  @IsString()
  eventId: string;

  @ApiProperty({
    description: 'Webhook event type',
    enum: ToastWebhookEventType,
    example: ToastWebhookEventType.ORDER_CLOSED,
  })
  @IsEnum(ToastWebhookEventType)
  eventType: ToastWebhookEventType;

  @ApiProperty({
    description: 'Restaurant GUID from Toast',
    example: 'rest_12345678-abcd-1234-efgh-567890ijklmn',
  })
  @IsString()
  restaurantGuid: string;

  @ApiProperty({
    description: 'Timestamp when event occurred (ISO 8601)',
    example: '2026-01-18T12:00:00.000Z',
  })
  @IsString()
  timestamp: string;

  @ApiPropertyOptional({
    description: 'Order payload (for order events)',
    type: WebhookOrderPayloadDto,
  })
  @ValidateNested()
  @Type(() => WebhookOrderPayloadDto)
  @IsOptional()
  order?: WebhookOrderPayloadDto;

  @ApiPropertyOptional({
    description: 'Stock payload (for stock events)',
    type: WebhookStockPayloadDto,
  })
  @ValidateNested()
  @Type(() => WebhookStockPayloadDto)
  @IsOptional()
  stock?: WebhookStockPayloadDto;

  @ApiPropertyOptional({
    description: 'Menu payload (for menu events)',
    type: WebhookMenuPayloadDto,
  })
  @ValidateNested()
  @Type(() => WebhookMenuPayloadDto)
  @IsOptional()
  menu?: WebhookMenuPayloadDto;

  @ApiPropertyOptional({
    description: 'Raw payload for unknown event types',
  })
  @IsObject()
  @IsOptional()
  data?: Record<string, any>;
}

/**
 * Response DTO for webhook processing
 */
export class ToastWebhookResponseDto {
  @ApiProperty({ description: 'Processing status', example: 'received' })
  status: 'received' | 'processed' | 'ignored' | 'error';

  @ApiProperty({ description: 'Webhook event ID echoed back' })
  eventId: string;

  @ApiPropertyOptional({ description: 'Internal event ID if created' })
  internalEventId?: string;

  @ApiPropertyOptional({ description: 'Message for debugging' })
  message?: string;

  @ApiPropertyOptional({ description: 'Processing timestamp' })
  processedAt?: string;
}
