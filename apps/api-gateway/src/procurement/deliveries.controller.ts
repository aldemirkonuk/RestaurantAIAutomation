import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { DeliverySpineService } from "./canonical/delivery-spine.service";

type AuthedUser = { userId: string; restaurantId: string };

/**
 * The delivery — the commercial event of ADR 0103 D1 / ADR 0104 D7.
 *
 *   GET /procurement/deliveries/:id   the delivery and every document on it
 *
 * READ-ONLY in slice 2. State transitions, proposals and the door count are
 * later slices; nothing here writes.
 *
 * `restaurantId` comes from the token on every route, never from the request —
 * the gateway holds the service role, so that filter IS the tenant isolation.
 */
@ApiTags("procurement-deliveries")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("procurement/deliveries")
export class DeliveriesController {
  constructor(private readonly spine: DeliverySpineService) {}

  @Get(":id")
  @ApiOperation({
    summary: "One delivery and the documents on it",
    description:
      "The spine of ADR 0104 D13: state, provenance (an UNORDERED delivery carries a permanent mark), the delivery date, and every document on the event with the role it plays there. A read that failed throws; it never comes back as a delivery with no documents.",
  })
  async byId(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    const result = await this.spine.byId(user.restaurantId, id);
    if (!result.ok)
      throw new HttpException(result.error, HttpStatus.INTERNAL_SERVER_ERROR);
    // Reached only after a SUCCESSFUL read, so this is genuinely "no such
    // delivery for this restaurant" and not a query that broke.
    if (!result.value)
      throw new HttpException("Not found", HttpStatus.NOT_FOUND);
    return { delivery: result.value };
  }
}
