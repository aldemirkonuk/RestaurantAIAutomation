/**
 * The commodity index-series endpoints.
 *
 *   GET /commodity-index/status  — the register itself: which series exist,
 *                                  whose terms are what, and whether a
 *                                  scheduled reader is armed (it is not).
 *   GET /commodity-index/me      — the series that speak for the caller's own
 *                                  house, each with its newest observation and
 *                                  the house items a person mapped to it.
 *
 * Owner/manager, exactly like `/price-index`: this states the house's buying
 * context and it renders inside that register's own box on `/notifications`.
 *
 * `status` is declared before `me` for the reason `PriceIndexController` gives:
 * a literal segment that could be captured by a parameter route must come
 * first. There is no `:series` route here at all — a caller who could name any
 * series would be reading another house's register scoping for free, and
 * nothing on the page needs it.
 *
 * **This controller never writes.** There is no POST, no exposure-creation
 * route and no calibration trigger. Asserting an exposure puts a person's name
 * on a mapping that a rule will later fire on, and phase 0 ships the register
 * and the line, not the act. That is stated so the absence reads as a decision
 * rather than as an oversight.
 */

import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { CommodityService } from "./commodity.service";
import { CommodityAlertService } from "./commodity-alert.service";

@ApiTags("Commodity Index")
@ApiBearerAuth()
@Controller("commodity-index")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
export class CommodityController {
  constructor(
    private readonly service: CommodityService,
    private readonly alerts: CommodityAlertService,
  ) {}

  @Get("status")
  @ApiOperation({
    summary:
      "The index-series register: every series, its terms, its cadence, and whether the scheduled reader is armed (off by default)",
  })
  status() {
    return {
      success: true,
      ...this.service.status(),
      // Named here rather than left to be inferred from silence: the alert is
      // built and dark, and a status route that showed only the fetch flag
      // would let a reader conclude no alert exists.
      // `standingNote`, never `reportLine` over a zeroed tally: the latter
      // would say "0 series evaluated, 0 would have interrupted this house",
      // which describes a run that did not happen, on the one route somebody
      // reads to find out whether this is on at all.
      alert: {
        armed: this.alerts.armed(),
        note: this.alerts.standingNote(),
      },
    };
  }

  @Get("me")
  @ApiOperation({
    summary:
      "The index series that speak for this house, each with its newest observation and the items a person mapped to it. A context line, never a claim",
  })
  async forHouse(@CurrentUser() user: { restaurantId: string }) {
    const result = await this.service.forHouse(user?.restaurantId ?? null);
    return { success: true, ...result };
  }
}
