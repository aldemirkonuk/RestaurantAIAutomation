import { IsString, IsUUID } from "class-validator";

export class LeaveRestaurantDto {
  @IsString()
  @IsUUID()
  restaurantId: string;
}
