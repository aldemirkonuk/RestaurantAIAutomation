import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
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

/**
 * One exposure or outcome on an experiment arm.
 *
 * NOTE WHAT IS ABSENT: there is no `arm` field, and there is no `restaurantId`.
 * Both are stamped by the service from the token and the stored assignment. A
 * browser that could name its own arm could file its outcome against the other
 * one, which would make the whole comparison a thing the measured party writes
 * about itself.
 */
export class RecordExperimentEventDto {
  @ApiProperty({
    enum: ["exposed", "completed", "abandoned"],
    description:
      "exposed: the control was rendered. completed: the note was closed. abandoned: exposed, then left still open.",
  })
  @IsIn(["exposed", "completed", "abandoned"])
  event!: "exposed" | "completed" | "abandoned";

  @ApiPropertyOptional({
    description: "The one-tap action the control belonged to.",
  })
  @IsOptional()
  @IsUUID()
  actionId?: string;

  @ApiPropertyOptional({
    description:
      "Milliseconds from EXPOSURE to completion. Ignored on any other event.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400_000)
  durationMs?: number;

  // There is deliberately NO field for the die's early releases. It would be
  // die-only — a plain button has no partial gesture to release — and an event
  // one arm can produce and the other cannot is not a measurement. Recording it
  // would also mean a `onRelease` prop on the shared `HoldToApprove`, which no
  // caller has and which is not this change's to add.
}
