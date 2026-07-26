import { Type } from "class-transformer";
import { IsInt, IsUUID, Max, Min } from "class-validator";

export class SetThresholdDto {
  @IsUUID()
  restaurantId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  thresholdMin: number;
}
