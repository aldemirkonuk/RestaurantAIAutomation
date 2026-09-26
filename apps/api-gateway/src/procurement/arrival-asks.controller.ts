import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ArrivalAsksService } from "./arrival-asks.service";
import { NOT_YET } from "./overdue-order";

type AuthUser = { userId?: string; id?: string; restaurantId?: string };

const NO_HOUSE =
  "This session names no house, so there is no order to ask about.";

function who(user: AuthUser | null | undefined): {
  house: string;
  userId: string;
} {
  const house = user?.restaurantId;
  const userId = user?.userId ?? user?.id;
  if (!house || !userId) throw new ForbiddenException(NO_HOUSE);
  return { house, userId };
}

/**
 * "Did it arrive?" and the Incomplete orders register (ADR 0207, round 3).
 *
 * The house and the person come from the verified token only. Who is asked,
 * and who may answer, is `mayAnswerArrival` — owners and managers, and a
 * house's receiving area once the areas model lands. The typed act these
 * routes return is rendered on the receiving page (`/receiving`), and is the
 * shape the shell's counter reads when that lane picks it up.
 */
@ApiTags("procurement")
@Controller("procurement")
@UseGuards(JwtAuthGuard)
export class ArrivalAsksController {
  constructor(private readonly asks: ArrivalAsksService) {}

  @Get("arrival-asks")
  @ApiOperation({
    summary:
      'The orders past their expected date and not received — "Did it arrive?"',
    description:
      "Each ask carries its three choices: Yes — receive it (the receiving door), Not yet (recorded here, which confirms the order late for that expected date), Cancel (the sealed cancellation). An order someone already answered Not yet for is listed as confirmed_late with the other two choices. Orders more than 30 days past are not asked; they are in the Incomplete orders register. `forYou: false` means the caller is not one of the people asked — a rule, not a failure.",
  })
  async list(@CurrentUser() user: AuthUser) {
    const { house, userId } = who(user);
    return this.asks.asks(house, userId);
  }

  @Post("orders/:id/arrival-answers")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Answer "Not yet" for an order past its expected date',
  })
  @ApiResponse({
    status: 201,
    description: "The order's ask, now confirmed late",
  })
  @ApiResponse({
    status: 403,
    description: "The caller is not one of the people asked",
  })
  @ApiResponse({ status: 404, description: "No such order in this house" })
  @ApiResponse({
    status: 409,
    description:
      "The order is not past its expected date, is received or cancelled, or is in Incomplete orders",
  })
  async notYet(
    @CurrentUser() user: AuthUser,
    @Param("id") orderId: string,
    @Body() body: { answer?: unknown },
  ) {
    const { house, userId } = who(user);
    if (body?.answer !== NOT_YET)
      throw new BadRequestException(
        'The only answer recorded here is "not_yet". "Yes — receive it" opens the receiving door and "Cancel" is the sealed cancellation. Nothing was recorded.',
      );
    return this.asks.notYet(house, userId, orderId);
  }

  @Get("incomplete-orders")
  @ApiOperation({
    summary:
      "Incomplete orders — 30 days past the expected date and not arrived",
    description:
      "Out of the vendor scorecard's current figures until received (then counted late, with its true dates), cancelled, or closed with a credit. Listed under Documents & Reports.",
  })
  async incomplete(@CurrentUser() user: AuthUser) {
    const { house, userId } = who(user);
    return this.asks.incomplete(house, userId);
  }
}
