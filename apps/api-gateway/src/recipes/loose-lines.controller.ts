import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { LooseLinesService } from "./loose-lines.service";

/**
 * The drinks' lines that name no shelf good, for owners and managers (r108
 * drinks-g9), the roles that link lines. The house in the path is checked by
 * `JwtAuthGuard` (assertTenantMatch), so another house's caller is a 403.
 */
@ApiTags("recipes")
@Controller("recipes")
@UseGuards(JwtAuthGuard, RolesGuard)
export class LooseLinesController {
  constructor(private readonly loose: LooseLinesService) {}

  @Get(":restaurantId/drinks/loose-lines")
  @Roles("owner", "manager")
  @ApiOperation({
    summary:
      "Every counted line of a drink's (default) or, with ?kind=dish, a dish's current recipe with no shelf good, grouped by name (owner/manager); writes nothing",
  })
  looseLines(@Param("restaurantId", ParseUUIDPipe) restaurantId: string, @Query("kind") kind?: string) {
    // Absent is a drink, so every caller before r109 g4 reads what it always did.
    if (kind === undefined || kind === "" || kind === "drink") return this.loose.looseLines(restaurantId);
    if (kind === "dish") return this.loose.looseDishLines(restaurantId);
    throw new BadRequestException("kind is drink or dish.");
  }
}
