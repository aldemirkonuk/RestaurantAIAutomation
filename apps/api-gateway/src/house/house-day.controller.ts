import { Controller, Get, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { HouseDayService } from "./house-day.service";
import type { HouseDayResponse } from "./house-day.types";

/**
 * The day line's read (sketch 119 §E; the founder's pick of 2026-09-21 —
 * built as a PAGE element on the dashboard and the receiving page, not
 * chrome). One read, three registers today (see `house-day.types.ts` for
 * what is not built yet, and why), plus the service-window band from
 * `restaurants.operating_hours`.
 *
 * Every MEMBER reads the day: none of the three registers this session
 * builds is restricted BY ROLE among members (the receiving routes carry no
 * role gate; `calendar/today` applies no role filter — both re-measured in
 * `house-day.service.ts`'s own comments). So the route admits owner, manager
 * and staff (admin ranks with owner/manager in `RolesGuard`), and refuses a
 * session with NO role in the house its token names (ADR 0162: null is no
 * role) — the hours read already refuses that session (`assertMembership`),
 * and the ticks must not be a wider door than the band.
 */
@ApiTags("house")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager", "staff")
@Controller("house")
export class HouseDayController {
  constructor(private readonly day: HouseDayService) {}

  @Get("day")
  @ApiOperation({
    summary:
      "Today's service arc and its fixed points, one outcome per register",
    description:
      "Three registers (deliveries that arrived, today's calendar, today's reminders), each `answered` (count, ticks) or `unreadable` (status and a sentence). " +
      "`hours` carries today's service window(s) from operating_hours, `not_recorded` when the hours or the timezone are unknown, `unreadable` on a failed read. No total.",
  })
  @ApiResponse({
    status: 200,
    description: "The day's registers and hours band.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The session names no restaurant, or holds no role in the one it names.",
  })
  async read(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<HouseDayResponse> {
    return this.day.read(user?.restaurantId, user?.userId);
  }
}
