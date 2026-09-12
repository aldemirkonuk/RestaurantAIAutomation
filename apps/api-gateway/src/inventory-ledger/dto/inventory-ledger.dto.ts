import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsNumber,
  IsUUID,
  IsDateString,
  IsObject,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  ValidateNested,
  Min,
  Max,
} from "class-validator";
import { Type } from "class-transformer";

// ============================================================================
// ENUMS
// ============================================================================

export enum TransactionType {
  SALE = "sale",
  PURCHASE = "purchase",
  ADJUSTMENT = "adjustment",
  TRANSFER = "transfer",
  WASTE = "waste",
  RETURN = "return",
  COMP = "comp",
  RECONCILIATION = "reconciliation",
  INITIAL = "initial",
  CORRECTION = "correction",
}

export enum TransactionSource {
  POS = "pos",
  MANUAL = "manual",
  ORDER = "order",
  MOBILE_COUNT = "mobile_count",
  RECONCILIATION = "reconciliation",
  SYSTEM = "system",
  IMPORT = "import",
  API = "api",
}

export enum StockType {
  LIVE = "live",
  SHADOW = "shadow",
}

// ============================================================================
// CREATE TRANSACTION DTO
// ============================================================================

export class CreateInventoryTransactionDto {
  @ApiProperty({ description: "Inventory item ID" })
  @IsUUID()
  inventoryId: string;

  @ApiProperty({ description: "Wine ID" })
  @IsUUID()
  wineId: string;

  @ApiProperty({ enum: TransactionType })
  @IsEnum(TransactionType)
  transactionType: TransactionType;

  @ApiProperty({ enum: TransactionSource })
  @IsEnum(TransactionSource)
  source: TransactionSource;

  @ApiProperty({
    description: "Quantity change (positive = increase, negative = decrease)",
  })
  @IsInt()
  quantityChange: number;

  @ApiPropertyOptional({ enum: StockType, default: StockType.LIVE })
  @IsEnum(StockType)
  @IsOptional()
  stockType?: StockType;

  @ApiPropertyOptional({
    description: "Reference type (e.g., order, pos_transaction)",
  })
  @IsString()
  @IsOptional()
  referenceType?: string;

  @ApiPropertyOptional({ description: "Reference ID" })
  @IsUUID()
  @IsOptional()
  referenceId?: string;

  @ApiPropertyOptional({ description: "POS transaction ID" })
  @IsString()
  @IsOptional()
  posTransactionId?: string;

  @ApiPropertyOptional({ description: "Procurement order ID" })
  @IsUUID()
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({ description: "Source location ID (for transfers)" })
  @IsUUID()
  @IsOptional()
  fromLocationId?: string;

  @ApiPropertyOptional({
    description: "Destination location ID (for transfers)",
  })
  @IsUUID()
  @IsOptional()
  toLocationId?: string;

  @ApiPropertyOptional({ description: "Unit cost at time of transaction" })
  @IsNumber()
  @IsOptional()
  unitCost?: number;

  @ApiPropertyOptional({ description: "Reason for the transaction" })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({ description: "Additional notes" })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: "Additional metadata" })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @ApiProperty({
    description:
      "Client-generated, stable across retries. Mandatory: apply_stock_movement " +
      "is idempotent on this key, and a caller that cannot supply one cannot " +
      "safely retry a stock write over a flaky connection.",
  })
  @IsString()
  idempotencyKey: string;
}

// ============================================================================
// QUERY DTOs
// ============================================================================

export class GetTransactionsQueryDto {
  @ApiPropertyOptional({ description: "Filter by inventory item ID" })
  @IsUUID()
  @IsOptional()
  inventoryId?: string;

  @ApiPropertyOptional({ description: "Filter by wine ID" })
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

  @ApiPropertyOptional({ description: "Start date (ISO)" })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: "End date (ISO)" })
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
  @ApiProperty({ description: "Point in time (ISO timestamp)" })
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

/**
 * Upper bound on one bulk call. The handler loops
 * `for (i = 0; i < dto.transactions.length; i++)` and awaits a database write
 * per element, so without a cap the array length is a caller-chosen amount of
 * server work — one request can hold a worker for as long as it likes.
 *
 * 500 is comfortably above a real physical count (the largest cellar counts in
 * the corpus are low hundreds of lines) and far below a useful denial of
 * service.
 */
export const BULK_TRANSACTION_MAX = 500;

export class BulkTransactionDto {
  @ApiProperty({
    type: [CreateInventoryTransactionDto],
    maxItems: BULK_TRANSACTION_MAX,
  })
  // These four decorators were absent entirely: the nested transaction objects
  // were never validated (ValidationPipe cannot see into an array without
  // @ValidateNested + @Type) and the array was unbounded.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_TRANSACTION_MAX)
  @ValidateNested({ each: true })
  @Type(() => CreateInventoryTransactionDto)
  transactions: CreateInventoryTransactionDto[];

  @ApiPropertyOptional({ description: "Correlation ID for all transactions" })
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

// ============================================================================
// RECONCILIATION (ADR 0078 — a count is a record)
// ============================================================================

export class StockCountRecordDto {
  @ApiProperty({ nullable: true })
  countId: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "What the lots said at the instant of the count, read under the same lock the applied delta was computed from — not the restaurant_inventory.stock_live projection.",
  })
  expectedQty: number | null;

  @ApiProperty({ nullable: true })
  countedQty: number | null;

  @ApiProperty({
    nullable: true,
    description:
      "counted - expected. 0 means the books were right, which is a recorded outcome and was previously unrepresentable.",
  })
  varianceQty: number | null;

  @ApiProperty({
    nullable: true,
    description:
      "The movement this count caused, or null when nothing had to move.",
  })
  transactionId: string | null;

  @ApiProperty({ nullable: true })
  countedAt: string | null;

  @ApiProperty({
    description: "True when this request replayed an already-recorded count.",
  })
  replayed: boolean;
}

export class ReconcileResultDto {
  @ApiProperty({
    type: StockCountRecordDto,
    description: "Always present — the count is recorded whether or not it changed anything.",
  })
  count: StockCountRecordDto;

  @ApiProperty({
    type: InventoryTransactionResponseDto,
    nullable: true,
    description:
      "The ledger movement, or null when the count agreed. Null is a result, not an error: this endpoint used to answer a correct count with a 400.",
  })
  transaction: InventoryTransactionResponseDto | null;
}
