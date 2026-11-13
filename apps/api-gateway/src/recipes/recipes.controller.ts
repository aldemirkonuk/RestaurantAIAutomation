import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RecipesService } from "./recipes.service";
import { PreviewCostDto, SaveRecipeDto, ShelfQueryDto } from "./dto/recipes.dto";

/**
 * A cocktail's recipe (ADR 0360). Every route names the house, so
 * `assertTenantMatch` inside `JwtAuthGuard` refuses another house's caller.
 * Owners and managers write (F13); anyone in the house reads, and a role that
 * does not see money reads no price and no cost.
 */
@ApiTags("recipes")
@Controller("recipes")
@UseGuards(JwtAuthGuard)
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get(":restaurantId/cocktails/:cocktailId")
  @ApiOperation({ summary: "A drink's current recipe, its lines and its cost per serve at today's prices" })
  getRecipe(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    @Param("cocktailId", ParseUUIDPipe) cocktailId: string,
    @CurrentUser() user: { role?: string } | undefined,
  ) {
    return this.recipes.getRecipe(restaurantId, cocktailId, user?.role);
  }

  @Get(":restaurantId/cocktails/:cocktailId/versions")
  @ApiOperation({ summary: "Every saved version of a drink's recipe, newest first" })
  listVersions(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    @Param("cocktailId", ParseUUIDPipe) cocktailId: string,
  ) {
    return this.recipes.listVersions(restaurantId, cocktailId);
  }

  @Get(":restaurantId/cocktails/:cocktailId/versions/:versionId")
  @ApiOperation({ summary: "One earlier version of a drink's recipe, its lines and its cost at today's prices" })
  readVersion(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    @Param("cocktailId", ParseUUIDPipe) cocktailId: string,
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @CurrentUser() user: { role?: string } | undefined,
  ) {
    return this.recipes.readVersion(restaurantId, cocktailId, versionId, user?.role);
  }

  @Put(":restaurantId/cocktails/:cocktailId")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Save a new version of a drink's recipe (owner/manager); 409 when someone saved first" })
  saveRecipe(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    @Param("cocktailId", ParseUUIDPipe) cocktailId: string,
    @Body() dto: SaveRecipeDto,
    @CurrentUser() user: { userId?: string } | undefined,
  ) {
    return this.recipes.saveRecipe(restaurantId, cocktailId, user?.userId ?? null, dto);
  }

  @Post(":restaurantId/cocktails/:cocktailId/cost-preview")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "What an unsaved draft would cost per serve at today's prices (owner/manager); writes nothing" })
  previewCost(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    @Param("cocktailId", ParseUUIDPipe) cocktailId: string,
    @Body() dto: PreviewCostDto,
  ) {
    return this.recipes.previewCost(restaurantId, cocktailId, dto);
  }

  @Get(":restaurantId/shelf")
  @ApiOperation({ summary: "The house's live shelf items of any kind, for linking a recipe line" })
  shelf(@Param("restaurantId", ParseUUIDPipe) restaurantId: string, @Query() q: ShelfQueryDto) {
    return this.recipes.shelf(restaurantId, q.search, q.limit);
  }
}
