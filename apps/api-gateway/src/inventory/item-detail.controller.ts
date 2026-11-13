import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { OrganizationsService } from "../organizations/organizations.service";
import { ItemUsedInService } from "./item-used-in.service";
import { ItemFiguresService, MoneyView } from "./item-figures.service";
import { HouseItemService } from "./house-item.service";
import { CreateHouseItemDto } from "./dto/house-item.dto";

/** Registered by InventoryModule beside this controller. */
export const ITEM_DETAIL_PROVIDERS = [ItemUsedInService, ItemFiguresService, HouseItemService];

/**
 * The /inventory item drawer's reads (proposal §3 I4/I10/I11) and "carry
 * this" for a good the wine library does not hold. :restaurantId is scoped
 * by the global TenantGuard; :itemId by the house filter in readHouseItem.
 */
@ApiTags("inventory")
@Controller("inventory")
@UseGuards(JwtAuthGuard)
export class ItemDetailController {
  constructor(
    private readonly usedInService: ItemUsedInService,
    private readonly figuresService: ItemFiguresService,
    private readonly houseItems: HouseItemService,
    private readonly organizations: OrganizationsService,
  ) {}

  /** Money is owner/manager only; a role that cannot be read shows none. */
  private async moneyView(userId: string | undefined, restaurantId: string): Promise<MoneyView> {
    if (!userId) return "staff";
    try {
      const role = (await this.organizations.readRestaurantRole(userId, restaurantId)) ?? "";
      return ["owner", "manager"].includes(role.trim().toLowerCase()) ? "shown" : "staff";
    } catch {
      return "unread";
    }
  }

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

  @Get(":restaurantId/item/:itemId/figures")
  @ApiOperation({ summary: "One item's waste vs given and count gap; the cost trend is not shown yet" })
  async figures(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
    @CurrentUser() user?: { userId?: string },
  ) {
    try {
      const view = await this.moneyView(user?.userId, restaurantId);
      return await this.figuresService.figures(restaurantId, itemId, view);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "This item's figures could not be read",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":restaurantId/house-items")
  @ApiOperation({ summary: "Carry a food or other good the wine library does not hold" })
  @ApiResponse({ status: 201, description: "Carried" })
  @ApiResponse({ status: 409, description: "This house already carries it" })
  async carry(
    @Param("restaurantId") restaurantId: string,
    @Body() dto: CreateHouseItemDto,
    @CurrentUser() user?: { userId?: string },
  ) {
    // Adding a good to the books is an owner's or a manager's (inventory r28,
    // gap 6). The page hid "Carry a food or supply" from staff, but the route
    // took anyone in the house. The role is read from the access rows.
    if (!user?.userId) {
      throw new HttpException(
        "Adding a good names the person who added it, and this session names nobody. Nothing was added.",
        HttpStatus.FORBIDDEN,
      );
    }
    await this.organizations.assertCanManageRestaurant(user.userId, restaurantId, "add a good to the inventory");
    try {
      return await this.houseItems.carry(restaurantId, dto);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "The item could not be added",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
