import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

/**
 * DTOs for the sale-unit review surface (see PosMappingReviewService).
 *
 * The review write path deliberately accepts only "glass" or "bottle" — NOT
 * null — even though `pos_item_mappings.sale_unit` is nullable and
 * `PosHubService.upsertItemMapping` accepts null. Null is the state this
 * surface exists to clear: it is what makes `applyStockEffects` fall through
 * to its documented `?? "bottle"` default. A route whose purpose is "a human
 * answers the question" should not offer "un-answer it" as one of the
 * answers. The generic `POST /pos-hub/mappings/:restaurantId` still writes
 * null for callers that genuinely need to.
 */
export const SALE_UNITS = ["glass", "bottle"] as const;
export type SaleUnit = (typeof SALE_UNITS)[number];

/** The unit `applyStockEffects` uses when `sale_unit` is null (decision B36). */
export const UNIT_IF_UNANSWERED: SaleUnit = "bottle";

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
      "Include mappings that already have a sale_unit, so an existing answer can be audited or corrected. Default false — only rows still missing a unit are returned.",
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
    enum: SALE_UNITS,
    description:
      "The human's answer. Rejected unless it is exactly 'glass' or 'bottle' — never inferred from the item name (decision B36).",
  })
  @IsIn(SALE_UNITS)
  sale_unit: SaleUnit;
}

export class SaleUnitAnswerDto {
  @ApiProperty({ description: "pos_item_mappings.id" })
  @IsUUID()
  mapping_id: string;

  @ApiProperty({ enum: SALE_UNITS })
  @IsIn(SALE_UNITS)
  sale_unit: SaleUnit;
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
