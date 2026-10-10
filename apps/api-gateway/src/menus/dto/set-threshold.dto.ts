import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from "class-validator";

export class SetThresholdDto {
  @IsUUID()
  restaurantId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  thresholdMin: number;

  /** Also set the number on every item the house carries now (F-1059). */
  @IsOptional()
  @IsBoolean()
  applyToCarried?: boolean;
}
