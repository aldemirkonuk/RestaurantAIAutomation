import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Put, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { OrganizationsService } from "../organizations/organizations.service";
import { ItemNutritionService, type ItemNutrition } from "./item-nutrition.service";
import { SaveItemNutritionDto } from "./dto/item-nutrition.dto";
import { LookupItemNutritionDto } from "./dto/nutrition-lookup.dto";
import { NutritionLookupService, type LookupAnswer } from "./nutrition-lookup.service";

type SessionUser = { userId?: string; name?: string; email?: string };

/**
 * What a good is made of: GET and PUT one item's nutrition and allergens.
 * :restaurantId is checked against the token by JwtAuthGuard's tenant
 * assertion; :itemId by the house filter in ItemNutritionService.
 *
 * Stating figures and allergens is an owner/manager act: an allergen "free"
 * is what the house tells a guest, so it names a person who may speak for
 * the house (the session's call under the 2026-11-07 /goal).
 */
@ApiTags("inventory")
@Controller("inventory")
@UseGuards(JwtAuthGuard)
export class ItemNutritionController {
  constructor(
    private readonly nutrition: ItemNutritionService,
    private readonly organizations: OrganizationsService,
    private readonly lookups: NutritionLookupService,
  ) {}

  /** The one gate on every statement written here. A session naming nobody is refused first. */
  async assertMayState(user: SessionUser | undefined, restaurantId: string): Promise<string> {
    if (!user?.userId) {
      throw new ForbiddenException("This session names nobody, so it cannot state what is in an item. Nothing was saved.");
    }
    await this.organizations.assertCanManageRestaurant(user.userId, restaurantId, "state what is in an item");
    return user.userId;
  }

  @Get(":restaurantId/item/:itemId/nutrition")
  @ApiOperation({ summary: "One item's nutrition per 100 g or 100 ml, and the 14 allergens" })
  @ApiResponse({ status: 503, description: "Could not be read; never answered as empty" })
  read(@Param("restaurantId") restaurantId: string, @Param("itemId") itemId: string): Promise<ItemNutrition> {
    return this.nutrition.read(restaurantId, itemId);
  }

  @Put(":restaurantId/item/:itemId/nutrition")
  @ApiOperation({ summary: "State one item's nutrition and allergens (owner or manager)" })
  async save(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
    @Body() dto: SaveItemNutritionDto,
    @CurrentUser() user?: SessionUser,
  ): Promise<ItemNutrition> {
    const userId = await this.assertMayState(user, restaurantId);
    const name = (user?.name ?? user?.email ?? "").trim();
    return this.nutrition.save(restaurantId, itemId, userId, name, dto);
  }

  /**
   * Fill a draft from Open Food Facts (by barcode or name) or FoodData
   * Central (by entry, when its key is set). Saves nothing: the person reads
   * the draft against the pack and confirms it with PUT. Gated like PUT,
   * because only those who may state figures need a draft of them.
   */
  @Post(":restaurantId/item/:itemId/nutrition/lookup")
  @HttpCode(200)
  @ApiOperation({ summary: "Draft one item's nutrition from a public source (never saved)" })
  @ApiResponse({ status: 502, description: "The source could not be reached; said, never answered as empty" })
  async lookup(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
    @Body() dto: LookupItemNutritionDto,
    @CurrentUser() user?: SessionUser,
  ): Promise<LookupAnswer> {
    await this.assertMayState(user, restaurantId);
    return this.lookups.lookup(restaurantId, itemId, dto);
  }
}
