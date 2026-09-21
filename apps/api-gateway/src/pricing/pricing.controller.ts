import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { TenantGuard } from "../common/tenant/tenant.guard";
import { OrganizationsService } from "../organizations/organizations.service";
import { TargetMarginService, type TargetMarginReadout } from "./target-margin.service";
import { MarginAdviceService, type HouseAdvice } from "./margin-advice.service";
import { AcceptPriceAdviceDto, SetTargetMarginDto } from "./dto/pricing.dto";

/**
 * A house's target margin, and price advice toward it (ADR 0193).
 *
 * THE FOUNDER, 2026-09-21: "... advise the manager or owner to increase
 * decrease the prices so that the profit margin is where it's needed. We don't
 * want market average because that will be already shown in another column."
 *
 * TENANT SCOPE. Every route takes the restaurant from the signed token
 * (`@CurrentUser("restaurantId")`) and never from the path or the body, so
 * there is no id to tamper with. The two writes also run
 * `assertCanManageRestaurant`: only an owner or a manager may state the
 * house's target or accept a price change -- the founder's own words name
 * "the manager or owner".
 */
@ApiTags("pricing")
@Controller("pricing")
@UseGuards(JwtAuthGuard, TenantGuard)
export class PricingController {
  constructor(
    private readonly targets: TargetMarginService,
    private readonly advice: MarginAdviceService,
    private readonly organizations: OrganizationsService,
  ) {}

  private requireHouse(restaurantId: string | undefined, what: string): string {
    if (!restaurantId) {
      throw new HttpException(
        `This session is not attached to a restaurant, so ${what}.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return restaurantId;
  }

  @Get("target-margin")
  @ApiOperation({
    summary: "The margin this house needs on a bottle and on a glass, and who stated it",
    description:
      "PERCENT of the selling price (65 = cost is 35 percent of the price). `bottlePct`/`glassPct` null means not set, and price advice then says \"no target set\". `readable: false` means the row could not be read, which is a different state and says so.",
  })
  async getTargetMargin(
    @CurrentUser("restaurantId") restaurantId: string,
  ): Promise<TargetMarginReadout> {
    return this.targets.read(this.requireHouse(restaurantId, "there is no target margin to read"));
  }

  @Put("target-margin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "State the margin this house needs — owner or manager only",
    description:
      "bottlePct / glassPct are PERCENT between 5 and 95 (null = none for that kind, at least one required); bandPts is 'close enough' in margin points, 0 to 20, required. No defaults. Audited; the response carries `audited` / `auditReason`.",
  })
  @ApiResponse({ status: 403, description: "The caller is not an owner or manager of this restaurant." })
  async setTargetMargin(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Body() dto: SetTargetMarginDto,
  ): Promise<TargetMarginReadout> {
    const house = this.requireHouse(restaurantId, "nothing was recorded");
    await this.organizations.assertCanManageRestaurant(
      userId,
      house,
      "state the margin this restaurant needs",
    );
    return this.targets.write(house, dto ?? ({} as SetTargetMarginDto), userId);
  }

  @Get("advice")
  @ApiOperation({
    summary: "Per-wine advice toward the house's target margin: raise to X, lower to Y, on target, or why not",
    description:
      "For every active wine and for each of bottle and glass: the house's price, the recorded cost (invoiced lot WAC, then last purchase price, else unknown), the margin, and the advised price = cost / (1 - target). Never uses the market average. Nothing is changed by this read. A failed read is a 500, never an empty list.",
  })
  async getAdvice(@CurrentUser("restaurantId") restaurantId: string): Promise<HouseAdvice> {
    return this.advice.adviseHouse(this.requireHouse(restaurantId, "there is no advice to read"));
  }

  @Post("advice/:inventoryId/accept")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Accept one wine's price advice — one tap, owner or manager only",
    description:
      "The advice is re-computed here; if it is no longer the price the page showed, 409 and nothing changes. On accept: one pricing_analyses row (the why) and the price written through set_house_menu_price with change_source 'agent_accepted' and changed_by from the token.",
  })
  @ApiResponse({ status: 409, description: "No advice stands for this wine now, or it changed since it was shown." })
  async acceptAdvice(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("inventoryId", new ParseUUIDPipe()) inventoryId: string,
    @Body() dto: AcceptPriceAdviceDto,
  ) {
    const house = this.requireHouse(restaurantId, "nothing was changed");
    await this.organizations.assertCanManageRestaurant(
      userId,
      house,
      "change a wine's price",
    );
    return this.advice.accept(house, inventoryId, dto.kind, dto.advisedPrice, userId);
  }
}
