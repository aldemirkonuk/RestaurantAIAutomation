import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class ListBeveragesQueryDto {
  /**
   * A cellar register — `beer`, `whiskey`, `spirits`, `non_alcoholic`. Resolved
   * to the measured `beverage_type` vocabulary in one place
   * (`cellar/cellar-registers.ts`), so the browser never carries its own copy
   * of which types count as spirits.
   */
  @ApiPropertyOptional({ description: "Filter by cellar register" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  register?: string;

  @ApiPropertyOptional({ description: "Filter on beverage_type (ilike)" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;

  @ApiPropertyOptional({ description: "Search name or producer" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /**
   * Always has a value, and the response says whether it was hit. A list
   * endpoint whose caller cannot tell a full page from a complete table teaches
   * the browser to print a floor as a total — the exact error the cellar's
   * parent card was already caught making about `/wines?limit=500`.
   */
  @ApiPropertyOptional({ default: 200, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 200;
}

export class ListCocktailsQueryDto {
  @ApiPropertyOptional({ description: "Search name" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ default: 200, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 200;
}
