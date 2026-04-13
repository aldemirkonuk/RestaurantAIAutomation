import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsNumber,
  IsUUID,
  IsDateString,
  IsObject,
  Min,
  Max,
} from 'class-validator';

// ============================================================================
// ENUMS
// ============================================================================

export enum TransactionType {
  SALE = 'sale',
  PURCHASE = 'purchase',
  ADJUSTMENT = 'adjustment',
  TRANSFER = 'transfer',
  WASTE = 'waste',
  RETURN = 'return',
  COMP = 'comp',
  RECONCILIATION = 'reconciliation',
  INITIAL = 'initial',
  CORRECTION = 'correction',
}

export enum TransactionSource {
  POS = 'pos',
  MANUAL = 'manual',
  ORDER = 'order',
  MOBILE_COUNT = 'mobile_count',
  RECONCILIATION = 'reconciliation',
  SYSTEM = 'system',
  IMPORT = 'import',
  API = 'api',
}

export enum StockType {
  LIVE = 'live',
  SHADOW = 'shadow',
  RESERVED = 'reserved',
}

// ============================================================================
// CREATE TRANSACTION DTO
// ============================================================================

export class CreateInventoryTransactionDto {
  @ApiProperty({ description: 'Inventory item ID' })
  @IsUUID()
  inventoryId: string;

  @ApiProperty({ description: 'Wine ID' })
  @IsUUID()
  wineId: string;

  @ApiProperty({ enum: TransactionType })
  @IsEnum(TransactionType)
  transactionType: TransactionType;

  @ApiProperty({ enum: TransactionSource })
  @IsEnum(TransactionSource)
  source: TransactionSource;

  @ApiProperty({ description: 'Quantity change (positive = increase, negative = decrease)' })
  @IsInt()
  quantityChange: number;

  @ApiPropertyOptional({ enum: StockType, default: StockType.LIVE })
  @IsEnum(StockType)
  @IsOptional()
  stockType?: StockType;

  @ApiPropertyOptional({ description: 'Reference type (e.g., order, pos_transaction)' })
  @IsString()
  @IsOptional()
  referenceType?: string;

  @ApiPropertyOptional({ description: 'Reference ID' })
  @IsUUID()
  @IsOptional()
  referenceId?: string;

  @ApiPropertyOptional({ description: 'POS transaction ID' })
  @IsString()
  @IsOptional()
  posTransactionId?: string;

  @ApiPropertyOptional({ description: 'Procurement order ID' })
  @IsUUID()
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Source location ID (for transfers)' })
  @IsUUID()
  @IsOptional()
  fromLocationId?: string;

  @ApiPropertyOptional({ description: 'Destination location ID (for transfers)' })
  @IsUUID()
  @IsOptional()
  toLocationId?: string;

  @ApiPropertyOptional({ description: 'Unit cost at time of transaction' })
  @IsNumber()
  @IsOptional()
  unitCost?: number;

  @ApiPropertyOptional({ description: 'Reason for the transaction' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

// ============================================================================
// QUERY DTOs
// ============================================================================

export class GetTransactionsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by inventory item ID' })
  @IsUUID()
  @IsOptional()
  inventoryId?: string;

  @ApiPropertyOptional({ description: 'Filter by wine ID' })
  @IsUUID()
  @IsOptional()
  wineId?: string;

  @ApiPropertyOptional({ enum: TransactionType })
  @IsEnum(TransactionType)
  @IsOptional()
  transactionType?: TransactionType;

  @ApiPropertyOptional({ enum: TransactionSource })
  @IsEnum(TransactionSource)
  @IsOptional()
  source?: TransactionSource;

  @ApiPropertyOptional({ description: 'Start date (ISO)' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO)' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  limit?: number;
}

export class GetBalanceAtQueryDto {
  @ApiProperty({ description: 'Point in time (ISO timestamp)' })
  @IsDateString()
  asOf: string;

  @ApiPropertyOptional({ enum: StockType, default: StockType.LIVE })
  @IsEnum(StockType)
  @IsOptional()
  stockType?: StockType;
}

// ============================================================================
// RESPONSE DTOs
// ============================================================================

export class InventoryTransactionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  restaurantId: string;

  @ApiProperty()
  inventoryId: string;

  @ApiProperty()
  wineId: string;

  @ApiProperty({ enum: TransactionType })
  transactionType: TransactionType;

  @ApiProperty({ enum: TransactionSource })
  source: TransactionSource;

  @ApiProperty()
  quantityChange: number;

  @ApiProperty()
  quantityBefore: number;

  @ApiProperty()
  quantityAfter: number;

  @ApiProperty({ enum: StockType })
  stockType: StockType;

  @ApiPropertyOptional()
  referenceType?: string;

  @ApiPropertyOptional()
  referenceId?: string;

  @ApiPropertyOptional()
  posTransactionId?: string;

  @ApiPropertyOptional()
  orderId?: string;

  @ApiPropertyOptional()
  fromLocationId?: string;

  @ApiPropertyOptional()
  toLocationId?: string;

  @ApiPropertyOptional()
  unitCost?: number;

  @ApiPropertyOptional()
  totalCost?: number;

  @ApiPropertyOptional()
  performedBy?: string;

  @ApiProperty()
  performedByType: string;

  @ApiPropertyOptional()
  reason?: string;

  @ApiPropertyOptional()
  notes?: string;

  @ApiPropertyOptional()
  metadata?: Record<string, unknown>;

  @ApiProperty()
  transactionDate: string;

  @ApiProperty()
  createdAt: string;
}

export class TransactionsListResponseDto {
  @ApiProperty({ type: [InventoryTransactionResponseDto] })
  transactions: InventoryTransactionResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  hasMore: boolean;
}

export class InventoryBalanceResponseDto {
  @ApiProperty()
  inventoryId: string;

  @ApiProperty()
  balance: number;

  @ApiProperty()
  asOf: string;

  @ApiProperty({ enum: StockType })
  stockType: StockType;
}

export class TransactionSummaryResponseDto {
  @ApiProperty()
  restaurantId: string;

  @ApiProperty()
  period: string;

  @ApiProperty()
  totalIn: number;

  @ApiProperty()
  totalOut: number;

  @ApiProperty()
  netChange: number;

  @ApiProperty()
  transactionCount: number;

  @ApiProperty()
  byType: Record<string, { count: number; quantity: number }>;

  @ApiProperty()
  bySource: Record<string, { count: number; quantity: number }>;
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

export class BulkTransactionDto {
  @ApiProperty({ type: [CreateInventoryTransactionDto] })
  transactions: CreateInventoryTransactionDto[];

  @ApiPropertyOptional({ description: 'Correlation ID for all transactions' })
  @IsString()
  @IsOptional()
  correlationId?: string;
}

export class BulkTransactionResponseDto {
  @ApiProperty()
  successCount: number;

  @ApiProperty()
  failedCount: number;

  @ApiProperty({ type: [String] })
  createdIds: string[];

  @ApiProperty({ type: [Object] })
  errors: { index: number; error: string }[];
}
