import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Look up by exactly one of these. The service says which is wrong in a
 * sentence (a barcode is 6 to 14 digits, a name 2 to 100 letters), so the
 * DTO only bounds the size.
 */
export class LookupItemNutritionDto {
  @ApiPropertyOptional({ description: "The pack's barcode (EAN/UPC), looked up on Open Food Facts" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  barcode?: string;

  @ApiPropertyOptional({ description: "A name to search on Open Food Facts (and FoodData Central when it is set up)" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: "A FoodData Central entry picked from a name search" })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  fdcId?: string;
}
