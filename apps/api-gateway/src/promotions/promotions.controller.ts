import {
  Controller,
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
    @CurrentUser() user: { restaurantId: string },
    @Query("includeDismissed") includeDismissed?: string,
  ): Promise<PromotionsReadDto> {
    try {
      return await this.promotions.readForHouse(user.restaurantId, {
        includeDismissed: includeDismissed === "true",
      });
    } catch (error) {
      throw new HttpException(
        error.message || "The house's offers could not be read",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
    @CurrentUser() user: { restaurantId: string; userId?: string },
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<{ dismissed: true; dismissed_at: string }> {
    try {
      return await this.promotions.dismiss(user.restaurantId, user.userId as string, id);
    } catch (error) {
      throw new HttpException(
        error.message || "The offer could not be put away",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":id/restore")
  @ApiOperation({ summary: "Bring a put-away offer back to the house's table" })
  @ApiResponse({ status: 200, description: "Restored" })
  @ApiResponse({ status: 404, description: "No such offer on this house's table" })
  async restore(
    @CurrentUser() user: { restaurantId: string },
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<{ restored: true }> {
    try {
      return await this.promotions.restore(user.restaurantId, id);
    } catch (error) {
      throw new HttpException(
        error.message || "The offer could not be restored",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
