import { Type } from "class-transformer";
import { IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

export class SetThresholdDto {
  /** Optional: the session's house is used. When sent it must be that house. */
  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  thresholdMin: number;
}
