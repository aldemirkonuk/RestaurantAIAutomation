import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { REPRICE_MAX_PERCENT, REPRICE_MIN_PERCENT, REPRICE_STEPS } from "../menu-reprice";

/**
 * The body of `POST /menu-versions/:menuId/reprice` (r108 menu-g9): move the
 * current menu's prices by a percent into a new draft. 0 % is refused by the
 * service, in words.
 */
export class RepriceMenuDto {
  @ApiProperty({ description: "Percent to move each price by, -50 to +100, at most two decimals; 0 is refused.", example: 10 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(REPRICE_MIN_PERCENT)
  @Max(REPRICE_MAX_PERCENT)
  percent: number;

  @ApiProperty({ description: "The step each new price is rounded half up to.", enum: REPRICE_STEPS, example: 0.5 })
  @IsIn(REPRICE_STEPS as unknown as number[])
  roundTo: number;

  @ApiPropertyOptional({
    description: "The sections (line categories) whose prices move; \"\" names the lines with none. Omitted: every section.",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  sections?: string[];
}
