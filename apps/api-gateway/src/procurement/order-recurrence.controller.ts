/**
 * order-recurrence.controller — the four acts on an order's recurrence.
 *
 * SCOPED FROM THE TOKEN, NEVER FROM A PATH PARAMETER. `RecurringOrdersController`
 * takes `:restaurantId` from the URL, which means the tenant is whatever the
 * caller typed; `ProcurementController` reads `user.restaurantId` off the
 * verified JWT. This follows the second, because a recurrence is a standing
 * commitment to buy and the tenant it belongs to is not a caller's opinion.
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
      "Refused on an order nobody has approved: a recurrence repeats an agreement, and an agreement is a thing a person sealed. The next date is DERIVED from the rule and the start date — the caller never sends one. This write approves nothing; every occurrence it produces is born PENDING and stops at the ADR 0116 gate.",
  })
  @ApiResponse({
    status: 400,
    description:
      "The order is not approved, is itself an occurrence of another order's rule, or the rule is one this house cannot run (an unknown frequency, an anchor outside its range, a start date that is not a calendar date).",
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
    summary: "End a recurrence for good",
    description:
      "Recorded with who and when. An ended series is not restarted — a second life for one rule would make one standing order look like two; set a new recurrence on a current order instead.",
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
