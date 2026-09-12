import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

/**
 * Approving a catalog-match proposal (POS lens defect 2).
 *
 * An approval answers TWO questions, and until 2026-09-05 it only recorded the
 * first: "is this button that wine?" and "how much stock does one sale of it
 * remove?". Writing only the identity produced a mapping that immediately
 * queued its next sale as `no_sale_volume` — the second invisible queue the
 * Sim Meyhouse run measured behind the first.
 *
 * Both unit fields stay OPTIONAL. ADR 0011 fails closed: an approval with no
 * unit is honest (the line queues and depletes nothing) where an approval with
 * a guessed unit is not. Nothing infers a unit from the item name or its price
 * (decision B36).
 */

/** Same plausibility band as PosHubService.upsertItemMapping enforces. */
const MIN_SALE_ML = 10;
const MAX_SALE_ML = 30000;

export class ApproveProposalDto {
  @ApiPropertyOptional({
    description:
      "An open human label for what one sale is — 'glass', 'bottle', 'half_bottle', 'carafe', 'taster'… Reporting only; the arithmetic reads sale_volume_ml (ADR 0011). Omit when the approver does not know: the mapping is written with null and the next sale queues rather than guessing.",
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  sale_unit?: string;

  @ApiPropertyOptional({
    description:
      "Millilitres one sale removes — the number depletion actually reads. Bounded because '1.5' meaning 1.5 LITRES would otherwise pour 1.5ml per sale forever.",
    minimum: MIN_SALE_ML,
    maximum: MAX_SALE_ML,
  })
  @IsOptional()
  @IsNumber()
  @Min(MIN_SALE_ML)
  @Max(MAX_SALE_ML)
  @Type(() => Number)
  sale_volume_ml?: number;
}

export class ApproveProposalEntryDto extends ApproveProposalDto {
  @ApiProperty({ description: "pos_catalog_match_proposals.id" })
  @IsUUID()
  proposal_id: string;
}

export class ApproveProposalsBatchDto {
  @ApiProperty({
    type: [ApproveProposalEntryDto],
    description:
      "One entry per proposal being confirmed. Applied independently — one bad id does not discard the rest — and the response reports per-entry ok/error. This exists because the queue is naturally the size of the venue's menu: the lens run's 107 one-at-a-time approvals hit the 100-per-60s rate limit and 7 were rejected 429 mid-queue.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ApproveProposalEntryDto)
  items: ApproveProposalEntryDto[];
}
