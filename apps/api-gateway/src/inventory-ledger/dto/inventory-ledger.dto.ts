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
  Min,
  Max,
} from "class-validator";

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

  @ApiProperty({
    nullable: true,
    description:
      "Base unit the three quantities above are counted in — one of each/bottle/mg/ml (ADR 0070). It is the item's canonical unit, never a per-row choice.",
  })
  uom: string | null;

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

/** One unit's slice of a summary. Quantities within a slice are always comparable. */
export class UomSummaryDto {
  @ApiProperty({ description: "Base unit these totals are counted in." })
  uom: string;

  @ApiProperty()
  totalIn: number;

  @ApiProperty()
  totalOut: number;

  @ApiProperty()
  netChange: number;

  @ApiProperty()
  transactionCount: number;
}

/** A per-type or per-source bucket. `quantity` is null when the bucket spans units. */
export class SummaryBucketDto {
  @ApiProperty()
  count: number;

  @ApiProperty({
    nullable: true,
    description:
      "Net quantity in `uom`. NULL when this bucket mixes units — a mixed sum is not a quantity, so it is refused rather than reported (ADR 0051).",
  })
  quantity: number | null;

  @ApiProperty({
    nullable: true,
    description: "The single base unit `quantity` is counted in, or null if mixed.",
  })
  uom: string | null;
}

export class TransactionSummaryResponseDto {
  @ApiProperty()
  restaurantId: string;

  @ApiProperty()
  period: string;

  // ADR 0070: every ledger row now states its own unit, and a cross-unit
  // aggregate must convert or refuse rather than silently sum. These three
  // scalars are the whole-restaurant totals, which are only a quantity when
  // every movement in the period shared one unit. Adding 25 (kg of flour) to
  // 25000 (mg of saffron) is not a number, so NULL is the honest answer and
  // `byUom` carries the real one.
  @ApiProperty({ nullable: true })
  totalIn: number | null;

  @ApiProperty({ nullable: true })
  totalOut: number | null;

  @ApiProperty({ nullable: true })
  netChange: number | null;

  @ApiProperty({
    nullable: true,
    description:
      "The single base unit the scalar totals are counted in, or null when the period spans more than one unit.",
  })
  uom: string | null;

  @ApiProperty({ type: [UomSummaryDto] })
  byUom: UomSummaryDto[];

  @ApiProperty({
    description:
      "Rows whose uom was missing or outside the base vocabulary. Counted rather than dropped: a total that quietly omits rows reports absence as health.",
  })
  unreadableCount: number;

  @ApiProperty()
  transactionCount: number;

  @ApiProperty({ type: SummaryBucketDto })
  byType: Record<string, SummaryBucketDto>;

  @ApiProperty({ type: SummaryBucketDto })
  bySource: Record<string, SummaryBucketDto>;
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

export class BulkTransactionDto {
  @ApiProperty({ type: [CreateInventoryTransactionDto] })
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
