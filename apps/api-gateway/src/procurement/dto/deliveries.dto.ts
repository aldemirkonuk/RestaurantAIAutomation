import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { DELIVERY_ROLES, REASON_CLASSES } from "../canonical/delivery.service";

/**
 * The delivery doors' bodies (ADR 0103 D1/D3/D5/D6/D7).
 *
 * Every vocabulary here is imported from the service that enforces it, never
 * restated: a second copy of the reason classes is a second copy that drifts,
 * and a value that passes validation and then fails a CHECK constraint is a 500
 * where a 400 belonged.
 */

export class LinkedDocumentDto {
  @ApiProperty({
    description: "A document already stored for this restaurant.",
  })
  @IsUUID()
  documentId!: string;

  @ApiProperty({
    enum: DELIVERY_ROLES as unknown as string[],
    description:
      "What this document IS to this delivery. Distinct from its `doc_type`: the same consolidated invoice is the `invoice` of several deliveries at once (ADR 0104 S5).",
  })
  @IsIn(DELIVERY_ROLES as unknown as string[])
  role!: (typeof DELIVERY_ROLES)[number];
}

export class CreateDeliveryDto {
  @ApiPropertyOptional({
    description:
      "The purchase order this fulfils. OMITTING IT IS NOT A MISTAKE — a delivery with no order is `UNORDERED` (ADR 0103 D5), a permanent mark, and the retroactive-order endpoint that used to manufacture one is retired.",
  })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({
    description: "The distributor, when we hold a row for them.",
  })
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiPropertyOptional({
    enum: ["TR", "US-CA", "unknown"],
    description:
      "Which jurisdiction's clocks apply. Leaving it out means the clocks cannot be looked up and every timer on this delivery is written `blocked_unknown` — visible, asking, and unable to fire (ADR 0103 D4).",
  })
  @IsOptional()
  @IsIn(["TR", "US-CA", "unknown"])
  jurisdiction?: string;

  @ApiPropertyOptional({ description: "When the goods arrived (ISO)." })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  deliveredAt?: string;

  @ApiPropertyOptional({
    description:
      "Who owns this delivery, and who covers for them. ADR 0103 D9: every open delivery has an owner and a deputy so the queue can never fall back into an unowned backlog. Defaults the owner to the caller.",
  })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  deputyUserId?: string;

  @ApiPropertyOptional({ type: [LinkedDocumentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LinkedDocumentDto)
  documents?: LinkedDocumentDto[];
}

export class DoorCountLineDto {
  @ApiProperty({ description: "The line's number on the count, from 1." })
  @IsInt()
  @Min(1)
  lineNo!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendorSku?: string;

  @ApiProperty({
    description:
      "How many, in the unit below. A line NOBODY counted is simply left out of this array — it then keeps its `not counted` (ADR 0103 A6) and never becomes a zero.",
  })
  @IsNumber()
  @Min(0)
  qty!: number;

  @ApiProperty({
    description:
      "bottle, case, pack, each, keg, liter, split_case (Turkish words are read too).",
  })
  @IsString()
  @MaxLength(20)
  uom!: string;

  @ApiPropertyOptional({
    description: "Bottles per case, when counting cases.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  packSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  vintage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  formatMl?: number;
}

export class DoorCountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiPropertyOptional({
    description: "When it was counted (ISO). Defaults to now.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  countedAt?: string;

  @ApiProperty({ type: [DoorCountLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DoorCountLineDto)
  lines!: DoorCountLineDto[];

  @ApiPropertyOptional({
    description:
      "Who signed the vendor's ticket at the door. ADR 0103 D3's second route to AGREED needs this AND a per-vendor `signed_ticket_is_final`; without both, a signature agrees nothing.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  signedBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    description:
      "One photograph of the goods, base64. Evidence, not decoration.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(14_000_000)
  photoBase64?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  photoFilename?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  photoMimeType?: string;

  @ApiPropertyOptional({
    description:
      "Create the delivery from this count in the same call, and attach the count to it with the `door_count` role.",
  })
  @IsOptional()
  @IsBoolean()
  createDelivery?: boolean;

  @ApiPropertyOptional({
    description: "The order this count is against, if any.",
  })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ enum: ["TR", "US-CA", "unknown"] })
  @IsOptional()
  @IsIn(["TR", "US-CA", "unknown"])
  jurisdiction?: string;

  @ApiPropertyOptional({
    description:
      "An existing delivery to attach the count to instead of creating one.",
  })
  @IsOptional()
  @IsUUID()
  deliveryId?: string;
}

export class ProposeDto {
  @ApiProperty({
    enum: ["restaurant", "vendor"],
    description:
      "Whose position this is. ADR 0103 D3 turns on both sides being ON THE RECORD, so an unattributed proposal can never make an agreement.",
  })
  @IsIn(["restaurant", "vendor"])
  side!: "restaurant" | "vendor";

  @ApiProperty({
    enum: REASON_CLASSES as unknown as string[],
    description:
      "ADR 0103 D7. WRONG_VENUE never enters RECONCILING — it is a rejection, and this door moves the delivery to REJECTED when it is used.",
  })
  @IsIn(REASON_CLASSES as unknown as string[])
  reason!: (typeof REASON_CLASSES)[number];

  @ApiPropertyOptional({ description: "The document this is about." })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({
    description:
      "The line on that document. NULL is legitimate: a short ship of a line that appears on no document at all is exactly what an event-first model must be able to state.",
  })
  @IsOptional()
  @IsInt()
  lineNo?: number;

  @ApiPropertyOptional({
    description:
      "How many, IN BOTTLE-EQUIVALENTS. The unit is in the name because JSON carries no comments and every quantity comparison in this codebase is in bottle-equivalents — `rejectedQty` booked 33 bottles of live stock for a refused delivery by being unitless.",
  })
  @IsOptional()
  @IsNumber()
  qtyProposedBottles?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  unitPriceProposed?: number;

  @ApiPropertyOptional({
    description:
      "What this is worth if it is wrong. Drives routing and the notification thresholds of ADR 0103 D8; it never auto-accepts anything.",
  })
  @IsOptional()
  @IsNumber()
  moneyAtRisk?: number;

  @ApiPropertyOptional({
    description:
      "REFERENCES to photos, documents and notes — storage paths and ids, never the bytes themselves.",
  })
  @IsOptional()
  @IsArray()
  evidence?: unknown[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class LinkDocumentDto {
  @ApiProperty()
  @IsUUID()
  documentId!: string;

  @ApiProperty({ enum: DELIVERY_ROLES as unknown as string[] })
  @IsIn(DELIVERY_ROLES as unknown as string[])
  role!: (typeof DELIVERY_ROLES)[number];
}

export class RunClocksDto {
  @ApiPropertyOptional({
    description:
      "Run the ladder as if it were this moment (ISO). For a catch-up after an outage and for tests; the hourly cron passes nothing.",
  })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(40)
  now?: string;
}
