import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

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

  /**
   * r35 G10: the drinks to take off sale -- line ids from the plan's
   * `notOnThisFile` the person ticked. Their bottle and glass price are
   * cleared once the menu is current; any other drink keeps its price (L12).
   */
  @ApiPropertyOptional({
    description:
      "Line ids from the plan's notOnThisFile whose house price is cleared once this menu is current. An id the plan does not offer is a 400, and nothing is changed.",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  takeOff?: string[];
}
