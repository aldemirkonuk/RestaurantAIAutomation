import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
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
  @ApiOperation({ summary: "Every counted line of a drink's current recipe with no shelf good, or with ?linkedTo= the lines of that good, grouped by name (owner/manager); writes nothing" })
  looseLines(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    /** Given, the lines that pour from this good instead (swap a good, r108 drinks-g10). */
    @Query("linkedTo", new ParseUUIDPipe({ optional: true })) linkedTo?: string,
  ) {
    return this.loose.looseLines(restaurantId, linkedTo);
  }
}
