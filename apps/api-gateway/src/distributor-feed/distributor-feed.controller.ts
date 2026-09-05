/**
 * The distributor-connection catalogue endpoint.
 *
 *   GET /distributor-feed/catalog          — every distributor measured
 *   GET /distributor-feed/:jurisdiction    — one state, or 'me' for the caller's
 *
 * Owner/manager, like `/price-index` and `/vendor-intel`: this states the
 * house's buying context and renders on `/connections`, which is already
 * manager-and-owner (ADR 0114).
 *
 * THERE IS NO WRITE ROUTE, AND THAT IS THE DECISION, NOT AN OMISSION. A declare
 * route would take a distributor login, and both Illinois distributors whose
 * terms were read forbid exactly that — Southern Glazer's in the words "agree
 * not to provide any other person with access to this Website … using your
 * username, password, or other security information". Building the box first and
 * asking later is how a product ends up holding credentials it may not use.
 *
 * `catalog` is declared before `:jurisdiction` on purpose — otherwise the word
 * would be captured as a jurisdiction and the route would be unreachable. Same
 * reason `price-index.controller.ts` declares `status` first.
 */

import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { DistributorFeedService } from "./distributor-feed.service";

@ApiTags("Distributor Feed")
@ApiBearerAuth()
@Controller("distributor-feed")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
export class DistributorFeedController {
  constructor(private readonly service: DistributorFeedService) {}

  @Get("catalog")
  @ApiOperation({
    summary:
      "Every licensed-distributor connection this register has measured, each with the sentence saying whether it can be connected today",
  })
  catalog() {
    return { success: true, ...this.service.forJurisdiction(null) };
  }

  @Get(":jurisdiction")
  @ApiOperation({
    summary:
      "The distributors measured for one jurisdiction — or 'me' for the caller's own house",
  })
  async forJurisdiction(
    @CurrentUser() user: { restaurantId: string },
    @Param("jurisdiction") jurisdiction: string,
  ) {
    if (jurisdiction.toLowerCase() === "me") {
      const result = await this.service.forHouse(user?.restaurantId ?? null);
      return { success: true, ...result };
    }
    return { success: true, ...this.service.forJurisdiction(jurisdiction) };
  }
}
