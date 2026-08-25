import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export enum ProcurementOrderStatus {
  PENDING = "PENDING",
  APPROVAL_NEEDED = "APPROVAL_NEEDED",
  NEGOTIATING = "NEGOTIATING",
  APPROVED = "APPROVED",
  CONFIRMED = "CONFIRMED",
  IN_TRANSIT = "IN_TRANSIT",
  DELIVERED = "DELIVERED",
  /** Accepted less than was ordered; the remainder stays open as a backorder. */
  PARTIALLY_RECEIVED = "PARTIALLY_RECEIVED",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  REJECTED = "REJECTED",
  FAILED = "FAILED",
}

export class CreateOrderDto {
  @ApiProperty()
  @IsString()
  inventoryId: string;

  @ApiProperty()
  @IsString()
  providerId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  unitType?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  quotedPrice?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  negotiatedPrice?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  finalPrice?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  totalCost?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isEmergency?: boolean;

  @ApiPropertyOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  priorityLevel?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  expectedDeliveryDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  managerNotes?: string;
}

export class UpdateOrderDto {
  @ApiPropertyOptional({ enum: ProcurementOrderStatus })
  @IsEnum(ProcurementOrderStatus)
  @IsOptional()
  status?: ProcurementOrderStatus;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  quotedPrice?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  negotiatedPrice?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  finalPrice?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  totalCost?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  managerNotes?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  rejectionReason?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  deliveryNotes?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  trackingNumber?: string;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  quantityReceived?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  priceVerified?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  invoiceImageUrl?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  discrepancyNotes?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  locationId?: string;
}

/** One signed stock correction applied while verifying a receipt. */
export class ReceiptAdjustmentDto {
  @ApiProperty()
  @IsString()
  inventoryId: string;

  @ApiProperty({
    description: "Signed correction; positive adds, negative removes.",
  })
  @IsNumber()
  delta: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Three-way match payload (PO <-> Invoice <-> Receipt).
 *
 * `adjustments` remains supported for callers that only correct counts. When the match
 * fields below are supplied the server recomputes the verdict itself via computeMatch()
 * and derives the ledger correction — the client is never trusted to decide the outcome.
 */
export class VerifyReceiptDto {
  @ApiPropertyOptional({ type: [ReceiptAdjustmentDto] })
  @IsArray()
  @IsOptional()
  @Type(() => ReceiptAdjustmentDto)
  adjustments?: ReceiptAdjustmentDto[];

  @ApiPropertyOptional({
    description: "Quantity the vendor invoice bills for.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  invoiceQuantity?: number;

  @ApiPropertyOptional({ description: "Unit price the vendor invoice bills." })
  @IsNumber()
  @Min(0)
  @IsOptional()
  invoiceUnitPrice?: number;

  @ApiPropertyOptional({
    description:
      "Quantity the vendor's own packing slip / ASN says shipped. When this disagrees with the invoice, the overbill is proven by the vendor's own paperwork and the claim needs no argument.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  shippedQuantity?: number;

  @ApiPropertyOptional({
    description:
      "Units supplied free under an agreed deal (11 for the price of 10). Netted out of quantity comparisons so a negotiated bonus stops reading as an overage.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  freeGoodsQuantity?: number;

  @ApiPropertyOptional({
    description:
      "Freight, fuel surcharge and split-case fees apportioned to this line. Folded into landed cost — freight is a cost component, not a price variance.",
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  allocatedCharges?: number;

  @ApiPropertyOptional({ description: "Units accepted into stock." })
  @IsInt()
  @Min(0)
  @IsOptional()
  acceptedQuantity?: number;

  @ApiPropertyOptional({
    description: "Units that arrived but were refused (damaged).",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  rejectedQuantity?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  rejectedReason?: string;

  @ApiPropertyOptional({
    description:
      "Required when the invoice price differs from the agreed price.",
  })
  @IsString()
  @IsOptional()
  priceOverrideReason?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  note?: string;
}

export class OrderFilterDto {
  @ApiPropertyOptional({ enum: ProcurementOrderStatus })
  @IsEnum(ProcurementOrderStatus)
  @IsOptional()
  status?: ProcurementOrderStatus;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  providerId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ["asc", "desc"] })
  @IsString()
  @IsOptional()
  sortOrder?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

export class OrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty()
  restaurantId: string;

  @ApiProperty()
  inventoryId: string;

  @ApiProperty()
  providerId: string;

  @ApiProperty()
  quantity: number;

  @ApiPropertyOptional()
  unitType?: string;

  @ApiPropertyOptional()
  bottlesTotal?: number;

  @ApiPropertyOptional()
  quotedPrice?: number;

  @ApiPropertyOptional()
  negotiatedPrice?: number;

  @ApiPropertyOptional()
  finalPrice?: number;

  @ApiPropertyOptional()
  totalCost?: number;

  @ApiProperty({ enum: ProcurementOrderStatus })
  status: ProcurementOrderStatus;

  @ApiPropertyOptional()
  requestedAt?: string;

  @ApiPropertyOptional()
  approvedAt?: string;

  @ApiPropertyOptional()
  deliveredAt?: string;

  @ApiPropertyOptional()
  completedAt?: string;

  @ApiPropertyOptional()
  isEmergency?: boolean;

  @ApiPropertyOptional()
  priorityLevel?: number;

  @ApiPropertyOptional()
  wineName?: string;
}

export class OrderListResponseDto {
  @ApiProperty({ type: [OrderResponseDto] })
  orders: OrderResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  hasMore: boolean;
}
