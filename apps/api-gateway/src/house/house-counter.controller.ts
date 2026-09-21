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
import { HouseCounterService } from "./house-counter.service";
import type { HouseCounterResponse } from "./house-counter.types";

/**
 * The counter — the shell's second organ (sketch 119 direction D; the
 * founder's pick of 2026-09-21). One read, seven registers, each answering for
 * itself. The house and the role are the token's; nothing here takes either as
 * a parameter.
 *
 * Every MEMBER has a counter: the route admits owner, manager and staff (and
 * admin, which `RolesGuard` ranks with owner/manager). The role decides a
 * register's outcome inside the answer (credits and invitations are refused to
 * staff, in words), so a staff member is told what they may not see rather than
 * being handed a 403 for the whole column.
 *
 * A session with NO role in the house the token names is refused whole (ADR
 * 0162: "null is no role, and `@Roles` refuses it"). That is a person whose
 * access row was deactivated while their token still names the house, or one
 * who never held one. Without this gate the counter handed such a session the
 * house's orders, replies, proposals — and the identity queue, whose own route
 * (`vendor-intel.controller.ts`, `@Roles("owner","manager","staff")`) refuses
 * them: one aggregate read must never be a wider door than the reads it sums.
 */
@ApiTags("house")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager", "staff")
@Controller("house")
export class HouseCounterController {
  constructor(private readonly counter: HouseCounterService) {}

  @Get("counter")
  @ApiOperation({
    summary: "What waits on the signed-in person, one outcome per register",
    description:
      "Seven registers (orders awaiting the seal, deliveries counted by case, credits promised, vendor replies waiting, identities to decide, invitations, the assistant's proposals). " +
      "Each is `answered` (count, `complete`, first rows, whose act), `refused` for this role (a sentence), or `unreadable` (status and a sentence). " +
      "There is no total: a sum over registers that did not all answer would print a failure as a zero.",
  })
  @ApiResponse({ status: 200, description: "Every register's own outcome." })
  @ApiResponse({
    status: 403,
    description:
      "The session names no restaurant, or holds no role in the one it names.",
  })
  async read(
    @CurrentUser()
    user: {
      userId: string;
      restaurantId: string;
      role?: string | null;
    },
  ): Promise<HouseCounterResponse> {
    return this.counter.read(
      user?.restaurantId,
      user?.userId,
      user?.role ?? null,
    );
  }
}
