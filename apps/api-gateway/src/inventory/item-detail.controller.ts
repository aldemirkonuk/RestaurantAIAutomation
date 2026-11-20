import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ItemUsedInService } from "./item-used-in.service";

/** Registered by InventoryModule beside this controller. */
export const ITEM_DETAIL_PROVIDERS = [ItemUsedInService];

/**
 * The /inventory item drawer's reads (proposal §3 I4/I10/I11). :restaurantId is scoped
 * by the global TenantGuard; :itemId by the house filter in readHouseItem.
 */
@ApiTags("inventory")
@Controller("inventory")
@UseGuards(JwtAuthGuard)
export class ItemDetailController {
  constructor(
    private readonly usedInService: ItemUsedInService,
  ) {}

  @Get(":restaurantId/item/:itemId/used-in")
  @ApiOperation({ summary: "Where one item is used: menu lines, house cocktails, same-named unlinked lines" })
  async usedIn(@Param("restaurantId") restaurantId: string, @Param("itemId") itemId: string) {
    try {
      return await this.usedInService.usedIn(restaurantId, itemId);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Where this item is used could not be read",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
