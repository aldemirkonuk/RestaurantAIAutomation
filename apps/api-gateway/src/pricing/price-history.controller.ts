import { Controller, Get, HttpException, HttpStatus, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { TenantGuard } from "../common/tenant/tenant.guard";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { readHousePriceHistory, type HousePriceHistory } from "./house-price-history";

/**
 * One good's house-price history (r36 menu audit N6). Its own controller so
 * PricingController's constructor, which its specs build by hand, is left as
 * it is. The house comes from the token; who changed a price and why are an
 * owner's or a manager's to read, as "who set it" is in the menu plan.
 */
@ApiTags("pricing")
@Controller("pricing/history")
@UseGuards(JwtAuthGuard, TenantGuard)
export class PriceHistoryController {
  constructor(
    private readonly db: DatabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Get(":inventoryId")
  @ApiOperation({
    summary: "When, by whom and from where one good's house price changed, newest first -- owner or manager only",
    description:
      "Reads menu_price_versions for one good of the caller's house (another house's good is a 404). The newest 30 changes; `more` says when older ones exist. A failed read is a 500 with a sentence, never an empty history.",
  })
  async history(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("inventoryId", new ParseUUIDPipe()) inventoryId: string,
  ): Promise<HousePriceHistory> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so there is no price history to read.",
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.organizations.assertCanManageRestaurant(userId, restaurantId, "read a price history");
    return readHousePriceHistory(this.db.supabase, restaurantId, inventoryId);
  }
}
