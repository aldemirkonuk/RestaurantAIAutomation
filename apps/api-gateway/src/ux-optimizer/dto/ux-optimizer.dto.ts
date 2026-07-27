import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/**
 * Signal events the client is allowed to report. Anything else is rejected —
 * `event` reaches a jsonb-adjacent column and is grouped on in summarize(), so
 * an open string lets a caller invent categories and skew the agent's view of
 * the product.
 */
export const UX_SIGNAL_EVENTS = [
  "rage_click",
  "dead_click",
  "abandon",
  "slow_tti",
  "task_success",
  "task_fail",
  "error",
  "nav",
] as const;

export class IngestSignalDto {
  @ApiProperty({ description: "Page key the signal belongs to" })
  @IsString()
  @MaxLength(120)
  page!: string;

  @ApiProperty({ enum: UX_SIGNAL_EVENTS })
  @IsIn(UX_SIGNAL_EVENTS as unknown as string[])
  event!: string;

  @ApiPropertyOptional({
    description:
      "Stable element key (data-ux-key). Never a DOM id — see elementKey() in apps/web/src/lib/uxSignals.ts.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  targetKey?: string;

  @ApiPropertyOptional({ description: "Numeric payload, e.g. TTI in ms" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(3_600_000)
  value?: number;

  @ApiPropertyOptional({ description: "Opaque per-user bucketing id" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @ApiPropertyOptional({
    description: "Small free-form context bag. Must not carry user content.",
  })
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}

export class ReviewProposalDto {
  @ApiProperty({ enum: ["approve", "reject"] })
  @IsIn(["approve", "reject"])
  decision!: "approve" | "reject";

  @ApiPropertyOptional({
    description: "Percentage of buckets the approved override reaches (0-100)",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPct?: number;
}

export class RollbackProposalDto {
  @ApiPropertyOptional({ description: "Why this change is being reverted" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
