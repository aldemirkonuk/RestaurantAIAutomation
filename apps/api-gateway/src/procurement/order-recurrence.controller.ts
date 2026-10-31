/**
 * order-recurrence.controller — the four acts on an order's recurrence.
 *
 * SCOPED FROM THE TOKEN, NEVER FROM A PATH PARAMETER. `RecurringOrdersController`
 * takes `:restaurantId` from the URL, which means the tenant is whatever the
 * caller typed; `ProcurementController` reads `user.restaurantId` off the
 * verified JWT. This follows the second, because a recurrence is a standing
 * commitment to buy and the tenant it belongs to is not a caller's opinion.
 *
 * WHO MAY (ADR 0247, founder 2026-10-01). Pause, resume and end need a
 * manager or an owner, and so does replacing a rule an order already carries.
 * A first rule on an approved order may be set by the person who placed it, or
 * by a manager or an owner on any order. "Manager or owner" is the role
 * `OrganizationsService.assertCanManageRestaurant` reads, its fallback to the
 * legacy `users` row included. The checks live in `OrderRecurrenceService`,
 * beside the writes they guard.
 */

import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { OrderRecurrenceService } from "./order-recurrence.service";
import { SetOrderRecurrenceDto } from "./dto/order-recurrence.dto";

@ApiTags("procurement")
@UseGuards(JwtAuthGuard)
@Controller("procurement/orders")
export class OrderRecurrenceController {
  constructor(private readonly recurrence: OrderRecurrenceService) {}

  @Post(":id/recurrence")
  @ApiOperation({
    summary: "Set a recurrence rule on an approved order",
    description:
      "Refused on an order nobody has approved: a recurrence repeats an agreement, and an agreement is a thing a person sealed. The next date is DERIVED from the rule and the start date — the caller never sends one. This write approves nothing; every occurrence it produces is born PENDING and stops at the ADR 0116 gate. On an order that already carries a rule (active, paused or ended) it replaces that rule, which resumes a paused one and restarts an ended one; that needs a manager or an owner. A first rule needs no role on an order whose created_by is the caller, and a manager or an owner on any other order (ADR 0247).",
  })
  @ApiResponse({
    status: 400,
    description:
      "The order is not approved, is itself an occurrence of another order's rule, or the rule is one this house cannot run (an unknown frequency, an anchor outside its range, a start date that is not a calendar date).",
  })
  @ApiResponse({
    status: 403,
    description:
      "The order already carries a rule, or carries none and its created_by is not the caller, and the role check does not find owner or manager for the caller at this house (ADR 0247). Nothing is written.",
  })
  @ApiResponse({
    status: 409,
    description:
      "rule_set_meanwhile: the order carried no rule when it was read, and the write, conditioned on it still carrying none, matched no row, including when a rule was set on it between the read and the write. Nothing is written.",
  })
  setRecurrence(
    @Param("id") orderId: string,
    @Body() body: SetOrderRecurrenceDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    return this.recurrence.setRecurrence(
      user.restaurantId,
      orderId,
      user.userId,
      {
        frequency: body.frequency,
        anchorDay: body.anchorDay,
        startsOn: body.startsOn,
      },
    );
  }

  @Post(":id/recurrence/pause")
  @ApiOperation({
    summary: "Pause a recurrence, keeping its place in the calendar",
    description:
      "A plain write with an audit row naming who and when — deliberately NOT sealed. Pausing commits no money and destroys no record of money: every occurrence would have stopped at the approval gate anyway. See order-recurrence.service.ts for the argument and for what would change it.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The role check does not find owner or manager for the caller at this house (ADR 0247). It runs before the order is read, and nothing is written.",
  })
  pause(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    return this.recurrence.pauseRecurrence(
      user.restaurantId,
      orderId,
      user.userId,
    );
  }

  @Post(":id/recurrence/resume")
  @ApiOperation({
    summary: "Resume a paused recurrence",
    description:
      "The next date is rolled FORWARD to the next occurrence at or after today, and the audit row records both dates. Without that, a series paused in March and resumed in September would be six months overdue and the generator would mint one order a day until it caught up.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The role check does not find owner or manager for the caller at this house (ADR 0247). It runs before the order is read, and nothing is written.",
  })
  resume(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    return this.recurrence.resumeRecurrence(
      user.restaurantId,
      orderId,
      user.userId,
    );
  }

  @Post(":id/recurrence/end")
  @ApiOperation({
    summary: "End a recurrence",
    description:
      "Recorded with who and when. Pause, resume and end do not restart an ended rule. A manager or an owner may restart it by setting a new rule on the order (POST /procurement/orders/:id/recurrence).",
  })
  @ApiResponse({
    status: 403,
    description:
      "The role check does not find owner or manager for the caller at this house (ADR 0247). It runs before the order is read, and nothing is written.",
  })
  end(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    return this.recurrence.endRecurrence(
      user.restaurantId,
      orderId,
      user.userId,
    );
  }
}
