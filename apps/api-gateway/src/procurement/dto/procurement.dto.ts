import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { ISO_4217_CODES } from "../../common/iso-4217";
import { Type } from "class-transformer";
import { ORDER_UNIT_TYPES } from "../order-units";
import { PRICE_UOM_TYPES } from "../agreed-price";

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

  @ApiPropertyOptional({
    description:
      "The unit the AGREED PRICE is stated in — bottle | case | keg | pack | split_case | " +
      "each | liter. INDEPENDENT of unitType: five cases at a per-bottle price is an " +
      "ordinary order, and a bottle price and a case price for the same item are posted " +
      "separately by the trade (ADR 0119). Omitted means UNSTATED, never 'bottle': an " +
      "agreement with no stated price unit does not enter the price register, and the " +
      "page says so rather than the number being filed under a guess. Must be sent " +
      "together with pricePackSize — half a statement is refused with a 400.",
    enum: PRICE_UOM_TYPES as unknown as string[],
  })
  @IsString()
  @IsOptional()
  priceUom?: string;

  @ApiPropertyOptional({
    description:
      "How many bottles are in one of priceUom. Exactly 1 for a unit that holds one " +
      "(bottle/each/keg/liter); the real pack for case/pack/split_case. Required " +
      "whenever priceUom is sent, and refused without it.",
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  pricePackSize?: number;

  @ApiPropertyOptional({
    description:
      "The money EVERY amount on this line is in — unit price, line total, allowance, deposit, " +
      "freight (ADR 0117 Q31). ISO 4217 alpha-3. Omitted means UNSTATED and the column stores NULL: " +
      "there is no default, because a defaulted currency is a claim about a vendor nobody made — " +
      "`restaurants.currency` said USD about a restaurant in Fethiye for seven months on exactly " +
      "that mechanism. The agreement sheet offers a default worked out from what this vendor last " +
      "billed this house in, and the person confirms or changes it before it is sent.",
    example: "TRY",
  })
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: "currency must be an ISO 4217 alpha-3 code in capitals, e.g. USD, TRY, GBP.",
  })
  // Membership as well as shape (2026-09-06): three capitals is not a
  // currency, and `ZZZ` on an agreement line is a denomination the
  // invoice-versus-agreement check would compare a vendor's real money against.
  @IsIn(ISO_4217_CODES as string[], {
    message: "$value is three letters but names no currency, so nothing was recorded. Send a code this product knows — the currency picker lists them.",
  })
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({
    description:
      "Money the vendor DEDUCTS from this line, as a POSITIVE amount for the whole line " +
      "(ADR 0119 Q3). The agreement's mirror of the invoice line's allowance. Kept outside " +
      "the unit price on purpose: folded in, a one-off deduction is indistinguishable from " +
      "the wine being cheaper, and the next order inherits a price the vendor never gave. " +
      "Omitted means the agreement named none, which is NOT the same as naming zero.",
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  allowance?: number;

  @ApiPropertyOptional({
    description:
      "Refundable container deposit agreed for this line, a POSITIVE amount for the whole " +
      "line (ADR 0119 Q3). Not part of what the wine costs — a deposit folded into the unit " +
      "price becomes a permanent price rise on a bottle that will be redeemed. Omitted means " +
      "the agreement named none.",
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  deposit?: number;

  @ApiPropertyOptional({
    description:
      "Delivery, fuel surcharge or other carriage agreed for this line, a POSITIVE amount for " +
      "the whole line (ADR 0119 Q3). Distributors publish freight as its own schedule by " +
      "weight and distance; it is a cost component, never a price variance. Omitted means the " +
      "agreement named none.",
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  freight?: number;

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

  @ApiPropertyOptional({
    description:
      "Units received, IN THE ORDER'S OWN unit_type — the same unit `quantity` is stated in, " +
      "which is the unit this value is stored beside in procurement_orders. The server reads " +
      "that unit from the order record; a client may not restate it, because a client-asserted " +
      "unit that disagreed with the order's would be a second way to book a wrong quantity.",
  })
  @IsInt()
  @IsOptional()
  quantityReceivedInOrderUom?: number;

  /**
   * @deprecated Unitless. Use `quantityReceivedInOrderUom`.
   *
   * DEPRECATED ALIAS. Kept so a deployed client that still holds the old name
   * keeps working; see `quantity-aliases.ts` for why aliasing rather than a hard
   * rename, and for the condition under which this may be deleted. Sending both
   * names with DIFFERENT values is a 400, not a silent choice.
   */
  @ApiPropertyOptional({
    deprecated: true,
    description:
      "DEPRECATED ALIAS of quantityReceivedInOrderUom. Named no unit. Sending both with different values is refused.",
  })
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

  // -------------------------------------------------------------------------
  // THE UNIT DECLARATIONS.
  //
  // Three documents can each count in their own unit, and until this shipped
  // none of them said which. An order placed in cases of 12 and invoiced in
  // bottles produced a CONFIDENT WRONG VERDICT — 2 vs 24 reads as a 22-unit
  // overage — which was then stamped into the landed cost and the price series,
  // where nothing downstream could identify it as doubtful.
  //
  // Each declaration shares the prefix of the quantities it governs, and every
  // quantity below names the declaration it belongs to in its OWN name. That is
  // deliberate and it is the lesson of a real bug: `countedQty`/`countedUom`
  // sat beside a `rejectedQty` that named no unit, the server converted only the
  // first, and a delivery refused at the door booked 33 bottles of live stock.
  // "The DTO has a unit field somewhere" is not enough; the field has to say
  // which one is ITS unit.
  //
  // Absent means "the unit the order was placed in", which is what every current
  // client already means — each seeds its count from the order's own quantity.
  // An UNRECOGNISED unit is refused rather than assumed, and a case/pack/
  // split_case with no pack size anywhere is refused too: guessing 12 multiplies
  // the delivery twelvefold and guessing 1 divides it by twelve, and neither is
  // knowledge.
  // -------------------------------------------------------------------------

  @ApiPropertyOptional({
    description:
      "Unit the INVOICE bills in — governs invoiceQuantityInInvoiceUom and its prefilled twin. " +
      "Absent means the unit the order was placed in. An unrecognised unit is refused rather than assumed.",
    enum: ORDER_UNIT_TYPES as unknown as string[],
  })
  @IsString()
  @IsOptional()
  invoiceUom?: string;

  @ApiPropertyOptional({
    description:
      "Bottles in one invoiced unit. Required when invoiceUom is case, pack or split_case and the order is not in that same unit.",
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  invoiceBottlesPerUnit?: number;

  @ApiPropertyOptional({
    description:
      "Unit the PACKING SLIP counts in — governs shippedQuantityInShippedUom and its prefilled twin. " +
      "Absent means the unit the order was placed in.",
    enum: ORDER_UNIT_TYPES as unknown as string[],
  })
  @IsString()
  @IsOptional()
  shippedUom?: string;

  @ApiPropertyOptional({
    description: "Bottles in one shipped unit. Required when shippedUom multiplies.",
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  shippedBottlesPerUnit?: number;

  @ApiPropertyOptional({
    description:
      "Unit the PHYSICAL COUNT was taken in — governs acceptedQuantityInCountedUom, " +
      "rejectedQuantityInCountedUom and freeGoodsQuantityInCountedUom. Absent means the unit the " +
      "order was placed in, which is what the receiving screens already show.",
    enum: ORDER_UNIT_TYPES as unknown as string[],
  })
  @IsString()
  @IsOptional()
  countedUom?: string;

  @ApiPropertyOptional({
    description: "Bottles in one counted unit. Required when countedUom multiplies.",
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  countedBottlesPerUnit?: number;

  @ApiPropertyOptional({
    description: "Quantity the vendor invoice bills for, in invoiceUom.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  invoiceQuantityInInvoiceUom?: number;

  @ApiPropertyOptional({
    description:
      "Unit price the vendor invoice bills, PER BOTTLE. It is compared directly against the agreed " +
      "price, which the order line derives per bottle (line_total = final_unit_price * total_bottles).",
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  invoiceUnitPrice?: number;

  @ApiPropertyOptional({
    description:
      "The ISO 4217 alpha-3 code the invoice is denominated in — the VENDOR'S currency, off the vendor's paper, " +
      "not the house's. `procurement_documents.currency` is where an uploaded invoice already carries it, and " +
      "production holds TRY invoices against a house whose own currency says USD. Omit it and the price series " +
      "records the figure with its currency marked NOT RECORDED, and the price register refuses the sighting " +
      "outright rather than stamping USD on it (ADR 0117 Q25).",
    example: "TRY",
  })
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message:
      "invoiceCurrency must be an ISO 4217 alpha-3 code in capitals, e.g. USD, TRY, GBP.",
  })
  // Membership as well as shape (2026-09-06). This value reaches
  // `price_history.currency` and the price register; a code naming no money
  // there is a wrong denomination in the ladder that nobody can see.
  @IsIn(ISO_4217_CODES as string[], {
    message: "$value is three letters but names no currency, so nothing was recorded. Send a code this product knows — the currency picker lists them.",
  })
  @IsOptional()
  invoiceCurrency?: string;

  @ApiPropertyOptional({
    description:
      "Quantity the vendor's own packing slip / ASN says shipped, in shippedUom. When this disagrees with the invoice, the overbill is proven by the vendor's own paperwork and the claim needs no argument.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  shippedQuantityInShippedUom?: number;

  @ApiPropertyOptional({
    description:
      "Units supplied free under an agreed deal (11 for the price of 10), in countedUom. Netted out of quantity comparisons so a negotiated bonus stops reading as an overage.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  freeGoodsQuantityInCountedUom?: number;

  @ApiPropertyOptional({
    description:
      "Freight, fuel surcharge and split-case fees apportioned to this line. Folded into landed cost — freight is a cost component, not a price variance.",
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  allocatedCharges?: number;

  @ApiPropertyOptional({
    description: "Units accepted into stock, in countedUom.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  acceptedQuantityInCountedUom?: number;

  @ApiPropertyOptional({
    description:
      "Units that arrived but were refused (damaged), in countedUom. Same unit as acceptedQuantityInCountedUom — " +
      "converting only one of the pair is precisely how a delivery refused at the door once booked 33 bottles of live stock.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  rejectedQuantityInCountedUom?: number;

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
      "What the extraction proposed for invoiceQuantityInInvoiceUom before the human answered (ADR 0059), " +
      "in the same invoiceUom as its twin. Absent = the form was not pre-filled.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  prefilledInvoiceQuantityInInvoiceUom?: number;

  @ApiPropertyOptional({
    description:
      "As prefilledInvoiceQuantityInInvoiceUom, for the unit price. Per bottle, like its twin.",
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  prefilledInvoiceUnitPrice?: number;

  @ApiPropertyOptional({
    description:
      "As prefilledInvoiceQuantityInInvoiceUom, for the shipped quantity, in shippedUom.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  prefilledShippedQuantityInShippedUom?: number;

  @ApiPropertyOptional({
    description:
      "As prefilledInvoiceQuantityInInvoiceUom, for free goods, in countedUom.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  prefilledFreeGoodsQuantityInCountedUom?: number;

  // =========================================================================
  // DEPRECATED ALIASES — the old unitless names.
  //
  // WHY ALIASES AND NOT A HARD RENAME. `apps/mobile/app/(tabs)/cellar/receive/
  // [orderId].tsx` runs on a phone that updates on the App Store's schedule and
  // queues receipts in an offline outbox, so a payload composed before this
  // change can still arrive weeks later. A bare rename would answer those with
  // "acceptedQuantity is not a known field" and stop receiving working on every
  // phone that had not updated — a worse outage than the bug being fixed.
  //
  // AN ALIAS MAY NOT LIE. Supplying an alias AND its canonical twin with
  // DIFFERENT values is refused with a 400 naming both fields and both values
  // (`quantity-aliases.ts#readAliasedQuantity`). A server that quietly picked
  // one would be committing the same defect these renames exist to end: a number
  // chosen by a rule nobody can see. Equal values are accepted — a client
  // mid-migration may legitimately send both.
  //
  // REMOVAL CONDITION, so a future session knows what to wait for rather than
  // reading "someday": delete these once no DEPLOYED client can still hold the
  // old name — when the oldest mobile build in the wild sends the canonical
  // names AND no queued offline receipt predating that build can still be
  // replayed. In-repo callers are not the gate; they moved in this change.
  // =========================================================================

  /** @deprecated Named no unit. Use `invoiceQuantityInInvoiceUom` with `invoiceUom`. */
  @ApiPropertyOptional({
    deprecated: true,
    description:
      "DEPRECATED ALIAS of invoiceQuantityInInvoiceUom. Sending both with different values is refused.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  invoiceQuantity?: number;

  /** @deprecated Named no unit. Use `shippedQuantityInShippedUom` with `shippedUom`. */
  @ApiPropertyOptional({
    deprecated: true,
    description:
      "DEPRECATED ALIAS of shippedQuantityInShippedUom. Sending both with different values is refused.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  shippedQuantity?: number;

  /** @deprecated Named no unit. Use `freeGoodsQuantityInCountedUom` with `countedUom`. */
  @ApiPropertyOptional({
    deprecated: true,
    description:
      "DEPRECATED ALIAS of freeGoodsQuantityInCountedUom. Sending both with different values is refused.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  freeGoodsQuantity?: number;

  /** @deprecated Named no unit. Use `acceptedQuantityInCountedUom` with `countedUom`. */
  @ApiPropertyOptional({
    deprecated: true,
    description:
      "DEPRECATED ALIAS of acceptedQuantityInCountedUom. Sending both with different values is refused.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  acceptedQuantity?: number;

  /** @deprecated Named no unit. Use `rejectedQuantityInCountedUom` with `countedUom`. */
  @ApiPropertyOptional({
    deprecated: true,
    description:
      "DEPRECATED ALIAS of rejectedQuantityInCountedUom. Sending both with different values is refused.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  rejectedQuantity?: number;

  /** @deprecated Named no unit. Use `prefilledInvoiceQuantityInInvoiceUom`. */
  @ApiPropertyOptional({
    deprecated: true,
    description:
      "DEPRECATED ALIAS of prefilledInvoiceQuantityInInvoiceUom. Sending both with different values is refused.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  prefilledInvoiceQuantity?: number;

  /** @deprecated Named no unit. Use `prefilledShippedQuantityInShippedUom`. */
  @ApiPropertyOptional({
    deprecated: true,
    description:
      "DEPRECATED ALIAS of prefilledShippedQuantityInShippedUom. Sending both with different values is refused.",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  prefilledShippedQuantity?: number;

  /** @deprecated Named no unit. Use `prefilledFreeGoodsQuantityInCountedUom`. */
  @ApiPropertyOptional({
    deprecated: true,
    description:
      "DEPRECATED ALIAS of prefilledFreeGoodsQuantityInCountedUom. Sending both with different values is refused.",
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

  /**
   * The vendor's NAME, joined from `providers` on `provider_id`.
   *
   * The same three states as the price pair below, and for the same reason:
   *   * a string — the provider row was read and carries this name;
   *   * `null` — the route joined `providers` and got nothing back. The
   *     provider row is gone, or `provider_id` is null. That is a fact about
   *     this order, and the screens print "the vendor is not named on this
   *     order" rather than a blank;
   *   * **the key ABSENT** — this route does not join `providers` at all, so
   *     it knows nothing either way. Only `GET /procurement/orders`,
   *     `/orders/history`, `/orders/pending` and `/orders/:id` join it today.
   *
   * A consumer must never read the absent case as "no vendor" — that is the
   * absence-reported-as-health fault (ADR 0020). Before this field existed,
   * four surfaces read a `providerName` the wire had never sent: the receiving
   * door's credit-note letter was addressed "To the vendor" and named nobody
   * on every order it had ever opened.
   */
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: "Kavaklidere Saraplari",
    description:
      "The vendor's name, joined from providers on provider_id. null = the join was made and returned no name. Key ABSENT = this route does not join providers.",
  })
  providerName?: string | null;

  /**
   * `procurement_orders.quantity_received` — what has actually been booked
   * against this order so far.
   *
   * Three states, as everywhere else on this DTO: a number; `null` (the column
   * was read and is empty — nothing has been received); the key ABSENT (this
   * route did not read the column). A screen that pre-fills a physical count
   * MUST tell `null` from absent: the phone used to read
   * `order.quantityReceived ?? order.quantity` against a key the wire never
   * sent, so a partially-received order pre-filled the receiver's count from
   * the ORDERED quantity.
   *
   * IT TRAVELS WITH `quantityReceivedUom` AND IS UNSAFE WITHOUT IT. The column
   * has four writers and they do not agree on its unit — see
   * `quantity-received-unit.ts`, which carries the measurement.
   */
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 3,
    description:
      "Units received against this order so far, in quantityReceivedUom. null = the column was read and is empty. Key ABSENT = this route does not read it. Never use it without its unit.",
  })
  quantityReceived?: number | null;

  /**
   * The unit `quantityReceived` is stated in — ADR 0070.
   *
   * A unit when the row can state one; `null` when it CANNOT, which is a
   * refusal and not a default. The column is a single integer written in the
   * order's own unit by three code paths and in bottles by the receiving door,
   * and nothing on the row records which wrote it — so on an order placed in
   * cases the two readings differ by the pack size and neither is knowledge.
   * On an order whose unit does not multiply (bottle, each, keg, liter, or
   * absent) both writers produce the same number and the unit is stated.
   *
   * The key is ABSENT exactly when `quantityReceived` is absent: they are one
   * fact and never travel apart.
   */
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: "bottle",
    description:
      "The unit quantityReceived is stated in. null = this row cannot state it (the column has two writers with two units and the row does not say which), so the count must not be used as a pre-fill. Travels with quantityReceived: both stated, both null-able, or both keys absent.",
  })
  quantityReceivedUom?: string | null;

  /**
   * The unit the agreed price is stated in — ADR 0119, read from the LINE.
   *
   * THREE VALUES, AND THE THIRD ONE IS THE POINT:
   *   * `"case"` (etc.) — the line states this unit, and `pricePackSize` says
   *     how many bottles are in one of them. The two always travel together.
   *   * `null` — the line was READ and states no unit. That is a refusal, not a
   *     default: the price register will not take this agreement, and the page
   *     prints the register's own sentence instead of a bare number.
   *   * **the key is ABSENT** — this route does not read
   *     `procurement_order_items` at all, so it knows nothing either way. Only
   *     `GET /procurement/orders` (and `/orders/history`, which is the same
   *     method) joins the line today; every other route returning an
   *     `OrderResponseDto` omits both keys.
   *
   * A consumer must never read the absent case as "unstated" — that is the
   * absence-reported-as-health fault (ADR 0020), and it is why this is
   * `string | null` on an optional property rather than a plain optional
   * string: missing and null are different answers, and JSON keeps them apart.
   *
   * `procurement_orders` carries no price unit of its own — the header's
   * `final_price` is an echo of the line by column comment
   * (`20260905010000_an_agreed_price_states_its_unit.sql`) — so this field
   * reports a unit only when every line under the order agrees on one
   * (`agreed-price.ts` `foldOrderPriceUnit`).
   */
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: "case",
    description:
      "The unit the agreed price is stated in, read from the order line. null = the line was read and states none, so the price register refuses it. Key ABSENT = this route does not read the line and knows nothing either way.",
  })
  priceUom?: string | null;

  /**
   * How many bottles are in one `priceUom`. Both halves or neither: the CHECK
   * `procurement_order_items_price_unit_pair_check` says so in the database,
   * and `readStatedPriceUnit` reads a half-written row as UNSTATED rather than
   * as half a claim.
   */
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 12,
    description:
      "Bottles in one priceUom. Travels with priceUom: both stated, both null, or both keys absent.",
  })
  pricePackSize?: number | null;

  /**
   * The money the agreement names OUTSIDE the price of the wine — ADR 0119 Q3,
   * read from the LINE like the pair above.
   *
   * The same three states as `priceUom`, and the third is again the point:
   *   * a number — the agreement names this amount for the whole line;
   *   * `null` — the line was read and names none;
   *   * **the key ABSENT** — this route did not read the fee columns, so it
   *     knows nothing either way. A consumer that read absence as "no deposit"
   *     would be reporting the absence of a read as a fact about the agreement.
   *
   * All three are POSITIVE amounts. `allowance` deducts; `deposit` and
   * `freight` add. The direction is in the name, never in a sign, and the
   * database CHECKs refuse a negative.
   */
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 25,
    description:
      "Allowance the vendor deducts from this line, positive, for the whole line. null = the line was read and names none. Key ABSENT = this route does not read the line's fee columns.",
  })
  allowance?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 6,
    description:
      "Refundable container deposit agreed for this line, positive, for the whole line. Travels with allowance and freight: all three stated, all three null, or all three keys absent.",
  })
  deposit?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 48,
    description:
      "Freight or carriage agreed for this line, positive, for the whole line. A cost component, never a price variance.",
  })
  freight?: number | null;

  /*
   * ===========================================================================
   * THE RECURRENCE (ADR 0125's addendum, founder 2026-09-05)
   * ===========================================================================
   * Six keys that travel together: all six stated, or all six ABSENT. The
   * distinction is the point of the whole group.
   *
   *   a value        this order repeats, and this is the rule
   *   null           this route READ the recurrence columns and this order does
   *                  not repeat
   *   key absent     this route does not read them, and knows nothing either way
   *
   * Reading absent as "does not repeat" is the fault this whole group exists to
   * remove. `.planning/v3.0-TECH-DEBT.md` "The orders wire" item 2:
   * `useOrdersNextData.toRow` set `recurring = false` unconditionally, so the
   * rebuilt page's Recurring station could never fill and every order fell into
   * "one-time" — and nothing on the wire could have told it otherwise.
   *
   * `GET /procurement/orders` and `GET /procurement/orders/:id` select `*` and
   * therefore send all six. A route that selects a column list sends none.
   */

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: "weekly",
    description:
      "How often this order repeats: daily, weekly, biweekly, monthly or quarterly. null = this route read the recurrence and this order does not repeat. Key ABSENT = this route does not read it. There is no second flag; procurement_orders.is_recurring is tombstoned.",
  })
  recurrenceFrequency?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 1,
    description:
      "What the rule is anchored to. Weekly/biweekly: a weekday, 0 = Monday to 6 = Sunday. Monthly/quarterly: a day of the month, 1 to 28 — 28 so that every month has one. null = no anchor stated, and the series runs from its start date.",
  })
  recurrenceAnchorDay?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: "2026-09-12",
    description:
      "The next date this order comes round, YYYY-MM-DD. DERIVED, never typed: nextOccurrenceOn() in order-recurrence.ts is the only thing that advances it. null on a paused or ended series.",
  })
  recurrenceNextDueOn?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: "active",
    description:
      "active, paused or ended. Paused keeps its place in the calendar and can be resumed; ended is over. A recurrence never approves anything — every occurrence is born PENDING and is sealed by a person.",
  })
  recurrenceStatus?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      "The order carrying the rule this one was minted from. Set on a CHILD, null on the parent and on every order that does not recur.",
  })
  recurrenceParentOrderId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: "2026-09-12",
    description:
      "The occurrence date this child was minted for. Travels with recurrenceParentOrderId: both set or both null. A partial unique index over the pair is what stops two orders being raised for one occurrence.",
  })
  recurrenceOccurrenceOn?: string | null;
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
