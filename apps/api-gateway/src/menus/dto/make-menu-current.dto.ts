import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

/**
 * The body of `POST /menu-versions/:menuId/make-current` (ADR 0193 round 3,
 * L13): the fingerprint of the plan the person was shown. The gateway
 * recomputes the plan and refuses (409, nothing changed) when it differs, so
 * no menu becomes current on a plan nobody saw -- an old client, onboarding,
 * or a page left open while a price or a lock moved.
 */
export class MakeMenuCurrentDto {
  @ApiProperty({ description: "GET /menu-versions/:menuId/plan's `fingerprint`, exactly as served." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  fingerprint: string;

  @ApiPropertyOptional({
    description:
      "True when the person confirmed making current a menu that was read only in part (the plan's `partRead`). Without it such a menu is refused, nothing changed (F-1292).",
  })
  @IsOptional()
  @IsBoolean()
  partReadAccepted?: boolean;
}
