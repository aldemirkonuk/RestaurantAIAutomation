import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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
  by_glass_price?: number;

  @IsOptional()
  @IsNumber()
  bottle_price?: number;
}
