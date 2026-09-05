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
