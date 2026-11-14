import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";

export class AddMenuItemDto {
  @IsUUID()
  menuId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  producer?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  vintage?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  grape_variety?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  by_glass_price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bottle_price?: number;

  /**
   * A price as the person typed it ("45,50", "1.250,00", "₺ 90"), read by the
   * gateway's parseMenuPrice: the same reading as the Change price boxes on
   * the same page (r28 G7). Send this or the number, not both.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  by_glass_typed?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  bottle_typed?: string;
}
