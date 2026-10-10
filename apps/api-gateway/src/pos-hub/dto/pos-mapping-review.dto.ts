import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";

/**
 * DTOs for the sale-unit review surface (see PosMappingReviewService).
 *
 * The review write path accepts "glass" or "bottle" on their own, any other
 * serve name (shot, pint, can, …) only WITH the millilitres one sale removes,
 * and never null — even though `pos_item_mappings.sale_unit` is nullable and
 * `PosHubService.upsertItemMapping` accepts null. A null unit on a row with no
 * `sale_volume_ml` is the state this surface exists to clear: since ADR 0011
 * removed the `?? "bottle"` default, `applyStockEffects` moves no stock for it
 * and queues the line as `no_sale_volume`. A route whose purpose is "a human
 * answers the question" should not offer "un-answer it" as one of the
 * answers. The generic `POST /pos-hub/mappings/:restaurantId` still writes
 * null for callers that genuinely need to.
 */
export const SALE_UNITS = ["glass", "bottle"] as const;
/**
 * An open serve label (ADR 0011). Only the two SALE_UNITS carry a derivation
 * from the inventory row; any other label is a reporting word, so the import
 * can deplete it only from `sale_volume_ml` (F-720).
 */
export type SaleUnit = string;

/** Same plausibility band as PosHubService.upsertItemMapping enforces. */
const MIN_SALE_ML = 10;
const MAX_SALE_ML = 30000;

/**
 * "shot" with no millilitres would be written, read as answered, and still
 * queue every sale as `no_sale_volume` — a label nothing can turn into a
 * volume. So the volume is required unless the label is exactly one of the
 * two the inventory row can resolve, and validated whenever it is sent.
 */
const needsVolume = (o: { sale_unit?: unknown; sale_volume_ml?: unknown }) =>
  o.sale_volume_ml !== undefined ||
  !(SALE_UNITS as readonly unknown[]).includes(o.sale_unit);

/**
 * `@Type(() => Boolean)` is wrong for a query string: `Boolean("false")` is
 * `true`, so `?includeAnswered=false` would silently mean the opposite of what
 * it says. Same helper shape as search-distributors.dto.ts.
 */
const toBool = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === null
    ? undefined
    : value === true || value === "true" || value === "1";

export class ListSaleUnitReviewQueryDto {
  @ApiPropertyOptional({
    description:
      "Include every mapping, so an existing answer can be audited or corrected. Default false — only mappings whose sale volume the import cannot resolve now are returned: no usable sale_volume_ml, and no sale_unit the linked inventory row can turn into one (a row labelled glass whose inventory row has no pour size is one of them).",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(toBool)
  includeAnswered?: boolean;

  @ApiPropertyOptional({
    description:
      "How many recent closed checks to scan for observed line prices. Higher is slower but sees further back.",
    default: 500,
    minimum: 1,
    maximum: 2000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  @Type(() => Number)
  checkLimit?: number;
}

export class SetSaleUnitDto {
  @ApiProperty({
    description:
      "The human's answer: 'glass', 'bottle', or another serve name such as 'shot', 'pint' or 'can' — never inferred from the item name (decision B36). Any name other than exactly 'glass' or 'bottle' must come with sale_volume_ml.",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  sale_unit: SaleUnit;

  @ApiPropertyOptional({
    description:
      "Millilitres one sale removes — the number depletion reads first (ADR 0011). Required for any serve other than 'glass' or 'bottle'; optional for those two, which the inventory row resolves.",
    minimum: MIN_SALE_ML,
    maximum: MAX_SALE_ML,
  })
  @ValidateIf(needsVolume)
  @IsNumber()
  @Min(MIN_SALE_ML)
  @Max(MAX_SALE_ML)
  @Type(() => Number)
  sale_volume_ml?: number;
}

export class SaleUnitAnswerDto extends SetSaleUnitDto {
  @ApiProperty({ description: "pos_item_mappings.id" })
  @IsUUID()
  mapping_id: string;
}

export class SetSaleUnitBatchDto {
  @ApiProperty({
    type: [SaleUnitAnswerDto],
    description:
      "One entry per mapping the human answered. Entries are applied independently: a failure on one is reported in that entry's result and does not abort the rest.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SaleUnitAnswerDto)
  items: SaleUnitAnswerDto[];
}
