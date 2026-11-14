import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/**
 * The body of `PATCH /menu-versions/:menuId/items/:itemId/house-good` (r28
 * G21): the house's own good a line of a kept menu is, picked by an owner or a
 * manager from the goods the read named.
 */
export class LinkHouseGoodDto {
  @ApiProperty({ description: "The id of one of the house's own goods (restaurant_inventory.id)." })
  @IsUUID()
  inventoryItemId: string;
}
