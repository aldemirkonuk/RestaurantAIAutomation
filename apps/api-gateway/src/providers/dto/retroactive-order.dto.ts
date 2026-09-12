import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
} from "class-validator";
import { ORDER_UNIT_TYPES } from "../../procurement/order-units";

/**
 * An invoice for wine that was bought outside the app, entered after the fact.
 *
 * WHY THIS DTO CHANGED SHAPE
 *
 * The previous version promised `wineName: string` and made everything else
 * optional. Neither half could be honoured:
 *
 *   - `procurement_orders.inventory_id` is `uuid NOT NULL`. A free-text wine
 *     name cannot become one. Matching the string against the inventory would
 *     mean attaching an invoice to whichever wine the fuzzy match liked, which
 *     is worse than refusing — a mis-attached invoice moves real money against
 *     the wrong wine's cost history and nothing downstream can detect it.
 *   - `quantity`, `final_price`, `total_cost` and `bottles_total` are all NOT
 *     NULL. Accepting an invoice with no quantity and no price and then writing
 *     an order anyway is not possible; the previous code accepted them and
 *     produced an insert that could never succeed.
 *
 * So the fields the schema requires are required here, stated in the units the
 * invoice itself states them in, and the ones that cannot be honoured are gone
 * rather than accepted and dropped.
 */
export class RetroactiveOrderDto {
  @ApiProperty({
    description:
      "The restaurant_inventory row this invoice is for. A uuid, not a wine name: " +
      "procurement_orders.inventory_id is NOT NULL and a name match that picks the " +
      "wrong wine books real money against the wrong cost history.",
    format: "uuid",
  })
  @IsUUID()
  inventoryId: string;

  @ApiProperty({
    description: "Quantity on the invoice, in the unit stated by unitType.",
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    description:
      "Purchase unit on the invoice: bottle | case | keg | pack | split_case | each | liter. " +
      "Omitted means bottles. An unrecognised unit is refused rather than assumed.",
    enum: ORDER_UNIT_TYPES as unknown as string[],
  })
  @IsString()
  @IsOptional()
  unitType?: string;

  @ApiPropertyOptional({
    description:
      "Bottles in one purchase unit. REQUIRED when unitType is case, pack or split_case — " +
      "the invoice total cannot be spread across bottles without it.",
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  bottlesPerUnit?: number;

  @ApiProperty({
    description:
      "The total printed on the invoice, for this line, in currency. Not a per-bottle " +
      "price: the per-bottle figure is derived from this and the bottle count, because " +
      "the total is the number a human can copy off the page without converting anything. " +
      "The old field was named finalConfirmedCost and documented as a total, but was " +
      "written to a column that means per-bottle — a 12x error on every case invoice.",
    minimum: 0,
  })
  @IsNumber()
  @IsPositive()
  invoiceTotal: number;

  @ApiPropertyOptional({
    description:
      "Invoice date (ISO 8601). Becomes the order's delivered_at and requested_at. " +
      "Absent means today.",
  })
  @IsString()
  @IsOptional()
  invoiceDate?: string;

  @ApiPropertyOptional({ description: "Invoice number, for the audit trail" })
  @IsString()
  @IsOptional()
  invoiceNumber?: string;

  @ApiPropertyOptional({
    description:
      "The vendor's own SKU for this wine, if the invoice states one. Carried onto the " +
      "order line so a later document can be matched on an exact SKU.",
  })
  @IsString()
  @IsOptional()
  vendorSku?: string;

  @ApiPropertyOptional({
    description:
      "Raw invoice text or email body. Stored as the inbound side of the " +
      "procurement_conversations thread for this order.",
  })
  @IsString()
  @IsOptional()
  rawInvoiceContent?: string;
}
