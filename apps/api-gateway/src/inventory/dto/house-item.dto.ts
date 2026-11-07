import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

/**
 * "Carry this": a food or other good the wine library does not hold. kind and
 * uom are checked in HouseItemService so a refusal can say what to do instead.
 */
export class CreateHouseItemDto {
  @ApiProperty({ description: "restaurant_inventory_kind_check value other than wine" })
  @IsString()
  @MaxLength(40)
  kind: string;

  @ApiProperty({ description: "restaurant_inventory_uom_check value other than kg and l" })
  @IsString()
  @MaxLength(20)
  uom: string;

  @ApiProperty({ description: "The house's name for it, 1-120 characters" })
  @IsString()
  @MaxLength(200)
  displayName: string;

  @ApiPropertyOptional({ description: "Par in uom; absent means 0, no par" })
  @IsOptional()
  @IsInt()
  @Min(0)
  thresholdMin?: number;
}
