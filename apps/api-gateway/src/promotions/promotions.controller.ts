import {
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { PromotionsService, type PromotionsReadDto } from "./promotions.service";

type AuthUser = { userId?: string; restaurantId?: string | null };

/**
 * The caller's house, from the token — never from a query param or a body.
 * A session that names no house is refused before any table is read, the
 * same shape `provider-intelligence.controller.ts` took in PR #416 (ADR
 * 0147): an unset `restaurantId` must never reach `.eq("restaurant_id", …)`.
 */
function houseOf(user: AuthUser | undefined): string {
  if (!user?.restaurantId) {
    throw new ForbiddenException("This session names no restaurant.");
  }
  return user.restaurantId;
}

/** A status the service chose deliberately (404, 403) survives; anything else is a 500. */
function rethrow(error: unknown, fallback: string): never {
  if (error instanceof HttpException) throw error;
  throw new HttpException(
    (error as { message?: string })?.message || fallback,
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

/**
 * The house's vendor offers, graded against its own book (sketch 113,
 * ADR 0160 §113; ADR 0144 §4).
 *
 * Owner/manager only (ADR 0124:357-362) — this read carries what a vendor
 * charges this house, the same reason `/vendor-intel` and the pricing
 * column are gated, and the legacy page's own reads were NOT (`Sidebar.tsx
 * :121-126` has no `minRole`; `provider-intelligence.controller.ts:21` is
 * `JwtAuthGuard` only). A staff account that could see offers on the legacy
 * page gets a named refusal here, not a silent empty list — see
 * `PromotionsNext.tsx`'s role-withheld state.
 *
 * No request body accepted on either write: the id comes from the path and
 * the actor from the token, per the house's own write-shape convention
 * (`ADR 0083`).
 */
@ApiTags("Promotions")
@ApiBearerAuth()
@Controller("promotions")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @ApiOperation({
    summary: "This house's offers, graded against its own ledger",
    description:
      "Each offer carries its state (open/undated/passed/dismissed), its grade against the " +
      "house's own last landed cost with this vendor and the best other vendor it has actually " +
      "paid, and — for a bundle — the aggregate worth when every named wine has one.",
  })
  @ApiQuery({ name: "includeDismissed", required: false, type: Boolean })
  @ApiResponse({ status: 200, description: "The house's offers and the ledger window they were read against" })
  @ApiResponse({ status: 403, description: "Not owner or manager" })
  async read(
    @CurrentUser() user: AuthUser,
    @Query("includeDismissed") includeDismissed?: string,
  ): Promise<PromotionsReadDto> {
    const house = houseOf(user);
    try {
      return await this.promotions.readForHouse(house, {
        includeDismissed: includeDismissed === "true",
      });
    } catch (error) {
      rethrow(error, "The house's offers could not be read");
    }
  }

  @Post(":id/dismiss")
  @ApiOperation({
    summary: "Put an offer away for the whole house",
    description: "House-wide, not per-device (ADR 0144 §4) — records who and when.",
  })
  @ApiResponse({ status: 200, description: "Dismissed" })
  @ApiResponse({ status: 404, description: "No such offer on this house's table" })
  async dismiss(
    @CurrentUser() user: AuthUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<{ dismissed: true; dismissed_at: string }> {
    const house = houseOf(user);
    // `dismissed_by` records who put it away; a token with no person would
    // write an anonymous dismissal the house could not review.
    if (!user?.userId) {
      throw new ForbiddenException("This session names no person.");
    }
    try {
      return await this.promotions.dismiss(house, user.userId, id);
    } catch (error) {
      rethrow(error, "The offer could not be put away");
    }
  }

  @Post(":id/restore")
  @ApiOperation({ summary: "Bring a put-away offer back to the house's table" })
  @ApiResponse({ status: 200, description: "Restored" })
  @ApiResponse({ status: 404, description: "No such offer on this house's table" })
  async restore(
    @CurrentUser() user: AuthUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<{ restored: true }> {
    const house = houseOf(user);
    try {
      return await this.promotions.restore(house, id);
    } catch (error) {
      rethrow(error, "The offer could not be restored");
    }
  }
}
