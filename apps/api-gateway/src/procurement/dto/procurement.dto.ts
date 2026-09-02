import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ORDER_UNIT_TYPES } from "../order-units";

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

  @ApiPropertyOptional({
    description:
      "Purchase unit: bottle | case | keg | pack | split_case | each | liter. " +
      "Omitted means bottles. An unrecognised unit is refused rather than assumed — " +
      "a guessed unit books a wrong quantity that nothing downstream can detect.",
    enum: ORDER_UNIT_TYPES as unknown as string[],
  })
  @IsString()
  @IsOptional()
  unitType?: string;

  @ApiPropertyOptional({
    description:
      "Bottles in one purchase unit. REQUIRED when unitType is case, pack or split_case: " +
      "guessing 12 books twelve times the delivery and guessing 1 books a twelfth of it, " +
      "so the order is refused until the pack size is stated.",
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  bottlesPerUnit?: number;

  @ApiPropertyOptional({
    description:
      "The vendor's own SKU for this wine, when the buyer knows it. Carried onto the " +
      "order line so an arriving invoice can be matched on an exact SKU rather than on " +
      "a description — the only match method strong enough to auto-apply.",
  })
  @IsString()
  @IsOptional()
  vendorSku?: string;

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
  // @IsUUID, not @IsString: this id is handed straight to apply_stock_movement,
  // which derives restaurant_id from the target row rather than from the caller.
  // Shape is the cheap half of that fix; the ownership check in
  // ProcurementService.applyReceiptAdjustment is the half that actually closes it.
  @IsUUID()
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
  // @ValidateNested({ each: true }) is what makes @Type() mean anything.
  // Without it, class-validator constructs ReceiptAdjustmentDto instances and
  // then validates NONE of their decorators — `adjustments` was checked only for
  // being an array, and every field inside it was accepted verbatim.
  @ValidateNested({ each: true })
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

  // =========================================================================
  // ADR 0059 — what the machine PROPOSED, before the human answered.
  //
  // The fields above are the manager's answer and remain the record. These are
  // the extraction's pre-fill, sent alongside so a correction is distinguishable
  // from a confirmation. A manager fixing a misread 22 to 24 used to leave the
  // submitted 24 indistinguishable from a 24 the model read correctly — which
  // makes every extraction correction invisible in the only corpus that could
  // grade the extractor.
  //
  // ABSENT means the form was not pre-filled from a document, so the final value
  // is not a correction of anything. It never means "proposed zero".
  //
  // TODO(ADR 0059, L4) — ACCEPTED HERE, NOT YET PERSISTED. DELIBERATE.
  // `ReceivingWorkspace.tsx` sends all four, this DTO validates all four, and
  // the columns exist (20260901200000_receiving_preserves_the_pair.sql adds
  // procurement_orders.prefilled_invoice_quantity and its three siblings). The
  // write belongs in procurement.service.ts `verifyReceipt`, in the same
  // `Object.assign(update, {...})` that already writes invoice_quantity — four
  // lines:
  //
  //     prefilled_invoice_quantity:    body.prefilledInvoiceQuantity ?? null,
  //     prefilled_invoice_unit_price:  body.prefilledInvoiceUnitPrice ?? null,
  //     prefilled_shipped_quantity:    body.prefilledShippedQuantity ?? null,
  //     prefilled_free_goods_quantity: body.prefilledFreeGoodsQuantity ?? null,
  //
  // That file was owned by a concurrent session when this landed and could not
  // be edited without a collision. UNTIL IT IS DONE, THE MANAGER'S CORRECTION IS
  // STILL LOST — it now reaches the gateway and is dropped there rather than in
  // the browser, which is a shorter fall, not a fix. The skipped test tagged
  // "ADR 0059 L4" in proposal-preservation-deferred.spec.ts fails until the write
  // exists; un-skip it with the change.
  // =========================================================================

  @ApiPropertyOptional({
    description:
      "What the extraction proposed for invoiceQuantity before the human answered (ADR 0059). Absent = the form was not pre-filled.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  prefilledInvoiceQuantity?: number;

  @ApiPropertyOptional({
    description: "As prefilledInvoiceQuantity, for the unit price.",
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  prefilledInvoiceUnitPrice?: number;

  @ApiPropertyOptional({
    description: "As prefilledInvoiceQuantity, for the shipped quantity.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  prefilledShippedQuantity?: number;

  @ApiPropertyOptional({
    description: "As prefilledInvoiceQuantity, for free goods.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  prefilledFreeGoodsQuantity?: number;
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
