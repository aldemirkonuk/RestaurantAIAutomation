import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsArray, IsOptional, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum ToastOrderStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  VOIDED = 'voided',
}

export class ToastOrderItemDto {
  @ApiProperty({ description: 'Menu item GUID' })
  @IsString()
  itemGuid: string;

  @ApiProperty({ description: 'Item name' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Quantity' })
  @IsNumber()
  quantity: number;

  @ApiProperty({ description: 'Unit price in cents' })
  @IsNumber()
  unitPrice: number;

  @ApiPropertyOptional({ description: 'Special instructions' })
  @IsString()
  @IsOptional()
  specialInstructions?: string;
}

export class CreateToastOrderDto {
  @ApiPropertyOptional({ description: 'Table name/number' })
  @IsString()
  @IsOptional()
  tableName?: string;

  @ApiPropertyOptional({ description: 'Server name' })
  @IsString()
  @IsOptional()
  serverName?: string;

  @ApiProperty({ description: 'Order items', type: [ToastOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ToastOrderItemDto)
  items: ToastOrderItemDto[];

  @ApiPropertyOptional({ description: 'Order notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class ToastOrderResponseDto {
  @ApiProperty({ description: 'Order GUID' })
  guid: string;

  @ApiProperty({ description: 'Order number' })
  orderNumber: string;

  @ApiProperty({ enum: ToastOrderStatus })
  status: ToastOrderStatus;

  @ApiPropertyOptional({ description: 'Table name' })
  tableName?: string;

  @ApiPropertyOptional({ description: 'Server name' })
  serverName?: string;

  @ApiProperty({ description: 'Order items', type: [ToastOrderItemDto] })
  items: ToastOrderItemDto[];

  @ApiProperty({ description: 'Subtotal in cents' })
  subtotal: number;

  @ApiProperty({ description: 'Tax in cents' })
  tax: number;

  @ApiProperty({ description: 'Total in cents' })
  total: number;

  @ApiProperty({ description: 'Order created timestamp' })
  createdAt: string;

  @ApiPropertyOptional({ description: 'Order closed timestamp' })
  closedAt?: string;
}

export class ToastSalesDataDto {
  @ApiProperty({ description: 'Sale ID' })
  id: string;

  @ApiProperty({ description: 'Order GUID' })
  orderGuid: string;

  @ApiProperty({ description: 'Item name' })
  itemName: string;

  @ApiPropertyOptional({ description: 'Wine type' })
  wineType?: string;

  @ApiProperty({ description: 'Quantity sold' })
  quantity: number;

  @ApiProperty({ description: 'Unit price' })
  unitPrice: number;

  @ApiProperty({ description: 'Total price' })
  totalPrice: number;

  @ApiProperty({ description: 'Sale timestamp' })
  timestamp: string;

  @ApiPropertyOptional({ description: 'Server name' })
  serverName?: string;

  @ApiPropertyOptional({ description: 'Table name' })
  tableName?: string;

  @ApiProperty({ description: 'Data source (toast_api or mock)' })
  source: string;
}

export class ToastSalesResponseDto {
  @ApiProperty({ description: 'Sales data', type: [ToastSalesDataDto] })
  sales: ToastSalesDataDto[];

  @ApiProperty({ description: 'Total sales count' })
  total: number;

  @ApiProperty({ description: 'Total revenue' })
  totalRevenue: number;

  @ApiProperty({ description: 'Start time of query' })
  startTime: string;

  @ApiProperty({ description: 'End time of query' })
  endTime: string;
}
