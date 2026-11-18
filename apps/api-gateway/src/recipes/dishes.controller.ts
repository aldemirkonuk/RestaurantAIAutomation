import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RecipesService } from "./recipes.service";
import { DishesService } from "./dishes.service";
import { CreateDishDto, PreviewCostDto, SaveRecipeDto, ShelfMatchDto, UpdateDishDto } from "./dto/recipes.dto";

/**
 * A dish and its recipe (ADR 0366), on the drinks' recipe routes. Every route
 * names the house, so `assertTenantMatch` inside `JwtAuthGuard` refuses
 * another house's caller. Owners and managers write; anyone in the house
 * reads, and a role that does not see money reads no price and no cost.
 */
@ApiTags("recipes")
@Controller("recipes")
@UseGuards(JwtAuthGuard)
export class DishesController {
  constructor(
    private readonly recipes: RecipesService,
    private readonly dishes: DishesService,
  ) {}

  @Get(":restaurantId/dishes")
  @ApiOperation({ summary: "The house's dishes, each with its cost a plate at today's prices" })
  listDishes(@Param("restaurantId", ParseUUIDPipe) restaurantId: string, @CurrentUser() user: { role?: string } | undefined) {
    return this.dishes.listDishes(restaurantId, user?.role);
  }

  @Post(":restaurantId/dishes")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Add a dish (owner/manager); 409 when the house already has one by that name" })
  createDish(@Param("restaurantId", ParseUUIDPipe) restaurantId: string, @Body() dto: CreateDishDto) {
    return this.dishes.createDish(restaurantId, dto);
  }

  @Patch(":restaurantId/dishes/:dishId")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Change a dish's name, section, price or description (owner/manager)" })
  updateDish(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    @Param("dishId", ParseUUIDPipe) dishId: string,
    @Body() dto: UpdateDishDto,
  ) {
    return this.dishes.updateDish(restaurantId, dishId, dto);
  }

  @Get(":restaurantId/dishes/:dishId")
  @ApiOperation({ summary: "A dish's current recipe, its lines, its cost a plate and what is in a plate" })
  getDishRecipe(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    @Param("dishId", ParseUUIDPipe) dishId: string,
    @CurrentUser() user: { role?: string } | undefined,
  ) {
    return this.recipes.getDishRecipe(restaurantId, dishId, user?.role);
  }

  @Get(":restaurantId/dishes/:dishId/versions")
  @ApiOperation({ summary: "Every saved version of a dish's recipe, newest first" })
  listDishVersions(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    @Param("dishId", ParseUUIDPipe) dishId: string,
  ) {
    return this.recipes.listDishVersions(restaurantId, dishId);
  }

  @Get(":restaurantId/dishes/:dishId/versions/:versionId")
  @ApiOperation({ summary: "One earlier version of a dish's recipe, at today's prices" })
  readDishVersion(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    @Param("dishId", ParseUUIDPipe) dishId: string,
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @CurrentUser() user: { role?: string } | undefined,
  ) {
    return this.recipes.readDishVersion(restaurantId, dishId, versionId, user?.role);
  }

  @Put(":restaurantId/dishes/:dishId")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Save a new version of a dish's recipe (owner/manager); 409 when someone saved first" })
  saveDishRecipe(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    @Param("dishId", ParseUUIDPipe) dishId: string,
    @Body() dto: SaveRecipeDto,
    @CurrentUser() user: { userId?: string } | undefined,
  ) {
    return this.recipes.saveDishRecipe(restaurantId, dishId, user?.userId ?? null, dto);
  }

  @Post(":restaurantId/dishes/:dishId/cost-preview")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "What an unsaved dish draft would cost a plate (owner/manager); writes nothing" })
  previewDishCost(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    @Param("dishId", ParseUUIDPipe) dishId: string,
    @Body() dto: PreviewCostDto,
  ) {
    return this.recipes.previewDishCost(restaurantId, dishId, dto);
  }

  @Get(":restaurantId/items/:itemId/dishes")
  @ApiOperation({ summary: "The dishes whose current recipe uses a shelf item, each with its figures" })
  dishesUsingItem(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @CurrentUser() user: { role?: string } | undefined,
  ) {
    return this.dishes.dishesUsingItem(restaurantId, itemId, user?.role);
  }

  @Post(":restaurantId/shelf/match")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Pasted recipe labels matched to shelf items by exact name (owner/manager); writes nothing" })
  matchShelf(@Param("restaurantId", ParseUUIDPipe) restaurantId: string, @Body() dto: ShelfMatchDto) {
    return this.dishes.matchShelf(restaurantId, dto.labels);
  }
}
