import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class ToastCacheRefreshDto {
  @ApiPropertyOptional({ description: "Restaurant UUID" })
  @IsOptional()
  @IsString()
  restaurantId?: string;

  @ApiPropertyOptional({ description: "Menu GUID" })
  @IsOptional()
  @IsString()
  menuId?: string;
}
