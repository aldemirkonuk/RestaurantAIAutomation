import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsNumber, IsOptional, Max, Min, ValidateIf } from "class-validator";

/**
 * The body of `PUT /pricing/target-margin` (ADR 0193).
 *
 * The bounds are the database's CHECKs verbatim
 * (`20260921113100_a_house_names_its_target_margin.sql`): a value this DTO
 * admits is a value the database admits. They are a UNITS check as much as a
 * range: 0.65, the fraction spelling of a 65 percent margin, is refused with a
 * sentence rather than stored as a 0.65 percent target.
 *
 * `null` for bottle or glass means "no target for that". At least one must be
 * a number (the service refuses the empty write). No field has a default.
 */
export class SetTargetMarginDto {
  @ApiPropertyOptional({
    description:
      "The gross margin this house needs on a BOTTLE, as a PERCENT of the price: 65 means cost is 35 percent of the price. Between 5 and 95. null = no bottle target.",
    example: 65,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(5, { message: "A target margin is a PERCENT between 5 and 95: 65, not 0.65. Nothing was recorded." })
  @Max(95, { message: "A target margin above 95 percent is a cost under a twentieth of the price. Nothing was recorded." })
  bottlePct?: number | null;

  @ApiPropertyOptional({
    description:
      "The gross margin this house needs on a GLASS, as a PERCENT of the glass price. Between 5 and 95. null = no glass target.",
    example: 75,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(5, { message: "A target margin is a PERCENT between 5 and 95: 75, not 0.75. Nothing was recorded." })
  @Max(95, { message: "A target margin above 95 percent is a cost under a twentieth of the price. Nothing was recorded." })
  glassPct?: number | null;

  @ApiProperty({
    description:
      "\"Close enough\", in margin POINTS: a wine within this many points of its target gets no advice. 0 means advise on any difference. Between 0 and 20. Required.",
    example: 2,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(20)
  bandPts: number;
}

/**
 * The body of `POST /pricing/advice/:inventoryId/accept`. It names WHICH
 * advice (bottle or glass) and the price the manager saw; the price that is
 * written is re-computed by the gateway, and a mismatch is refused (409).
 */
export class AcceptPriceAdviceDto {
  @ApiProperty({ enum: ["bottle", "glass"] })
  @IsIn(["bottle", "glass"])
  kind: "bottle" | "glass";

  @ApiProperty({ description: "The advised price exactly as the page showed it.", example: 57.14 })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  advisedPrice: number;
}
